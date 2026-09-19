/** Shapes of the Nuxeo REST and OpenSearch payloads the dashboard consumes. */

/** `GET /api/v1/me` */
export interface NxCurrentUser {
  'entity-type': 'user';
  id: string;
  isAdministrator: boolean;
  isAnonymous: boolean;
  properties: {
    username: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    groups?: string[];
  };
}

/** `GET /api/v1/capabilities` */
export interface NxCapabilities {
  'entity-type': 'capabilities';
  server?: {
    distributionName?: string;
    distributionVersion?: string;
    distributionServer?: string;
    hotfixVersion?: string;
  };
  repository?: Record<string, { queryBlobKeys?: boolean }>;
  cluster?: { enabled?: boolean; nodeId?: string };
  /**
   * Registered by OpenSearchPassthroughComponent since 2025.13. Absent on servers where the
   * passthrough bundle is not deployed at all.
   */
  passthrough?: {
    elasticsearch?: boolean;
    'elasticsearch-audit'?: boolean;
  };
}

/** A single document type as returned by `GET /api/v1/config/types`. */
export interface NxDocumentType {
  name: string;
  parent?: string;
  facets?: string[];
  schemas?: { name: string; '@prefix'?: string; fields?: Record<string, string> }[];
}

/** `GET /api/v1/config/types` */
export interface NxDocumentTypes {
  doctypes: Record<string, NxDocumentType>;
  schemas: Record<string, unknown>;
}

/* ==================== OpenSearch ==================== */

/** Any OpenSearch aggregation node. Narrowed by the result mapper, not here. */
export interface EsBucket {
  key: string | number;
  key_as_string?: string;
  doc_count: number;
  [aggregationName: string]: unknown;
}

export interface EsAggregation {
  /** `terms`, `date_histogram`, `range`, `filters`, ... */
  buckets?: EsBucket[] | Record<string, EsBucket>;
  /** Single-value metrics: `cardinality`, `avg`, `sum`, `min`, `max`. Null over an empty set. */
  value?: number | null;
  /** Multi-value metrics: `percentiles`. Each entry is null over an empty set. */
  values?: Record<string, number | null>;
  /** `filter` aggregation wrapper. */
  doc_count?: number;
  [nestedAggregationName: string]: unknown;
}

export interface EsHit<T = Record<string, unknown>> {
  _id: string;
  _index: string;
  _score?: number | null;
  _source: T;
  sort?: unknown[];
}

export interface EsResponse<T = Record<string, unknown>> {
  took: number;
  timed_out: boolean;
  hits: {
    total: { value: number; relation: 'eq' | 'gte' } | number;
    max_score?: number | null;
    hits: EsHit<T>[];
  };
  aggregations?: Record<string, EsAggregation>;
}

/** Search request body sent to the passthrough. */
export interface EsSearchBody {
  size?: number;
  from?: number;
  query?: Record<string, unknown>;
  aggs?: Record<string, unknown>;
  sort?: unknown[];
  _source?: string[] | boolean;
  track_total_hits?: boolean;
}

/** Indices exposed by the Nuxeo passthrough. `audit` and `audit_wf` are virtual aliases. */
export type EsIndex = 'nuxeo' | 'audit' | 'audit_wf';

/** Reads `hits.total` regardless of the `track_total_hits` representation. */
export function totalHits(response: EsResponse): number {
  const total = response.hits?.total;
  if (typeof total === 'number') {
    return total;
  }
  return total?.value ?? 0;
}
