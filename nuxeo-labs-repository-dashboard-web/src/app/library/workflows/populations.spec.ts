import { describe, expect, it } from 'vitest';
import { CANCELLED, COMPLETED, STARTED, TASK_CREATED, TASK_ENDED } from './populations';
import { Predicate, compilePredicates } from '../predicates';

/**
 * Every workflow event this view can return.
 *
 * Eight of the thirteen audited: the injected `category: "Routing"` filter hides the other five,
 * which are fired with no explicit category. A population built on one of those would stay empty
 * for ever with nothing on screen to explain why.
 */
const REACHABLE_EVENTS = [
  'afterWorkflowStarted',
  'afterWorkflowFinish',
  'beforeWorkflowCanceled',
  'workflowCanceled',
  'afterWorkflowTaskCreated',
  'afterWorkflowTaskEnded',
  'afterWorkflowTaskReassigned',
  'afterWorkflowTaskDelegated',
];

const POPULATIONS: [string, Predicate[]][] = [
  ['started', STARTED],
  ['completed', COMPLETED],
  ['cancelled', CANCELLED],
  ['taskCreated', TASK_CREATED],
  ['taskEnded', TASK_ENDED],
];

/** Event ids a population accepts, read from the clauses it compiles to. */
function eventsOf(predicates: Predicate[]): string[] {
  return compilePredicates(predicates).flatMap((clause) => {
    const { term, terms } = clause as {
      term?: Record<string, string>;
      terms?: Record<string, string[]>;
    };
    if (term?.['eventId']) {
      return [term['eventId']];
    }
    return terms?.['eventId'] ?? [];
  });
}

describe('the workflow populations', () => {
  it('are built out of events this view can actually return', () => {
    const used = POPULATIONS.flatMap(([, predicates]) => eventsOf(predicates));

    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((event) => !REACHABLE_EVENTS.includes(event))).toEqual([]);
  });

  /**
   * A workflow has no state field, so state is derived from the event id. That derivation is only
   * sound while no event feeds two populations at once: a reader comparing the started, completed
   * and cancelled tiles would otherwise be counting the same entry twice.
   *
   * These are deliberately **not** a partition — three of the eight reachable events are counted
   * by none of them — so only exclusivity is asserted, never exhaustiveness.
   */
  it('can never count one event twice', () => {
    for (const event of REACHABLE_EVENTS) {
      const matching = POPULATIONS.filter(([, predicates]) =>
        eventsOf(predicates).includes(event),
      ).map(([name]) => name);

      expect(
        matching.length,
        `${event} is counted by ${matching.join(' and ')}`,
      ).toBeLessThanOrEqual(1);
    }
  });

  /**
   * `workflowCanceled` fires once per attached document, so counting it would multiply a single
   * cancellation by the size of its attachment. `beforeWorkflowCanceled` fires once per instance.
   */
  it('count a cancellation once, not once per attached document', () => {
    expect(eventsOf(CANCELLED)).toEqual(['beforeWorkflowCanceled']);
  });

  it('leave three reachable events uncounted, which is why the tiles never add up', () => {
    const counted = new Set(POPULATIONS.flatMap(([, predicates]) => eventsOf(predicates)));

    expect(REACHABLE_EVENTS.filter((event) => !counted.has(event))).toEqual([
      'workflowCanceled',
      'afterWorkflowTaskReassigned',
      'afterWorkflowTaskDelegated',
    ]);
  });
});
