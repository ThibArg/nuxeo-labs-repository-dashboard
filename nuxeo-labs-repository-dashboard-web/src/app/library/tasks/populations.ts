/**
 * The population every task widget describes: tasks waiting on somebody.
 *
 * Open ones only, and that is a limit of the platform rather than a choice. A scheduled job runs
 * at 23:59 and deletes finished workflows, taking every task they carry with them whatever its
 * state, so a "completed tasks" figure would read ten in the afternoon and zero the next morning.
 * History belongs to the audit, which keeps its entries when the repository loses its documents.
 *
 * One trap the figures cannot see: a workflow node with no due date expression produces a task
 * whose `nt:dueDate` is the moment it was created, so it counts as overdue a second later. Both
 * shipped models set the expression; a Studio model need not.
 */
import { Predicate, equals } from '../predicates';

export const OPEN_TASKS: Predicate[] = [
  equals('ecm:mixinType', 'Task'),
  equals('ecm:currentLifeCycleState', 'opened'),
];

export const DUE_DATE = 'nt:dueDate';

/** People and groups a task is waiting on. Stores a principal under two forms, hence `labels`. */
export const ASSIGNEES = 'nt:actors';
