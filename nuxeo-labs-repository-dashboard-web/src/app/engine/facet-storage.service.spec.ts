import { TestBed } from '@angular/core/testing';
import { GroupSelection, TermsGroupConfig } from '../config/dashboard-config.model';
import { FacetStorageService } from './facet-storage.service';

const GROUP: TermsGroupConfig = {
  type: 'termsGroup',
  id: 'kind',
  label: 'Document kinds',
  members: [
    { id: 'types', field: 'ecm:primaryType', label: 'Document types' },
    { id: 'facets', field: 'ecm:mixinType', label: 'Facets' },
  ],
};

const KEY = 'nxd.filters.content.kind';

describe('FacetStorageService', () => {
  let service: FacetStorageService;

  beforeEach(() => {
    service = TestBed.inject(FacetStorageService);
    localStorage.clear();
  });

  afterEach(() => localStorage.clear());

  it('defaults to no constraint when nothing was stored', () => {
    expect(service.read('content', GROUP)).toEqual({
      types: { mode: 'all' },
      facets: { mode: 'all' },
    });
  });

  it('round-trips a selection', () => {
    const selection: GroupSelection = {
      types: { mode: 'subset', values: ['File', 'Picture'] },
      facets: { mode: 'all' },
    };

    service.write('content', GROUP, selection);

    expect(service.read('content', GROUP)).toEqual(selection);
  });

  it('stores "all" as such, so a type created later is included rather than excluded', () => {
    service.write('content', GROUP, { types: { mode: 'all' }, facets: { mode: 'all' } });

    const stored = JSON.parse(localStorage.getItem(KEY)!);
    expect(stored.members.types.selection).toEqual({ mode: 'all' });
  });

  it('discards a member whose field no longer matches the configuration', () => {
    service.write('content', GROUP, {
      types: { mode: 'subset', values: ['File'] },
      facets: { mode: 'all' },
    });

    const renamed: TermsGroupConfig = {
      ...GROUP,
      members: [
        { id: 'types', field: 'docType', label: 'Document types' },
        { id: 'facets', field: 'ecm:mixinType', label: 'Facets' },
      ],
    };

    expect(service.read('content', renamed)['types']).toEqual({ mode: 'all' });
  });

  it('discards a payload written by another version', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        v: 99,
        members: {
          types: { field: 'ecm:primaryType', selection: { mode: 'subset', values: ['File'] } },
        },
      }),
    );

    expect(service.read('content', GROUP)['types']).toEqual({ mode: 'all' });
  });

  it('survives a corrupted payload', () => {
    localStorage.setItem(KEY, 'not json at all');
    expect(service.read('content', GROUP)['types']).toEqual({ mode: 'all' });
  });

  it('rejects a selection whose shape is wrong', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        v: 1,
        members: {
          types: { field: 'ecm:primaryType', selection: { mode: 'subset', values: [1, 2] } },
        },
      }),
    );

    expect(service.read('content', GROUP)['types']).toEqual({ mode: 'all' });
  });

  it('keeps dashboards independent', () => {
    service.write('content', GROUP, {
      types: { mode: 'subset', values: ['File'] },
      facets: { mode: 'all' },
    });

    expect(service.read('governance', GROUP)['types']).toEqual({ mode: 'all' });
  });

  it('does not throw when localStorage is unavailable', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('storage disabled');
      },
    });

    try {
      expect(() => service.read('content', GROUP)).not.toThrow();
      expect(() =>
        service.write('content', GROUP, { types: { mode: 'all' }, facets: { mode: 'all' } }),
      ).not.toThrow();
      expect(() => service.clear('content', GROUP)).not.toThrow();
    } finally {
      if (original) {
        Object.defineProperty(globalThis, 'localStorage', original);
      }
    }
  });
});
