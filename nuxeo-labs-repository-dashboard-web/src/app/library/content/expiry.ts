/**
 * Documents reaching their `dc:expired` date.
 *
 * The three windows partition: J+7 belongs to the week alone, because the sixty day window opens
 * at `gt: now+7d` rather than at `gte`. A reader adds the three figures up, so an overlap would be
 * a wrong answer rather than a detail — and the three are counted in one request, so `now` is one
 * instant for all of them.
 */
import { KpiSeverity } from '../../config/dashboard-config.model';
import { RESTRICTION_PARAMS, countTile, restrict } from '../builders';
import { ParamSpecs, defineWidget } from '../definition';
import { LIVE_NOT_TRASHED } from '../populations';
import { dateWindow } from '../predicates';

const SEVERITY_VALUES = ['neutral', 'accent', 'warning', 'danger', 'success'] as const;

function severityParam(fallback: KpiSeverity) {
  return {
    ...RESTRICTION_PARAMS,
    severity: {
      type: 'enum' as const,
      values: SEVERITY_VALUES,
      default: fallback,
      describe: 'Colour the tile carries, which is how urgency is read at a glance.',
    },
  } satisfies ParamSpecs;
}

export const documentsExpiringThisWeek = defineWidget({
  id: 'documents-expiring-this-week',
  index: 'nuxeo',
  title: 'Expiring This Week',
  summary: 'Live documents whose expiry date falls within the next seven days.',
  params: severityParam('warning'),
  build: (params) =>
    countTile({
      of: [
        ...LIVE_NOT_TRASHED,
        ...restrict(params),
        dateWindow({ field: 'dc:expired', gte: 'now', lte: 'now+7d' }),
      ],
      severity: params.severity,
      hint: 'Within the next 7 days',
    }),
});

export const documentsExpiringInSixtyDays = defineWidget({
  id: 'documents-expiring-in-60-days',
  index: 'nuxeo',
  title: 'Expiring < 60 Days',
  summary: 'Live documents expiring after the coming week and within sixty days.',
  params: severityParam('warning'),
  build: (params) =>
    countTile({
      of: [
        ...LIVE_NOT_TRASHED,
        ...restrict(params),
        dateWindow({ field: 'dc:expired', gt: 'now+7d', lte: 'now+60d' }),
      ],
      severity: params.severity,
      hint: 'Beyond the next 7 days',
    }),
});

export const documentsExpired = defineWidget({
  id: 'documents-expired',
  index: 'nuxeo',
  title: 'Already Expired',
  summary: 'Live documents whose expiry date has passed.',
  params: severityParam('danger'),
  build: (params) =>
    countTile({
      of: [
        ...LIVE_NOT_TRASHED,
        ...restrict(params),
        dateWindow({ field: 'dc:expired', lt: 'now' }),
      ],
      severity: params.severity,
    }),
});
