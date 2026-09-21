import { describe, expect, it } from 'vitest';
import { OPEN_TASKS } from './populations';
import { compilePredicates } from '../predicates';
import { TASKS_WIDGETS } from '../registry';

describe('the open tasks population', () => {
  /**
   * A workflow model may declare its own task document type, so the facet is the only reliable
   * way to catch every task. `RoutingTask` alone would silently miss the ones a Studio project
   * defines.
   */
  it('selects tasks by facet rather than by document type', () => {
    expect(compilePredicates(OPEN_TASKS)).toContainEqual({ term: { 'ecm:mixinType': 'Task' } });
    expect(JSON.stringify(compilePredicates(OPEN_TASKS))).not.toContain('RoutingTask');
  });

  /**
   * A nightly job deletes finished workflows and every task they carry, so a count of completed
   * tasks would read ten today and zero tomorrow. The audit keeps that history; the repository
   * does not, and no widget here may pretend otherwise.
   */
  it('describes open tasks only, which is all the repository reliably holds', () => {
    expect(compilePredicates(OPEN_TASKS)).toContainEqual({
      term: { 'ecm:currentLifeCycleState': 'opened' },
    });
  });

  it('is the population every task widget describes, with no exception', () => {
    const open = JSON.stringify(compilePredicates(OPEN_TASKS)).slice(1, -1);

    for (const definition of TASKS_WIDGETS) {
      const body = definition.build({}) as { filter?: unknown[] };

      expect(JSON.stringify(body.filter ?? []), definition.id).toContain(open);
    }
  });
});
