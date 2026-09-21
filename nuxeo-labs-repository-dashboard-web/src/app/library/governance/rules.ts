/**
 * The retention rules themselves, rather than the documents they govern.
 *
 * A different subject from everything else in this folder: these describe how governance is
 * **configured**, not how much content it protects. That distinction is not academic — the rules
 * live under `/RetentionRules`, outside `/default-domain`, so a reader who narrows a page to a
 * container empties every one of these without being told why, and the period filter constrains
 * the day a rule was written, which nobody is asking about.
 *
 * Which is why none of them sits on the shipped Governance page. They are here to be composed
 * onto a screen where the content filters have no business.
 */
import { ChartWidgetType } from '../../config/dashboard-config.model';
import { countTile, topNChart } from '../builders';
import { ParamSpecs, defineWidget } from '../definition';
import { RETENTION_RULES } from './populations';

const BUCKET_CHARTS = ['donut', 'pie', 'bar', 'hbar', 'ranked-list'] as const;

interface RuleChartParams {
  chart: ChartWidgetType;
  size: number;
}

function ruleChartParams(chart: (typeof BUCKET_CHARTS)[number]): ParamSpecs {
  return {
    chart: { type: 'enum', values: BUCKET_CHARTS, default: chart, describe: 'How it is drawn.' },
    size: {
      type: 'number',
      default: 20,
      min: 1,
      max: 100,
      describe: 'How many values are listed.',
    },
  };
}

export const retentionRules = defineWidget({
  id: 'retention-rules',
  index: 'nuxeo',
  title: 'Retention Rules',
  summary: 'How many retention rules the repository defines. Describes configuration, not content.',
  build: () => countTile({ of: RETENTION_RULES, hint: 'Rules defined, wherever they are applied' }),
});

/**
 * What a rule does to its documents when the retention runs out.
 *
 * The `retention_end` vocabulary offers exactly two values, `Document.Delete` and
 * `Document.Trash`, so this is the one chart on which "empty" is the reassuring answer: a rule
 * with no end action leaves its documents alone.
 *
 * It will stay empty on any repository whose rules were written for a demonstration, since a
 * non-empty list makes those documents disappear on their own at expiry, under the `system`
 * identity. It has therefore never been confronted with a live index.
 */
export const rulesByEndAction = defineWidget<RuleChartParams>({
  id: 'rules-by-end-action',
  index: 'nuxeo',
  title: 'Rules by End Action',
  summary: 'What each rule does when its retention runs out: delete, trash, or nothing at all.',
  params: ruleChartParams('donut'),
  build: (params) =>
    topNChart({
      of: RETENTION_RULES,
      field: 'retention_def:endActions',
      size: params.size,
      chart: params.chart,
      hint: 'A rule with no end action leaves its documents alone',
    }),
});

/** Whether a rule is attached by hand or applied to everything matching it. */
export const rulesByApplicationPolicy = defineWidget<RuleChartParams>({
  id: 'rules-by-application-policy',
  index: 'nuxeo',
  title: 'Rules by Application',
  summary: 'Whether each rule is attached by hand or applied automatically.',
  params: ruleChartParams('donut'),
  build: (params) =>
    topNChart({
      of: RETENTION_RULES,
      field: 'retention_rule:applicationPolicy',
      size: params.size,
      chart: params.chart,
    }),
});

/** What starts the clock: the moment of attachment, an event, or a date held on the document. */
export const rulesByStartingPoint = defineWidget<RuleChartParams>({
  id: 'rules-by-starting-point',
  index: 'nuxeo',
  title: 'Rules by Starting Point',
  summary: 'What starts a retention: attaching the rule, an event, or a date on the document.',
  params: ruleChartParams('donut'),
  build: (params) =>
    topNChart({
      of: RETENTION_RULES,
      field: 'retention_def:startingPointPolicy',
      size: params.size,
      chart: params.chart,
    }),
});

/**
 * How many rules make a record that can still be released.
 *
 * The distinction the index cannot make on a *document* — `ecm:isFlexibleRecord` never reaches it —
 * is readable here, on the rule. It is the only place it is.
 */
export const rulesByFlexibility = defineWidget<RuleChartParams>({
  id: 'rules-by-flexibility',
  index: 'nuxeo',
  title: 'Rules by Flexibility',
  summary: 'How many rules make a record that can be released, and how many make it permanent.',
  params: ruleChartParams('donut'),
  build: (params) =>
    topNChart({
      of: RETENTION_RULES,
      field: 'retention_rule:flexibleRecords',
      size: params.size,
      chart: params.chart,
      labels: 'boolean',
      hint: 'A flexible record can be released; an enforced one cannot, ever',
    }),
});
