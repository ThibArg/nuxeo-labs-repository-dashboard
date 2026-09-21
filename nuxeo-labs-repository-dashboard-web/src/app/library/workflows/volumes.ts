/** How many workflows and tasks reached each point of their life. */
import { KpiSeverity } from '../../config/dashboard-config.model';
import { countTile } from '../builders';
import { ParamSpecs, defineWidget } from '../definition';
import { CANCELLED, COMPLETED, STARTED, TASK_CREATED, TASK_ENDED } from './populations';

const SEVERITIES = ['neutral', 'accent', 'warning', 'danger', 'success'] as const;

interface TileParams {
  severity: KpiSeverity;
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
 * Instances started over the period, which is not the same as instances running.
 *
 * A trustworthy "running now" figure cannot be read from the audit at all — it needs
 * `DocumentRoute` on the repository index — so the hint says what this one is rather than letting
 * it be mistaken for the other.
 */
export const workflowsStarted = defineWidget<TileParams>({
  id: 'workflows-started',
  index: 'audit_wf',
  title: 'Workflows Started',
  summary: 'How many workflow instances were started over the period.',
  params: severity('neutral'),
  build: (params) =>
    countTile({
      of: STARTED,
      severity: params.severity,
      hint: 'Instances started ({range}), not instances running now',
    }),
});

export const workflowsCompleted = defineWidget<TileParams>({
  id: 'workflows-completed',
  index: 'audit_wf',
  title: 'Workflows Completed',
  summary: 'How many workflow instances ran to their end.',
  params: severity('success'),
  build: (params) => countTile({ of: COMPLETED, severity: params.severity }),
});

export const workflowsCancelled = defineWidget<TileParams>({
  id: 'workflows-cancelled',
  index: 'audit_wf',
  title: 'Workflows Cancelled',
  summary: 'How many workflow instances were cancelled before their end.',
  params: severity('warning'),
  build: (params) => countTile({ of: CANCELLED, severity: params.severity }),
});

export const tasksCreated = defineWidget<TileParams>({
  id: 'workflow-tasks-created',
  index: 'audit_wf',
  title: 'Tasks Created',
  summary: 'How many workflow tasks were handed to somebody.',
  params: severity('neutral'),
  build: (params) => countTile({ of: TASK_CREATED, severity: params.severity }),
});

export const tasksEnded = defineWidget<TileParams>({
  id: 'workflow-tasks-ended',
  index: 'audit_wf',
  title: 'Tasks Ended',
  summary: 'How many workflow tasks were answered or closed.',
  params: severity('neutral'),
  build: (params) => countTile({ of: TASK_ENDED, severity: params.severity }),
});
