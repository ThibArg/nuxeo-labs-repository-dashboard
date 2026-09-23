/**
 * The shapes the library is made of.
 *
 * Sixty-five widgets are placed across the six screens and they are a handful of ideas; two of
 * them — counting a population and ranking the top values of a field — account for fifty-four. So
 * the reuse worth having is here, in a handful of builders, while the *names* stay one per idea: a
 * composition that said `topNChart('ecm:primaryType')` would be back to writing queries by hand.
 */
import {
  ChartWidgetType,
  ColumnConfig,
  DateRangeBucket,
  HistogramInterval,
  KpiSeverity,
  LabelStrategy,
  MetricConfig,
  NumericRange,
  TermsOrder,
  ValueFormat,
} from '../config/dashboard-config.model';
import { keyFormat } from '../engine/agg-compiler';
import { ParamSpecs, WidgetBody } from './definition';
import { Predicate, anyOf, compilePredicates } from './predicates';

/**
 * Parameters every repository widget accepts, so any of them can describe part of the content.
 *
 * `satisfies` rather than an annotation: an annotation would widen this to
 * `Record<string, ParamSpec>`, and a definition spreading it would then derive a build argument
 * with an index signature instead of `types` and `facets` — which is exactly the looseness
 * `ParamsOf` exists to remove.
 */
export const RESTRICTION_PARAMS = {
  types: {
    type: 'string[]' as const,
    describe: 'Restrict to these document types. Absent or empty means no constraint.',
  },
  facets: {
    type: 'string[]' as const,
    describe: 'Restrict to documents carrying these facets. Absent or empty means no constraint.',
  },
} satisfies ParamSpecs;

export interface Restrictions {
  types?: string[];
  facets?: string[];
}

/** Predicates the restriction parameters add, which are silent when nothing was asked. */
export function restrict(params: Restrictions): Predicate[] {
  return [anyOf('ecm:primaryType', params.types), anyOf('ecm:mixinType', params.facets)];
}

export interface SecondaryFigure {
  of: Predicate[];
  /** Template where `{value}` is replaced by the formatted count. */
  label: string;
  hideWhenZero?: boolean;
  format?: ValueFormat;
}

/**
 * A single figure describing one population.
 *
 * `of` is the whole population, composed by the definition, because the order of the clauses is
 * what the planner hands to OpenSearch and a reader comparing two tiles is entitled to the same
 * reading of both.
 */
export function countTile(options: {
  of: Predicate[];
  /**
   * What is measured instead of the number of documents.
   *
   * An average, a minimum, a maximum and a percentile have no value over an empty set — the index
   * answers null and the tile shows a dash rather than a zero, since `0 s` and "never happened"
   * are not the same statement.
   */
  metric?: MetricConfig;
  severity?: KpiSeverity;
  hint?: string;
  format?: ValueFormat;
  secondary?: SecondaryFigure;
}): WidgetBody {
  const filter = compilePredicates(options.of);
  return {
    type: 'kpi',
    ...(options.metric ? { metric: options.metric } : {}),
    ...(options.hint ? { hint: options.hint } : {}),
    ...(options.severity ? { severity: options.severity } : {}),
    ...(options.format ? { format: options.format } : {}),
    ...(filter.length ? { filter } : {}),
    ...(options.secondary
      ? {
          secondary: {
            filter: compilePredicates(options.secondary.of),
            label: options.secondary.label,
            ...(options.secondary.format ? { format: options.secondary.format } : {}),
            ...(options.secondary.hideWhenZero ? { hideWhenZero: true } : {}),
          },
        }
      : {}),
  };
}

/**
 * The values a field takes most often, drawn however the composition asked.
 *
 * `order: 'metric_desc'` ranks by the metric rather than by volume, which is what turns "the
 * models people use most" into "the models that take longest". The compiler derives the order
 * path, including the `metric.50` a percentile needs, so a definition cannot get it wrong.
 */
export function topNChart(options: {
  of: Predicate[];
  field: string;
  size: number;
  chart: ChartWidgetType;
  metric?: MetricConfig;
  order?: TermsOrder;
  labels?: LabelStrategy;
  hint?: string;
  format?: ValueFormat;
}): WidgetBody {
  const filter = compilePredicates(options.of);
  return {
    type: options.chart,
    ...(options.metric ? { metric: options.metric } : {}),
    ...(options.hint ? { hint: options.hint } : {}),
    ...(options.labels ? { labels: options.labels } : {}),
    ...(options.format ? { format: options.format } : {}),
    ...(filter.length ? { filter } : {}),
    agg: {
      terms: {
        field: options.field,
        size: options.size,
        ...(options.order ? { order: options.order } : {}),
      },
    },
  };
}

/**
 * Widths a trend may be drawn at, `auto` first because it is every trend's default.
 *
 * `auto` follows the period: a day up to ninety-two days, a week up to two years, a month up to
 * twenty, a year beyond, and a width OpenSearch picks when the period does not bound the field —
 * "All time", or `dc:modified` under a filter on `dc:created`. A composition naming a width keeps
 * it, and with it the risk `auto` exists to remove: a daily chart over "All time" spans whatever
 * dates the index holds, and one document dated 1899 is 46,000 buckets.
 */
export const TREND_INTERVALS = ['auto', 'hour', 'day', 'week', 'month', 'quarter', 'year'] as const;

/** How a volume, or a measure of it, moved over the period. */
export function trendChart(options: {
  of: Predicate[];
  field: string;
  interval: HistogramInterval;
  chart: ChartWidgetType;
  /** Computed per bucket instead of counting documents, e.g. how many distinct people logged in. */
  metric?: MetricConfig;
  /**
   * Drops the empty buckets, which a histogram otherwise draws between its first and its last.
   *
   * Worth it on a field whose values are sparse and scattered: retention dates falling in three
   * months over two years draw three bars this way and twenty-five otherwise. Never on a trend
   * over the filtered period, where a quiet day is information.
   */
  minDocCount?: number;
  hint?: string;
  format?: ValueFormat;
}): WidgetBody {
  const filter = compilePredicates(options.of);
  return {
    type: options.chart,
    ...(options.metric ? { metric: options.metric } : {}),
    ...(options.hint ? { hint: options.hint } : {}),
    ...(options.format ? { format: options.format } : {}),
    ...(filter.length ? { filter } : {}),
    agg: {
      date_histogram: {
        field: options.field,
        calendar_interval: options.interval,
        ...(options.interval === 'auto' ? {} : { format: keyFormat(options.interval) }),
        ...(options.minDocCount !== undefined ? { min_doc_count: options.minDocCount } : {}),
      },
    },
  };
}

/**
 * A population split into bands somebody decided on.
 *
 * The bands are written by the definition rather than passed by the composition: "under an hour,
 * up to a day, up to a week, beyond" *is* what `workflow-duration-distribution` means, and a
 * parameter for them would need a shape the closed `ParamSpec` union does not have. A different
 * split is a different widget.
 *
 * Numeric bands and date math bands are the same idea to a reader and two aggregations to the
 * index, so one builder carries both.
 */
export function bandChart(options: {
  of: Predicate[];
  field: string;
  chart: ChartWidgetType;
  bands: { numeric: NumericRange[] } | { dates: DateRangeBucket[] };
  hint?: string;
  format?: ValueFormat;
}): WidgetBody {
  const filter = compilePredicates(options.of);
  return {
    type: options.chart,
    ...(options.hint ? { hint: options.hint } : {}),
    ...(options.format ? { format: options.format } : {}),
    ...(filter.length ? { filter } : {}),
    agg:
      'numeric' in options.bands
        ? { range: { field: options.field, ranges: options.bands.numeric } }
        : { date_range: { field: options.field, ranges: options.bands.dates } },
  };
}

/**
 * The documents themselves, as rows.
 *
 * The only widget kind that needs `hits`, so the only one to keep a request of its own. Columns
 * are written by the definition for the same reason the bands above are: which four fields answer
 * "who is holding up what" is the idea, not a setting.
 *
 * Sorting matters more here than anywhere else. No dashboard lists records until it can paginate,
 * so a table is a top N of its sort and nothing else — and a table of twenty rows sorted by
 * nothing in particular describes nothing at all.
 */
export function recordTable(options: {
  of: Predicate[];
  columns: ColumnConfig[];
  sort: { field: string; order: 'asc' | 'desc' }[];
  size: number;
  hint?: string;
}): WidgetBody {
  const filter = compilePredicates(options.of);
  return {
    type: 'table',
    ...(options.hint ? { hint: options.hint } : {}),
    ...(filter.length ? { filter } : {}),
    columns: options.columns,
    sort: options.sort,
    size: options.size,
  };
}
