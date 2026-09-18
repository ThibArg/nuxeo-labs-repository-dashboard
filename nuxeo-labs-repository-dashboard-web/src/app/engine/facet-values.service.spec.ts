import { TestBed } from '@angular/core/testing';
import {
  DashboardConfig,
  FilterState,
  TermsGroupConfig,
  termsGroups,
} from '../config/dashboard-config.model';
import { FacetValuesService } from './facet-values.service';
import { FetchStub, installFetchStub } from '../../testing/fetch-stub';

const CONFIG: DashboardConfig = {
  id: 'test',
  label: 'Test',
  index: 'nuxeo',
  baseFilter: [{ term: { 'ecm:isVersion': false } }],
  filters: [
    { type: 'dateRange', field: 'dc:created' },
    {
      type: 'termsGroup',
      id: 'kind',
      label: 'Document kinds',
      members: [
        { id: 'types', field: 'ecm:primaryType', label: 'Document types', size: 200 },
        { id: 'facets', field: 'ecm:mixinType', label: 'Facets', size: 200 },
      ],
    },
  ],
  layout: [],
  widgets: {},
};

const GROUP: TermsGroupConfig = termsGroups(CONFIG)[0];

function state(overrides: Partial<FilterState> = {}): FilterState {
  return {
    range: { id: 'all', label: 'All time', from: null },
    groups: { kind: { types: { mode: 'all' }, facets: { mode: 'all' } } },
    ...overrides,
  };
}

function response(sumOther = 0): unknown {
  return {
    took: 2,
    timed_out: false,
    hits: { total: { value: 10, relation: 'eq' }, hits: [] },
    aggregations: {
      types: {
        sum_other_doc_count: sumOther,
        buckets: [
          { key: 'File', doc_count: 3000 },
          { key: 'Picture', doc_count: 1500 },
        ],
      },
      facets: {
        sum_other_doc_count: 0,
        buckets: [{ key: 'Picture', doc_count: 1690 }],
      },
    },
  };
}

describe('FacetValuesService', () => {
  let stub: FetchStub;
  let service: FacetValuesService;

  beforeEach(() => {
    service = TestBed.inject(FacetValuesService);
    service.invalidate();
  });

  afterEach(() => stub?.restore());

  it('aggregates every member of a group in one request', async () => {
    stub = installFetchStub([{ match: '/site/es/nuxeo/_search', json: response() }]);

    const values = await service.load(CONFIG, GROUP, state(), 'sig');

    expect(stub.calls).toHaveLength(1);
    const body = stub.bodies[0] as { aggs: Record<string, unknown> };
    expect(Object.keys(body.aggs).sort()).toEqual(['facets', 'types']);
    expect(values.get('types')?.values).toEqual([
      { value: 'File', count: 3000 },
      { value: 'Picture', count: 1500 },
    ]);
  });

  it('sends an explicit size, because the OpenSearch default of 10 would truncate the list', async () => {
    stub = installFetchStub([{ match: '/site/es/nuxeo/_search', json: response() }]);

    await service.load(CONFIG, GROUP, state(), 'sig');

    const body = stub.bodies[0] as { aggs: Record<string, { terms: { size: number } }> };
    expect(body.aggs['types'].terms.size).toBe(200);
    expect(body.aggs['facets'].terms.size).toBe(200);
  });

  it('reports truncation so that the operator can raise the size', async () => {
    stub = installFetchStub([{ match: '/site/es/nuxeo/_search', json: response(42) }]);

    const values = await service.load(CONFIG, GROUP, state(), 'sig');

    expect(values.get('types')?.truncated).toBe(true);
    expect(values.get('facets')?.truncated).toBe(false);
  });

  it('excludes the whole group from its own query, so both lists stay stable while editing', async () => {
    stub = installFetchStub([{ match: '/site/es/nuxeo/_search', json: response() }]);

    await service.load(
      CONFIG,
      GROUP,
      state({
        groups: {
          kind: {
            types: { mode: 'subset', values: ['File'] },
            facets: { mode: 'subset', values: ['Picture'] },
          },
        },
      }),
      'sig',
    );

    // The field appears in `aggs`, since that is what is being aggregated. What must stay out is
    // the group's own constraint in `query`, otherwise the lists would shrink as the user clicks.
    const body = stub.bodies[0] as { query: unknown; aggs: unknown };
    expect(JSON.stringify(body.query)).not.toContain('ecm:primaryType');
    expect(JSON.stringify(body.query)).not.toContain('ecm:mixinType');
    expect(JSON.stringify(body.query)).toContain('ecm:isVersion');
  });

  it('keeps the date range, since the counts must match what the dashboard shows', async () => {
    stub = installFetchStub([{ match: '/site/es/nuxeo/_search', json: response() }]);

    await service.load(
      CONFIG,
      GROUP,
      state({ range: { id: '30d', label: 'Last 30 days', from: 'now-30d' } }),
      'sig-30d',
    );

    expect(JSON.stringify(stub.bodies[0])).toContain('now-30d');
  });

  it('keeps a selected value that disappeared from the index, with a zero count', async () => {
    stub = installFetchStub([{ match: '/site/es/nuxeo/_search', json: response() }]);

    const values = await service.load(
      CONFIG,
      GROUP,
      state({
        groups: {
          kind: {
            types: { mode: 'subset', values: ['File', 'RetiredType'] },
            facets: { mode: 'all' },
          },
        },
      }),
      'sig',
    );

    expect(values.get('types')?.values).toContainEqual({ value: 'RetiredType', count: 0 });
  });

  it('serves a repeated signature from the cache', async () => {
    stub = installFetchStub([{ match: '/site/es/nuxeo/_search', json: response() }]);

    await service.load(CONFIG, GROUP, state(), 'sig');
    await service.load(CONFIG, GROUP, state(), 'sig');

    expect(stub.calls).toHaveLength(1);
  });

  it('refetches when the signature changes', async () => {
    stub = installFetchStub([{ match: '/site/es/nuxeo/_search', json: response() }]);

    await service.load(CONFIG, GROUP, state(), 'sig-a');
    await service.load(CONFIG, GROUP, state(), 'sig-b');

    expect(stub.calls).toHaveLength(2);
  });

  it('never caches a failure', async () => {
    stub = installFetchStub([{ match: '/site/es/nuxeo/_search', status: 500, json: {} }]);

    await expect(service.load(CONFIG, GROUP, state(), 'sig')).rejects.toThrow();
    await expect(service.load(CONFIG, GROUP, state(), 'sig')).rejects.toThrow();

    expect(stub.calls).toHaveLength(2);
  });

  describe('signatureOf', () => {
    it('changes with the date range', () => {
      const a = FacetValuesService.signatureOf(CONFIG, GROUP, state());
      const b = FacetValuesService.signatureOf(
        CONFIG,
        GROUP,
        state({ range: { id: '30d', label: '', from: 'now-30d' } }),
      );
      expect(a).not.toBe(b);
    });

    it('does not change with the selection inside the group', () => {
      const a = FacetValuesService.signatureOf(CONFIG, GROUP, state());
      const b = FacetValuesService.signatureOf(
        CONFIG,
        GROUP,
        state({
          groups: {
            kind: { types: { mode: 'subset', values: ['File'] }, facets: { mode: 'all' } },
          },
        }),
      );
      expect(a).toBe(b);
    });
  });
});
