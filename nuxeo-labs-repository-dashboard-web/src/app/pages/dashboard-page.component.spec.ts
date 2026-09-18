import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import contentConfig from '../config/dashboards/content.json';
import { DashboardConfig, defaultFilterState, resolveSpan } from '../config/dashboard-config.model';
import { planDashboard } from '../engine/query-planner';
import { DashboardPageComponent } from './dashboard-page.component';
import { provideDashboardCharts } from '../widgets/echarts.setup';
import { ChartWidgetComponent } from '../widgets/chart-widget.component';
import { WidgetOutletComponent } from '../widgets/widget-outlet.component';
import { ChartWidgetStubComponent } from '../../testing/chart-widget.stub';
import {
  FetchStub,
  StubRoute,
  installFetchStub,
  isAggregationsRequest,
  isFacetValuesRequest,
} from '../../testing/fetch-stub';
import { settle } from '../../testing/settle';

const CONTENT = contentConfig as DashboardConfig;

/** Aggregations response covering every widget declared in content.json. */
function aggregationsResponse(): unknown {
  return {
    took: 14,
    timed_out: false,
    hits: { total: { value: 5941, relation: 'eq' }, hits: [] },
    aggregations: {
      liveNotTrashed: { doc_count: 4821 },
      trashed: { doc_count: 120 },
      versions: { doc_count: 700, secondary: { doc_count: 0 } },
      proxies: { doc_count: 300, secondary: { doc_count: 10 } },
      records: { doc_count: 42 },
      legalHold: { doc_count: 3 },
      expiringWeek: { doc_count: 2 },
      expiring60: { doc_count: 19 },
      expired: { doc_count: 7 },
      byType: {
        buckets: [
          { key: 'File', doc_count: 3000 },
          { key: 'Picture', doc_count: 1500 },
        ],
      },
      byState: { buckets: [{ key: 'project', doc_count: 4821 }] },
      createdTrend: {
        buckets: [
          { key: 1, key_as_string: '2026-09-15', doc_count: 12 },
          { key: 2, key_as_string: '2026-09-16', doc_count: 30 },
        ],
      },
      modifiedTrend: {
        buckets: [
          { key: 1, key_as_string: '2026-09-15', doc_count: 40 },
          { key: 2, key_as_string: '2026-09-16', doc_count: 55 },
        ],
      },
      topContributors: { buckets: [{ key: 'jdoe', doc_count: 900 }] },
      storageByType: {
        buckets: [{ key: 'Picture', doc_count: 1500, metric: { value: 5_000_000_000 } }],
      },
    },
  };
}

/** Configuration, translations and user lookups, shared by every page test. */
function supportRoutes(): StubRoute[] {
  return [
    { match: 'assets/dashboards/content.json', json: contentConfig },
    { match: '/ui/i18n/messages.json', json: { 'label.document.type.file': 'File' } },
    {
      match: '/api/v1/user/jdoe',
      json: { id: 'jdoe', properties: { firstName: 'Jane', lastName: 'Doe' } },
    },
  ];
}

describe('content.json', () => {
  it('declares a widget for every layout cell, and no orphan widget', () => {
    const referenced = new Set(CONTENT.layout.flatMap((row) => row.cells));
    const declared = new Set(Object.keys(CONTENT.widgets));

    expect([...referenced].filter((id) => !declared.has(id))).toEqual([]);
    expect([...declared].filter((id) => !referenced.has(id))).toEqual([]);
  });

  it('compiles into a single batched request', () => {
    const plan = planDashboard(CONTENT, defaultFilterState());

    expect(plan.errors.size).toBe(0);
    expect(plan.requests).toHaveLength(1);
    expect(plan.requests[0].kind).toBe('aggregations');
  });

  it('charts creations and modifications on their own date field', () => {
    const aggs = planDashboard(CONTENT, defaultFilterState()).requests[0].body.aggs as Record<
      string,
      any
    >;

    expect(aggs['createdTrend'].aggs.inner.date_histogram.field).toBe('dc:created');
    expect(aggs['modifiedTrend'].aggs.inner.date_histogram.field).toBe('dc:modified');
  });

  it('never emits a .keyword suffix', () => {
    const plan = planDashboard(CONTENT, defaultFilterState());
    expect(JSON.stringify(plan.requests)).not.toContain('.keyword');
  });

  it('scopes every chart to live, untrashed documents', () => {
    const aggs = planDashboard(CONTENT, defaultFilterState()).requests[0].body.aggs as Record<
      string,
      any
    >;

    // The charts describe the population the "Live" tile counts.
    const chartScope = JSON.stringify(aggs['byType'].filter);
    expect(chartScope).toContain('"ecm:isVersion":false');
    expect(chartScope).toContain('"ecm:isProxy":false');
    expect(chartScope).toContain('"ecm:isTrashed":false');
  });

  it('keeps the shared query free of any scope, so the total can count everything', () => {
    const plan = planDashboard(CONTENT, defaultFilterState());

    expect(JSON.stringify(plan.requests[0].body.query)).not.toContain('ecm:isVersion');
    expect(plan.widgets.get('totalAll')?.read).toBe('total');
  });

  describe('composition row', () => {
    /**
     * The four populations must partition the repository exactly, otherwise the tiles would not
     * add up to the total and the row would be quietly wrong.
     */
    const CASES: { scope: string; version: boolean; proxy: boolean; trashed: boolean }[] = [
      { scope: 'liveNotTrashed', version: false, proxy: false, trashed: false },
      { scope: 'trashed', version: false, proxy: false, trashed: true },
      { scope: 'versions', version: true, proxy: false, trashed: false },
      { scope: 'proxies', version: false, proxy: true, trashed: false },
    ];

    function matches(
      clauses: unknown[],
      doc: { version: boolean; proxy: boolean; trashed: boolean },
    ) {
      return clauses.every((clause) => {
        const term = (clause as { term: Record<string, boolean> }).term;
        const [field, expected] = Object.entries(term)[0];
        const actual =
          field === 'ecm:isVersion'
            ? doc.version
            : field === 'ecm:isProxy'
              ? doc.proxy
              : doc.trashed;
        return actual === expected;
      });
    }

    it('declares scopes that are mutually exclusive and exhaustive', () => {
      const scopes = CONTENT.scopes!;

      for (const doc of CASES) {
        const matching = CASES.filter((candidate) => matches(scopes[candidate.scope], doc));
        expect(matching.map((entry) => entry.scope)).toEqual([doc.scope]);
      }
    });

    it('counts everything in the total tile', () => {
      expect(CONTENT.scopes!['all']).toEqual([]);
      expect(CONTENT.widgets['totalAll'].scope).toBe('all');
    });

    it('annotates versions and proxies with a secondary figure', () => {
      const plan = planDashboard(CONTENT, defaultFilterState());

      expect(plan.widgets.get('versions')?.hasSecondary).toBe(true);
      expect(plan.widgets.get('proxies')?.hasSecondary).toBe(true);
      // The Trashed tile already carries that information in its own column.
      expect(plan.widgets.get('totalAll')?.hasSecondary).toBe(false);
    });
  });

  it('fills complete grid lines, for every date range', () => {
    for (const range of ['all', '7d', '30d', '90d', '12m']) {
      for (const row of CONTENT.layout) {
        const spans = row.cells.map((id) => resolveSpan(CONTENT.widgets[id], range) ?? 0);
        expect(spans.every((span) => span >= 1 && span <= 12)).toBe(true);
        // A row wider than twelve simply wraps, so the total must stay a whole number of lines.
        expect(spans.reduce((total, span) => total + span, 0) % 12).toBe(0);
      }
    }
  });

  it('pairs the two trends on a short range and stacks them on a long one', () => {
    for (const short of ['7d', '30d']) {
      expect(resolveSpan(CONTENT.widgets['createdTrend'], short)).toBe(6);
      expect(resolveSpan(CONTENT.widgets['modifiedTrend'], short)).toBe(6);
    }
    for (const long of ['90d', '12m', 'all']) {
      expect(resolveSpan(CONTENT.widgets['createdTrend'], long)).toBe(12);
      expect(resolveSpan(CONTENT.widgets['modifiedTrend'], long)).toBe(12);
    }
  });
});

describe('DashboardPageComponent', () => {
  let stub: FetchStub;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideDashboardCharts()],
    });

    // ECharts needs a real canvas; the option building it relies on is unit tested separately.
    TestBed.overrideComponent(WidgetOutletComponent, {
      remove: { imports: [ChartWidgetComponent] },
      add: { imports: [ChartWidgetStubComponent] },
    });
  });

  afterEach(() => stub?.restore());

  it('renders the configured dashboard end to end', async () => {
    stub = installFetchStub([
      {
        match: '/site/es/nuxeo/_search',
        matchBody: isAggregationsRequest,
        json: aggregationsResponse(),
      },
      ...supportRoutes(),
    ]);

    const fixture = TestBed.createComponent(DashboardPageComponent);
    await settle(fixture);

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Content Dashboard');
    expect(text).toContain((5941).toLocaleString()); // hits.total feeds the Total tile
    expect(text).toContain('42'); // filter aggregation
    expect(text).toContain('Jane Doe'); // user label resolution
    expect(text).toContain('5.0 GB'); // bytes formatting of the nested sum metric
  });

  it('renders a composition row whose parts add up to the total', async () => {
    stub = installFetchStub([
      {
        match: '/site/es/nuxeo/_search',
        matchBody: isAggregationsRequest,
        json: aggregationsResponse(),
      },
      ...supportRoutes(),
    ]);

    const fixture = TestBed.createComponent(DashboardPageComponent);
    await settle(fixture);

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain((5941).toLocaleString()); // Total
    expect(text).toContain((4821).toLocaleString()); // Live
    expect(text).toContain('120'); // Trashed
    expect(text).toContain('700'); // Versions
    expect(text).toContain('300'); // Proxies
    expect(4821 + 120 + 700 + 300).toBe(5941);

    // Only the proxies tile has a non zero secondary; the versions one is hidden at zero.
    expect(text).toContain('10 targeting trashed');
    expect(text).not.toContain('0 trashed');
  });

  it('renders the whole page with a single search', async () => {
    stub = installFetchStub([
      {
        match: '/site/es/nuxeo/_search',
        matchBody: isAggregationsRequest,
        json: aggregationsResponse(),
      },
      ...supportRoutes(),
    ]);

    const fixture = TestBed.createComponent(DashboardPageComponent);
    await settle(fixture);

    const searches = stub.calls.filter((call) => call.url.includes('/site/es/'));
    expect(searches).toHaveLength(1);
  });

  it('reminds the reader which range the trends cover', async () => {
    stub = installFetchStub([
      {
        match: '/site/es/nuxeo/_search',
        matchBody: isAggregationsRequest,
        json: aggregationsResponse(),
      },
      ...supportRoutes(),
    ]);

    const fixture = TestBed.createComponent(DashboardPageComponent);
    await settle(fixture);

    let text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Number of documents created per day (All time)');
    expect(text).toContain('Number of documents modified per day (Based on All time creation)');

    const last30 = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        'nxd-date-range-picker button',
      ),
    ).find((button) => button.textContent?.includes('Last 30 days'))!;
    last30.click();
    await settle(fixture);

    text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Number of documents created per day (Last 30 days)');
    expect(text).toContain('(Based on Last 30 days creation)');
  });

  it('surfaces a failing search instead of rendering zeros', async () => {
    stub = installFetchStub([
      { match: '/site/es/nuxeo/_search', status: 500, json: { message: 'boom' } },
      ...supportRoutes(),
    ]);

    const fixture = TestBed.createComponent(DashboardPageComponent);
    await settle(fixture);

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('The index could not be queried.');
    expect(text).not.toContain((5941).toLocaleString());
  });

  it('reports a missing configuration clearly', async () => {
    stub = installFetchStub([
      { match: 'assets/dashboards/content.json', status: 404, text: 'not found' },
    ]);

    const fixture = TestBed.createComponent(DashboardPageComponent);
    await settle(fixture);

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('This dashboard could not be loaded.');
  });

  it('re-runs every widget when the date range changes', async () => {
    stub = installFetchStub([
      {
        match: '/site/es/nuxeo/_search',
        matchBody: isAggregationsRequest,
        json: aggregationsResponse(),
      },
      ...supportRoutes(),
    ]);

    const fixture = TestBed.createComponent(DashboardPageComponent);
    await settle(fixture);

    const buttons = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        'nxd-date-range-picker button',
      ),
    );
    const last30 = buttons.find((button) => button.textContent?.includes('Last 30 days'));
    last30!.click();
    await settle(fixture);

    const bodies = stub.bodies.filter(isAggregationsRequest);
    expect(bodies).toHaveLength(2);
    expect(JSON.stringify(bodies[1])).toContain('now-30d');
  });

  describe('document kind filter', () => {
    function facetValuesResponse(): unknown {
      return {
        took: 2,
        timed_out: false,
        hits: { total: { value: 0, relation: 'eq' }, hits: [] },
        aggregations: {
          types: {
            sum_other_doc_count: 0,
            buckets: [
              { key: 'File', doc_count: 3000 },
              { key: 'Picture', doc_count: 1500 },
            ],
          },
          facets: { sum_other_doc_count: 0, buckets: [{ key: 'Picture', doc_count: 1690 }] },
        },
      };
    }

    function routes(): StubRoute[] {
      return [
        {
          match: '/site/es/nuxeo/_search',
          matchBody: isFacetValuesRequest,
          json: facetValuesResponse(),
        },
        {
          match: '/site/es/nuxeo/_search',
          matchBody: isAggregationsRequest,
          json: aggregationsResponse(),
        },
        ...supportRoutes(),
      ];
    }

    function element(fixture: ComponentFixture<DashboardPageComponent>): HTMLElement {
      return fixture.nativeElement as HTMLElement;
    }

    async function openDialog(fixture: ComponentFixture<DashboardPageComponent>): Promise<void> {
      element(fixture).querySelector<HTMLButtonElement>('nxd-facet-group-button button')!.click();
      await settle(fixture);
    }

    function dialogButton(
      fixture: ComponentFixture<DashboardPageComponent>,
      label: string,
    ): HTMLButtonElement {
      return Array.from(element(fixture).querySelectorAll<HTMLButtonElement>('dialog button')).find(
        (button) => button.textContent?.trim() === label,
      )!;
    }

    /** Unchecks the first value of the first panel, leaving the rest selected. */
    function uncheckFirstValue(fixture: ComponentFixture<DashboardPageComponent>): void {
      const panels = element(fixture).querySelectorAll('nxd-facet-panel');
      panels[0].querySelector<HTMLInputElement>('input[type=checkbox]')!.click();
      fixture.detectChanges();
    }

    afterEach(() => localStorage.clear());

    it('does not fetch facet values until the dialog is opened', async () => {
      stub = installFetchStub(routes());

      const fixture = TestBed.createComponent(DashboardPageComponent);
      await settle(fixture);

      expect(stub.bodies.filter(isFacetValuesRequest)).toHaveLength(0);
      expect(stub.calls.filter((call) => call.url.includes('/site/es/'))).toHaveLength(1);
    });

    it('lists every value with its count once opened', async () => {
      stub = installFetchStub(routes());

      const fixture = TestBed.createComponent(DashboardPageComponent);
      await settle(fixture);
      await openDialog(fixture);

      const dialog = element(fixture).querySelector('dialog')!;
      expect(stub.bodies.filter(isFacetValuesRequest)).toHaveLength(1);
      expect(dialog.textContent).toContain('File');
      expect(dialog.textContent).toContain((3000).toLocaleString());
      expect(dialog.textContent).toContain('Including: all documents.');
    });

    it('applies a selection to every widget, including the table', async () => {
      stub = installFetchStub(routes());

      const fixture = TestBed.createComponent(DashboardPageComponent);
      await settle(fixture);
      await openDialog(fixture);

      uncheckFirstValue(fixture);
      dialogButton(fixture, 'Apply').click();
      await settle(fixture);

      const last = stub.bodies.filter(isAggregationsRequest).at(-1) as { query: unknown };
      expect(JSON.stringify(last.query)).toContain('"ecm:primaryType":["Picture"]');
    });

    it('does not refetch the values when only the selection changes', async () => {
      stub = installFetchStub(routes());

      const fixture = TestBed.createComponent(DashboardPageComponent);
      await settle(fixture);
      await openDialog(fixture);

      uncheckFirstValue(fixture);
      dialogButton(fixture, 'Apply').click();
      await settle(fixture);
      await openDialog(fixture);

      expect(stub.bodies.filter(isFacetValuesRequest)).toHaveLength(1);
    });

    it('discards the draft when the dialog is cancelled', async () => {
      stub = installFetchStub(routes());

      const fixture = TestBed.createComponent(DashboardPageComponent);
      await settle(fixture);
      const before = stub.bodies.filter(isAggregationsRequest).length;

      await openDialog(fixture);
      uncheckFirstValue(fixture);
      dialogButton(fixture, 'Cancel').click();
      await settle(fixture);

      expect(stub.bodies.filter(isAggregationsRequest)).toHaveLength(before);
    });

    it('restores a selection persisted for this dashboard', async () => {
      localStorage.setItem(
        'nxd.filters.content.kind',
        JSON.stringify({
          v: 1,
          members: {
            types: { field: 'ecm:primaryType', selection: { mode: 'subset', values: ['Picture'] } },
            facets: { field: 'ecm:mixinType', selection: { mode: 'all' } },
          },
        }),
      );
      stub = installFetchStub(routes());

      const fixture = TestBed.createComponent(DashboardPageComponent);
      await settle(fixture);

      expect(JSON.stringify(stub.bodies.filter(isAggregationsRequest)[0])).toContain(
        '"ecm:primaryType":["Picture"]',
      );
    });
  });
});
