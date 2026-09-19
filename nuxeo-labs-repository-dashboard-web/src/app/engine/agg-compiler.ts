/**
 * Turns the declarative `AggConfig` into OpenSearch aggregation JSON.
 *
 * This is the only place where aggregation JSON is produced. Anything not described by
 * `AggConfig` is rejected, which keeps `script`, `runtime_mappings` and friends out of the
 * payload even though the passthrough would happily forward them for an administrator.
 */
import { AggConfig, MetricConfig, TermsOrder } from '../config/dashboard-config.model';
import { EsClause } from './es-query';

/** Name of the nested single value metric aggregation. */
export const METRIC_AGG = 'metric';

/** Name of the aggregation counting the distinct terms a `terms` bucket list had to choose from. */
export const DISTINCT_AGG = 'distinct';

/**
 * Candidate list each shard contributes to the merge.
 *
 * A `terms` aggregation ranks locally on every shard, so the coordinating node can only build an
 * exact top N if each shard hands over more candidates than the final list holds. OpenSearch
 * defaults to `size * 1.5 + 10`, which is thin: on the five shard audit index that is twenty-five
 * candidates per shard, enough for a term to be missed and for a returned count to be short.
 */
export function shardSizeFor(size: number): number {
  return Math.max(size * 5, 100);
}

/** Name of the aggregation nested under a per widget `filter` wrapper. */
export const INNER_AGG = 'inner';

/**
 * Instants a `date_histogram` must span, whatever the data holds.
 *
 * Derived from the active period, never written in a configuration file: the bounds are a fact
 * about what the reader asked to see, not something an administrator should be able to set. This
 * is also what keeps `AggConfig` a closed union.
 *
 * Epoch milliseconds, and not a date string: OpenSearch parses a string bound with the
 * aggregation's own `format`, so a histogram declaring `yyyy-MM-dd` — as every chart here does, to
 * get readable bucket keys — rejects an ISO instant with a 400. Verified against a live index.
 */
export interface HistogramBounds {
  /** Only a histogram on this very field is padded; see `compileAgg`. */
  field: string;
  min?: number;
  max?: number;
}

export class UnsupportedAggregationError extends Error {
  constructor(detail: string) {
    super(`Unsupported aggregation: ${detail}`);
    this.name = 'UnsupportedAggregationError';
  }
}

/**
 * Nuxeo maps strings straight to `keyword` through a dynamic template, so a `.keyword` suffix
 * silently matches nothing. Catching it here turns a puzzling empty chart into a clear error.
 */
function assertAggregatableField(field: string): string {
  if (!field) {
    throw new UnsupportedAggregationError('a field name is required');
  }
  if (field.endsWith('.keyword')) {
    throw new UnsupportedAggregationError(
      `"${field}" must not carry a .keyword suffix, Nuxeo indexes strings as keyword already`,
    );
  }
  if (field.includes('/')) {
    throw new UnsupportedAggregationError(
      `"${field}" uses a slash, complex properties are indexed with a dot (file:content.length)`,
    );
  }
  return field;
}

/**
 * Zone the date buckets are cut in.
 *
 * Without it OpenSearch cuts days at UTC midnight, so a document created at 23:30 in Paris lands
 * in the previous day's bucket and an evening of activity is credited to the wrong date. An IANA
 * name is sent rather than a fixed offset, so that a range spanning a daylight saving change is
 * still cut correctly on both sides of it.
 */
export function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    // No Intl data: better to omit the key and let OpenSearch default to UTC.
    return undefined;
  }
}

/** IANA names, fixed offsets and `UTC` only; anything else is a configuration mistake. */
function assertTimeZone(zone: string): string {
  if (!/^[A-Za-z0-9_/+:-]{1,64}$/.test(zone)) {
    throw new UnsupportedAggregationError(`"${zone}" is not a valid time zone`);
  }
  return zone;
}

export function compileMetric(metric: MetricConfig | undefined): EsClause | null {
  if (!metric || 'count' in metric) {
    return null;
  }
  const [operator, field] = Object.entries(metric)[0] as [string, string];
  return { [operator]: { field: assertAggregatableField(field) } };
}

/**
 * Whether this metric has no value at all over an empty set, as opposed to having the value zero.
 *
 * A count, a cardinality and a sum over nothing are all legitimately zero. An average, a minimum
 * and a maximum are not: OpenSearch answers `null`, and rendering that as `0` states a measurement
 * that was never made. On a server where no workflow has ever completed, an average duration tile
 * would read `0 s`, which no reader can tell apart from a genuinely instantaneous workflow.
 */
export function metricUndefinedWhenEmpty(metric: MetricConfig | undefined): boolean {
  return !!metric && ('avg' in metric || 'min' in metric || 'max' in metric);
}

/**
 * The `extended_bounds` body, or undefined when there is nothing to pad.
 *
 * `max` is the start of the last selected day, never the exclusive upper bound of the query: the
 * latter is the start of the following day, and would make the chart grow an empty bucket for a
 * day the reader did not ask about.
 */
function extendedBounds(
  field: string,
  bounds: HistogramBounds | null | undefined,
): EsClause | undefined {
  if (!bounds || bounds.field !== field || (bounds.min === undefined && bounds.max === undefined)) {
    return undefined;
  }
  return {
    ...(bounds.min !== undefined ? { min: bounds.min } : {}),
    ...(bounds.max !== undefined ? { max: bounds.max } : {}),
  };
}

function compileTermsOrder(
  order: TermsOrder | undefined,
  hasMetric: boolean,
): EsClause | undefined {
  switch (order) {
    case undefined:
    case 'count_desc':
      return undefined; // OpenSearch default
    case 'count_asc':
      return { _count: 'asc' };
    case 'key_asc':
      return { _key: 'asc' };
    case 'key_desc':
      return { _key: 'desc' };
    case 'metric_desc':
    case 'metric_asc':
      if (!hasMetric) {
        throw new UnsupportedAggregationError(`order "${order}" requires a metric to be declared`);
      }
      return { [METRIC_AGG]: order === 'metric_desc' ? 'desc' : 'asc' };
    default:
      throw new UnsupportedAggregationError(`unknown terms order "${order}"`);
  }
}

/**
 * Compiles an aggregation, optionally nesting a single value metric under it.
 *
 * @param bounds period the reader selected. A `date_histogram` only spans the days where
 *               something happened, so a quiet start of period silently shortens the chart;
 *               `extended_bounds` fixes that. It is applied only when the histogram groups by the
 *               very field the date filter constrains, since for any other field the selected
 *               period says nothing about where the buckets should be.
 * @returns the aggregation body, ready to be placed under an `aggs` key.
 */
export function compileAgg(
  agg: AggConfig,
  metric?: MetricConfig,
  bounds?: HistogramBounds | null,
): EsClause {
  const compiledMetric = compileMetric(metric);
  const withMetric = (body: EsClause): EsClause =>
    compiledMetric ? { ...body, aggs: { [METRIC_AGG]: compiledMetric } } : body;

  if ('terms' in agg) {
    const { field, size, order, missing } = agg.terms;
    const terms: EsClause = { field: assertAggregatableField(field) };
    if (size !== undefined) {
      terms['size'] = size;
      terms['shard_size'] = shardSizeFor(size);
    }
    const compiledOrder = compileTermsOrder(order, compiledMetric !== null);
    if (compiledOrder) {
      terms['order'] = compiledOrder;
    }
    if (missing !== undefined) {
      terms['missing'] = missing;
    }
    return withMetric({ terms });
  }

  if ('date_histogram' in agg) {
    const { field, calendar_interval, format, min_doc_count, time_zone } = agg.date_histogram;
    const histogram: EsClause = {
      field: assertAggregatableField(field),
      calendar_interval,
      min_doc_count: min_doc_count ?? 0,
    };
    if (format) {
      histogram['format'] = format;
    }
    const zone = time_zone ? assertTimeZone(time_zone) : browserTimeZone();
    if (zone) {
      histogram['time_zone'] = zone;
    }
    const extended = extendedBounds(field, bounds);
    if (extended) {
      histogram['extended_bounds'] = extended;
    }
    return withMetric({ date_histogram: histogram });
  }

  if ('range' in agg) {
    const { field, ranges } = agg.range;
    if (!ranges?.length) {
      throw new UnsupportedAggregationError('a range aggregation needs at least one range');
    }
    return withMetric({ range: { field: assertAggregatableField(field), ranges } });
  }

  if ('date_range' in agg) {
    const { field, ranges } = agg.date_range;
    if (!ranges?.length) {
      throw new UnsupportedAggregationError('a date_range aggregation needs at least one range');
    }
    return withMetric({ date_range: { field: assertAggregatableField(field), ranges } });
  }

  if ('filters' in agg) {
    const { filters } = agg.filters;
    if (!filters || !Object.keys(filters).length) {
      throw new UnsupportedAggregationError('a filters aggregation needs at least one filter');
    }
    return withMetric({ filters: { filters } });
  }

  throw new UnsupportedAggregationError(
    `"${Object.keys(agg as object).join(', ')}" is not a known aggregation`,
  );
}
