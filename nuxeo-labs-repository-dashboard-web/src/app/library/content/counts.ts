/**
 * The repository composition: how many documents there are, and of what nature.
 *
 * The five tiles add up — `total = live + trashed + versions + proxies` — which is the whole
 * reason they are worth putting side by side, and which only holds because they are counted in
 * one request.
 */
import { RESTRICTION_PARAMS, countTile, restrict } from '../builders';
import { defineWidget } from '../definition';
import { EVERYTHING, LIVE_NOT_TRASHED, PROXIES, TRASHED, VERSIONS } from '../populations';
import { equals } from '../predicates';

export const totalDocuments = defineWidget({
  id: 'total-documents',
  index: 'nuxeo',
  title: 'Total Documents',
  summary: 'Every document the index carries, whatever its nature.',
  params: RESTRICTION_PARAMS,
  build: (params) =>
    countTile({
      of: [...EVERYTHING, ...restrict(params)],
      hint: 'Live, versions and proxies, trashed or not',
    }),
});

export const liveDocuments = defineWidget({
  id: 'live-documents',
  index: 'nuxeo',
  title: 'Live',
  summary: 'Documents that are neither a version, nor a proxy, nor in the trash.',
  params: RESTRICTION_PARAMS,
  build: (params) => countTile({ of: [...LIVE_NOT_TRASHED, ...restrict(params)] }),
});

/**
 * Versions, with the ones born in the trash counted beside them.
 *
 * Trashing does not propagate to versions, but `ecm:isTrashed` is copied verbatim at check-in, so
 * a version cut from a document already in the trash is trashed from birth. On a real repository
 * that is not marginal, which is why the figure is shown rather than assumed to be zero — and
 * hidden when it really is.
 */
export const versions = defineWidget({
  id: 'versions',
  index: 'nuxeo',
  title: 'Versions',
  summary: 'Archived versions, with how many of them were cut while already in the trash.',
  params: RESTRICTION_PARAMS,
  build: (params) =>
    countTile({
      of: [...VERSIONS, ...restrict(params)],
      secondary: {
        of: [equals('ecm:isTrashed', true)],
        label: '{value} trashed',
        hideWhenZero: true,
      },
    }),
});

/**
 * Proxies, with the orphan publications counted beside them.
 *
 * A proxy is never itself trashed — the trash service removes it outright — but it reads
 * `ecm:isTrashed` from its target, so this second figure counts publications pointing at a
 * deleted document rather than deleted proxies.
 */
export const proxies = defineWidget({
  id: 'proxies',
  index: 'nuxeo',
  title: 'Proxies',
  summary: 'Publications, with how many of them point at a trashed document.',
  params: RESTRICTION_PARAMS,
  build: (params) =>
    countTile({
      of: [...PROXIES, ...restrict(params)],
      secondary: {
        of: [equals('ecm:isTrashed', true)],
        label: '{value} targeting trashed',
        hideWhenZero: true,
      },
    }),
});

export const trashedDocuments = defineWidget({
  id: 'trashed-documents',
  index: 'nuxeo',
  title: 'Trashed',
  summary: 'Live documents sitting in the trash.',
  params: RESTRICTION_PARAMS,
  build: (params) => countTile({ of: [...TRASHED, ...restrict(params)] }),
});
