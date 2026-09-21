/**
 * The catalogue.
 *
 * A developer points an assistant at this folder: each definition is a dozen lines carrying a
 * semantic id and one sentence saying what it measures, which is the catalogue itself. Nothing
 * generated has to be kept in step with it.
 */
import { WidgetDefinition } from './definition';
import {
  liveDocuments,
  proxies,
  totalDocuments,
  trashedDocuments,
  versions,
} from './content/counts';
import {
  documentsExpired,
  documentsExpiringInSixtyDays,
  documentsExpiringThisWeek,
} from './content/expiry';
import { documentsByLifecycleState, documentsByType, topContributors } from './content/breakdowns';
import { documentsCreated, documentsModified } from './content/trends';
import {
  distinctUsersPerDay,
  documentsCreatedByUser,
  documentsModifiedByUser,
  failedLogins,
  topUsersByLogins,
} from './users/activity';
import {
  tasksCreated,
  tasksEnded,
  workflowsCancelled,
  workflowsCompleted,
  workflowsStarted,
} from './workflows/volumes';
import {
  averageTaskDuration,
  averageWorkflowDuration,
  medianWorkflowDuration,
  slowestTaskSteps,
  slowestWorkflowModels,
  workflowDurationDistribution,
} from './workflows/durations';
import {
  taskOutcomes,
  tasksByStep,
  topTaskPerformers,
  topWorkflowInitiators,
  workflowsByModel,
  workflowsCompletedPerDay,
  workflowsStartedPerDay,
} from './workflows/activity';

export const CONTENT_WIDGETS: WidgetDefinition[] = [
  totalDocuments,
  liveDocuments,
  versions,
  proxies,
  trashedDocuments,
  documentsExpiringThisWeek,
  documentsExpiringInSixtyDays,
  documentsExpired,
  documentsByType,
  documentsByLifecycleState,
  documentsCreated,
  documentsModified,
  topContributors,
];

/** Who is using the repository, read from the audit index. */
export const USERS_WIDGETS: WidgetDefinition[] = [
  distinctUsersPerDay,
  topUsersByLogins,
  failedLogins,
  documentsCreatedByUser,
  documentsModifiedByUser,
];

/** What the workflow engine did, read from the `audit_wf` view. */
export const WORKFLOWS_WIDGETS: WidgetDefinition[] = [
  workflowsStarted,
  workflowsCompleted,
  workflowsCancelled,
  tasksCreated,
  tasksEnded,
  averageWorkflowDuration,
  medianWorkflowDuration,
  averageTaskDuration,
  slowestWorkflowModels,
  slowestTaskSteps,
  workflowDurationDistribution,
  workflowsStartedPerDay,
  workflowsCompletedPerDay,
  workflowsByModel,
  taskOutcomes,
  topWorkflowInitiators,
  topTaskPerformers,
  tasksByStep,
];

export const WIDGET_LIBRARY: WidgetDefinition[] = [
  ...CONTENT_WIDGETS,
  ...USERS_WIDGETS,
  ...WORKFLOWS_WIDGETS,
];

const BY_ID = new Map(WIDGET_LIBRARY.map((definition) => [definition.id, definition]));

export function findWidget(id: string): WidgetDefinition | undefined {
  return BY_ID.get(id);
}

/** Every id a composition may name, sorted, for an error message worth reading. */
export function knownWidgetIds(): string[] {
  return [...BY_ID.keys()].sort();
}
