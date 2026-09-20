/**
 * Named populations of the repository.
 *
 * A widget can only ever narrow the query a page shares, never widen it, so "exclude versions and
 * proxies" cannot live at the page level: it would make counting versions impossible. Each widget
 * therefore states the population it describes, and stating it here rather than in a configuration
 * file is what turns the partition below into something a single test can hold for good.
 */
import { Predicate, equals } from './predicates';

const notVersion = equals('ecm:isVersion', false);
const notProxy = equals('ecm:isProxy', false);
const notTrashed = equals('ecm:isTrashed', false);

/** Every document the index carries: live, versions and proxies, trashed or not. */
export const EVERYTHING: Predicate[] = [];

/** What a reader means by "the documents": live, not a version, not a proxy, not in the trash. */
export const LIVE_NOT_TRASHED: Predicate[] = [notVersion, notProxy, notTrashed];

/**
 * Live documents sitting in the trash.
 *
 * Proxies are never trashed — `PropertyTrashService.doTrashDocument` removes them outright — so
 * excluding them here is not redundant with excluding versions.
 */
export const TRASHED: Predicate[] = [notVersion, notProxy, equals('ecm:isTrashed', true)];

export const VERSIONS: Predicate[] = [equals('ecm:isVersion', true), notProxy];

export const PROXIES: Predicate[] = [equals('ecm:isProxy', true)];

/**
 * The four populations a reader adds up, in the order the composition row shows them.
 *
 * They partition the repository exactly, which is the whole reason the Total tile can sit beside
 * them without needing an explanation.
 */
export const COMPOSITION: Record<string, Predicate[]> = {
  liveNotTrashed: LIVE_NOT_TRASHED,
  trashed: TRASHED,
  versions: VERSIONS,
  proxies: PROXIES,
};
