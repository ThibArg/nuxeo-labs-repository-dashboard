/** Who runs the workflows, which models they use, and when. */
import { CalendarInterval, ChartWidgetType } from '../../config/dashboard-config.model';
import { topNChart, trendChart } from '../builders';
import { ParamSpecs, defineWidget } from '../definition';
import { COMPLETED, STARTED, TASK_CREATED, TASK_ENDED } from './populations';

const BUCKET_CHARTS = ['donut', 'pie', 'bar', 'hbar', 'ranked-list'] as const;
const TREND_CHARTS = ['area', 'line', 'bar'] as const;
const INTERVALS = ['hour', 'day', 'week', 'month', 'quarter', 'year'] as const;

interface RankedParams {
  chart: ChartWidgetType;
  size: number;
}

interface TrendParams {
  chart: ChartWidgetType;
  interval: CalendarInterval;
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

const TREND_PARAMS: ParamSpecs = {
  chart: { type: 'enum', values: TREND_CHARTS, default: 'area', describe: 'How it is drawn.' },
  interval: {
    type: 'enum',
    values: INTERVALS,
    default: 'day',
    describe: 'Width of one bucket. Buckets are cut in the reader\u2019s own time zone.',
  },
};

export const workflowsStartedPerDay = defineWidget<TrendParams>({
  id: 'workflows-started-per-day',
  index: 'audit_wf',
  title: 'Workflows Started per Day',
  summary: 'How many workflow instances were started, over time.',
  params: TREND_PARAMS,
  build: (params) =>
    trendChart({
      of: STARTED,
      field: 'eventDate',
      interval: params.interval,
      chart: params.chart,
      hint: `Instances started per ${params.interval} ({range})`,
    }),
});

export const workflowsCompletedPerDay = defineWidget<TrendParams>({
  id: 'workflows-completed-per-day',
  index: 'audit_wf',
  title: 'Workflows Completed per Day',
  summary: 'How many workflow instances finished, over time.',
  params: TREND_PARAMS,
  build: (params) =>
    trendChart({
      of: COMPLETED,
      field: 'eventDate',
      interval: params.interval,
      chart: params.chart,
      hint: `Instances finished per ${params.interval} ({range})`,
    }),
});

/**
 * Which models are used.
 *
 * `labels: "workflowModel"` composes the i18n key Studio writes into the model, and falls back to
 * the words of the identifier when that project is not deployed — so a model reads "Claim Review"
 * rather than sitting next to a properly translated one as a bare id.
 */
export const workflowsByModel = defineWidget<RankedParams>({
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
export const taskOutcomes = defineWidget<RankedParams>({
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

export const topWorkflowInitiators = defineWidget<RankedParams>({
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

export const topTaskPerformers = defineWidget<RankedParams>({
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

export const tasksByStep = defineWidget<RankedParams>({
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
