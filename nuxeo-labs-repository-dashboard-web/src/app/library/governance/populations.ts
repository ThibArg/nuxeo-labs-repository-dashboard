/**
 * Populations of the governed repository.
 *
 * All of them narrow the live documents first. That pair of exclusions — no version, no proxy —
 * is near-tautological and deliberately kept: a record can be neither checked in nor published,
 * so no version and no proxy ever carries one, which means these never double count the way a
 * repository composition does.
 *
 * Three fields and no more reach the index: `ecm:isRecord`, `ecm:retainUntil` and
 * `ecm:hasLegalHold`. **`ecm:isFlexibleRecord` is not among them**, so nothing here can tell a
 * flexible record from an enforced one — the `Record` facet is the only discriminant left, and it
 * says how a record was made rather than what it is.
 */
import { LIVE_NOT_TRASHED } from '../populations';
import { Predicate, dateWindow, equals } from '../predicates';

/** Live documents, the population every figure here is a share of. */
export const GOVERNED_REPOSITORY: Predicate[] = LIVE_NOT_TRASHED;

/** Declared a record, whatever protects it. */
export const RECORDS: Predicate[] = [...GOVERNED_REPOSITORY, equals('ecm:isRecord', true)];

/**
 * Records a retention rule was attached to.
 *
 * The `Record` facet is set by `Retention.AttachRule` alone: `Document.Retain` and `Document.Hold`
 * both produce a record without it. So this is always a subset of the records, and the gap between
 * the two is exactly the records somebody made by hand.
 */
export const GOVERNED_BY_A_RULE: Predicate[] = [
  ...GOVERNED_REPOSITORY,
  equals('ecm:mixinType', 'Record'),
];

/**
 * Documents whose retention date is still in the future.
 *
 * There is no "expired retention" population to write beside it: an hourly scheduler sets
 * `ecm:retainUntil` back to null once it has passed, so a retention is visible as future or not
 * visible at all.
 */
export const UNDER_RETENTION: Predicate[] = [
  ...GOVERNED_REPOSITORY,
  dateWindow({ field: 'ecm:retainUntil', gt: 'now' }),
];

export const UNDER_LEGAL_HOLD: Predicate[] = [
  ...GOVERNED_REPOSITORY,
  equals('ecm:hasLegalHold', true),
];

export const RETAIN_UNTIL = 'ecm:retainUntil';
