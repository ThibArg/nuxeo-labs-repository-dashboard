import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import usersConfig from '../config/dashboards/users.json';
import { DashboardConfig, defaultFilterState, resolveSpan } from '../config/dashboard-config.model';
import { planDashboard } from '../engine/query-planner';
import { PreflightService } from '../core/preflight.service';
import { DashboardPageComponent } from './dashboard-page.component';
import { provideDashboardCharts } from '../widgets/echarts.setup';
import { ChartWidgetComponent } from '../widgets/chart-widget.component';
import { WidgetOutletComponent } from '../widgets/widget-outlet.component';
import { ChartWidgetStubComponent } from '../../testing/chart-widget.stub';
import {
  FetchStub,
  StubRoute,
  healthyServerRoutes,
  installFetchStub,
  isAggregationsRequest,
} from '../../testing/fetch-stub';
import { settle } from '../../testing/settle';

const USERS = usersConfig as DashboardConfig;

/** Every widget carries its own event filter, so each aggregation sits under a wrapper. */
function wrapped(docCount: number, buckets: unknown[]) {
  return { doc_count: docCount, inner: { buckets } };
}

function auditResponse(): unknown {
  return {
    took: 7,
    timed_out: false,
    hits: { total: { value: 1509, relation: 'eq' }, hits: [] },
    aggregations: {
      uniqueLoginsPerDay: wrapped(800, [
        { key: 1, key_as_string: '2026-09-17', doc_count: 40, metric: { value: 12 } },
        { key: 2, key_as_string: '2026-09-18', doc_count: 55, metric: { value: 17 } },
      ]),
      topUsers: wrapped(800, [{ key: 'jdoe', doc_count: 120 }]),
      loginFailures: wrapped(9, [{ key: 'r00t', doc_count: 7 }]),
      creationsByUser: wrapped(300, [{ key: 'jdoe', doc_count: 55 }]),
      modificationsByUser: wrapped(400, [{ key: 'jdoe', doc_count: 77 }]),
    },
  };
}

function supportRoutes(): StubRoute[] {
  return [
    { match: 'assets/dashboards/users.json', json: usersConfig },
    { match: '/ui/i18n/messages.json', json: {} },
    {
      match: '/api/v1/user/jdoe',
      json: { id: 'jdoe', properties: { firstName: 'Jane', lastName: 'Doe' } },
    },
  ];
}

describe('users.json', () => {
  it('declares a widget for every layout cell, and no orphan widget', () => {
    const referenced = new Set(USERS.layout.flatMap((row) => row.cells));
    const declared = new Set(Object.keys(USERS.widgets));

    expect([...referenced].filter((id) => !declared.has(id))).toEqual([]);
    expect([...declared].filter((id) => !referenced.has(id))).toEqual([]);
  });

  it('reads the audit index in a single request', () => {
    const plan = planDashboard(USERS, defaultFilterState(USERS));

    expect(plan.errors.size).toBe(0);
    expect(plan.requests).toHaveLength(1);
    expect(plan.requests[0].index).toBe('audit');
  });

  it('names the event each widget counts', () => {
    const events = Object.values(USERS.widgets).map(
      (widget) => (widget.filter?.[0] as { term: Record<string, string> })?.term?.['eventId'],
    );

    expect(events).toEqual([
      'loginSuccess',
      'loginSuccess',
      'loginFailed',
      'documentCreated',
      'documentModified',
    ]);
  });

  it('never aggregates on the comment field', () => {
    // `comment` is mapped `text` with no keyword sub-field: any aggregation on it fails outright.
    const aggs = planDashboard(USERS, defaultFilterState(USERS)).requests[0].body.aggs;
    expect(JSON.stringify(aggs)).not.toContain('comment');
  });

  it('never emits a .keyword suffix', () => {
    const plan = planDashboard(USERS, defaultFilterState(USERS));
    expect(JSON.stringify(plan.requests)).not.toContain('.keyword');
  });

  it('spans the whole selected period, not only the days with a login', () => {
    const aggs = planDashboard(USERS, defaultFilterState(USERS)).requests[0].body.aggs as Record<
      string,
      any
    >;

    expect(aggs['uniqueLoginsPerDay'].aggs.inner.date_histogram.extended_bounds).toBeDefined();
  });

  it('counts distinct users rather than logins, on the daily chart', () => {
    const aggs = planDashboard(USERS, defaultFilterState(USERS)).requests[0].body.aggs as Record<
      string,
      any
    >;

    expect(aggs['uniqueLoginsPerDay'].aggs.inner.aggs.metric).toEqual({
      cardinality: { field: 'principalName' },
    });
  });

  it('starts on a bounded period, since the audit index grows faster than the repository', () => {
    expect(defaultFilterState(USERS).range.from).not.toBeNull();
  });

  it('fills complete grid lines, for every date range', () => {
    for (const range of ['all', '7d', '30d', '90d', '12m', 'custom']) {
      for (const row of USERS.layout) {
        const spans = row.cells.map((id) => resolveSpan(USERS.widgets[id], range) ?? 0);
        expect(spans.reduce((total, span) => total + span, 0) % 12).toBe(0);
      }
    }
  });
});

describe('Users dashboard', () => {
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
    fixture.componentRef.setInput('dashboardId', 'users');
    await settle(fixture);
    return fixture;
  }

  it('renders the five widgets from one audit request', async () => {
    stub = installFetchStub([
      { match: '/site/es/audit/_search', matchBody: isAggregationsRequest, json: auditResponse() },
      ...supportRoutes(),
    ]);

    const text = ((await render()).nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Users Dashboard');
    expect(text).toContain('Most Active Users');
    expect(text).toContain('Failed Logins');
    expect(text).toContain('Documents Created by User');
    expect(text).toContain('Documents Modified by User');
    expect(stub.calls.filter((call) => call.url.includes('/site/es/'))).toHaveLength(1);
  });

  it('shows the typed login as it stands, and resolves the name of a real user', async () => {
    stub = installFetchStub([
      { match: '/site/es/audit/_search', matchBody: isAggregationsRequest, json: auditResponse() },
      ...supportRoutes(),
    ]);

    const text = ((await render()).nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Jane Doe');
    // A failed login is evidence: prettifying it would hide what was actually attempted.
    expect(text).toContain('r00t');
    expect(text).not.toContain('Jane Doe (r00t)');

    const lookups = stub.calls.filter((call) => call.url.includes('/api/v1/user/'));
    expect(lookups.map((call) => call.url.split('/user/')[1])).toEqual(['jdoe']);
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
    fixture.componentRef.setInput('dashboardId', 'users');
    fixture.componentRef.setInput('requires', 'audit');
    fixture.componentRef.setInput('requirementLabel', 'the OpenSearch audit passthrough');
    await settle(fixture);

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('the OpenSearch audit passthrough');
    expect(text).toContain('Diagnostics');
  });
});
