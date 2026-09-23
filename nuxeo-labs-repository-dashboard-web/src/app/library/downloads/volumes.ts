/** How much left the server, and when. */
import { KpiSeverity } from '../../config/dashboard-config.model';
import { TREND_INTERVALS, countTile, trendChart } from '../builders';
import { ParamSpecs, defineWidget } from '../definition';
import { FILE_DOWNLOADS, RENDITIONS_SERVED } from './populations';

const SEVERITIES = ['neutral', 'accent', 'warning', 'danger', 'success'] as const;
const TREND_CHARTS = ['area', 'line', 'bar'] as const;

function severity(fallback: KpiSeverity) {
  return {
    severity: {
      type: 'enum' as const,
      values: SEVERITIES,
      default: fallback,
      describe: 'Colour the tile carries.',
    },
  } satisfies ParamSpecs;
}

const TREND_PARAMS = {
  chart: {
    type: 'enum' as const,
    values: TREND_CHARTS,
    default: 'line',
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

export const downloads = defineWidget({
  id: 'downloads',
  index: 'audit',
  title: 'Downloads',
  summary: 'How many files a reader actually saved, renditions excluded.',
  params: severity('accent'),
  build: (params) =>
    countTile({
      of: FILE_DOWNLOADS,
      severity: params.severity,
      hint: 'Files saved by a reader ({range})',
    }),
});

/**
 * The figure that keeps the one beside it honest.
 *
 * Shown rather than filtered away, because the gap is the whole point: a repository where these
 * two differ by two orders of magnitude is being browsed, not read, and a "downloads" chart that
 * quietly folded them together would have said the opposite.
 */
export const renditionsServed = defineWidget({
  id: 'renditions-served',
  index: 'audit',
  title: 'Renditions Served',
  summary: 'How many thumbnails and previews the interface fetched, which are not reads.',
  params: severity('neutral'),
  build: (params) =>
    countTile({
      of: RENDITIONS_SERVED,
      severity: params.severity,
      hint: 'Thumbnails and previews the interface asked for, not files a reader saved',
    }),
});

/**
 * Distinct documents, not distinct events.
 *
 * One person saving the same file eleven times is one document, and on a small repository that is
 * the difference between "the team is using it" and "somebody had a bad connection".
 */
export const documentsDownloaded = defineWidget({
  id: 'documents-downloaded',
  index: 'audit',
  title: 'Documents Downloaded',
  summary: 'How many distinct documents were saved at least once.',
  build: () =>
    countTile({
      of: FILE_DOWNLOADS,
      metric: { cardinality: 'docUUID' },
      hint: 'Distinct documents, however often each was saved',
    }),
});

export const downloadsPerDay = defineWidget({
  id: 'downloads-per-day',
  index: 'audit',
  title: 'Downloads Over Time',
  summary: 'How the number of files saved by readers moved over the period.',
  params: TREND_PARAMS,
  build: (params) =>
    trendChart({
      of: FILE_DOWNLOADS,
      field: 'eventDate',
      interval: params.interval,
      chart: params.chart,
      hint: 'Files saved per {interval}, renditions excluded ({range})',
    }),
});
