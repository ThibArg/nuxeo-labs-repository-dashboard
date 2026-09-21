import { describe, expect, it } from 'vitest';
import { DOWNLOAD_EVENTS, FILE_DOWNLOADS, RENDITIONS_SERVED } from './populations';
import { Predicate, compilePredicates } from '../predicates';

/**
 * Every reason the platform writes on a `download` entry.
 *
 * `webengine` is deliberately absent: `DownloadServiceImpl` returns before logging for it, so an
 * operation result coming back as a blob leaves no entry at all. A population built on it would
 * stay empty for ever with nothing on screen to explain why.
 */
const REACHABLE_REASONS = ['download', 'preview', 'rendition', 'cmis', 'cmisRendition'];

const POPULATIONS: [string, Predicate[]][] = [
  ['files', FILE_DOWNLOADS],
  ['renditions', RENDITIONS_SERVED],
];

/** Values a population accepts on a field, read from the clauses it compiles to. */
function valuesOf(predicates: Predicate[], field: string): string[] {
  return compilePredicates(predicates).flatMap((clause) => {
    const { term, terms } = clause as {
      term?: Record<string, string>;
      terms?: Record<string, string[]>;
    };
    if (term?.[field] !== undefined) {
      return [term[field]];
    }
    return terms?.[field] ?? [];
  });
}

describe('the download populations', () => {
  it('are built out of reasons the platform actually writes', () => {
    const used = POPULATIONS.flatMap(([, predicates]) =>
      valuesOf(predicates, 'extended.downloadReason'),
    );

    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((reason) => !REACHABLE_REASONS.includes(reason))).toEqual([]);
  });

  it('all narrow the one event the platform fires', () => {
    for (const [name, predicates] of POPULATIONS) {
      expect(valuesOf(predicates, 'eventId'), name).toEqual(['download']);
    }
    expect(valuesOf(DOWNLOAD_EVENTS, 'eventId')).toEqual(['download']);
  });

  /**
   * The two tiles sit side by side and a reader reads them against each other, so one entry
   * counted by both would make the comparison meaningless — which is the only thing that screen
   * is for.
   *
   * They are deliberately **not** a partition: `cmis` and `cmisRendition` are counted by neither,
   * so the two figures do not add up to the number of `download` entries. That is why the screen
   * shows them as two answers rather than as a split of one total.
   */
  it('can never count one entry twice', () => {
    for (const reason of REACHABLE_REASONS) {
      const matching = POPULATIONS.filter(([, predicates]) =>
        valuesOf(predicates, 'extended.downloadReason').includes(reason),
      ).map(([name]) => name);

      expect(
        matching.length,
        `${reason} is counted by ${matching.join(' and ')}`,
      ).toBeLessThanOrEqual(1);
    }
  });

  it('leave the two CMIS reasons uncounted, which is why the tiles never add up', () => {
    const counted = new Set(
      POPULATIONS.flatMap(([, predicates]) => valuesOf(predicates, 'extended.downloadReason')),
    );

    expect(REACHABLE_REASONS.filter((reason) => !counted.has(reason))).toEqual([
      'cmis',
      'cmisRendition',
    ]);
  });

  /**
   * The whole reason this domain has populations at all. Counting `eventId: download` alone would
   * present thumbnails as reads — measured at 524 renditions against 15 files on a repository in
   * ordinary use, which is not an imprecision but the opposite answer.
   */
  it('never count downloads without naming the reason', () => {
    for (const [name, predicates] of POPULATIONS) {
      expect(valuesOf(predicates, 'extended.downloadReason').length, name).toBeGreaterThan(0);
    }
  });
});
