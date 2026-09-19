import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import tasksConfig from '../config/dashboards/tasks.json';
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
  isHitsRequest,
} from '../../testing/fetch-stub';
import { settle } from '../../testing/settle';

const TASKS = tasksConfig as DashboardConfig;

/** Every widget is scoped to open tasks, so each aggregation sits under a wrapper. */
function wrapped(docCount: number, buckets: unknown[]) {
  return { doc_count: docCount, inner: { buckets }, distinct: { value: buckets.length } };
}

function aggregationsResponse(): unknown {
  return {
    took: 4,
    timed_out: false,
    hits: { total: { value: 10, relation: 'eq' }, hits: [] },
    aggregations: {
      openTasks: { doc_count: 10 },
      overdue: { doc_count: 2 },
      dueThisWeek: { doc_count: 4 },
      assignees: { doc_count: 10, metric: { value: 4 } },
      lateness: {
        doc_count: 10,
        inner: {
          buckets: [
            { key: 'over 30 days late', doc_count: 0 },
            { key: '8 to 30 days late', doc_count: 1 },
            { key: 'up to 7 days late', doc_count: 1 },
            { key: 'due within 7 days', doc_count: 4 },
            { key: 'due later', doc_count: 4 },
          ],
        },
      },
      byAssignee: wrapped(10, [
        { key: 'user:Josh', doc_count: 6 },
        { key: 'group:sales', doc_count: 2 },
      ]),
      overdueByAssignee: wrapped(2, [{ key: 'user:Josh', doc_count: 2 }]),
      byTaskType: wrapped(10, [
        { key: 'wf.serialDocumentReview.chooseParticipants', doc_count: 4 },
      ]),
    },
  };
}

function hitsResponse(): unknown {
  return {
    took: 3,
    timed_out: false,
    hits: {
      total: { value: 2, relation: 'eq' },
      hits: [
        {
          _id: 'a',
          _source: {
            'ecm:uuid': 'a',
            'nt:name': 'wf.serialDocumentReview.chooseParticipants',
            'nt:actors': ['user:Josh', 'group:sales'],
            'nt:dueDate': '2026-09-12T09:56:30.867Z',
            'nt:directive': 'wf.serialDocumentReview.pleaseSelect',
          },
        },
      ],
    },
  };
}

function supportRoutes(): StubRoute[] {
  return [
    { match: 'assets/dashboards/tasks.json', json: tasksConfig },
    {
      match: '/ui/i18n/messages.json',
      json: {
        'wf.serialDocumentReview.chooseParticipants': 'Choose Participants',
        'wf.serialDocumentReview.pleaseSelect': 'Please select some participants for the review.',
      },
    },
    {
      match: '/api/v1/user/Josh',
      json: { id: 'Josh', properties: { firstName: 'Josh', lastName: 'Kramer' } },
    },
    { match: '/api/v1/group/sales', json: { id: 'sales', grouplabel: 'Sales Team' } },
  ];
}

describe('tasks.json', () => {
  it('declares a widget for every layout cell, and no orphan widget', () => {
    const referenced = new Set(TASKS.layout.flatMap((row) => row.cells));
    const declared = new Set(Object.keys(TASKS.widgets));

    expect([...referenced].filter((id) => !declared.has(id))).toEqual([]);
    expect([...declared].filter((id) => !referenced.has(id))).toEqual([]);
  });

  it('reads the repository index, batching every widget but the table', () => {
    const plan = planDashboard(TASKS, defaultFilterState(TASKS));

    expect(plan.errors.size).toBe(0);
    expect(plan.requests).toHaveLength(2);
    expect(plan.requests.map((request) => request.index)).toEqual(['nuxeo', 'nuxeo']);
    expect(plan.requests.filter((request) => request.kind === 'hits')).toHaveLength(1);
  });

  /*
   * A workflow model may declare its own task document type, so the facet is the only reliable
   * way to catch every task. `RoutingTask` alone would silently miss them.
   */
  it('selects tasks by facet rather than by document type', () => {
    expect(TASKS.baseFilter).toEqual([{ term: { 'ecm:mixinType': 'Task' } }]);
    expect(JSON.stringify(TASKS)).not.toContain('RoutingTask');
  });

  /*
   * A nightly job deletes finished workflows and every task they carry, so a count of completed
   * tasks would read ten today and zero tomorrow. The audit keeps that history; the repository
   * does not, and the dashboard must not pretend otherwise.
   */
  it('describes open tasks only, and says why on screen', () => {
    expect(TASKS.defaultScope).toBe('open');
    expect(Object.keys(TASKS.scopes!)).not.toContain('ended');
    expect(TASKS.subtitle).toContain('nightly');
    expect(TASKS.subtitle).toContain('nuxeo.routing.disable.cleanup.workflow.instances');
  });

  /*
   * An overdue task is a present state, not an event with a date. A period filter would hide the
   * oldest ones, which are exactly the ones worth seeing.
   */
  it('carries no period filter, since lateness is a state rather than an event', () => {
    expect((TASKS.filters ?? []).map((filter) => filter.type)).toEqual(['termsGroup']);
    expect(defaultFilterState(TASKS).range.from).toBeNull();
  });

  it('never emits a .keyword suffix', () => {
    const plan = planDashboard(TASKS, defaultFilterState(TASKS));
    expect(JSON.stringify(plan.requests)).not.toContain('.keyword');
  });

  it('fills complete grid lines, for every date range', () => {
    for (const range of ['all', '7d', '30d', '90d', '12m', 'custom']) {
      for (const row of TASKS.layout) {
        const spans = row.cells.map((id) => resolveSpan(TASKS.widgets[id], range) ?? 0);
        expect(spans.reduce((total, span) => total + span, 0) % 12).toBe(0);
      }
    }
  });
});

describe('Tasks dashboard', () => {
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
    stub = installFetchStub([
      {
        match: '/site/es/nuxeo/_search',
        matchBody: isAggregationsRequest,
        json: aggregationsResponse(),
      },
      { match: '/site/es/nuxeo/_search', matchBody: isHitsRequest, json: hitsResponse() },
      ...supportRoutes(),
    ]);
    const fixture = TestBed.createComponent(DashboardPageComponent);
    fixture.componentRef.setInput('dashboardId', 'tasks');
    await settle(fixture);
    return fixture;
  }

  it('renders the tiles, the charts and the overdue table', async () => {
    const text = ((await render()).nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Tasks Dashboard');
    expect(text).toContain('Open Tasks');
    expect(text).toContain('Overdue');
    expect(text).toContain('How Late They Are');
    expect(text).toContain('Overdue Tasks');
  });

  it('warns that finished workflows are swept away, and names the property', async () => {
    const text = ((await render()).nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('nightly job');
    expect(text).toContain('nuxeo.routing.disable.cleanup.workflow.instances');
  });

  it('names the people and the groups behind a prefixed assignee', async () => {
    const text = ((await render()).nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Josh Kramer');
    expect(text).toContain('Sales Team');
    expect(text).not.toContain('user:Josh');
    expect(text).not.toContain('group:sales');
  });

  it('translates the task name and the directive, which are both i18n keys', async () => {
    const text = ((await render()).nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Choose Participants');
    expect(text).toContain('Please select some participants for the review.');
    expect(text).not.toContain('wf.serialDocumentReview.chooseParticipants');
  });

  /*
   * A task may be assigned to several principals at once. Stringifying the whole array would ask
   * the server for `user:Josh,group:sales`, which resolves to nothing and reads as noise.
   */
  it('labels every principal of a multivalued column, not the array as a whole', async () => {
    const fixture = await render();
    const row = (fixture.nativeElement as HTMLElement).querySelector('tbody tr');

    expect(row?.textContent).toContain('Josh Kramer, Sales Team');
    const lookups = stub.calls.map((call) => call.url).filter((url) => url.includes('/api/v1/'));
    expect(lookups.some((url) => url.includes('Josh%2C') || url.includes('Josh,'))).toBe(false);
  });
});
