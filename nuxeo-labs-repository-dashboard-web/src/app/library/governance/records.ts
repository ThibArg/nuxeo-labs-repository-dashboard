/**
 * What is a record, and what protects it.
 *
 * Putting a document under retention is close to irreversible — `ecm:isRecord` never goes back to
 * false, and what blocks a deletion is a future `ecm:retainUntil` or a legal hold — so these
 * figures describe a commitment rather than a state somebody can undo.
 */
import { ChartWidgetType, KpiSeverity } from '../../config/dashboard-config.model';
import { countTile, topNChart } from '../builders';
import { ParamSpecs, defineWidget } from '../definition';
import { equals } from '../predicates';
import { GOVERNED_BY_A_RULE, RECORDS, UNDER_LEGAL_HOLD, UNDER_RETENTION } from './populations';

const BUCKET_CHARTS = ['donut', 'pie', 'bar', 'hbar', 'ranked-list'] as const;
const SEVERITIES = ['neutral', 'accent', 'warning', 'danger', 'success'] as const;

interface RankedParams {
  chart: ChartWidgetType;
  size: number;
}

interface TileParams {
  severity: KpiSeverity;
}

function rankedParams(chart: (typeof BUCKET_CHARTS)[number]): ParamSpecs {
  return {
    chart: { type: 'enum', values: BUCKET_CHARTS, default: chart, describe: 'How it is drawn.' },
    size: {
      type: 'number',
      default: 10,
      min: 1,
      max: 100,
      describe: 'How many are listed. The chart says so when it leaves some out.',
    },
  };
}

function severity(fallback: KpiSeverity): ParamSpecs {
  return {
    severity: {
      type: 'enum',
      values: SEVERITIES,
      default: fallback,
      describe: 'Colour the tile carries.',
    },
  };
}

/**
 * Records, with how many of them a rule made.
 *
 * The two figures differ by the records somebody made by hand: only `Retention.AttachRule` sets
 * the `Record` facet, while `Document.Retain` and `Document.Hold` make a record without it. The
 * gap is worth seeing, which is why the second figure sits under the first rather than beside it.
 */
export const records = defineWidget<TileParams>({
  id: 'records',
  index: 'nuxeo',
  title: 'Records',
  summary: 'How many live documents are declared records, and how many of those a rule made.',
  params: severity('accent'),
  build: (params) =>
    countTile({
      of: RECORDS,
      severity: params.severity,
      hint: 'Declared a record, whatever protects it',
      secondary: {
        of: [equals('ecm:mixinType', 'Record')],
        label: '{value} governed by a rule',
        hideWhenZero: true,
      },
    }),
});

export const documentsUnderRetention = defineWidget<TileParams>({
  id: 'documents-under-retention',
  index: 'nuxeo',
  title: 'Under Retention',
  summary: 'How many live documents cannot be deleted until a date still in the future.',
  params: severity('warning'),
  build: (params) =>
    countTile({
      of: UNDER_RETENTION,
      severity: params.severity,
      hint: 'Retention date still in the future',
    }),
});

/**
 * Documents held until somebody lifts it.
 *
 * A legal hold has no date and turns its target into an *enforced* record permanently: a flexible
 * record loses that quality the moment a hold touches it, and `Document.Unhold` gives it back the
 * hold but not the flexibility.
 */
export const documentsOnLegalHold = defineWidget<TileParams>({
  id: 'documents-on-legal-hold',
  index: 'nuxeo',
  title: 'Under Legal Hold',
  summary: 'How many live documents are held indefinitely until somebody lifts the hold.',
  params: severity('danger'),
  build: (params) =>
    countTile({
      of: UNDER_LEGAL_HOLD,
      severity: params.severity,
      hint: 'Held until someone lifts it',
    }),
});

/**
 * Records grouped by the rule that made them.
 *
 * `record:ruleIds` holds document uuids, so `labels: "document"` resolves each to the title of the
 * rule. A rule deleted after the records it governs leaves its uuid behind and the lookup answers
 * 404 — the bucket still holds documents, so it falls back to the uuid, which is a poor label but
 * an honest one.
 */
export const recordsByRule = defineWidget<RankedParams>({
  id: 'records-by-rule',
  index: 'nuxeo',
  title: 'By Retention Rule',
  summary: 'Which retention rule made the records, by the rule they carry.',
  params: rankedParams('hbar'),
  build: (params) =>
    topNChart({
      of: GOVERNED_BY_A_RULE,
      field: 'record:ruleIds',
      size: params.size,
      chart: params.chart,
      labels: 'document',
      hint: 'Records a rule was attached to. A record made by hand carries no rule',
    }),
});

export const recordsByType = defineWidget<RankedParams>({
  id: 'records-by-type',
  index: 'nuxeo',
  title: 'Records by Document Type',
  summary: 'Which document types the records are made of.',
  params: rankedParams('donut'),
  build: (params) =>
    topNChart({
      of: RECORDS,
      field: 'ecm:primaryType',
      size: params.size,
      chart: params.chart,
      labels: 'doctype',
    }),
});
