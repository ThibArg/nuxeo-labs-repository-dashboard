import { Injectable, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { EsIndex, EsResponse, EsSearchBody } from './nuxeo.types';

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

  /** Absolute URL of an OpenSearch passthrough path. */
  esUrl(index: EsIndex): string {
    return `${this.serverRoot}/site/es/${index}/_search`;
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
    return this.request<EsResponse<T>>(this.esUrl(index), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
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
