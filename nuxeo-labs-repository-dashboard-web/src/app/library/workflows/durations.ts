/**
 * How long workflows and their tasks take.
 *
 * Every figure here is milliseconds, and every one of them describes a population that may have
 * nothing in common with itself: five models spanning two orders of magnitude put the mean where
 * no model sits. Hence the rule these widgets exist to serve — **an aggregate over a mixed
 * population always ships beside a breakdown**, and the median beside the mean.
 */
import { ChartWidgetType } from '../../config/dashboard-config.model';
import { bandChart, countTile, topNChart } from '../builders';
import { ParamSpecs, defineWidget } from '../definition';
import { COMPLETED, TASK_DURATION, TASK_ENDED, WORKFLOW_DURATION } from './populations';

const BUCKET_CHARTS = ['donut', 'pie', 'bar', 'hbar', 'ranked-list'] as const;

interface RankedParams {
  chart: ChartWidgetType;
  size: number;
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

export const averageWorkflowDuration = defineWidget({
  id: 'average-workflow-duration',
  index: 'audit_wf',
  title: 'Average Duration',
  summary: 'How long a completed workflow instance takes on average, across every model.',
  build: () =>
    countTile({
      of: COMPLETED,
      metric: { avg: WORKFLOW_DURATION },
      format: 'duration',
      hint: 'Every model at once, which no single model resembles',
    }),
});

/**
 * The median, which is the figure to read when the mean describes nobody.
 *
 * On a mix of models spanning hours and weeks the mean lands at ten days, a value no model
 * approaches, while the median says one. The mean is not wrong; it simply describes nobody.
 */
export const medianWorkflowDuration = defineWidget({
  id: 'median-workflow-duration',
  index: 'audit_wf',
  title: 'Median Duration',
  summary: 'The duration half of the completed instances come in under.',
  build: () =>
    countTile({
      of: COMPLETED,
      metric: { percentile: { field: WORKFLOW_DURATION, percent: 50 } },
      format: 'duration',
      hint: 'Half of the completed instances settle faster than this',
    }),
});

export const averageTaskDuration = defineWidget({
  id: 'average-task-duration',
  index: 'audit_wf',
  title: 'Average Task Duration',
  summary: 'How long a task waits between being assigned and being answered.',
  build: () =>
    countTile({
      of: TASK_ENDED,
      metric: { avg: TASK_DURATION },
      format: 'duration',
      hint: 'From assignment to completion',
    }),
});

/** The breakdown that names which model the overall average came from. */
export const slowestWorkflowModels = defineWidget<RankedParams>({
  id: 'slowest-workflow-models',
  index: 'audit_wf',
  title: 'Average Duration by Model',
  summary: 'Which workflow models take longest, slowest first.',
  params: rankedParams('hbar'),
  build: (params) =>
    topNChart({
      of: COMPLETED,
      field: 'extended.modelName',
      size: params.size,
      chart: params.chart,
      metric: { avg: WORKFLOW_DURATION },
      order: 'metric_desc',
      labels: 'workflowModel',
      format: 'duration',
      hint: 'Slowest first',
    }),
});

export const slowestTaskSteps = defineWidget<RankedParams>({
  id: 'slowest-task-steps',
  index: 'audit_wf',
  title: 'Slowest Steps',
  summary: 'Which workflow step keeps people waiting longest before it is answered.',
  params: rankedParams('hbar'),
  build: (params) =>
    topNChart({
      of: TASK_ENDED,
      field: 'extended.taskName',
      size: params.size,
      chart: params.chart,
      metric: { avg: TASK_DURATION },
      order: 'metric_desc',
      labels: 'message',
      format: 'duration',
      hint: 'Average time a task waits before it is answered',
    }),
});

/**
 * Completed instances split into four bands.
 *
 * A distribution answers what neither a mean nor a median can: whether the population has one
 * shape or two. The bands are the widget, not a setting — a different split is a different idea.
 */
export const workflowDurationDistribution = defineWidget({
  id: 'workflow-duration-distribution',
  index: 'audit_wf',
  title: 'Workflow Duration',
  summary: 'How completed instances spread across four bands of duration.',
  build: () =>
    bandChart({
      of: COMPLETED,
      field: WORKFLOW_DURATION,
      chart: 'bar',
      bands: {
        numeric: [
          { key: '< 1 hour', to: 3600000 },
          { key: '1 hour to 1 day', from: 3600000, to: 86400000 },
          { key: '1 to 7 days', from: 86400000, to: 604800000 },
          { key: 'over 7 days', from: 604800000 },
        ],
      },
      hint: 'Completed instances, by how long they took',
    }),
});
