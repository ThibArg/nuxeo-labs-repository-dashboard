/** How the volume of documents moved over the period. */
import { CalendarInterval, ChartWidgetType } from '../../config/dashboard-config.model';
import { RESTRICTION_PARAMS, Restrictions, restrict, trendChart } from '../builders';
import { ParamSpecs, defineWidget } from '../definition';
import { LIVE_NOT_TRASHED } from '../populations';

const TREND_CHARTS = ['area', 'line', 'bar'] as const;
const INTERVALS = ['hour', 'day', 'week', 'month', 'quarter', 'year'] as const;

interface TrendParams extends Restrictions {
  chart: ChartWidgetType;
  interval: CalendarInterval;
}

const TREND_PARAMS: ParamSpecs = {
  ...RESTRICTION_PARAMS,
  chart: { type: 'enum', values: TREND_CHARTS, default: 'area', describe: 'How it is drawn.' },
  interval: {
    type: 'enum',
    values: INTERVALS,
    default: 'day',
    describe: 'Width of one bucket. Buckets are cut in the reader\u2019s own time zone.',
  },
};

export const documentsCreated = defineWidget<TrendParams>({
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
      hint: `Number of documents created per ${params.interval} ({range})`,
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
export const documentsModified = defineWidget<TrendParams>({
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
      hint: `Number of documents modified per ${params.interval} (Based on {range} creation)`,
    }),
});
