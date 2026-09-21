/** How the live documents break down, by one dimension at a time. */
import { RESTRICTION_PARAMS, restrict, topNChart } from '../builders';
import { ParamSpecs, defineWidget } from '../definition';
import { LIVE_NOT_TRASHED } from '../populations';

const BUCKET_CHARTS = ['donut', 'pie', 'bar', 'hbar', 'ranked-list'] as const;

/**
 * The two knobs every breakdown offers.
 *
 * `chart` is a drawing decision, not a semantic one: a donut, a horizontal bar chart and a ranked
 * list ask the index exactly the same question. Letting a composition choose is what keeps the
 * library from needing one entry per shape.
 */
function breakdownParams(chart: (typeof BUCKET_CHARTS)[number], size = 10) {
  return {
    ...RESTRICTION_PARAMS,
    chart: {
      type: 'enum' as const,
      values: BUCKET_CHARTS,
      default: chart,
      describe: 'How it is drawn.',
    },
    size: {
      type: 'number' as const,
      default: size,
      min: 1,
      max: 100,
      describe: 'How many values are kept. The chart says so when it leaves some out.',
    },
  } satisfies ParamSpecs;
}

export const documentsByType = defineWidget({
  id: 'documents-by-type',
  index: 'nuxeo',
  title: 'By Document Type',
  summary: 'Which document types the live documents are made of.',
  params: breakdownParams('donut'),
  build: (params) =>
    topNChart({
      of: [...LIVE_NOT_TRASHED, ...restrict(params)],
      field: 'ecm:primaryType',
      size: params.size,
      chart: params.chart,
      labels: 'doctype',
    }),
});

export const documentsByLifecycleState = defineWidget({
  id: 'documents-by-lifecycle-state',
  index: 'nuxeo',
  title: 'By Lifecycle State',
  summary: 'Which lifecycle states the live documents sit in.',
  params: breakdownParams('donut'),
  build: (params) =>
    topNChart({
      of: [...LIVE_NOT_TRASHED, ...restrict(params)],
      field: 'ecm:currentLifeCycleState',
      size: params.size,
      chart: params.chart,
      labels: 'lifecycle',
    }),
});

/**
 * Who created the most documents.
 *
 * `labels: "user"` also merges the two forms a principal reaches the index under, so one person
 * is one bar rather than two.
 */
export const topContributors = defineWidget({
  id: 'top-contributors',
  index: 'nuxeo',
  title: 'Top Contributors',
  summary: 'Who created the most live documents.',
  params: breakdownParams('ranked-list'),
  build: (params) =>
    topNChart({
      of: [...LIVE_NOT_TRASHED, ...restrict(params)],
      field: 'dc:creator',
      size: params.size,
      chart: params.chart,
      labels: 'user',
      hint: 'Documents created, by author',
    }),
});
