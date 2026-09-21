/**
 * What is a record, and what protects it.
 *
 * Putting a document under retention is close to irreversible — `ecm:isRecord` never goes back to
 * false, and what blocks a deletion is a future `ecm:retainUntil` or a legal hold — so these
 * figures describe a commitment rather than a state somebody can undo.
 */
import {
  CalendarInterval,
  ChartWidgetType,
  KpiSeverity,
} from '../../config/dashboard-config.model';
import { countTile, topNChart, trendChart } from '../builders';
import { ParamSpecs, defineWidget } from '../definition';
import { equals } from '../predicates';
import { GOVERNED_BY_A_RULE, RECORDS, UNDER_RETENTION } from './populations';

const BUCKET_CHARTS = ['donut', 'pie', 'bar', 'hbar', 'ranked-list'] as const;
const TREND_CHARTS = ['area', 'line', 'bar'] as const;
const INTERVALS = ['hour', 'day', 'week', 'month', 'quarter', 'year'] as const;
const SEVERITIES = ['neutral', 'accent', 'warning', 'danger', 'success'] as const;

interface TrendParams {
  chart: ChartWidgetType;
  interval: CalendarInterval;
}

const TREND_PARAMS: ParamSpecs = {
  chart: { type: 'enum', values: TREND_CHARTS, default: 'area', describe: 'How it is drawn.' },
  interval: {
    type: 'enum',
    values: INTERVALS,
    default: 'day',
    describe: 'Width of one bucket. Buckets are cut in the reader\u2019s own time zone.',
  },
};

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

export const recordsByAuthor = defineWidget<RankedParams>({
  id: 'records-by-author',
  index: 'nuxeo',
  title: 'Records by Author',
  summary: 'Who created the documents that are now records.',
  params: rankedParams('ranked-list'),
  build: (params) =>
    topNChart({
      of: RECORDS,
      field: 'dc:creator',
      size: params.size,
      chart: params.chart,
      labels: 'user',
      hint: 'Who created the document, not who declared it a record',
    }),
});

/**
 * Records by the date their **document** was created.
 *
 * Not by the date they became records, which is the reading the shorter name would invite and
 * which the index cannot support: the only three retention fields that reach it are
 * `ecm:isRecord`, `ecm:retainUntil` and `ecm:hasLegalHold`, and none of them is a date of
 * declaration. A document written in 2020 and made a record yesterday shows up in 2020.
 */
export const recordsByCreationDate = defineWidget<TrendParams>({
  id: 'records-by-creation-date',
  index: 'nuxeo',
  title: 'Records by Creation Date',
  summary: 'When the documents that are now records were written, not when they became records.',
  params: TREND_PARAMS,
  build: (params) =>
    trendChart({
      of: RECORDS,
      field: 'dc:created',
      interval: params.interval,
      chart: params.chart,
      hint: `Documents created per ${params.interval} ({range}) that are records today`,
    }),
});
