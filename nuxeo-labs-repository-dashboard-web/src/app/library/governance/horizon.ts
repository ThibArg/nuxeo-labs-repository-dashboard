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
import { countTile } from '../builders';
import { ParamSpecs, defineWidget } from '../definition';
import { dateWindow } from '../predicates';
import { RETAIN_UNTIL, UNDER_RETENTION } from './populations';

const SEVERITIES = ['neutral', 'accent', 'warning', 'danger', 'success'] as const;

interface HorizonParams {
  severity: KpiSeverity;
}

function severity(fallback: KpiSeverity): ParamSpecs {
  return {
    severity: {
      type: 'enum',
      values: SEVERITIES,
      default: fallback,
      describe: 'Colour the tile carries, which is how urgency is read at a glance.',
    },
  };
}

export const retentionExpiringThisWeek = defineWidget<HorizonParams>({
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

export const retentionExpiringInSixtyDays = defineWidget<HorizonParams>({
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

export const retentionExpiringLater = defineWidget<HorizonParams>({
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
