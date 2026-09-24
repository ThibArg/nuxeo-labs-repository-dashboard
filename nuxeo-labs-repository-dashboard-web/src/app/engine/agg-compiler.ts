/**
 * Turns the declarative `AggConfig` into OpenSearch aggregation JSON.
 *
 * This is the only place where aggregation JSON is produced. Anything not described by
 * `AggConfig` is rejected, which keeps `script`, `runtime_mappings` and friends out of the
 * payload even though the passthrough would happily forward them for an administrator.
 */
import {
  AggConfig,
  CalendarInterval,
  HistogramInterval,
  MetricConfig,
  TermsOrder,
} from '../config/dashboard-config.model';
import { EsClause } from './es-query';
import { compileClause } from './clause-compiler';

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
  /**
   * First instant the index still holds, when the period starts before it.
   *
   * Padding stops there, since a day the index kept nothing of would be drawn as a day nothing
   * happened. The width is still chosen from `min`: the query bounds the data by the period, not
   * by the horizon, and an entry older than the horizon — one restored after it was measured —
   * must not turn a weekly chart into a daily one reaching back to that entry.
   */
  floor?: number;
}

/**
 * Most buckets an `auto_date_histogram` may answer.
 *
 * OpenSearch widens the buckets until the dates fit, so a stray `1601-01-01` in `dc:created` costs
 * the chart its resolution rather than costing the page its request: `search.max_buckets` is
 * 65,535 across the whole response, and one daily chart spanning four centuries is 150,000.
 */
export const AUTO_BUCKETS = 100;

/** What an `auto` interval becomes: a width chosen here, or a ceiling OpenSearch honours. */
export type ResolvedHistogram = { kind: 'calendar'; interval: CalendarInterval } | { kind: 'auto' };

const DAY_MILLIS = 86_400_000;

/**
 * Width a period of known days is drawn at.
 *
 * A day up to ninety-two, so the longest shortcut but one still shows its quiet days; a week up to
 * two years, which puts Last 12 months at about fifty-three bars rather than three hundred and
 * sixty-six; a month up to twenty years; a year beyond. The last step is not decoration: the date
 * fields accept any day from year 1, and a range typed from there drawn by the month is 24,000
 * buckets a chart, two such charts being most of the ceiling.
 */
export function intervalForPeriod(min: number, max: number): CalendarInterval {
  // Rounded, since a day around a daylight saving change is 23 or 25 hours long.
  const days = Math.round((max - min) / DAY_MILLIS) + 1;
  if (days <= 92) {
    return 'day';
  }
  if (days <= 2 * 366) {
    return 'week';
  }
  if (days <= 20 * 366) {
    return 'month';
  }
  return 'year';
}

/**
 * How one histogram is drawn for the active period.
 *
 * Only a histogram on the very field the period constrains, with both ends of the period known,
 * has a span the planner can measure: the query guarantees no entry lies outside it. Everywhere
 * else — "All time", an open ended range, `dc:modified` under a filter on `dc:created` — the span
 * is whatever the index holds, and only OpenSearch can see it.
 */
export function resolveHistogram(
  histogram: { field: string; calendar_interval: HistogramInterval },
  bounds: HistogramBounds | null | undefined,
): ResolvedHistogram {
  if (histogram.calendar_interval !== 'auto') {
    return { kind: 'calendar', interval: histogram.calendar_interval };
  }
  if (bounds?.field === histogram.field && bounds.min !== undefined && bounds.max !== undefined) {
    return { kind: 'calendar', interval: intervalForPeriod(bounds.min, bounds.max) };
  }
  return { kind: 'auto' };
}

/**
 * Bucket key pattern that says as much as the interval carries and no more.
 *
 * A monthly histogram formatted `yyyy-MM-dd` would label every bar with a first of the month,
 * which reads as a day rather than as a month.
 */
export function keyFormat(interval: CalendarInterval): string {
  switch (interval) {
    case 'hour':
      return 'yyyy-MM-dd HH:mm';
    case 'month':
      return 'yyyy-MM';
    case 'quarter':
    case 'year':
      return 'yyyy';
    default:
      return 'yyyy-MM-dd';
  }
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

/** Everything `MetricConfig` names beside `count` and `percentile`, which are handled apart. */
const SINGLE_VALUE_METRICS = ['cardinality', 'sum', 'avg', 'min', 'max'] as const;

export function compileMetric(metric: MetricConfig | undefined): EsClause | null {
  if (!metric || 'count' in metric) {
    return null;
  }
  if ('percentile' in metric) {
    const { field, percent } = metric.percentile;
    if (!(percent > 0 && percent < 100)) {
      throw new UnsupportedAggregationError(`percentile "${percent}" is not between 0 and 100`);
    }
    return { percentiles: { field: assertAggregatableField(field), percents: [percent] } };
  }
  /*
   * Read from the object rather than inferred from it. TypeScript is erased at runtime, so a
   * metric parsed from JSON arrives here carrying whatever key it was written with, and taking
   * the first one would send `significant_terms` — far more expensive than anything the union
   * names — where a single value was expected.
   */
  const [operator, field] = Object.entries(metric)[0] ?? [];
  if (!SINGLE_VALUE_METRICS.includes(operator as never) || typeof field !== 'string') {
    throw new UnsupportedAggregationError(`"${operator}" is not a metric this dashboard computes`);
  }
  return { [operator]: { field: assertAggregatableField(field) } };
}

/**
 * Whether this metric has no value at all over an empty set, as opposed to having the value zero.
 *
 * A count, a cardinality and a sum over nothing are all legitimately zero. An average, a minimum,
 * a maximum and a percentile are not: OpenSearch answers `null`, and rendering that as `0` states
 * a measurement that was never made. On a server where no workflow has ever completed, an average
 * duration tile would read `0 s`, which no reader can tell apart from a genuinely instantaneous
 * workflow.
 */
export function metricUndefinedWhenEmpty(metric: MetricConfig | undefined): boolean {
  return (
    !!metric && ('avg' in metric || 'min' in metric || 'max' in metric || 'percentile' in metric)
  );
}

/**
 * The `extended_bounds` body, or undefined when there is nothing to pad.
 *
 * `max` is the start of the last selected day, never the exclusive upper bound of the query: the
 * latter is the start of the following day, and would make the chart grow an empty bucket for a
 * day the reader did not ask about.
 *
 * A period lying wholly before the floor pads nothing: OpenSearch refuses a `min` above `max`, and
 * there is no day of it the index could hold.
 */
function extendedBounds(
  field: string,
  bounds: HistogramBounds | null | undefined,
): EsClause | undefined {
  if (!bounds || bounds.field !== field || (bounds.min === undefined && bounds.max === undefined)) {
    return undefined;
  }
  const min =
    bounds.min !== undefined && bounds.floor !== undefined
      ? Math.max(bounds.min, bounds.floor)
      : bounds.min;
  if (min !== undefined && bounds.max !== undefined && min > bounds.max) {
    return undefined;
  }
  return {
    ...(min !== undefined ? { min } : {}),
    ...(bounds.max !== undefined ? { max: bounds.max } : {}),
  };
}

/**
 * Path a `terms` order must use to reach the nested metric.
 *
 * A single value metric is addressed by its name alone, but `percentiles` is multi-valued: sorting
 * on `metric` would leave OpenSearch unable to tell which percentile is meant, so the path carries
 * it — `metric.50`. Verified against the passthrough, which forwards the order untouched.
 */
function metricOrderPath(metric: MetricConfig | undefined): string {
  return metric && 'percentile' in metric
    ? `${METRIC_AGG}.${metric.percentile.percent}`
    : METRIC_AGG;
}

function compileTermsOrder(
  order: TermsOrder | undefined,
  metric: MetricConfig | undefined,
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
      return { [metricOrderPath(metric)]: order === 'metric_desc' ? 'desc' : 'asc' };
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
 *               period says nothing about where the buckets should be. The same test decides what
 *               an `auto` interval becomes; see `resolveHistogram`.
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
    const { field, size, order, missing, execution_hint } = agg.terms;
    const terms: EsClause = { field: assertAggregatableField(field) };
    if (size !== undefined) {
      terms['size'] = size;
      terms['shard_size'] = shardSizeFor(size);
    }
    const compiledOrder = compileTermsOrder(order, metric, compiledMetric !== null);
    if (compiledOrder) {
      terms['order'] = compiledOrder;
    }
    if (missing !== undefined) {
      terms['missing'] = missing;
    }
    /*
     * A `terms` on a keyword defaults to global ordinals: a table of every value the shard holds,
     * built whatever the filter selects and rebuilt after any refresh that touched the shard. On
     * `docUUID` that is every document the audit ever named, so the most downloaded documents of a
     * week cost a table of years. `map` hashes the values of the documents actually collected
     * instead, which is cheaper exactly when those are few beside the values the field holds.
     * Only `map` is accepted: the other hint, `global_ordinals`, is what a keyword gets anyway, and
     * a closed set that lists only what is needed is the point.
     */
    if (execution_hint !== undefined) {
      if (execution_hint !== 'map') {
        throw new UnsupportedAggregationError(
          `execution_hint "${execution_hint}" is not accepted on "${field}"; only "map" is`,
        );
      }
      terms['execution_hint'] = 'map';
    }
    return withMetric({ terms });
  }

  if ('date_histogram' in agg) {
    const { field, calendar_interval, format, min_doc_count, time_zone } = agg.date_histogram;
    assertAggregatableField(field);
    if (calendar_interval === 'auto' && min_doc_count !== undefined) {
      throw new UnsupportedAggregationError(
        `"${field}" cannot combine min_doc_count with an automatic interval, ` +
          'which OpenSearch may answer with an aggregation that has no such setting',
      );
    }
    const zone = time_zone ? assertTimeZone(time_zone) : browserTimeZone();
    const resolved = resolveHistogram(agg.date_histogram, bounds);

    /*
     * Every bucket it answers is kept, empty ones included, as a `date_histogram` with
     * `min_doc_count: 0` would. That matters on a category axis, where a missing bucket does not
     * leave a gap: it moves the next bar up against the previous one.
     */
    if (resolved.kind === 'auto') {
      return withMetric({
        auto_date_histogram: {
          field,
          buckets: AUTO_BUCKETS,
          minimum_interval: 'day',
          format: format ?? keyFormat('day'),
          ...(zone ? { time_zone: zone } : {}),
        },
      });
    }

    const histogram: EsClause = {
      field,
      calendar_interval: resolved.interval,
      min_doc_count: min_doc_count ?? 0,
    };
    const pattern = format ?? (calendar_interval === 'auto' ? keyFormat(resolved.interval) : null);
    if (pattern) {
      histogram['format'] = pattern;
    }
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
    /*
     * The sub-filters are query clauses, so they go through the clause compiler like any other.
     * This was the one place an aggregation could still carry raw DSL, which made the closed
     * union true of everything except itself.
     */
    const compiled = Object.fromEntries(
      Object.entries(filters).map(([key, clause]) => [key, compileClause(clause)]),
    );
    return withMetric({ filters: { filters: compiled } });
  }

  throw new UnsupportedAggregationError(
    `"${Object.keys(agg as object).join(', ')}" is not a known aggregation`,
  );
}
