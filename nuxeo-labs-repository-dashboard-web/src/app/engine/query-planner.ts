/**
 * Turns a dashboard configuration into the smallest set of OpenSearch requests.
 *
 * The Nuxeo passthrough exposes neither `_msearch` nor `_mapping`, so issuing one request per
 * widget would mean a dozen round trips for a single screen. Instead every widget backed by an
 * aggregation is folded into one request, each widget owning a named aggregation and, when it
 * carries its own predicate, a `filter` wrapper. Table widgets need `hits` and therefore keep a
 * request of their own.
 */
import { EsIndex, EsSearchBody } from '../core/nuxeo.types';
import {
  AggConfig,
  DashboardConfig,
  FilterState,
  WidgetConfig,
  dateRangeFilter,
  isChartWidget,
  isKpiWidget,
  isTableWidget,
  scopeClauses,
  termsGroups,
} from '../config/dashboard-config.model';
import {
  DISTINCT_AGG,
  HistogramBounds,
  INNER_AGG,
  METRIC_AGG,
  compileAgg,
  compileMetric,
} from './agg-compiler';
import { compileTermsGroup } from './facet-clause';
import { EsClause, boolFilter, dayRangeFilter, startOfLocalDayMillis } from './es-query';

/** Name of the nested aggregation carrying a KPI's secondary figure. */
export const SECONDARY_AGG = 'secondary';

export type RequestKind = 'aggregations' | 'hits';

export interface PlannedRequest {
  /** Stable identifier, used as a key when dispatching responses. */
  id: string;
  kind: RequestKind;
  index: EsIndex;
  body: EsSearchBody;
  /** Widgets served by this request. */
  widgetIds: string[];
}

/**
 * How a widget's value must be read back from the response.
 *
 * `total` means the widget has neither a predicate nor a metric, so it is simply the number of
 * documents matching the dashboard filters: no aggregation is emitted for it at all.
 */
export type ReadStrategy = 'total' | 'aggregation' | 'hits';

export interface WidgetPlan {
  widgetId: string;
  requestId: string;
  read: ReadStrategy;
  /** True when the aggregation sits under a `filter` wrapper. */
  wrapped: boolean;
  /** True when values come from a nested metric rather than `doc_count`. */
  hasMetric: boolean;
  /** True when a secondary figure is nested under the wrapper. */
  hasSecondary: boolean;
}

export interface DashboardPlan {
  requests: PlannedRequest[];
  widgets: Map<string, WidgetPlan>;
  /** Widgets whose configuration could not be compiled, with the reason. */
  errors: Map<string, string>;
}

/**
 * Clauses shared by every widget of the dashboard.
 *
 * @param skipGroupId group left out of the result, used when computing the values of that very
 *                    group so that its own lists stay stable while the user edits them.
 */
export function globalFilters(
  config: DashboardConfig,
  filters: FilterState,
  skipGroupId?: string,
): EsClause[] {
  const clauses: EsClause[] = [...(config.baseFilter ?? [])];

  const range = dateRangeFilter(config);
  if (range) {
    const clause = dayRangeFilter(range.field, filters.range.from, filters.range.to);
    if (clause) {
      clauses.push(clause);
    }
  }

  for (const group of termsGroups(config)) {
    if (group.id === skipGroupId) {
      continue;
    }
    const clause = compileTermsGroup(group, filters);
    if (clause) {
      clauses.push(clause);
    }
  }

  return clauses;
}

/**
 * Days a daily chart must span, whatever the data holds.
 *
 * Only the field the date filter constrains is padded. Padding a histogram on another field would
 * be guesswork: documents created within the period may well have been modified outside it, so the
 * selected days say nothing about where those buckets belong.
 */
export function histogramBounds(
  config: DashboardConfig,
  filters: FilterState,
): HistogramBounds | null {
  const range = dateRangeFilter(config);
  const { from, to } = filters.range;
  if (!range || (!from && !to)) {
    return null;
  }
  return {
    field: range.field,
    ...(from ? { min: startOfLocalDayMillis(from) } : {}),
    ...(to ? { max: startOfLocalDayMillis(to) } : {}),
  };
}

/** Every widget id referenced by the layout, in display order, ignoring unknown ids. */
export function layoutWidgetIds(config: DashboardConfig): string[] {
  return config.layout.flatMap((row) => row.cells).filter((id) => id in config.widgets);
}

export function planDashboard(config: DashboardConfig, filters: FilterState): DashboardPlan {
  const shared = globalFilters(config, filters);
  const bounds = histogramBounds(config, filters);
  const requests: PlannedRequest[] = [];
  const widgets = new Map<string, WidgetPlan>();
  const errors = new Map<string, string>();

  const aggs: Record<string, EsClause> = {};
  const aggregationWidgetIds: string[] = [];
  const aggregationRequestId = `${config.id}:aggregations`;

  for (const widgetId of layoutWidgetIds(config)) {
    const widget = config.widgets[widgetId];

    if (isTableWidget(widget)) {
      try {
        requests.push(planTable(config, widgetId, widget, shared));
        widgets.set(widgetId, {
          widgetId,
          requestId: tableRequestId(config, widgetId),
          read: 'hits',
          wrapped: false,
          hasMetric: false,
          hasSecondary: false,
        });
      } catch (error) {
        errors.set(widgetId, error instanceof Error ? error.message : String(error));
      }
      continue;
    }

    try {
      const planned = planAggregationWidget(config, widgetId, widget, bounds);
      if (planned.agg) {
        aggs[widgetId] = planned.agg;
      }
      aggregationWidgetIds.push(widgetId);
      widgets.set(widgetId, {
        widgetId,
        requestId: aggregationRequestId,
        read: planned.read,
        wrapped: planned.wrapped,
        hasMetric: planned.hasMetric,
        hasSecondary: planned.hasSecondary,
      });
    } catch (error) {
      errors.set(widgetId, error instanceof Error ? error.message : String(error));
    }
  }

  if (aggregationWidgetIds.length) {
    requests.unshift({
      id: aggregationRequestId,
      kind: 'aggregations',
      index: config.index,
      body: {
        size: 0,
        track_total_hits: true,
        query: boolFilter(shared),
        ...(Object.keys(aggs).length ? { aggs } : {}),
      },
      widgetIds: aggregationWidgetIds,
    });
  }

  return { requests, widgets, errors };
}

interface AggregationWidgetPlan {
  /** Absent when the widget reads `hits.total` instead of an aggregation. */
  agg: EsClause | null;
  read: ReadStrategy;
  wrapped: boolean;
  hasMetric: boolean;
  hasSecondary: boolean;
}

function planAggregationWidget(
  config: DashboardConfig,
  widgetId: string,
  widget: WidgetConfig,
  bounds: HistogramBounds | null,
): AggregationWidgetPlan {
  // The scope narrows the shared query before the widget's own predicate does.
  const ownFilter = [...scopeClauses(config, widget), ...(widget.filter ?? [])];

  if (isKpiWidget(widget)) {
    const metric = compileMetric(widget.metric);
    const secondary = widget.secondary;

    /*
     * A secondary figure has to hang off a `filter` wrapper, so one is emitted even for an
     * unscoped tile. `match_all` costs nothing and keeps a single code path.
     */
    if (!ownFilter.length && !metric && !secondary) {
      return { agg: null, read: 'total', wrapped: false, hasMetric: false, hasSecondary: false };
    }

    if (!ownFilter.length && metric && !secondary) {
      return {
        agg: metric as EsClause,
        read: 'aggregation',
        wrapped: false,
        hasMetric: true,
        hasSecondary: false,
      };
    }

    const wrapper: EsClause = { filter: boolFilter(ownFilter) };
    const nested: Record<string, EsClause> = {};
    if (metric) {
      nested[METRIC_AGG] = metric;
    }
    if (secondary) {
      nested[SECONDARY_AGG] = { filter: boolFilter(secondary.filter) };
    }
    if (Object.keys(nested).length) {
      wrapper['aggs'] = nested;
    }

    return {
      agg: wrapper,
      read: 'aggregation',
      wrapped: true,
      hasMetric: metric !== null,
      hasSecondary: !!secondary,
    };
  }

  if (isChartWidget(widget)) {
    const inner = compileAgg(widget.agg, widget.metric, bounds);
    const hasMetric = compileMetric(widget.metric) !== null;
    const distinct = distinctAgg(widget.agg);

    /*
     * A `terms` list is a top N, so the reader deserves to know how many values it leaves out.
     * The count of distinct values hangs off the wrapper, beside the bucket list; a widget with
     * no predicate of its own gets a `match_all` wrapper for it, as a KPI with a secondary
     * figure already does.
     */
    if (!ownFilter.length && !distinct) {
      return { agg: inner, read: 'aggregation', wrapped: false, hasMetric, hasSecondary: false };
    }
    return {
      agg: {
        filter: boolFilter(ownFilter),
        aggs: { [INNER_AGG]: inner, ...(distinct ? { [DISTINCT_AGG]: distinct } : {}) },
      },
      read: 'aggregation',
      wrapped: true,
      hasMetric,
      hasSecondary: false,
    };
  }

  throw new Error(`Widget "${widgetId}" has an unsupported type`);
}

/** Counts the values a `terms` list had to choose from, so the omitted ones can be announced. */
function distinctAgg(agg: AggConfig): EsClause | null {
  if (!('terms' in agg) || agg.terms.size === undefined) {
    return null;
  }
  return { cardinality: { field: agg.terms.field } };
}

function tableRequestId(config: DashboardConfig, widgetId: string): string {
  return `${config.id}:table:${widgetId}`;
}

function planTable(
  config: DashboardConfig,
  widgetId: string,
  widget: Extract<WidgetConfig, { type: 'table' }>,
  shared: EsClause[],
): PlannedRequest {
  const sourceFields = [...new Set(widget.columns.map((column) => column.field))];
  const body: EsSearchBody = {
    size: widget.size ?? 20,
    track_total_hits: true,
    query: boolFilter([...shared, ...scopeClauses(config, widget), ...(widget.filter ?? [])]),
    // `ecm:uuid` is always fetched so that rows can link back to Web UI.
    _source: [...new Set([...sourceFields, 'ecm:uuid'])],
  };

  if (widget.sort?.length) {
    body.sort = widget.sort.map((entry) => ({ [entry.field]: { order: entry.order } }));
  }

  return {
    id: tableRequestId(config, widgetId),
    kind: 'hits',
    index: config.index,
    body,
    widgetIds: [widgetId],
  };
}
