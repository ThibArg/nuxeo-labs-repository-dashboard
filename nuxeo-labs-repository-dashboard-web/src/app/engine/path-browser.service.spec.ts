import { TestBed } from '@angular/core/testing';
import { FetchStub, installFetchStub } from '../../testing/fetch-stub';
import { PathBrowserService, depthOf } from './path-browser.service';

function response(paths: string[]): unknown {
  return {
    hits: {
      total: { value: paths.length, relation: 'eq' },
      hits: paths.map((path, index) => ({
        _id: `id-${index}`,
        _source: {
          'ecm:uuid': `id-${index}`,
          'ecm:path': path,
          'ecm:name': path.split('/').pop(),
          'ecm:title': `Title of ${path.split('/').pop()}`,
        },
      })),
    },
  };
}

describe('depthOf', () => {
  /*
   * `ecm:path@depth` holds `pathAsString.split("/").length`, and the leading slash leaves an empty
   * first segment. Counting the segments instead is short by one, which lists the container itself
   * rather than its children — a level that looks plausible and is wrong.
   */
  it('counts a path the way the index does, leading empty segment included', () => {
    expect(depthOf('/default-domain')).toBe(2);
    expect(depthOf('/default-domain/workspaces')).toBe(3);
    expect(depthOf('/default-domain/workspaces/governance-fixture')).toBe(4);
  });
});

describe('PathBrowserService', () => {
  let stub: FetchStub;

  afterEach(() => stub?.restore());

  it('asks for the containers one level below the path', async () => {
    stub = installFetchStub([
      { match: '/site/es/nuxeo/_search', json: response(['/default-domain/workspaces']) },
    ]);

    await TestBed.inject(PathBrowserService).children('nuxeo', '/default-domain');

    const body = stub.bodies[0] as { query: { bool: { filter: unknown[] } } };
    expect(body.query.bool.filter).toContainEqual({ term: { 'ecm:path@depth': 3 } });
    expect(body.query.bool.filter).toContainEqual({
      term: { 'ecm:path.children': '/default-domain' },
    });
  });

  /*
   * `ecm:path.children` matches the container itself as well as its descendants, so the depth is
   * what keeps a level from listing its own parent, and `Folderish` what keeps it from paginating
   * through ten thousand files to find four folders.
   */
  it('asks for containers only, and leaves out what cannot hold documents', async () => {
    stub = installFetchStub([{ match: '/site/es/nuxeo/_search', json: response([]) }]);

    await TestBed.inject(PathBrowserService).children('nuxeo', '/default-domain');

    const filter = (stub.bodies[0] as { query: { bool: { filter: unknown[] } } }).query.bool.filter;
    expect(filter).toContainEqual({ term: { 'ecm:mixinType': 'Folderish' } });
    expect(filter).toContainEqual({ term: { 'ecm:isVersion': false } });
    expect(filter).toContainEqual({ term: { 'ecm:isProxy': false } });
    expect(filter).toContainEqual({ term: { 'ecm:isTrashed': false } });
  });

  it('names a container by its title', async () => {
    stub = installFetchStub([
      {
        match: '/site/es/nuxeo/_search',
        json: response(['/default-domain/workspaces/governance-fixture']),
      },
    ]);

    const containers = await TestBed.inject(PathBrowserService).children(
      'nuxeo',
      '/default-domain/workspaces',
    );

    expect(containers).toEqual([
      {
        id: 'id-0',
        path: '/default-domain/workspaces/governance-fixture',
        title: 'Title of governance-fixture',
      },
    ]);
  });

  it('falls back to the name when a container carries no title', async () => {
    stub = installFetchStub([
      {
        match: '/site/es/nuxeo/_search',
        json: {
          hits: {
            hits: [
              { _id: 'a', _source: { 'ecm:path': '/a/b', 'ecm:name': 'b', 'ecm:title': ' ' } },
            ],
          },
        },
      },
    ]);

    const containers = await TestBed.inject(PathBrowserService).children('nuxeo', '/a');

    expect(containers[0].title).toBe('b');
  });

  /** A hit with no path could not be scoped to, so it is dropped rather than shown as unusable. */
  it('ignores a hit that carries no path', async () => {
    stub = installFetchStub([
      { match: '/site/es/nuxeo/_search', json: { hits: { hits: [{ _id: 'a', _source: {} }] } } },
    ]);

    expect(await TestBed.inject(PathBrowserService).children('nuxeo', '/a')).toEqual([]);
  });
});
