import { Injectable, inject } from '@angular/core';
import { EsIndex, EsResponse } from '../core/nuxeo.types';
import { NuxeoHttpService } from '../core/nuxeo-http.service';

export interface Container {
  id: string;
  /** Full path, which is what the scope clause matches on. */
  path: string;
  /** `dc:title`, falling back to the name when a container carries none. */
  title: string;
}

/** How many containers a level lists before the reader is told to narrow by hand. */
const PAGE_SIZE = 100;

interface ContainerSource {
  'ecm:uuid'?: string;
  'ecm:path'?: string;
  'ecm:name'?: string;
  'ecm:title'?: string;
}

/**
 * Lists the containers under a path, for the scope picker.
 *
 * Reads the index rather than `/api/v1/path/{path}/@children` for two reasons: the dashboard is
 * already a search client and needs no second notion of a document, and `@children` returns every
 * child whatever its type, so finding the folders among ten thousand files would mean paginating
 * through the files. `ecm:mixinType: Folderish` asks the question directly.
 *
 * The consequence is that a container created seconds ago may be missing, indexing being
 * asynchronous. For choosing a scope to read figures about, that is the right trade.
 */
@Injectable({ providedIn: 'root' })
export class PathBrowserService {
  private readonly http = inject(NuxeoHttpService);

  /** Direct sub-containers of a path, ordered by name. */
  async children(index: EsIndex, path: string): Promise<Container[]> {
    const response = await this.http.search<ContainerSource>(index, {
      size: PAGE_SIZE,
      query: {
        bool: {
          filter: [
            { term: { 'ecm:path@depth': depthOf(path) + 1 } },
            { term: { 'ecm:path.children': path } },
            { term: { 'ecm:mixinType': 'Folderish' } },
            { term: { 'ecm:isVersion': false } },
            { term: { 'ecm:isProxy': false } },
            { term: { 'ecm:isTrashed': false } },
          ],
        },
      },
      sort: [{ 'ecm:name': { order: 'asc' } }],
      _source: ['ecm:uuid', 'ecm:path', 'ecm:name', 'ecm:title'],
    });

    return readContainers(response);
  }
}

/**
 * Depth of a path as `ecm:path@depth` counts it.
 *
 * The writer stores `pathAsString.split("/").length`, and a leading slash leaves an empty first
 * segment, so `/default-domain` is 2 rather than 1. Read off the index rather than reasoned about:
 * the obvious formula is short by one and silently lists the container instead of its children.
 */
export function depthOf(path: string): number {
  return path.split('/').filter(Boolean).length + 1;
}

function readContainers(response: EsResponse<ContainerSource>): Container[] {
  return (response.hits?.hits ?? []).flatMap((hit) => {
    const source = hit._source ?? {};
    const path = source['ecm:path'];
    if (!path) {
      return [];
    }
    return [
      {
        id: String(source['ecm:uuid'] ?? hit._id),
        path,
        title: source['ecm:title']?.trim() || source['ecm:name'] || path,
      },
    ];
  });
}
