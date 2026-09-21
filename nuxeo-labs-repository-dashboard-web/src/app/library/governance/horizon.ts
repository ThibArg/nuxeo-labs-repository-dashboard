/**
 * When the retentions currently in force run out.
 *
 * The three tiles partition `UNDER_RETENTION` exactly, and the lower bound of each comes from
 * that population rather than from the tile: a reader adds them up and expects the total, so an
 * overlap would be a wrong answer rather than a detail. J+7 belongs to the week alone, the sixty
 * day window opening at `gt: now+7d`.
 *
 * All three are bounded by `now`, which OpenSearch evaluates when it receives a request — they
 * only add up because they travel in one.
 */
import { KpiSeverity } from '../../config/dashboard-config.model';
import { countTile, trendChart } from '../builders';
import { ParamSpecs, defineWidget } from '../definition';
import { dateWindow } from '../predicates';
import { RETAIN_UNTIL, UNDER_RETENTION } from './populations';

const SEVERITIES = ['neutral', 'accent', 'warning', 'danger', 'success'] as const;

function severity(fallback: KpiSeverity) {
  return {
    severity: {
      type: 'enum' as const,
      values: SEVERITIES,
      default: fallback,
      describe: 'Colour the tile carries, which is how urgency is read at a glance.',
    },
  } satisfies ParamSpecs;
}

export const retentionExpiringThisWeek = defineWidget({
  id: 'retention-expiring-this-week',
  index: 'nuxeo',
  title: 'Expiring This Week',
  summary: 'How many retentions run out within the next seven days.',
  params: severity('danger'),
  build: (params) =>
    countTile({
      of: [...UNDER_RETENTION, dateWindow({ field: RETAIN_UNTIL, lte: 'now+7d' })],
      severity: params.severity,
      hint: 'Within the next 7 days',
    }),
});

export const retentionExpiringInSixtyDays = defineWidget({
  id: 'retention-expiring-in-60-days',
  index: 'nuxeo',
  title: 'Expiring < 60 Days',
  summary: 'How many retentions run out after the coming week and within sixty days.',
  params: severity('warning'),
  build: (params) =>
    countTile({
      of: [...UNDER_RETENTION, dateWindow({ field: RETAIN_UNTIL, gt: 'now+7d', lte: 'now+60d' })],
      severity: params.severity,
      hint: 'Beyond the next 7 days',
    }),
});

export const retentionExpiringLater = defineWidget({
  id: 'retention-expiring-later',
  index: 'nuxeo',
  title: 'Expiring Later',
  summary: 'How many retentions run out beyond sixty days.',
  params: severity('neutral'),
  build: (params) =>
    countTile({
      of: [...UNDER_RETENTION, dateWindow({ field: RETAIN_UNTIL, gt: 'now+60d' })],
      severity: params.severity,
    }),
});

const TREND_CHARTS = ['area', 'line', 'bar'] as const;
const INTERVALS = ['day', 'week', 'month', 'quarter', 'year'] as const;

/**
 * When the retentions currently in force run out.
 *
 * The three tiles say how many; this says when, which is the only view that shows the long tail —
 * on the sandbox, nine retentions lapse this month, seven in November and three in two years.
 *
 * Two things set it apart from a trend. It buckets `ecm:retainUntil`, which the period filter does
 * not constrain, so it receives no `extended_bounds` and spans the dates rather than the reader's
 * window. And it drops the empty buckets: retentions scattered over two years otherwise draw
 * twenty-five bars of which twenty-two are nothing. On a trend that would hide a quiet week and
 * would be wrong; here a month with no expiry is not information, it is the gap between two.
 */
export const retentionHorizon = defineWidget({
  id: 'retention-horizon',
  index: 'nuxeo',
  title: 'When Retentions Lapse',
  summary: 'When the retentions currently in force run out, empty periods left out.',
  params: {
    chart: {
      type: 'enum' as const,
      values: TREND_CHARTS,
      default: 'bar',
      describe: 'How it is drawn.',
    },
    interval: {
      type: 'enum' as const,
      values: INTERVALS,
      default: 'month',
      describe: 'Width of one bucket. Buckets are cut in the reader\u2019s own time zone.',
    },
  },
  build: (params) =>
    trendChart({
      of: UNDER_RETENTION,
      field: RETAIN_UNTIL,
      interval: params.interval,
      chart: params.chart,
      minDocCount: 1,
      hint: 'Periods with nothing expiring are left out',
    }),
});
