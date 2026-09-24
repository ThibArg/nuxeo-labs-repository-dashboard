/** Who runs the workflows, which models they use, and when. */
import { TREND_INTERVALS, topNChart, trendChart } from '../builders';
import { ParamSpecs, defineWidget } from '../definition';
import { COMPLETED, STARTED, TASK_CREATED, TASK_ENDED } from './populations';

const BUCKET_CHARTS = ['donut', 'pie', 'bar', 'hbar', 'ranked-list'] as const;
const TREND_CHARTS = ['area', 'line', 'bar'] as const;

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

const TREND_PARAMS = {
  chart: {
    type: 'enum' as const,
    values: TREND_CHARTS,
    default: 'area',
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

export const workflowsStartedPerDay = defineWidget({
  id: 'workflows-started-per-day',
  index: 'audit_wf',
  title: 'Workflows Started',
  summary: 'How many workflow instances were started, over time.',
  params: TREND_PARAMS,
  build: (params) =>
    trendChart({
      of: STARTED,
      field: 'eventDate',
      interval: params.interval,
      chart: params.chart,
      hint: 'Instances started per {interval}',
    }),
});

export const workflowsCompletedPerDay = defineWidget({
  id: 'workflows-completed-per-day',
  index: 'audit_wf',
  title: 'Workflows Completed',
  summary: 'How many workflow instances finished, over time.',
  params: TREND_PARAMS,
  build: (params) =>
    trendChart({
      of: COMPLETED,
      field: 'eventDate',
      interval: params.interval,
      chart: params.chart,
      hint: 'Instances finished per {interval}',
    }),
});

/**
 * Which models are used.
 *
 * `labels: "workflowModel"` composes the i18n key Studio writes into the model, and falls back to
 * the words of the identifier when that project is not deployed — so a model reads "Claim Review"
 * rather than sitting next to a properly translated one as a bare id.
 */
export const workflowsByModel = defineWidget({
  id: 'workflows-by-model',
  index: 'audit_wf',
  title: 'By Workflow Model',
  summary: 'Which workflow models are started most often.',
  params: rankedParams('donut'),
  build: (params) =>
    topNChart({
      of: STARTED,
      field: 'extended.modelName',
      size: params.size,
      chart: params.chart,
      labels: 'workflowModel',
      hint: 'Instances started, by model',
    }),
});

/**
 * Which button assignees pressed.
 *
 * Deliberately unresolved: the audit records the button's `name` — approve, reject, validate —
 * while the i18n key sits in its `label` and never leaves the model definition. A label strategy
 * here would promise a translation that cannot happen.
 */
export const taskOutcomes = defineWidget({
  id: 'task-outcomes',
  index: 'audit_wf',
  title: 'Task Outcomes',
  summary: 'Which decision assignees took, by the identifier of the button they pressed.',
  params: rankedParams('donut'),
  build: (params) =>
    topNChart({
      of: TASK_ENDED,
      field: 'extended.action',
      size: params.size,
      chart: params.chart,
      hint: 'The button the assignee pressed, by its identifier',
    }),
});

export const topWorkflowInitiators = defineWidget({
  id: 'top-workflow-initiators',
  index: 'audit_wf',
  title: 'Top Initiators',
  summary: 'Who starts the most workflows.',
  params: rankedParams('ranked-list'),
  build: (params) =>
    topNChart({
      of: STARTED,
      field: 'extended.workflowInitiator',
      size: params.size,
      chart: params.chart,
      labels: 'user',
      hint: 'By number of workflows started',
    }),
});

export const topTaskPerformers = defineWidget({
  id: 'top-task-performers',
  index: 'audit_wf',
  title: 'Tasks Completed by User',
  summary: 'Who answers the most workflow tasks.',
  params: rankedParams('ranked-list'),
  build: (params) =>
    topNChart({
      of: TASK_ENDED,
      field: 'principalName',
      size: params.size,
      chart: params.chart,
      labels: 'user',
      hint: 'Server-side work counts for the user who triggered it',
    }),
});

export const tasksByStep = defineWidget({
  id: 'workflow-tasks-by-step',
  index: 'audit_wf',
  title: 'Most Frequent Tasks',
  summary: 'Which workflow step produces the most tasks.',
  params: rankedParams('hbar'),
  build: (params) =>
    topNChart({
      of: TASK_CREATED,
      field: 'extended.taskName',
      size: params.size,
      chart: params.chart,
      labels: 'message',
      hint: 'By number of tasks created',
    }),
});
