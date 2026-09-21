/**
 * What is waiting on whom, and how late it is.
 *
 * Every widget here describes open tasks, because that is all the repository reliably holds: a
 * nightly job deletes finished workflows and every task they carry. The page says so in its
 * subtitle, and these summaries say it again, because a widget dropped onto another screen takes
 * its caveat with it or loses it.
 */
import { KpiSeverity } from '../../config/dashboard-config.model';
import { bandChart, countTile, recordTable, topNChart } from '../builders';
import { ParamSpecs, defineWidget } from '../definition';
import { dateWindow } from '../predicates';
import { ASSIGNEES, DUE_DATE, OPEN_TASKS } from './populations';

const BUCKET_CHARTS = ['donut', 'pie', 'bar', 'hbar', 'ranked-list'] as const;
const SEVERITIES = ['neutral', 'accent', 'warning', 'danger', 'success'] as const;

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

function severity(fallback: KpiSeverity) {
  return {
    severity: {
      type: 'enum' as const,
      values: SEVERITIES,
      default: fallback,
      describe: 'Colour the tile carries, which is how urgency is read at a glance.',
    },
  };
}

export const openTasks = defineWidget({
  id: 'open-tasks',
  index: 'nuxeo',
  title: 'Open Tasks',
  summary: 'How many workflow tasks are waiting on somebody right now.',
  params: severity('neutral'),
  build: (params) =>
    countTile({ of: OPEN_TASKS, severity: params.severity, hint: 'Waiting on somebody right now' }),
});

export const overdueTasks = defineWidget({
  id: 'overdue-tasks',
  index: 'nuxeo',
  title: 'Overdue',
  summary: 'How many open tasks are past their due date.',
  params: severity('danger'),
  build: (params) =>
    countTile({
      of: [...OPEN_TASKS, dateWindow({ field: DUE_DATE, lt: 'now' })],
      severity: params.severity,
      hint: 'Past their due date',
    }),
});

export const tasksDueThisWeek = defineWidget({
  id: 'tasks-due-this-week',
  index: 'nuxeo',
  title: 'Due Within 7 Days',
  summary: 'How many open tasks fall due in the coming week without being late yet.',
  params: severity('warning'),
  build: (params) =>
    countTile({
      of: [...OPEN_TASKS, dateWindow({ field: DUE_DATE, gte: 'now', lte: 'now+7d' })],
      severity: params.severity,
      hint: 'Not late yet',
    }),
});

/**
 * How many people and groups have work waiting.
 *
 * A cardinality rather than a count: the same person holding forty tasks is one assignee. It
 * counts groups as well as people, a task being assignable to either.
 */
export const distinctAssignees = defineWidget({
  id: 'distinct-assignees',
  index: 'nuxeo',
  title: 'Assignees',
  summary: 'How many distinct people and groups have a task waiting on them.',
  build: () =>
    countTile({
      of: OPEN_TASKS,
      metric: { cardinality: ASSIGNEES },
      hint: 'People and groups with work waiting',
    }),
});

/**
 * Open tasks split by how far past their due date they are.
 *
 * The bands are relative to `now` and they partition: every open task falls in exactly one, which
 * is what lets a reader add them up to the open total.
 */
export const taskLateness = defineWidget({
  id: 'task-lateness',
  index: 'nuxeo',
  title: 'How Late They Are',
  summary: 'How open tasks spread from long overdue to not yet due.',
  build: () =>
    bandChart({
      of: OPEN_TASKS,
      field: DUE_DATE,
      chart: 'bar',
      bands: {
        dates: [
          { key: 'over 30 days late', to: 'now-30d' },
          { key: '8 to 30 days late', from: 'now-30d', to: 'now-7d' },
          { key: 'up to 7 days late', from: 'now-7d', to: 'now' },
          { key: 'due within 7 days', from: 'now', to: 'now+7d' },
          { key: 'due later', from: 'now+7d' },
        ],
      },
      hint: 'Open tasks, by how far past their due date',
    }),
});

export const tasksByAssignee = defineWidget({
  id: 'tasks-by-assignee',
  index: 'nuxeo',
  title: 'Open Tasks by Assignee',
  summary: 'Who has the most work waiting on them.',
  params: rankedParams('hbar'),
  build: (params) =>
    topNChart({
      of: OPEN_TASKS,
      field: ASSIGNEES,
      size: params.size,
      chart: params.chart,
      labels: 'user',
      hint: 'A task assigned to a group counts once, for that group',
    }),
});

export const overdueTasksByAssignee = defineWidget({
  id: 'overdue-tasks-by-assignee',
  index: 'nuxeo',
  title: 'Overdue by Assignee',
  summary: 'Who is sitting on the most work that is already late.',
  params: rankedParams('ranked-list'),
  build: (params) =>
    topNChart({
      of: [...OPEN_TASKS, dateWindow({ field: DUE_DATE, lt: 'now' })],
      field: ASSIGNEES,
      size: params.size,
      chart: params.chart,
      labels: 'user',
      hint: 'Who is holding up the most work',
    }),
});

/**
 * Which step of a workflow the work is waiting at.
 *
 * `nt:name` holds the node's i18n key, which `labels: "message"` renders. It is the only field on
 * a task that leads anywhere near its model: `nt:processName` receives the notification template
 * and is usually empty, and only `nt:processId` leads to the instance — a join the planner cannot
 * express, which is why there is no "tasks by workflow model" widget here.
 */
export const tasksByName = defineWidget({
  id: 'tasks-by-name',
  index: 'nuxeo',
  title: 'By Task Type',
  summary: 'Which workflow step the waiting work sits at.',
  params: rankedParams('donut'),
  build: (params) =>
    topNChart({
      of: OPEN_TASKS,
      field: 'nt:name',
      size: params.size,
      chart: params.chart,
      labels: 'message',
      hint: 'Which step of a workflow the work is waiting at',
    }),
});

/**
 * The late tasks themselves, oldest first.
 *
 * Twenty rows and no paging, which is the only shape a list may take here: answering "how much" is
 * the grid's job, and reaching every document would need paging and an export. Sorted by due date
 * so the twenty shown are the twenty that matter.
 */
export const overdueTasksTable = defineWidget({
  id: 'overdue-tasks-table',
  index: 'nuxeo',
  title: 'Overdue Tasks',
  summary: 'The oldest overdue tasks, with who they wait on and how late they are.',
  build: () =>
    recordTable({
      of: [...OPEN_TASKS, dateWindow({ field: DUE_DATE, lt: 'now' })],
      size: 20,
      sort: [{ field: DUE_DATE, order: 'asc' }],
      columns: [
        { field: 'nt:name', label: 'Task', labels: 'message' },
        { field: ASSIGNEES, label: 'Assigned to', labels: 'user', width: 'w-48' },
        { field: DUE_DATE, label: 'Due', format: 'daysUntil', width: 'w-32' },
        { field: 'nt:directive', label: 'Directive', labels: 'message' },
      ],
      hint: 'Oldest first',
    }),
});
