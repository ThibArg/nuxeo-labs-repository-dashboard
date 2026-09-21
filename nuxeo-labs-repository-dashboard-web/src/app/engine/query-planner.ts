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
  pathScopeFilter,
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
  metricUndefinedWhenEmpty,
} from './agg-compiler';
import { compileClauses } from './clause-compiler';
import { compilePicks, compileTermsGroup } from './facet-clause';
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
  /**
   * True when that metric has no value over an empty set, so the widget must say so rather than
   * show a zero. See `metricUndefinedWhenEmpty`.
   */
  metricUndefinedWhenEmpty: boolean;
  /** True when a secondary figure is nested under the wrapper. */
  hasSecondary: boolean;
  /**
   * True when bucket keys name principals and must be collapsed onto one form.
   *
   * `nt:actors` stores `Josh` and `user:Josh` for the same person, depending on which workflow
   * node created the task. See `core/principal.ts`.
   */
  mergePrincipals: boolean;
}

export interface DashboardPlan {
  requests: PlannedRequest[];
  widgets: Map<string, WidgetPlan>;
  /** Widgets whose configuration could not be compiled, with the reason. */
  errors: Map<string, string>;
}

/**
 * Date field the period constrains on one index.
 *
 * A page mixing the repository and the audit means two fields for one picker: `dc:created` there,
 * `eventDate` here. Returning null means the period constrains nothing on that index, which is
 * honest — a widget whose index the filter says nothing about is better left unfiltered than
 * filtered on a field it does not carry.
 */
export function dateFieldFor(config: DashboardConfig, index: EsIndex): string | null {
  const range = dateRangeFilter(config);
  if (!range) {
    return null;
  }
  return range.byIndex?.[index] ?? range.field;
}

/**
 * Clauses shared by every widget of the dashboard.
 *
 * @param skipGroupId group left out of the result, used when computing the values of that very
 *                    group so that its own lists stay stable while the user edits them.
 * @param index       index the clauses are built for, which decides the date field.
 */
export function globalFilters(
  config: DashboardConfig,
  filters: FilterState,
  skipGroupId?: string,
  index: EsIndex = config.index,
): EsClause[] {
  /*
   * The base filter is written by hand in the compiled form, so it goes through the clause
   * compiler like every other predicate. A page whose shared filter cannot be compiled fails as a
   * page rather than widget by widget, which is right: every figure on it would be wrong.
   */
  const clauses: EsClause[] = compileClauses(config.baseFilter);

  const field = dateFieldFor(config, index);
  if (field) {
    const clause = dayRangeFilter(field, filters.range.from, filters.range.to);
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

  /*
   * `ecm:path.children` is the path hierarchy sub-field: it holds every ancestor path as a token,
   * so one `term` matches a container and everything below it. That includes versions, which carry
   * the path of the document they were cut from — harmless where the dashboard already excludes
   * them in its `baseFilter`, and worth knowing where it does not.
   */
  if (pathScopeFilter(config) && filters.path) {
    clauses.push({ term: { 'ecm:path.children': filters.path } });
  }

  /*
   * Picked buckets narrow the facet value lists too, deliberately. They constrain a field no group
   * declares, so no dialog shows a list this could collapse — and a reader who has drilled into a
   * lifecycle state expects the type list beside it to describe what is left.
   */
  clauses.push(...compilePicks(filters.picks));

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
  index: EsIndex = config.index,
): HistogramBounds | null {
  const field = dateFieldFor(config, index);
  const { from, to } = filters.range;
  if (!field || (!from && !to)) {
    return null;
  }
  return {
    field,
    ...(from ? { min: startOfLocalDayMillis(from) } : {}),
    ...(to ? { max: startOfLocalDayMillis(to) } : {}),
  };
}

/** Every widget id referenced by the layout, in display order, ignoring unknown ids. */
export function layoutWidgetIds(config: DashboardConfig): string[] {
  return config.layout.flatMap((row) => row.cells).filter((id) => id in config.widgets);
}

/** Widget ids the layout shows, in display order, grouped by the index each one reads. */
function groupByIndex(config: DashboardConfig): Map<EsIndex, string[]> {
  const groups = new Map<EsIndex, string[]>();
  for (const widgetId of layoutWidgetIds(config)) {
    const index = config.widgets[widgetId].index ?? config.index;
    const group = groups.get(index);
    if (group) {
      group.push(widgetId);
    } else {
      groups.set(index, [widgetId]);
    }
  }
  return groups;
}

function aggregationRequestId(config: DashboardConfig, index: EsIndex): string {
  return index === config.index
    ? `${config.id}:aggregations`
    : `${config.id}:aggregations:${index}`;
}

/**
 * Folds a dashboard into one request per index.
 *
 * Widgets reading the same index travel together, which is what makes a composition row add up
 * and what makes `now` a single instant across the tiles bounded by it. Grouping rather than
 * batching everything is what lets a page mix the repository and the audit at all, the two having
 * neither the same fields nor the same date field.
 */
export function planDashboard(config: DashboardConfig, filters: FilterState): DashboardPlan {
  const widgets = new Map<string, WidgetPlan>();
  const errors = new Map<string, string>();
  const aggregationRequests: PlannedRequest[] = [];
  const tableRequests: PlannedRequest[] = [];

  for (const [index, widgetIds] of groupByIndex(config)) {
    const shared = globalFilters(config, filters, undefined, index);
    const bounds = histogramBounds(config, filters, index);
    const aggs: Record<string, EsClause> = {};
    const aggregationWidgetIds: string[] = [];
    const requestId = aggregationRequestId(config, index);

    for (const widgetId of widgetIds) {
      const widget = config.widgets[widgetId];

      if (isTableWidget(widget)) {
        try {
          tableRequests.push(planTable(config, widgetId, widget, shared, index));
          widgets.set(widgetId, {
            widgetId,
            requestId: tableRequestId(config, widgetId),
            read: 'hits',
            wrapped: false,
            hasMetric: false,
            metricUndefinedWhenEmpty: false,
            hasSecondary: false,
            mergePrincipals: false,
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
          requestId,
          read: planned.read,
          wrapped: planned.wrapped,
          hasMetric: planned.hasMetric,
          metricUndefinedWhenEmpty: planned.metricUndefinedWhenEmpty,
          hasSecondary: planned.hasSecondary,
          mergePrincipals: planned.mergePrincipals,
        });
      } catch (error) {
        errors.set(widgetId, error instanceof Error ? error.message : String(error));
      }
    }

    if (aggregationWidgetIds.length) {
      aggregationRequests.push({
        id: requestId,
        kind: 'aggregations',
        index,
        body: {
          size: 0,
          track_total_hits: true,
          query: boolFilter(shared),
          ...(Object.keys(aggs).length ? { aggs } : {}),
        },
        widgetIds: aggregationWidgetIds,
      });
    }
  }

  return { requests: [...aggregationRequests, ...tableRequests], widgets, errors };
}

interface AggregationWidgetPlan {
  /** Absent when the widget reads `hits.total` instead of an aggregation. */
  agg: EsClause | null;
  read: ReadStrategy;
  wrapped: boolean;
  hasMetric: boolean;
  metricUndefinedWhenEmpty: boolean;
  hasSecondary: boolean;
  mergePrincipals: boolean;
}

function planAggregationWidget(
  config: DashboardConfig,
  widgetId: string,
  widget: WidgetConfig,
  bounds: HistogramBounds | null,
): AggregationWidgetPlan {
  /*
   * The scope narrows the shared query before the widget's own predicate does. Both are compiled
   * rather than forwarded, so a refusal lands in the per widget error map the editor renders.
   */
  const ownFilter = compileClauses([...scopeClauses(config, widget), ...(widget.filter ?? [])]);

  if (isKpiWidget(widget)) {
    const metric = compileMetric(widget.metric);
    const undefinedWhenEmpty = metricUndefinedWhenEmpty(widget.metric);
    const secondary = widget.secondary;

    /*
     * A secondary figure has to hang off a `filter` wrapper, so one is emitted even for an
     * unscoped tile. `match_all` costs nothing and keeps a single code path.
     */
    if (!ownFilter.length && !metric && !secondary) {
      return {
        agg: null,
        read: 'total',
        wrapped: false,
        hasMetric: false,
        metricUndefinedWhenEmpty: false,
        hasSecondary: false,
        mergePrincipals: false,
      };
    }

    if (!ownFilter.length && metric && !secondary) {
      return {
        agg: metric as EsClause,
        read: 'aggregation',
        wrapped: false,
        hasMetric: true,
        metricUndefinedWhenEmpty: undefinedWhenEmpty,
        hasSecondary: false,
        mergePrincipals: false,
      };
    }

    const wrapper: EsClause = { filter: boolFilter(ownFilter) };
    const nested: Record<string, EsClause> = {};
    if (metric) {
      nested[METRIC_AGG] = metric;
    }
    if (secondary) {
      nested[SECONDARY_AGG] = { filter: boolFilter(compileClauses(secondary.filter)) };
    }
    if (Object.keys(nested).length) {
      wrapper['aggs'] = nested;
    }

    return {
      agg: wrapper,
      read: 'aggregation',
      wrapped: true,
      hasMetric: metric !== null,
      metricUndefinedWhenEmpty: metric !== null && undefinedWhenEmpty,
      hasSecondary: !!secondary,
      mergePrincipals: false,
    };
  }

  if (isChartWidget(widget)) {
    const inner = compileAgg(widget.agg, widget.metric, bounds);
    const hasMetric = compileMetric(widget.metric) !== null;
    const undefinedWhenEmpty = hasMetric && metricUndefinedWhenEmpty(widget.metric);
    const distinct = distinctAgg(widget.agg);

    /*
     * Bucket keys that name principals carry two forms of the same person, so they are collapsed
     * after the response comes back. Only document counts survive that: two averages recombine
     * only with their weights, and two cardinalities or percentiles not at all. Rather than merge
     * a figure that would be wrong, the widget fails loudly.
     */
    const mergePrincipals = widget.labels === 'user';
    if (mergePrincipals && hasMetric) {
      throw new Error(
        `Widget "${widgetId}" cannot merge principals and compute a metric: ` +
          'the two forms of a principal would have to be averaged, not added',
      );
    }

    /*
     * A `terms` list is a top N, so the reader deserves to know how many values it leaves out.
     * The count of distinct values hangs off the wrapper, beside the bucket list; a widget with
     * no predicate of its own gets a `match_all` wrapper for it, as a KPI with a secondary
     * figure already does.
     */
    if (!ownFilter.length && !distinct) {
      return {
        agg: inner,
        read: 'aggregation',
        wrapped: false,
        hasMetric,
        metricUndefinedWhenEmpty: undefinedWhenEmpty,
        hasSecondary: false,
        mergePrincipals,
      };
    }
    return {
      agg: {
        filter: boolFilter(ownFilter),
        aggs: { [INNER_AGG]: inner, ...(distinct ? { [DISTINCT_AGG]: distinct } : {}) },
      },
      read: 'aggregation',
      wrapped: true,
      hasMetric,
      metricUndefinedWhenEmpty: undefinedWhenEmpty,
      hasSecondary: false,
      mergePrincipals,
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
  index: EsIndex,
): PlannedRequest {
  const sourceFields = [...new Set(widget.columns.map((column) => column.field))];
  const body: EsSearchBody = {
    size: widget.size ?? 20,
    track_total_hits: true,
    query: boolFilter([
      ...shared,
      ...compileClauses([...scopeClauses(config, widget), ...(widget.filter ?? [])]),
    ]),
    // `ecm:uuid` is always fetched so that rows can link back to Web UI.
    _source: [...new Set([...sourceFields, 'ecm:uuid'])],
  };

  if (widget.sort?.length) {
    body.sort = widget.sort.map((entry) => ({ [entry.field]: { order: entry.order } }));
  }

  return {
    id: tableRequestId(config, widgetId),
    kind: 'hits',
    index,
    body,
    widgetIds: [widgetId],
  };
}
