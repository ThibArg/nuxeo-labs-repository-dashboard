/**
 * Populations of the `audit_wf` view.
 *
 * A workflow has no state field: what happened is the event id, and these five are the events a
 * figure can honestly be built on. They are mutually exclusive but **not** exhaustive — three
 * reachable events fall outside them — so the tiles never claim to add up to anything.
 *
 * Two choices worth keeping. `beforeWorkflowCanceled` rather than `workflowCanceled`, which fires
 * once per attached document and so multiplies a single cancellation. And nothing here counts
 * instances *running now*: that figure cannot come from the audit at all, it needs `DocumentRoute`
 * on the repository index.
 *
 * Five further events are invisible through this view whatever is asked of it: the injected
 * `category: "Routing"` filter hides `workflowTaskAssigned`, `workflowTaskReassigned`,
 * `workflowTaskCompleted`, `workflowTaskDelegated` and `auditLogRoute`.
 */
import { Predicate, equals } from '../predicates';

export const STARTED: Predicate[] = [equals('eventId', 'afterWorkflowStarted')];
export const COMPLETED: Predicate[] = [equals('eventId', 'afterWorkflowFinish')];
export const CANCELLED: Predicate[] = [equals('eventId', 'beforeWorkflowCanceled')];
export const TASK_CREATED: Predicate[] = [equals('eventId', 'afterWorkflowTaskCreated')];
export const TASK_ENDED: Predicate[] = [equals('eventId', 'afterWorkflowTaskEnded')];

/** Milliseconds since the instance started, absent rather than negative when it cannot be found. */
export const WORKFLOW_DURATION = 'extended.timeSinceWfStarted';

/** Milliseconds a task waited between assignment and completion. */
export const TASK_DURATION = 'extended.timeSinceTaskStarted';
