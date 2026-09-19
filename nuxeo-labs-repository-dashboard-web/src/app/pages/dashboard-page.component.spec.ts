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
import { DownloadCapture, captureDownloads, textOf } from '../../testing/downloads';

const CONTENT = contentConfig as DashboardConfig;

/** Midnight, `offset` calendar days from today, as the instant a request carries. */
function startOfDay(offset: number): string {
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() + offset);
  return day.toISOString();
}

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
      expiringWeek: { doc_count: 42 },
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

  describe('expiry row', () => {
    /*
     * The three tiles read the same field, so a reader adds them up. They must therefore partition
     * the timeline: the sixty day figure is what remains once the weekly one is set aside, not a
     * total that restates it.
     */
    const TILES = ['expired', 'expiringWeek', 'expiring60'];
    const DAY = 86_400_000;
    const NOW = Date.UTC(2026, 8, 18, 10, 0, 0);

    /** Resolves the date math the tiles use, which is limited to `now` and `now±Nd`. */
    function resolve(math: string): number {
      const parsed = /^now(?:([+-])(\d+)d)?$/.exec(math);
      if (!parsed) {
        throw new Error(`Unsupported date math: ${math}`);
      }
      const [, sign, days] = parsed;
      return sign ? NOW + (sign === '-' ? -1 : 1) * Number(days) * DAY : NOW;
    }

    function counts(widgetId: string, expiry: number): boolean {
      const clause = CONTENT.widgets[widgetId].filter![0] as {
        range: Record<string, Record<string, string>>;
      };

      return Object.entries(clause.range['dc:expired']).every(([operator, math]) => {
        const bound = resolve(math);
        switch (operator) {
          case 'gte':
            return expiry >= bound;
          case 'gt':
            return expiry > bound;
          case 'lte':
            return expiry <= bound;
          case 'lt':
            return expiry < bound;
          default:
            throw new Error(`Unsupported bound: ${operator}`);
        }
      });
    }

    const CASES: { name: string; days: number; tiles: string[] }[] = [
      { name: 'expired yesterday', days: -1, tiles: ['expired'] },
      { name: 'expiring in three days', days: 3, tiles: ['expiringWeek'] },
      // The week ends on an inclusive bound, so this is where a double count would show.
      { name: 'expiring exactly seven days from now', days: 7, tiles: ['expiringWeek'] },
      { name: 'expiring in thirty days', days: 30, tiles: ['expiring60'] },
      { name: 'expiring in ninety days', days: 90, tiles: [] },
    ];

    it('counts a document in at most one tile', () => {
      for (const { name, days, tiles } of CASES) {
        expect(
          TILES.filter((id) => counts(id, NOW + days * DAY)),
          name,
        ).toEqual(tiles);
      }
    });

    it('tells the reader that the sixty day tile starts where the weekly one stops', () => {
      expect(CONTENT.widgets['expiringWeek'].hint).toBe('Within the next 7 days');
      expect(CONTENT.widgets['expiring60'].hint).toBe('Beyond the next 7 days');
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
    expect(text).toContain((900).toLocaleString()); // bucket aggregation
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

    // "All time" carries no bound at all.
    expect(JSON.stringify((bodies[0] as any).query)).not.toContain('dc:created');

    /*
     * The shortcut resolves to thirty calendar days ending today: from the start of the day
     * twenty-nine days ago, up to the start of tomorrow, which is what makes today inclusive.
     */
    const bounds = (bodies[1] as any).query.bool.filter.find((clause: any) => clause.range).range[
      'dc:created'
    ];
    expect(bounds.gte).toBe(startOfDay(-29));
    expect(bounds.lt).toBe(startOfDay(1));
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

      // Scoped to the facet editor: the page also carries the path scope picker's own dialog.
      const dialog = element(fixture).querySelector('nxd-facet-group-dialog dialog')!;
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
  describe('cross filtering', () => {
    function routes(): StubRoute[] {
      return [
        {
          match: '/site/es/nuxeo/_search',
          matchBody: isAggregationsRequest,
          json: aggregationsResponse(),
        },
        {
          match: '/site/es/nuxeo/_search',
          matchBody: isFacetValuesRequest,
          json: { hits: { total: { value: 0, relation: 'eq' }, hits: [] }, aggregations: {} },
        },
        ...supportRoutes(),
      ];
    }

    afterEach(() => localStorage.clear());

    async function render() {
      stub = installFetchStub(routes());
      const fixture = TestBed.createComponent(DashboardPageComponent);
      await settle(fixture);
      return fixture;
    }

    /** The stubbed chart renders one button per bucket, standing in for an ECharts segment. */
    function segment(
      fixture: ComponentFixture<DashboardPageComponent>,
      field: string,
      key: string,
    ) {
      return (fixture.nativeElement as HTMLElement).querySelector(
        `button[data-testid="chart-pick"][data-field="${field}"][data-key="${key}"]`,
      ) as HTMLButtonElement;
    }

    /*
     * Only the query, never the whole body: `byState` aggregates on ecm:currentLifeCycleState, so
     * a naive stringify of the request finds that field whether or not anything filters on it.
     */
    function lastQuery(): string {
      const bodies = stub.bodies.filter(isAggregationsRequest) as { query?: unknown }[];
      return JSON.stringify(bodies[bodies.length - 1]?.query);
    }

    it('narrows every widget to the bucket that was clicked', async () => {
      const fixture = await render();

      segment(fixture, 'ecm:currentLifeCycleState', 'project').click();
      await settle(fixture);

      expect(lastQuery()).toContain('"ecm:currentLifeCycleState":["project"]');
    });

    it('shows the constraint as a chip, and lifts it when dismissed', async () => {
      const fixture = await render();

      segment(fixture, 'ecm:currentLifeCycleState', 'project').click();
      await settle(fixture);
      expect((fixture.nativeElement as HTMLElement).textContent).toContain(
        'ecm:currentLifeCycleState',
      );

      (
        (fixture.nativeElement as HTMLElement).querySelector(
          'button[aria-label^="Remove filter"]',
        ) as HTMLButtonElement
      ).click();
      await settle(fixture);

      expect(lastQuery()).not.toContain('ecm:currentLifeCycleState');
    });

    it('lifts the constraint when the same bucket is clicked again', async () => {
      const fixture = await render();

      segment(fixture, 'ecm:currentLifeCycleState', 'project').click();
      await settle(fixture);
      segment(fixture, 'ecm:currentLifeCycleState', 'project').click();
      await settle(fixture);

      expect(lastQuery()).not.toContain('ecm:currentLifeCycleState');
    });

    /*
     * `ecm:primaryType` is charted *and* declared as a filter member. Both paths must land in the
     * same place, otherwise the filter bar would read "all document types" beside a chip saying
     * the opposite.
     */
    it('routes a click into the declared filter when one covers that field', async () => {
      const fixture = await render();

      segment(fixture, 'ecm:primaryType', 'File').click();
      await settle(fixture);

      expect(lastQuery()).toContain('"ecm:primaryType":["File"]');
      // It belongs to the group, so the button names it and no chip repeats it.
      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('Document kinds');
      expect(text).not.toContain('ecm:primaryType');
      expect(localStorage.getItem('nxd.filters.content.kind')).toContain('File');
    });

    /*
     * A bucket keyed by a principal was merged to one canonical form before being drawn, so the
     * clause has to look for both forms again or it finds only half the documents it counted.
     */
    it('searches both forms of a principal picked from a ranked list', async () => {
      const fixture = await render();

      // Scoped to the list itself: the card header now carries an export button too.
      const rows = (fixture.nativeElement as HTMLElement).querySelectorAll(
        'nxd-ranked-list ul button',
      );
      (rows[0] as HTMLButtonElement).click();
      await settle(fixture);

      expect(lastQuery()).toContain('"dc:creator":["jdoe","user:jdoe"]');
    });

    it('clears the picks and the groups together, and leaves the period alone', async () => {
      const fixture = await render();

      segment(fixture, 'ecm:currentLifeCycleState', 'project').click();
      await settle(fixture);
      segment(fixture, 'ecm:primaryType', 'File').click();
      await settle(fixture);

      const clear = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find(
        (button) => button.textContent?.trim() === 'Clear filters',
      ) as HTMLButtonElement;
      clear.click();
      await settle(fixture);

      expect(lastQuery()).not.toContain('ecm:currentLifeCycleState');
      expect(lastQuery()).not.toContain('"ecm:primaryType":["File"]');
      expect(localStorage.getItem('nxd.filters.content.kind')).toBeNull();
    });
  });

  describe('path scope', () => {
    /** The picker browses the index, so its own request must not be read as a widget batch. */
    function isContainerRequest(body: unknown): boolean {
      return JSON.stringify(body).includes('Folderish');
    }

    function routes(): StubRoute[] {
      return [
        {
          match: '/site/es/nuxeo/_search',
          matchBody: isContainerRequest,
          json: {
            hits: {
              hits: [
                {
                  _id: 'ws',
                  _source: {
                    'ecm:uuid': 'ws',
                    'ecm:path': '/default-domain/workspaces',
                    'ecm:name': 'workspaces',
                    'ecm:title': 'Workspaces',
                  },
                },
              ],
            },
          },
        },
        {
          match: '/site/es/nuxeo/_search',
          matchBody: isAggregationsRequest,
          json: aggregationsResponse(),
        },
        ...supportRoutes(),
      ];
    }

    async function render() {
      stub = installFetchStub(routes());
      const fixture = TestBed.createComponent(DashboardPageComponent);
      await settle(fixture);
      return fixture;
    }

    function buttonNamed(
      fixture: ComponentFixture<DashboardPageComponent>,
      text: string,
    ): HTMLButtonElement {
      return [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find(
        (button) => button.textContent?.trim() === text,
      ) as HTMLButtonElement;
    }

    function lastQuery(): string {
      const bodies = stub.bodies.filter(isAggregationsRequest) as { query?: unknown }[];
      return JSON.stringify(bodies[bodies.length - 1]?.query);
    }

    it('costs no request until the picker is opened', async () => {
      await render();

      expect(stub.bodies.filter(isContainerRequest)).toHaveLength(0);
    });

    it('restricts every widget to the container that was chosen', async () => {
      const fixture = await render();

      buttonNamed(fixture, 'Whole repository').click();
      await settle(fixture);
      buttonNamed(fixture, 'Use').click();
      await settle(fixture);

      expect(lastQuery()).toContain('"ecm:path.children":"/default-domain/workspaces"');
    });

    it('describes the whole repository again once the scope is lifted', async () => {
      const fixture = await render();

      buttonNamed(fixture, 'Whole repository').click();
      await settle(fixture);
      buttonNamed(fixture, 'Use').click();
      await settle(fixture);
      expect(lastQuery()).toContain('ecm:path.children');

      buttonNamed(fixture, 'workspaces').click();
      await settle(fixture);
      buttonNamed(fixture, 'Whole repository').click();
      await settle(fixture);

      expect(lastQuery()).not.toContain('ecm:path.children');
    });
  });
  describe('configuration editor', () => {
    afterEach(() => localStorage.clear());

    function routes(): StubRoute[] {
      return [
        {
          match: '/site/es/nuxeo/_search',
          matchBody: isAggregationsRequest,
          json: aggregationsResponse(),
        },
        ...supportRoutes(),
      ];
    }

    async function render() {
      stub = installFetchStub(routes());
      const fixture = TestBed.createComponent(DashboardPageComponent);
      await settle(fixture);
      return fixture;
    }

    function buttonNamed(
      fixture: ComponentFixture<DashboardPageComponent>,
      text: string,
    ): HTMLButtonElement {
      return [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find(
        (button) => button.textContent?.trim() === text,
      ) as HTMLButtonElement;
    }

    function type(fixture: ComponentFixture<DashboardPageComponent>, json: string): void {
      const area = (fixture.nativeElement as HTMLElement).querySelector(
        'nxd-config-editor textarea',
      ) as HTMLTextAreaElement;
      area.value = json;
      area.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    }

    /** A configuration renaming a tile, which is the cheapest change that shows on screen. */
    function renamed(): string {
      const config = JSON.parse(JSON.stringify(contentConfig));
      config.widgets['totalAll'].label = 'Everything At All';
      return JSON.stringify(config, null, 2);
    }

    it('opens on the configuration in force', async () => {
      const fixture = await render();

      buttonNamed(fixture, 'Configure').click();
      fixture.detectChanges();

      const area = (fixture.nativeElement as HTMLElement).querySelector(
        'nxd-config-editor textarea',
      ) as HTMLTextAreaElement;
      expect(JSON.parse(area.value).id).toBe('content');
    });

    it('renders the edited configuration instead of the shipped one', async () => {
      const fixture = await render();

      buttonNamed(fixture, 'Configure').click();
      fixture.detectChanges();
      type(fixture, renamed());
      buttonNamed(fixture, 'Save').click();
      await settle(fixture);

      expect((fixture.nativeElement as HTMLElement).textContent).toContain('Everything At All');
    });

    it('refuses to save something that cannot be rendered, and says why', async () => {
      const fixture = await render();

      buttonNamed(fixture, 'Configure').click();
      fixture.detectChanges();
      type(fixture, '{ "id": "content" }');

      expect((fixture.nativeElement as HTMLElement).textContent).toContain('"index" is required');
      expect(buttonNamed(fixture, 'Save').disabled).toBe(true);
    });

    it('goes back to the shipped configuration for good', async () => {
      const fixture = await render();

      buttonNamed(fixture, 'Configure').click();
      fixture.detectChanges();
      type(fixture, renamed());
      buttonNamed(fixture, 'Save').click();
      await settle(fixture);

      buttonNamed(fixture, 'Configure').click();
      fixture.detectChanges();
      buttonNamed(fixture, 'Use the shipped one').click();
      await settle(fixture);

      expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Everything At All');
      expect(localStorage.getItem('nxd.config.content')).toBeNull();
    });

    /*
     * A configuration can stop compiling without being touched, a widget naming a field a later
     * Studio change removed. Rendering a column of errors nobody can escape from would be worse
     * than quietly showing what ships, which is still correct.
     */
    it('falls back to what ships when a stored edit no longer compiles', async () => {
      localStorage.setItem(
        'nxd.config.content',
        JSON.stringify({ v: 1, json: '{"id":"content","index":"nuxeo"}' }),
      );

      const fixture = await render();

      expect((fixture.nativeElement as HTMLElement).textContent).toContain('Total Documents');
    });
  });
  describe('whole page export', () => {
    let capture: DownloadCapture;

    beforeEach(() => (capture = captureDownloads()));
    afterEach(() => {
      capture.restore();
      localStorage.clear();
    });

    async function render() {
      stub = installFetchStub([
        {
          match: '/site/es/nuxeo/_search',
          matchBody: isAggregationsRequest,
          json: aggregationsResponse(),
        },
        {
          match: 'styles.css',
          text: '.nxd-card { border: 1px solid red }',
          contentType: 'text/css',
        },
        ...supportRoutes(),
      ]);
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/styles.css';
      document.head.appendChild(link);

      const fixture = TestBed.createComponent(DashboardPageComponent);
      await settle(fixture);
      return { fixture, link };
    }

    async function exported(): Promise<string> {
      const { fixture, link } = await render();
      const button = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find(
        (candidate) => candidate.textContent?.trim() === 'Standalone HTML file',
      ) as HTMLButtonElement;
      button.click();
      await settle(fixture);
      link.remove();
      return textOf(capture.files[0]);
    }

    it('writes one file named after the dashboard', async () => {
      await exported();

      expect(capture.files[0].filename).toBe('content-dashboard.html');
    });

    /* The point of the whole thing: it has to open with no server and no assets behind it. */
    it('carries the stylesheet inline and links to nothing', async () => {
      const html = await exported();

      expect(html).toContain('.nxd-card { border: 1px solid red }');
      expect(html).not.toContain('<link');
      expect(html).not.toContain('<script');
    });

    it('keeps the figures that are already HTML', async () => {
      const html = await exported();

      expect(html).toContain('Total Documents');
      expect(html).toContain((5941).toLocaleString());
    });

    /* A canvas clones blank, so a chart only survives as the image its component photographed. */
    it('turns every chart into an embedded image', async () => {
      const html = await exported();

      expect(html).toContain('data:image/png;base64,byType');
      expect(html).toContain('data:image/png;base64,createdTrend');
    });

    /*
     * A file showing 5,941 documents says nothing a week later unless it says which 5,941, and the
     * filter bar it was read beside is not in the export.
     */
    it('states what the figures were filtered by', async () => {
      const html = await exported();

      expect(html).toContain('Period:');
      expect(html).toContain('dc:created');
    });

    it('leaves out the controls, which would act on a page that is gone', async () => {
      const html = await exported();

      expect(html).not.toContain('<button');
      expect(html).not.toContain('<dialog');
    });
  });
});
