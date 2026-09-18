/**
 * Small helpers to assemble OpenSearch bodies.
 *
 * Field naming rules that matter here (Nuxeo LTS 2025 `opensearch1-doc-mapping.json`):
 *  - strings are mapped straight to `keyword` by a dynamic template, so aggregation fields must
 *    NEVER carry a `.keyword` suffix;
 *  - `dc:title` is the exception: it is `text` with `fielddata: true`. Read it from `_source`
 *    instead of aggregating on it;
 *  - complex properties use a dot, not a slash: `file:content.length`;
 *  - `ecm:retainUntil` is only written when non null, so combine it with an `exists` clause.
 */
import { EsSearchBody } from '../core/nuxeo.types';

export type EsClause = Record<string, unknown>;

/**
 * Clauses excluding the technical documents that would otherwise inflate every count:
 * versions, proxies and trashed documents.
 */
export function liveDocumentsFilter(): EsClause[] {
  return [
    { term: { 'ecm:isVersion': false } },
    { term: { 'ecm:isProxy': false } },
    { term: { 'ecm:isTrashed': false } },
  ];
}

/** Wraps clauses into a `bool.filter` query, or `match_all` when there is nothing to filter. */
export function boolFilter(clauses: EsClause[]): EsClause {
  return clauses.length ? { bool: { filter: clauses } } : { match_all: {} };
}

/**
 * A counting sub-aggregation.
 *
 * This is the mechanism that lets many widgets share a single request: each widget that needs its
 * own predicate becomes a `filter` aggregation instead of a separate round trip. It matters
 * because the Nuxeo passthrough does not expose `_msearch`.
 */
export function countWhere(...clauses: EsClause[]): EsClause {
  return { filter: boolFilter(clauses) };
}

/** Builds a `size: 0` body that only carries aggregations. */
export function aggregationOnlyBody(
  filters: EsClause[],
  aggs: Record<string, EsClause>,
): EsSearchBody {
  return {
    size: 0,
    track_total_hits: true,
    query: boolFilter(filters),
    aggs,
  };
}

/**
 * Subtree filter, mirroring how Nuxeo translates `ecm:path STARTSWITH`.
 *
 * `ecm:path` is a keyword with a `.children` sub-field analysed as a path hierarchy. The parent
 * itself is excluded, as the platform does since NXP-18955.
 */
export function underPath(path: string): EsClause {
  const normalised = path.replace(/\/+$/, '');
  if (!normalised) {
    return { exists: { field: 'ecm:parentId' } };
  }
  return {
    bool: {
      must: [{ term: { 'ecm:path.children': normalised } }],
      must_not: [{ term: { 'ecm:path': normalised } }],
    },
  };
}

/** Lower bounded date range, using OpenSearch date math such as `now-30d`. */
export function sinceFilter(field: string, from: string): EsClause {
  return { range: { [field]: { gte: from } } };
}
