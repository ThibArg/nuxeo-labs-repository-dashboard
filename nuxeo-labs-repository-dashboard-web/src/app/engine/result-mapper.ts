/**
 * Turns an OpenSearch response into the normalised shapes the widgets consume.
 *
 * Unwrapping has to cope with four nesting levels produced by the planner: an optional `filter`
 * wrapper, the aggregation itself, an optional nested `metric`, and `doc_count` as the fallback
 * value. The checks below are ordered accordingly, because a filter wrapper carrying a metric
 * exposes both `doc_count` and `metric`.
 */
import { EsAggregation, EsBucket, EsResponse, totalHits } from '../core/nuxeo.types';
import { DISTINCT_AGG, INNER_AGG, METRIC_AGG } from './agg-compiler';
import { PlannedRequest, SECONDARY_AGG, WidgetPlan } from './query-planner';

export interface DataBucket {
  /** Raw bucket key, used for label resolution and, later, for drill down. */
  key: string;
  /** Rendered value: the nested metric when there is one, `doc_count` otherwise. */
  value: number;
  docCount: number;
}

export interface TableRow {
  id: string;
  source: Record<string, unknown>;
}

export type WidgetData =
  | { kind: 'scalar'; value: number; secondary?: number }
  | {
      kind: 'buckets';
      buckets: DataBucket[];
      /** Values the top N left out, so a truncated list can say so. Zero when it is complete. */
      others?: number;
      /** Documents those omitted values account for, read from `sum_other_doc_count`. */
      otherDocs?: number;
    }
  | { kind: 'rows'; rows: TableRow[]; total: number };

export function isEmptyData(data: WidgetData | undefined): boolean {
  if (!data) {
    return true;
  }
  switch (data.kind) {
    case 'buckets':
      return data.buckets.length === 0;
    case 'rows':
      return data.rows.length === 0;
    case 'scalar':
      return false;
  }
}

/** Reads the value of a single value metric aggregation. */
function metricValue(node: EsAggregation | undefined): number | null {
  if (!node) {
    return null;
  }
  if (typeof node.value === 'number') {
    return node.value;
  }
  // `cardinality` on an empty index answers null rather than 0.
  if (node.value === null) {
    return 0;
  }
  return null;
}

function bucketValue(bucket: EsBucket): { value: number; docCount: number } {
  const docCount = bucket.doc_count ?? 0;
  const metric = metricValue(bucket[METRIC_AGG] as EsAggregation | undefined);
  return { value: metric ?? docCount, docCount };
}

/** `terms` and friends answer an array, `filters` answers a keyed object. */
function normaliseBuckets(buckets: EsBucket[] | Record<string, EsBucket>): DataBucket[] {
  const entries: EsBucket[] = Array.isArray(buckets)
    ? buckets
    : Object.entries(buckets).map(([key, bucket]) => ({ ...bucket, key }));

  return entries.map((bucket) => {
    const { value, docCount } = bucketValue(bucket);
    return {
      key: String(bucket.key_as_string ?? bucket.key),
      value,
      docCount,
    };
  });
}

/**
 * Extracts one widget's data from an aggregations response.
 *
 * @param response the shared aggregations response
 * @param plan how the planner encoded this widget
 */
export function readAggregationWidget(
  response: EsResponse,
  plan: WidgetPlan,
): WidgetData | undefined {
  if (plan.read === 'total') {
    return { kind: 'scalar', value: totalHits(response) };
  }

  const root = response.aggregations?.[plan.widgetId];
  if (!root) {
    return undefined;
  }

  // Charts nest their aggregation under `inner` when the widget carries its own predicate.
  const node = (plan.wrapped && (root[INNER_AGG] as EsAggregation | undefined)) || root;

  if (node.buckets) {
    const buckets = normaliseBuckets(node.buckets);
    /*
     * The count of distinct values hangs off the wrapper, never off the bucket list itself, so it
     * is read from the root. `sum_other_doc_count` sits on the list and weighs what was dropped.
     */
    const distinct = metricValue(root[DISTINCT_AGG] as EsAggregation | undefined);
    const otherDocs = node['sum_other_doc_count'];

    return {
      kind: 'buckets',
      buckets,
      ...(distinct === null ? {} : { others: Math.max(0, distinct - buckets.length) }),
      ...(typeof otherDocs === 'number' ? { otherDocs } : {}),
    };
  }

  /*
   * The secondary figure always hangs off the wrapper, never off the metric, so it is read from
   * the root rather than from the possibly unwrapped node.
   */
  const secondary = plan.hasSecondary
    ? ((root[SECONDARY_AGG] as EsAggregation | undefined)?.doc_count ?? 0)
    : undefined;

  const scalar = (value: number): WidgetData =>
    secondary === undefined ? { kind: 'scalar', value } : { kind: 'scalar', value, secondary };

  const nested = metricValue(node[METRIC_AGG] as EsAggregation | undefined);
  if (nested !== null) {
    return scalar(nested);
  }

  const direct = metricValue(node);
  if (direct !== null) {
    return scalar(direct);
  }

  if (typeof node.doc_count === 'number') {
    return scalar(node.doc_count);
  }

  return undefined;
}

/** Extracts a table widget's rows from its own response. */
export function readHitsWidget(response: EsResponse): WidgetData {
  return {
    kind: 'rows',
    total: totalHits(response),
    rows: (response.hits?.hits ?? []).map((hit) => ({
      id: String(hit._source?.['ecm:uuid'] ?? hit._id),
      source: hit._source ?? {},
    })),
  };
}

/** Dispatches a response over the widgets it serves. */
export function mapResponse(
  request: PlannedRequest,
  response: EsResponse,
  plans: Map<string, WidgetPlan>,
): Map<string, WidgetData> {
  const result = new Map<string, WidgetData>();

  for (const widgetId of request.widgetIds) {
    const plan = plans.get(widgetId);
    if (!plan) {
      continue;
    }
    const data =
      request.kind === 'hits' ? readHitsWidget(response) : readAggregationWidget(response, plan);
    if (data) {
      result.set(widgetId, data);
    }
  }

  return result;
}
