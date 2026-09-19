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

/**
 * Midnight opening a local calendar day.
 *
 * Parsed without a zone suffix, so the runtime reads it in the reader's own zone, and stepped with
 * `setDate` rather than by 86 400 000 ms: a day is 23 or 25 hours long around a daylight saving
 * change.
 */
function localDay(day: string, plusDays = 0): Date {
  const date = new Date(`${day}T00:00:00`);
  if (plusDays) {
    date.setDate(date.getDate() + plusDays);
  }
  return date;
}

/** Start of a local calendar day, as the UTC instant OpenSearch stores. */
export function startOfLocalDay(day: string, plusDays = 0): string {
  return localDay(day, plusDays).toISOString();
}

/**
 * Same instant, in epoch milliseconds.
 *
 * Needed by `extended_bounds`, which OpenSearch parses with the aggregation's own `format` when
 * the bound is a string. Our histograms declare `yyyy-MM-dd` to get readable bucket keys, so an
 * ISO instant is refused outright — "unparsed text found at index 10". A number is read as epoch
 * milliseconds and escapes the format entirely.
 */
export function startOfLocalDayMillis(day: string, plusDays = 0): number {
  return localDay(day, plusDays).getTime();
}

/**
 * Inclusive day range, expressed as a half open interval of instants.
 *
 * Dates are indexed as UTC instants — `eventDate` in the audit index is written by a formatter
 * pinned to UTC — while the reader picks calendar days in their own zone. Sending the start of the
 * day *after* the last one, with `lt`, covers that final day entirely, including its local
 * evening, without a `23:59:59.999` approximation and without relying on how OpenSearch rounds a
 * date given at day precision.
 *
 * @returns null when neither bound is set, so that "All time" adds no clause at all.
 */
export function dayRangeFilter(
  field: string,
  from: string | null,
  to: string | null,
): EsClause | null {
  if (!from && !to) {
    return null;
  }

  const bounds: Record<string, string> = {};
  if (from) {
    bounds['gte'] = startOfLocalDay(from);
  }
  if (to) {
    bounds['lt'] = startOfLocalDay(to, 1);
  }

  return { range: { [field]: bounds } };
}
