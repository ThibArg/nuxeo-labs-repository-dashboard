/**
 * What was taken, and by whom.
 *
 * All three read a field the audit fills from the source document, so all three silently lose the
 * `nxbigblob` downloads: those go through a branch that builds no document context, leaving
 * `docUUID`, `docType` and even the category unset. The tiles count events and are unaffected;
 * these are qualified, and say so.
 */
import { topNChart } from '../builders';
import { ParamSpecs, defineWidget } from '../definition';
import { FILE_DOWNLOADS } from './populations';

const BUCKET_CHARTS = ['donut', 'pie', 'bar', 'hbar', 'ranked-list'] as const;

function rankedParams(chart: (typeof BUCKET_CHARTS)[number]) {
  return {
    chart: {
      type: 'enum' as const,
      values: BUCKET_CHARTS,
      default: chart,
      describe: 'How it is drawn.',
    },
    size: {
      type: 'number' as const,
      default: 10,
      min: 1,
      max: 100,
      describe: 'How many are listed. The chart says so when it leaves some out.',
    },
  } satisfies ParamSpecs;
}

export const downloadsByType = defineWidget({
  id: 'downloads-by-type',
  index: 'audit',
  title: 'Downloads by Type',
  summary: 'Which kinds of document readers save the most.',
  params: rankedParams('donut'),
  build: (params) =>
    topNChart({
      of: FILE_DOWNLOADS,
      field: 'docType',
      size: params.size,
      chart: params.chart,
      labels: 'doctype',
      hint: 'A download carrying no document, such as a temporary blob, is not counted here',
    }),
});

export const topDownloaders = defineWidget({
  id: 'top-downloaders',
  index: 'audit',
  title: 'Most Active Downloaders',
  summary: 'Who saved the most files.',
  params: rankedParams('hbar'),
  build: (params) =>
    topNChart({
      of: FILE_DOWNLOADS,
      field: 'principalName',
      size: params.size,
      chart: params.chart,
      labels: 'user',
      hint: 'Server-side work counts for the user who triggered it',
    }),
});

/**
 * The documents themselves, named rather than listed as uuids.
 *
 * `docUUID` is what the audit holds, so the keys are resolved one by one against the repository.
 * A document deleted since it was downloaded resolves to nothing and keeps its uuid, which is the
 * honest answer: the event happened, and what it happened to is gone.
 */
export const topDownloadedDocuments = defineWidget({
  id: 'top-downloaded-documents',
  index: 'audit',
  title: 'Most Downloaded Documents',
  summary: 'Which documents readers saved the most often.',
  params: rankedParams('ranked-list'),
  build: (params) =>
    topNChart({
      of: FILE_DOWNLOADS,
      field: 'docUUID',
      size: params.size,
      chart: params.chart,
      labels: 'document',
      hint: 'A document deleted since keeps its identifier',
    }),
});
