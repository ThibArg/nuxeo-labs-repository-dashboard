import { Injectable, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { EsIndex, EsResponse, EsSearchBody } from './nuxeo.types';

/**
 * How long OpenSearch may work on a dashboard search before it stops it.
 *
 * The passthrough is synchronous and cancels nothing: a search the browser gave up on, or one a
 * reader superseded by choosing another period, would otherwise run to its end, holding a search
 * thread per shard. Sent as `cancel_after_time_interval`, which OpenSearch 1.1 introduced. Kept
 * under the 121 s the passthrough's socket waits by default, so that OpenSearch gives up first and
 * frees what it holds; an administrator who lowered `nuxeo.opensearch1.client.socketTimeout` below
 * it gets the socket's error first, and the search still stops here.
 */
export const SEARCH_CANCEL_AFTER = '90s';

/** Raised for any non-2xx response, carrying enough context to render a useful message. */
export class NuxeoHttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
    message?: string,
  ) {
    super(message ?? `${status} on ${url}`);
    this.name = 'NuxeoHttpError';
  }

  /** Nuxeo answers 401 by redirecting to login.jsp; a fetch sees an opaque-ish HTML page. */
  get isAuthenticationFailure(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

/**
 * Thin fetch wrapper around the Nuxeo server.
 *
 * Deliberately not using the `nuxeo` JS client: the dashboard only needs three call shapes, and
 * the client is a CommonJS bundle that cannot be tree-shaken (it would pull batch upload,
 * directories, OAuth2, a Buffer polyfill, ...).
 *
 * Authentication relies entirely on the existing JSESSIONID cookie, hence
 * `credentials: 'same-origin'` on every request.
 */
@Injectable({ providedIn: 'root' })
export class NuxeoHttpService {
  private readonly document = inject(DOCUMENT);

  /**
   * Server root, derived from the `<base href>` injected at package time.
   *
   * In production the base is `/nuxeo/dashboard/`, so the root is `/nuxeo`.
   * Under `ng serve` the base is `/`, and the dev proxy forwards `/nuxeo/**`, so the root is
   * `/nuxeo` as well.
   */
  readonly serverRoot: string = this.computeServerRoot();

  private computeServerRoot(): string {
    const base = this.document.querySelector('base')?.getAttribute('href') ?? '/';
    // `/nuxeo/dashboard/` -> `/nuxeo` ; `/` -> `/nuxeo`
    const match = /^(.*)\/dashboard\/?$/.exec(base);
    return match ? match[1] || '' : '/nuxeo';
  }

  /** Absolute URL of a REST API v1 path, e.g. `me` -> `/nuxeo/api/v1/me`. */
  apiUrl(path: string): string {
    return `${this.serverRoot}/api/v1/${path.replace(/^\/+/, '')}`;
  }

  /**
   * False once the cluster has refused `cancel_after_time_interval`, which only the preflight's
   * first search finds out. A cluster older than OpenSearch 1.1 answers 400 to a parameter it
   * does not know, on every search, so sending it anyway would take every screen down.
   */
  private cancelling = true;

  get cancelsSearches(): boolean {
    return this.cancelling;
  }

  /** For the rest of the session, sends searches without asking OpenSearch to stop them. */
  stopCancellingSearches(): void {
    this.cancelling = false;
  }

  /**
   * Absolute URL of an OpenSearch passthrough search.
   *
   * The passthrough appends the query string it received to the URL it forwards, for every index
   * it exposes (`AbstractSearchRequestFilterImpl.getUrl`), so a parameter here reaches OpenSearch.
   */
  esUrl(index: EsIndex): string {
    const url = `${this.serverRoot}/site/es/${index}/_search`;
    return this.cancelling ? `${url}?cancel_after_time_interval=${SEARCH_CANCEL_AFTER}` : url;
  }

  /** `GET` on the REST API v1, returning parsed JSON. */
  async get<T>(path: string, options: { headers?: Record<string, string> } = {}): Promise<T> {
    return this.request<T>(this.apiUrl(path), {
      method: 'GET',
      headers: { accept: 'application/json', ...options.headers },
    });
  }

  /**
   * `GET` on a static JSON resource served by the server outside the REST API, such as Web UI's
   * translation bundle at `/nuxeo/ui/i18n/messages.json`.
   */
  async getStatic<T>(path: string): Promise<T> {
    return this.request<T>(`${this.serverRoot}/${path.replace(/^\/+/, '')}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
  }

  /**
   * Runs a search through the OpenSearch passthrough.
   *
   * `Content-Type: application/json` is mandatory: without it JAX-RS routes the call to the
   * form-urlencoded variant of the resource and the server answers 500.
   */
  async search<T = Record<string, unknown>>(
    index: EsIndex,
    body: EsSearchBody,
  ): Promise<EsResponse<T>> {
    try {
      return await this.request<EsResponse<T>>(this.esUrl(index), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (error) {
      /*
       * A cancelled search reaches the browser as a Nuxeo 500 wrapping OpenSearch's error. Said as
       * it stands, "500 on …" would read as a broken server rather than as a search asked to do
       * too much. The reason of a cancellation on time is written the same way every time,
       * "Cancellation timeout of 1.5m is expired" (`TimeoutTaskCancellationUtility`); a shard that
       * had not started yet says only that its parent task was cancelled.
       */
      if (error instanceof NuxeoHttpError && error.body.includes('task_cancelled_exception')) {
        throw new NuxeoHttpError(
          error.status,
          error.url,
          error.body,
          error.body.includes('Cancellation timeout of')
            ? `OpenSearch stopped the search on the ${index} index after ${SEARCH_CANCEL_AFTER}, ` +
                'before it had answered. A shorter period asks less of it.'
            : `OpenSearch cancelled the search on the ${index} index before it had answered.`,
        );
      }
      throw error;
    }
  }

  /**
   * Runs an Automation operation, returning its parsed result.
   *
   * Used for the lookups the REST API cannot answer in one call, such as `UserGroup.Suggestion`,
   * which searches users and groups together and composes their display label server side. The
   * abort signal lets a caller drop a reply it no longer wants, which is what keeps a fast typist
   * from seeing answers arrive out of order.
   */
  async operation<T>(
    id: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.request<T>(this.apiUrl(`automation/${id}`), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ params, context: {} }),
      ...(signal ? { signal } : {}),
    });
  }

  private async request<T>(url: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url, { ...init, credentials: 'same-origin' });
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new NuxeoHttpError(0, url, '', `Network error while calling ${url}: ${reason}`);
    }

    if (!response.ok) {
      throw new NuxeoHttpError(response.status, url, await this.safeText(response));
    }

    // A login redirect answers 200 with an HTML page; treat it as an authentication failure.
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('json')) {
      const body = await this.safeText(response);
      if (/<html/i.test(body)) {
        throw new NuxeoHttpError(401, url, body, 'Session expired, please sign in again.');
      }
      throw new NuxeoHttpError(response.status, url, body, `Unexpected content type on ${url}`);
    }

    return (await response.json()) as T;
  }

  private async safeText(response: Response): Promise<string> {
    try {
      return (await response.text()).slice(0, 2000);
    } catch {
      return '';
    }
  }
}
