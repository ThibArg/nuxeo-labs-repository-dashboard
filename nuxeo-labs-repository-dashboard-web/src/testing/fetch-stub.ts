/**
 * Minimal `fetch` double for the tests.
 *
 * Routes are matched on a substring of the request URL and, when needed, on the parsed request
 * body. Body matching matters because a dashboard issues its aggregation batch and its table
 * queries against the very same `_search` URL.
 */
export interface StubRoute {
  /** Substring the request URL must contain. */
  match: string;
  /** Further narrows the route by inspecting the parsed JSON body. */
  matchBody?: (body: unknown) => boolean;
  status?: number;
  /** Parsed and returned as JSON. Ignored when `text` is set. */
  json?: unknown;
  /** Raw body, used to simulate a login redirect returning HTML. */
  text?: string;
  contentType?: string;
}

export interface FetchStub {
  /** Every URL requested, in order. */
  readonly calls: { url: string; init?: RequestInit }[];
  /** Parsed bodies of the requests that carried one, in order. */
  readonly bodies: unknown[];
  restore(): void;
}

export function installFetchStub(routes: StubRoute[]): FetchStub {
  const original = globalThis.fetch;
  const calls: { url: string; init?: RequestInit }[] = [];
  const bodies: unknown[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });

    let parsedBody: unknown;
    if (typeof init?.body === 'string') {
      parsedBody = JSON.parse(init.body);
      bodies.push(parsedBody);
    }

    const route = routes.find(
      (candidate) =>
        url.includes(candidate.match) && (!candidate.matchBody || candidate.matchBody(parsedBody)),
    );
    if (!route) {
      return new Response('not found', { status: 404 });
    }

    const contentType = route.contentType ?? (route.text ? 'text/html' : 'application/json');
    const body = route.text ?? JSON.stringify(route.json ?? {});

    return new Response(body, {
      status: route.status ?? 200,
      headers: { 'content-type': contentType },
    });
  }) as typeof fetch;

  return {
    calls,
    bodies,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

/**
 * True for the batched widget aggregations request.
 *
 * `track_total_hits` is what tells it apart from the facet values request, which also carries
 * `size: 0` and an `aggs` block but never needs a total.
 */
export function isAggregationsRequest(body: unknown): boolean {
  const candidate = body as
    { size?: number; aggs?: unknown; track_total_hits?: boolean } | undefined;
  return (
    candidate?.size === 0 && candidate.aggs !== undefined && candidate.track_total_hits === true
  );
}

/** True for the filter group values request. */
export function isFacetValuesRequest(body: unknown): boolean {
  const candidate = body as
    { size?: number; aggs?: unknown; track_total_hits?: boolean } | undefined;
  return (
    candidate?.size === 0 && candidate.aggs !== undefined && candidate.track_total_hits !== true
  );
}

/** True for a table request: it asks for `_source` fields. */
export function isHitsRequest(body: unknown): boolean {
  const candidate = body as { _source?: unknown } | undefined;
  return candidate?._source !== undefined;
}

/** True for the preflight probe reading where the audit starts. */
export function isHorizonRequest(body: unknown): boolean {
  const candidate = body as { aggs?: Record<string, unknown> } | undefined;
  return candidate?.aggs?.['horizon'] !== undefined;
}

/** The audit answering, to the preflight, that its earliest entry is this instant. */
export function auditHorizonRoute(earliest: number): StubRoute {
  return {
    match: '/site/es/audit/_search',
    matchBody: isHorizonRequest,
    json: {
      took: 2,
      timed_out: false,
      hits: { total: { value: 1, relation: 'gte' }, hits: [] },
      aggregations: { horizon: { value: earliest } },
    },
  };
}

/** A healthy server: administrator session, passthrough on, every index answering. */
export function healthyServerRoutes(overrides: StubRoute[] = []): StubRoute[] {
  return [
    ...overrides,
    {
      match: '/api/v1/me',
      json: {
        'entity-type': 'user',
        id: 'Administrator',
        isAdministrator: true,
        isAnonymous: false,
        properties: { username: 'Administrator', firstName: 'John', lastName: 'Doe' },
      },
    },
    {
      match: '/api/v1/capabilities',
      json: {
        'entity-type': 'capabilities',
        server: { distributionName: 'Nuxeo', distributionVersion: '2025.22' },
        passthrough: { elasticsearch: true, 'elasticsearch-audit': true },
      },
    },
    { match: '/api/v1/config/types/RetentionRule', json: { name: 'RetentionRule' } },
    { match: '/site/es/', json: emptySearchResponse() },
  ];
}

export function emptySearchResponse(): unknown {
  return { took: 3, timed_out: false, hits: { total: { value: 0, relation: 'eq' }, hits: [] } };
}
