import { describe, expect, it } from 'vitest';
import { UnsupportedClauseError, compileClause, compileClauses } from './clause-compiler';
import { WIDGET_LIBRARY } from '../library/registry';
import { EsClause } from './es-query';

describe('compileClause', () => {
  describe('what it accepts', () => {
    it.each([
      ['a term on a string', { term: { 'ecm:primaryType': 'File' } }],
      ['a term on a boolean', { term: { 'ecm:isTrashed': false } }],
      ['a terms list', { terms: { 'ecm:primaryType': ['File', 'Note'] } }],
      ['a range in date math', { range: { 'nt:dueDate': { gte: 'now', lte: 'now+7d' } } }],
      ['a numeric range', { range: { 'file:content.length': { gt: 0 } } }],
      ['an exists', { exists: { field: 'ecm:retainUntil' } }],
    ])('%s, unchanged', (_name, clause) => {
      expect(compileClause(clause)).toEqual(clause);
    });

    it('a bool, recursing into every arm', () => {
      const clause = {
        bool: {
          should: [{ term: { a: 1 } }, { terms: { b: ['x'] } }],
          must_not: [{ exists: { field: 'c' } }],
          minimum_should_match: 1,
        },
      };

      expect(compileClause(clause)).toEqual(clause);
    });
  });

  describe('what it refuses', () => {
    /**
     * The reason this compiler exists. `DefaultSearchRequestFilter.getPayload()` forwards an
     * administrator's payload unmodified, so a script clause runs Painless per document under
     * their identity.
     */
    it('a script, which the passthrough would forward and OpenSearch would run', () => {
      expect(() =>
        compileClause({ script: { script: { source: '1', lang: 'painless' } } }),
      ).toThrow(UnsupportedClauseError);
    });

    /**
     * The shape worth knowing about: a `terms` clause may be given an object naming an index, an
     * id and a path, and OpenSearch then reads the values out of that document. It looks like an
     * ordinary filter and reads an index this application never declared.
     */
    it('a terms lookup, which reads a document in another index', () => {
      expect(() =>
        compileClause({ terms: { 'ecm:uuid': { index: 'audit', id: '1', path: 'x' } } }),
      ).toThrow(/terms lookup/);
    });

    it.each([
      ['a wrapper nobody declared', { runtime_mappings: { x: { type: 'keyword' } } }],
      ['a wildcard', { wildcard: { 'dc:title': '*' } }],
      ['a bool arm that is not one', { bool: { script_score: [{ term: { a: 1 } }] } }],
      ['a range bound that is not one', { range: { a: { format: 'epoch_millis' } } }],
      ['an exists with no field', { exists: {} }],
      ['an empty object', {}],
      ['an array', [{ term: { a: 1 } }]],
    ])('%s', (_name, clause) => {
      expect(() => compileClause(clause)).toThrow(UnsupportedClauseError);
    });

    /**
     * Two keys at once is how a refused shape would otherwise ride along beside an accepted one.
     * Rebuilding rather than forwarding is what closes it, and this is the test that says so.
     */
    it('a second key beside a valid one', () => {
      expect(() => compileClause({ term: { a: 1 }, script: { source: '1' } })).toThrow(
        UnsupportedClauseError,
      );
    });

    it('a key nested inside an accepted clause', () => {
      const compiled = compileClause({
        bool: { filter: [{ term: { a: 1 } }] },
      }) as { bool: { filter: EsClause[] } };

      expect(() => compileClause({ bool: { filter: [{ term: { a: 1 }, script: {} }] } })).toThrow(
        UnsupportedClauseError,
      );
      expect(compiled.bool.filter).toHaveLength(1);
    });
  });

  /**
   * The closed set has to cover everything the library emits, or a shipped dashboard would refuse
   * to plan. Idempotence rather than mere acceptance: a clause that survives unchanged proves
   * nothing was quietly dropped on the way through either.
   */
  it('accepts every clause the library emits, unchanged', () => {
    const emitted: EsClause[] = [];
    for (const definition of WIDGET_LIBRARY) {
      const body = definition.build({}) as {
        filter?: EsClause[];
        secondary?: { filter?: EsClause[] };
      };
      emitted.push(...(body.filter ?? []), ...(body.secondary?.filter ?? []));
    }

    expect(emitted.length).toBeGreaterThan(50);
    expect(compileClauses(emitted)).toEqual(emitted);
  });
});
