/**
 * Turns an OpenSearch response into the normalised shapes the widgets consume.
 *
 * Unwrapping has to cope with four nesting levels produced by the planner: an optional `filter`
 * wrapper, the aggregation itself, an optional nested `metric`, and `doc_count` as the fallback
 * value. The checks below are ordered accordingly, because a filter wrapper carrying a metric
 * exposes both `doc_count` and `metric`.
 */
import { EsAggregation, EsBucket, EsIndex, EsResponse, totalHits } from '../core/nuxeo.types';
import { canonicalPrincipal } from '../core/principal';
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
      /**
       * Width of a date histogram's buckets: a calendar unit (`week`), or the code OpenSearch
       * answers for a width it chose (`3M`). `describeInterval` puts either into words.
       */
      interval?: string;
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

/**
 * Reads the value of a single value metric aggregation.
 *
 * `percentiles` is the one metric that answers a map rather than a scalar, under `values`, keyed
 * by the percentile as OpenSearch formats it — `"50.0"`, but `"99.9"` for a fractional one. Only
 * ever one percentile is requested, so the single entry is read rather than the key recomposed.
 *
 * @param undefinedWhenEmpty when the metric has no value over an empty set, a `null` answer means
 *                           "not measured" and becomes `NaN`, which every formatter renders as a
 *                           dash. Otherwise `null` is the zero of a count, a cardinality or a sum.
 */
function metricValue(node: EsAggregation | undefined, undefinedWhenEmpty = false): number | null {
  if (!node) {
    return null;
  }
  if (typeof node.value === 'number') {
    return node.value;
  }
  const percentile = node.values ? Object.values(node.values)[0] : undefined;
  if (typeof percentile === 'number') {
    return percentile;
  }
  if (node.value === null || (node.values !== undefined && percentile === null)) {
    return undefinedWhenEmpty ? Number.NaN : 0;
  }
  return null;
}

function bucketValue(
  bucket: EsBucket,
  undefinedWhenEmpty: boolean,
): { value: number; docCount: number } {
  const docCount = bucket.doc_count ?? 0;
  const metric = metricValue(bucket[METRIC_AGG] as EsAggregation | undefined, undefinedWhenEmpty);
  return { value: metric ?? docCount, docCount };
}

/** `terms` and friends answer an array, `filters` answers a keyed object. */
function normaliseBuckets(
  buckets: EsBucket[] | Record<string, EsBucket>,
  undefinedWhenEmpty: boolean,
): DataBucket[] {
  const entries: EsBucket[] = Array.isArray(buckets)
    ? buckets
    : Object.entries(buckets).map(([key, bucket]) => ({ ...bucket, key }));

  return entries.map((bucket) => {
    const { value, docCount } = bucketValue(bucket, undefinedWhenEmpty);
    return {
      key: String(bucket.key_as_string ?? bucket.key),
      value,
      docCount,
    };
  });
}

/**
 * Collapses the two forms of a principal onto one bucket.
 *
 * `nt:actors` stores `Josh` for a task assigned through `workflowInitiator` and `user:Josh` for
 * one assigned through Web UI's picker, within the same workflow instance. Only counts are added:
 * the planner refuses a metric on a merged list, because two averages do not add up.
 */
function mergePrincipalBuckets(buckets: DataBucket[]): DataBucket[] {
  const merged = new Map<string, DataBucket>();

  for (const bucket of buckets) {
    const key = canonicalPrincipal(bucket.key);
    const current = merged.get(key);
    if (current) {
      current.value += bucket.value;
      current.docCount += bucket.docCount;
    } else {
      merged.set(key, { ...bucket, key });
    }
  }

  return [...merged.values()].sort((a, b) => b.value - a.value);
}

/**
 * Shortens the key of a bucket OpenSearch sized itself to what the bucket covers.
 *
 * An `auto_date_histogram` is sent before anyone knows whether it will answer days or decades, so
 * its keys carry a whole date; a month labelled `2024-03-01` reads as a day, which is what
 * `keyFormat` exists to prevent for a width chosen in advance. Only a key in that very pattern is
 * touched, so a format a configuration chose itself comes back as it was written.
 */
function autoBucketKey(key: string, interval: string | undefined): string {
  if (!interval || !/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    return key;
  }
  if (interval.endsWith('M')) {
    return key.slice(0, 7);
  }
  return interval.endsWith('y') ? key.slice(0, 4) : key;
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
    const answered = typeof node['interval'] === 'string' ? node['interval'] : undefined;
    const interval = plan.interval === 'auto' ? answered : plan.interval;
    const normalised = normaliseBuckets(node.buckets, plan.metricUndefinedWhenEmpty);
    const returned =
      plan.interval === 'auto'
        ? normalised.map((bucket) => ({ ...bucket, key: autoBucketKey(bucket.key, interval) }))
        : normalised;
    const buckets = plan.mergePrincipals ? mergePrincipalBuckets(returned) : returned;
    /*
     * The count of distinct values hangs off the wrapper, never off the bucket list itself, so it
     * is read from the root. `sum_other_doc_count` sits on the list and weighs what was dropped.
     *
     * The comparison uses the number of buckets the server returned, not the merged one: the
     * cardinality counts raw values, so subtracting a merged list would invent omissions.
     */
    const distinct = metricValue(root[DISTINCT_AGG] as EsAggregation | undefined);
    const otherDocs = node['sum_other_doc_count'];

    return {
      kind: 'buckets',
      buckets,
      ...(distinct === null ? {} : { others: Math.max(0, distinct - returned.length) }),
      ...(typeof otherDocs === 'number' ? { otherDocs } : {}),
      ...(interval ? { interval } : {}),
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

  const nested = metricValue(
    node[METRIC_AGG] as EsAggregation | undefined,
    plan.metricUndefinedWhenEmpty,
  );
  if (nested !== null) {
    return scalar(nested);
  }

  const direct = metricValue(node, plan.metricUndefinedWhenEmpty);
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

/**
 * Why a response describes less than the index holds, or null when every shard answered in time.
 *
 * OpenSearch does not fail a search because one of its shards did. A tripped circuit breaker, a
 * full search queue or a shard being relocated leaves the other shards' answer standing, sent with
 * a 200 and a count of the missing ones. Every figure is then short by what those shards held, and
 * nothing on screen could tell: the four populations stop adding up to the total, a trend dips on
 * no day in particular. A search that timed out is the same answer, seen from the clock.
 *
 * The count is read from `failed` rather than from the list, which OpenSearch groups: five shards
 * tripping the same breaker are listed once.
 */
export function incompleteAnswer(index: EsIndex, response: EsResponse): string | null {
  const shards = response._shards;
  if (shards && shards.failed > 0) {
    const reason = shards.failures?.[0]?.reason;
    const cause = reason?.type
      ? ` (${reason.type}${reason.reason ? `: ${reason.reason}` : ''})`
      : '';
    return (
      `${shards.failed} of ${shards.total} shards of the ${index} index did not answer${cause}. ` +
      'The figures would be short by what they hold, so none is shown.'
    );
  }
  if (response.timed_out) {
    return (
      `The search on the ${index} index timed out before every shard had answered. ` +
      'The figures would be short by what the shards had yet to count, so none is shown.'
    );
  }
  return null;
}

/**
 * Dispatches a response over the widgets it serves.
 *
 * Refuses an incomplete answer whole rather than widget by widget: the widgets of a request share
 * one walk of the index, so a missing shard is missing from every one of them. The runner then
 * fails the page as it does for a request that failed outright, a page whose figures come partly
 * from every shard and partly from some being one nobody can account for.
 */
export function mapResponse(
  request: PlannedRequest,
  response: EsResponse,
  plans: Map<string, WidgetPlan>,
): Map<string, WidgetData> {
  const incomplete = incompleteAnswer(request.index, response);
  if (incomplete) {
    throw new Error(incomplete);
  }

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
