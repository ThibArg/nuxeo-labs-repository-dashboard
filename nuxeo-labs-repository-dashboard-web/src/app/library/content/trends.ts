/** How the volume of documents moved over the period. */
import { RESTRICTION_PARAMS, TREND_INTERVALS, restrict, trendChart } from '../builders';
import { ParamSpecs, defineWidget } from '../definition';
import { LIVE_NOT_TRASHED } from '../populations';

const TREND_CHARTS = ['area', 'line', 'bar'] as const;

const TREND_PARAMS = {
  ...RESTRICTION_PARAMS,
  chart: {
    type: 'enum' as const,
    values: TREND_CHARTS,
    default: 'area',
    describe: 'How it is drawn.',
  },
  interval: {
    type: 'enum' as const,
    values: TREND_INTERVALS,
    default: 'auto',
    describe:
      'Width of one bucket; `auto` follows the period. Buckets are cut in the reader\u2019s own time zone.',
  },
} satisfies ParamSpecs;

export const documentsCreated = defineWidget({
  id: 'documents-created',
  index: 'nuxeo',
  title: 'Documents Created',
  summary: 'How many live documents were created, over time.',
  params: TREND_PARAMS,
  build: (params) =>
    trendChart({
      of: [...LIVE_NOT_TRASHED, ...restrict(params)],
      field: 'dc:created',
      interval: params.interval,
      chart: params.chart,
      hint: 'Number of documents created per {interval} ({range})',
    }),
});

/**
 * Modifications made to the documents *created* in the period, which is not the same thing as
 * modifications made during it.
 *
 * The page filter constrains `dc:created` while this chart buckets `dc:modified`, so the two read
 * differently and the hint says which. It is the one wording on the page that a reader would
 * otherwise get wrong.
 */
export const documentsModified = defineWidget({
  id: 'documents-modified',
  index: 'nuxeo',
  title: 'Documents Modified',
  summary: 'How often the documents created in the period were modified afterwards.',
  params: TREND_PARAMS,
  build: (params) =>
    trendChart({
      of: [...LIVE_NOT_TRASHED, ...restrict(params)],
      field: 'dc:modified',
      interval: params.interval,
      chart: params.chart,
      hint: 'Number of documents modified per {interval} (Based on {range} creation)',
    }),
});
