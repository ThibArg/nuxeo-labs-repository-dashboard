import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import downloadsConfig from '../config/dashboards/downloads.json';
import {
  defaultFilterState,
  layoutCells,
  layoutRows,
  resolveSpan,
} from '../config/dashboard-config.model';
import { planDashboard } from '../engine/query-planner';
import { PreflightService } from '../core/preflight.service';
import { DashboardPageComponent } from './dashboard-page.component';
import { provideDashboardCharts } from '../widgets/echarts.setup';
import { ChartWidgetComponent } from '../widgets/chart-widget.component';
import { WidgetOutletComponent } from '../widgets/widget-outlet.component';
import { ChartWidgetStubComponent } from '../../testing/chart-widget.stub';
import { shippedConfig } from '../../testing/shipped';
import {
  FetchStub,
  StubRoute,
  healthyServerRoutes,
  installFetchStub,
  isAggregationsRequest,
} from '../../testing/fetch-stub';
import { settle } from '../../testing/settle';

const DOWNLOADS = shippedConfig('downloads.json', downloadsConfig);

const FILE_UUID = '1f3c9b2e-0000-4000-8000-000000000001';

/** Every widget carries its own reason filter, so each aggregation sits under a wrapper. */
function wrapped(docCount: number, buckets: unknown[]) {
  return { doc_count: docCount, inner: { buckets }, distinct: { value: buckets.length } };
}

function auditResponse(): unknown {
  return {
    took: 4,
    timed_out: false,
    hits: { total: { value: 539, relation: 'eq' }, hits: [] },
    aggregations: {
      fileDownloads: { doc_count: 15 },
      renditions: { doc_count: 524 },
      distinctDocuments: { doc_count: 15, metric: { value: 14 } },
      perDay: wrapped(15, [
        { key: 1, key_as_string: '2026-09-18', doc_count: 4 },
        { key: 2, key_as_string: '2026-09-19', doc_count: 11 },
      ]),
      byType: wrapped(15, [{ key: 'File', doc_count: 15 }]),
      topPeople: wrapped(15, [{ key: 'jdoe', doc_count: 12 }]),
      topDocuments: wrapped(15, [{ key: FILE_UUID, doc_count: 5 }]),
    },
  };
}

function supportRoutes(): StubRoute[] {
  return [
    { match: 'assets/dashboards/downloads.json', json: downloadsConfig },
    { match: '/ui/i18n/messages.json', json: {} },
    {
      match: '/api/v1/user/jdoe',
      json: { id: 'jdoe', properties: { firstName: 'Jane', lastName: 'Doe' } },
    },
    { match: `/api/v1/id/${FILE_UUID}`, json: { uid: FILE_UUID, title: 'Q3 report.pdf' } },
  ];
}

describe('downloads.json', () => {
  it('declares a widget for every layout cell, and no orphan widget', () => {
    const referenced = new Set(layoutCells(DOWNLOADS.layout));
    const declared = new Set(Object.keys(DOWNLOADS.widgets));

    expect([...referenced].filter((id) => !declared.has(id))).toEqual([]);
    expect([...declared].filter((id) => !referenced.has(id))).toEqual([]);
  });

  it('reads the audit index in a single request', () => {
    const plan = planDashboard(DOWNLOADS, defaultFilterState(DOWNLOADS));

    expect(plan.errors.size).toBe(0);
    expect(plan.requests).toHaveLength(1);
    expect(plan.requests[0].index).toBe('audit');
  });

  /**
   * The point of the screen, asserted as a property rather than left to the widget titles.
   *
   * `download` is fired by a reader saving a file and by the interface fetching a thumbnail, and
   * the second outnumbers the first by two orders of magnitude on a repository in ordinary use.
   * A widget here that counted the event without naming the reason would be presenting browsing
   * as reading.
   */
  it('never counts a download without naming the reason it was fired for', () => {
    for (const [name, widget] of Object.entries(DOWNLOADS.widgets)) {
      const clauses = JSON.stringify(widget.filter ?? []);

      expect(clauses, name).toContain('"eventId":"download"');
      expect(clauses, name).toContain('extended.downloadReason');
    }
  });

  it('counts distinct documents rather than events, on the tile that says so', () => {
    const aggs = planDashboard(DOWNLOADS, defaultFilterState(DOWNLOADS)).requests[0].body
      .aggs as Record<string, any>;

    expect(aggs['distinctDocuments'].aggs.metric).toEqual({ cardinality: { field: 'docUUID' } });
  });

  it('spans the whole selected period, not only the days somebody downloaded', () => {
    const aggs = planDashboard(DOWNLOADS, defaultFilterState(DOWNLOADS)).requests[0].body
      .aggs as Record<string, any>;

    expect(aggs['perDay'].aggs.inner.date_histogram.extended_bounds).toBeDefined();
  });

  it('never aggregates on the comment field', () => {
    // `comment` is mapped `text` with no keyword sub-field, and it is where the filename sits.
    const aggs = planDashboard(DOWNLOADS, defaultFilterState(DOWNLOADS)).requests[0].body.aggs;
    expect(JSON.stringify(aggs)).not.toContain('comment');
  });

  it('never emits a .keyword suffix', () => {
    const plan = planDashboard(DOWNLOADS, defaultFilterState(DOWNLOADS));
    expect(JSON.stringify(plan.requests)).not.toContain('.keyword');
  });

  it('starts on a bounded period, since the audit index grows faster than the repository', () => {
    expect(defaultFilterState(DOWNLOADS).range.from).not.toBeNull();
  });

  it('fills complete grid lines, for every date range', () => {
    for (const range of ['all', '7d', '30d', '90d', '12m', 'custom']) {
      for (const row of layoutRows(DOWNLOADS.layout)) {
        const spans = row.cells.map((id) => resolveSpan(DOWNLOADS.widgets[id], range) ?? 0);
        expect(spans.reduce((total, span) => total + span, 0) % 12).toBe(0);
      }
    }
  });
});

describe('Downloads dashboard', () => {
  let stub: FetchStub;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideDashboardCharts()],
    });
    TestBed.overrideComponent(WidgetOutletComponent, {
      remove: { imports: [ChartWidgetComponent] },
      add: { imports: [ChartWidgetStubComponent] },
    });
  });

  afterEach(() => stub?.restore());

  async function render() {
    const fixture = TestBed.createComponent(DashboardPageComponent);
    fixture.componentRef.setInput('dashboardId', 'downloads');
    await settle(fixture);
    return fixture;
  }

  it('renders the seven widgets from one audit request', async () => {
    stub = installFetchStub([
      { match: '/site/es/audit/_search', matchBody: isAggregationsRequest, json: auditResponse() },
      ...supportRoutes(),
    ]);

    const text = ((await render()).nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Downloads Dashboard');
    expect(text).toContain('Renditions Served');
    expect(text).toContain('Documents Downloaded');
    expect(text).toContain('Downloads Over Time');
    expect(text).toContain('Downloads by Type');
    expect(text).toContain('Most Active Downloaders');
    expect(text).toContain('Most Downloaded Documents');
    expect(stub.calls.filter((call) => call.url.includes('/site/es/'))).toHaveLength(1);
  });

  /**
   * The two figures shown side by side, and the gap between them left visible.
   *
   * A reader seeing 524 beside 15 learns that the repository is being browsed rather than read.
   * A single "Downloads: 539" would have told them the opposite, which is why this is asserted on
   * the rendered page rather than on the plan.
   */
  it('shows files saved and renditions served as two figures, not one', async () => {
    stub = installFetchStub([
      { match: '/site/es/audit/_search', matchBody: isAggregationsRequest, json: auditResponse() },
      ...supportRoutes(),
    ]);

    const text = ((await render()).nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('15');
    expect(text).toContain('524');
    expect(text).not.toContain('539');
  });

  it('names the documents and the people rather than showing uuids and logins', async () => {
    stub = installFetchStub([
      { match: '/site/es/audit/_search', matchBody: isAggregationsRequest, json: auditResponse() },
      ...supportRoutes(),
    ]);

    const text = ((await render()).nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Q3 report.pdf');
    expect(text).toContain('Jane Doe');
    expect(text).not.toContain(FILE_UUID);
  });

  it('names the missing prerequisite instead of showing an empty page', async () => {
    stub = installFetchStub([
      {
        match: '/api/v1/capabilities',
        json: {
          'entity-type': 'capabilities',
          passthrough: { elasticsearch: true, 'elasticsearch-audit': false },
        },
      },
      { match: '/site/es/audit/_search', matchBody: isAggregationsRequest, json: auditResponse() },
      ...supportRoutes(),
      ...healthyServerRoutes(),
    ]);
    await TestBed.inject(PreflightService).run();

    const fixture = TestBed.createComponent(DashboardPageComponent);
    fixture.componentRef.setInput('dashboardId', 'downloads');
    fixture.componentRef.setInput('requires', 'audit');
    fixture.componentRef.setInput('requirementLabel', 'the OpenSearch audit passthrough');
    await settle(fixture);

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('the OpenSearch audit passthrough');
    expect(text).toContain('Diagnostics');
  });
});
