import { describe, expect, it } from 'vitest';
import { COMPOSITION, EVERYTHING } from './populations';
import { Predicate, compilePredicates } from './predicates';

/**
 * A synthetic document, described by the three flags every population reads.
 *
 * Evaluating the clauses against these rather than reading them is what makes the partition a
 * fact rather than an opinion: the four sets are checked to accept one document each, and the
 * same document to fall in exactly one of them.
 */
interface Doc {
  version: boolean;
  proxy: boolean;
  trashed: boolean;
}

const CASES: { population: string; doc: Doc }[] = [
  { population: 'liveNotTrashed', doc: { version: false, proxy: false, trashed: false } },
  { population: 'trashed', doc: { version: false, proxy: false, trashed: true } },
  { population: 'versions', doc: { version: true, proxy: false, trashed: false } },
  { population: 'proxies', doc: { version: false, proxy: true, trashed: false } },
];

function accepts(predicates: Predicate[], doc: Doc): boolean {
  return compilePredicates(predicates).every((clause) => {
    const term = (clause as { term: Record<string, boolean> }).term;
    const [field, expected] = Object.entries(term)[0];
    const actual =
      field === 'ecm:isVersion' ? doc.version : field === 'ecm:isProxy' ? doc.proxy : doc.trashed;
    return actual === expected;
  });
}

describe('the repository populations', () => {
  /**
   * The row a reader adds up. An overlap or a gap would not read as a bug: the tiles would simply
   * fail to sum to the total, with nothing on screen to say why.
   */
  it('partition the repository, so the composition row adds up', () => {
    for (const { population, doc } of CASES) {
      const matching = CASES.filter((candidate) => accepts(COMPOSITION[candidate.population], doc));

      expect(matching.map((entry) => entry.population)).toEqual([population]);
    }
  });

  it('constrain nothing when counting everything', () => {
    expect(compilePredicates(EVERYTHING)).toEqual([]);
  });

  /**
   * Excluding proxies from the trashed population looks redundant, since a proxy is never trashed
   * itself. It is not: a proxy reads `ecm:isTrashed` from its target, so one pointing at a trashed
   * document would otherwise be counted both as a proxy and as a trashed document.
   */
  it('keep a proxy pointing at a trashed document out of the trashed tile', () => {
    const orphanProxy: Doc = { version: false, proxy: true, trashed: true };

    expect(accepts(COMPOSITION['trashed'], orphanProxy)).toBe(false);
    expect(accepts(COMPOSITION['proxies'], orphanProxy)).toBe(true);
  });
});
