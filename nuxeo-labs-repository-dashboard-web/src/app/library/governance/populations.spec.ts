import { describe, expect, it } from 'vitest';
import { GOVERNANCE_WIDGETS } from '../registry';
import { RETENTION_RULES, UNDER_RETENTION } from './populations';
import { compilePredicates } from '../predicates';

/** The widgets describing how governance is configured rather than what it protects. */
const RULE_WIDGETS = [
  'retention-rules',
  'rules-by-end-action',
  'rules-by-application-policy',
  'rules-by-starting-point',
  'rules-by-flexibility',
];

describe('the retention rules population', () => {
  it('selects the rule documents, and only the live ones', () => {
    const clauses = compilePredicates(RETENTION_RULES);

    expect(clauses).toContainEqual({ term: { 'ecm:primaryType': 'RetentionRule' } });
    expect(clauses).toContainEqual({ term: { 'ecm:isTrashed': false } });
  });

  it('is what every rule widget describes, and nothing else uses it', () => {
    for (const definition of GOVERNANCE_WIDGETS) {
      const body = definition.build({}) as { filter?: unknown[] };
      const onRules = JSON.stringify(body.filter ?? []).includes('RetentionRule');

      expect(onRules, definition.id).toBe(RULE_WIDGETS.includes(definition.id));
    }
  });

  /**
   * These describe configuration, not content, and the two do not belong on one filtered page.
   * The rules live under `/RetentionRules`, outside `/default-domain`, so narrowing a page to a
   * container would empty them without saying why — and a reader would read that as "no rules".
   */
  it('stays off every shipped page', async () => {
    const shipped: unknown = (await import('../../config/dashboards/governance.json')).default;
    const used = JSON.stringify(shipped);

    for (const id of RULE_WIDGETS) {
      expect(used, id).not.toContain(`"${id}"`);
    }
  });

  it('says in every summary that it describes configuration', () => {
    const rules = GOVERNANCE_WIDGETS.filter((definition) => RULE_WIDGETS.includes(definition.id));

    expect(rules).toHaveLength(RULE_WIDGETS.length);
    for (const definition of rules) {
      expect(`${definition.summary} ${definition.title}`.toLowerCase(), definition.id).toMatch(
        /rule/,
      );
    }
  });
});

describe('the retention horizon', () => {
  /**
   * The lower bound of all three tiles comes from the population, not from the tile: without it
   * "expiring this week" would also count everything that lapsed last year.
   */
  it('is bounded below by the population rather than by each tile', () => {
    expect(compilePredicates(UNDER_RETENTION)).toContainEqual({
      range: { 'ecm:retainUntil': { gt: 'now' } },
    });
  });
});
