/**
 * Documents held until somebody lifts the hold.
 *
 * A legal hold is the harshest thing in this domain: it has no date, so nothing expires it, and it
 * turns its target into an *enforced* record permanently — a flexible record loses that quality
 * the moment a hold touches it, and `Document.Unhold` gives back the hold but not the flexibility.
 *
 * Its own theme rather than a line among the records, because it answers a different question: not
 * how much is governed, but how much cannot be touched at all.
 */
import { countTile, topNChart } from '../builders';
import { defineWidget } from '../definition';
import { UNDER_LEGAL_HOLD } from './populations';

const BUCKET_CHARTS = ['donut', 'pie', 'bar', 'hbar', 'ranked-list'] as const;
const SEVERITIES = ['neutral', 'accent', 'warning', 'danger', 'success'] as const;

export const documentsOnLegalHold = defineWidget({
  id: 'documents-on-legal-hold',
  index: 'nuxeo',
  title: 'Under Legal Hold',
  summary: 'How many live documents are held indefinitely until somebody lifts the hold.',
  params: {
    severity: {
      type: 'enum' as const,
      values: SEVERITIES,
      default: 'danger',
      describe: 'Colour the tile carries.',
    },
  },
  build: (params) =>
    countTile({
      of: UNDER_LEGAL_HOLD,
      severity: params.severity,
      hint: 'Held until someone lifts it',
    }),
});

export const legalHoldsByType = defineWidget({
  id: 'legal-holds-by-type',
  index: 'nuxeo',
  title: 'Legal Holds by Type',
  summary: 'Which document types are the ones nobody can touch.',
  params: {
    chart: {
      type: 'enum' as const,
      values: BUCKET_CHARTS,
      default: 'donut',
      describe: 'How it is drawn.',
    },
    size: {
      type: 'number' as const,
      default: 10,
      min: 1,
      max: 100,
      describe: 'How many types are listed. The chart says so when it leaves some out.',
    },
  },
  build: (params) =>
    topNChart({
      of: UNDER_LEGAL_HOLD,
      field: 'ecm:primaryType',
      size: params.size,
      chart: params.chart,
      labels: 'doctype',
    }),
});
