import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import workflowsConfig from '../config/dashboards/workflows.json';
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

const WORKFLOWS = workflowsConfig as DashboardConfig;

/**
 * The events the `audit_wf` view can actually return.
 *
 * `RoutingAuditRequestFilter` injects `term: { category: "Routing" }` for every caller,
 * administrators included. Five audited workflow events are fired with no explicit category and
 * therefore default to `eventDocumentCategory`: `workflowTaskAssigned`, `workflowTaskReassigned`,
 * `workflowTaskCompleted`, `workflowTaskDelegated` and `auditLogRoute`. They sit in the index and
 * this view will never hand them over, so a widget built on one of them would stay empty forever,
 * with nothing on screen to explain why.
 */
const REACHABLE_EVENTS = [
  'afterWorkflowStarted',
  'afterWorkflowFinish',
  'beforeWorkflowCanceled',
  'workflowCanceled',
  'afterWorkflowTaskCreated',
  'afterWorkflowTaskEnded',
  'afterWorkflowTaskReassigned',
  'afterWorkflowTaskDelegated',
];

/** Event ids a scope accepts, whether it was written as a `term` or as a `terms`. */
function eventsOf(clauses: unknown[]): string[] {
  return clauses.flatMap((clause) => {
    const { term, terms } = clause as {
      term?: Record<string, string>;
      terms?: Record<string, string[]>;
    };
    if (term?.['eventId']) {
      return [term['eventId']];
    }
    return terms?.['eventId'] ?? [];
  });
}

/** Every widget is scoped to an event, so each aggregation sits under a wrapper. */
function wrapped(docCount: number, buckets: unknown[]) {
  return { doc_count: docCount, inner: { buckets }, distinct: { value: buckets.length } };
}

function workflowResponse(): unknown {
  return {
    took: 5,
    timed_out: false,
    hits: { total: { value: 812, relation: 'eq' }, hits: [] },
    aggregations: {
      started: { doc_count: 96 },
      completed: { doc_count: 71 },
      cancelled: { doc_count: 9 },
      // Nothing has completed with a measurable duration, which must read as a dash, not as zero.
      averageDuration: { doc_count: 0, metric: { value: null } },
      tasksCreated: { doc_count: 240 },
      tasksEnded: { doc_count: 205 },
      averageTaskDuration: { doc_count: 205, metric: { value: 7_200_000 } },
      tasksMoved: { doc_count: 12 },
      startedPerDay: {
        doc_count: 96,
        inner: {
          buckets: [
            { key: 1, key_as_string: '2026-09-17', doc_count: 4 },
            { key: 2, key_as_string: '2026-09-18', doc_count: 6 },
          ],
        },
      },
      completedPerDay: {
        doc_count: 71,
        inner: { buckets: [{ key: 1, key_as_string: '2026-09-18', doc_count: 5 }] },
      },
      byModel: wrapped(96, [{ key: 'ParallelDocumentReview', doc_count: 60 }]),
      taskOutcomes: wrapped(205, [{ key: 'approve', doc_count: 150 }]),
      topInitiators: wrapped(96, [{ key: 'kate', doc_count: 40 }]),
      topTaskPerformers: wrapped(205, [{ key: 'kate', doc_count: 88 }]),
      byTaskName: wrapped(240, [
        { key: 'wf.parallelDocumentReview.chooseParticipants.title', doc_count: 90 },
      ]),
      durationDistribution: {
        doc_count: 71,
        inner: {
          buckets: [
            { key: '< 1 hour', doc_count: 20 },
            { key: '1 hour to 1 day', doc_count: 31 },
            { key: '1 to 7 days', doc_count: 15 },
            { key: 'over 7 days', doc_count: 5 },
          ],
        },
      },
    },
  };
}

function supportRoutes(): StubRoute[] {
  return [
    { match: 'assets/dashboards/workflows.json', json: workflowsConfig },
    {
      match: '/ui/i18n/messages.json',
      json: {
        'wf.parallelDocumentReview.ParallelDocumentReview': 'Parallel Document Review',
        'wf.parallelDocumentReview.approve': 'Approve',
        'wf.parallelDocumentReview.chooseParticipants.title': 'Choose Participants',
      },
    },
    {
      match: '/api/v1/user/kate',
      json: { id: 'kate', properties: { firstName: 'Kate', lastName: 'Byrne' } },
    },
  ];
}

describe('workflows.json', () => {
  it('declares a widget for every layout cell, and no orphan widget', () => {
    const referenced = new Set(WORKFLOWS.layout.flatMap((row) => row.cells));
    const declared = new Set(Object.keys(WORKFLOWS.widgets));

    expect([...referenced].filter((id) => !declared.has(id))).toEqual([]);
    expect([...declared].filter((id) => !referenced.has(id))).toEqual([]);
  });

  it('reads the workflow audit view in a single request', () => {
    const plan = planDashboard(WORKFLOWS, defaultFilterState(WORKFLOWS));

    expect(plan.errors.size).toBe(0);
    expect(plan.requests).toHaveLength(1);
    expect(plan.requests[0].index).toBe('audit_wf');
  });

  it('builds every scope out of events this view can actually return', () => {
    const scopes = WORKFLOWS.scopes!;
    const used = Object.values(scopes).flatMap(eventsOf);

    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((event) => !REACHABLE_EVENTS.includes(event))).toEqual([]);
  });

  /*
   * A workflow has no state field, so state is derived from the event id. That derivation is only
   * sound while no event feeds two scopes at once: a reader comparing the started, completed and
   * cancelled tiles would otherwise be counting the same entry twice. These scopes are deliberately
   * not a partition — three of the eight reachable events are counted by none of them — so only
   * exclusivity is asserted here, never exhaustiveness.
   */
  it('declares scopes that no single event can satisfy twice', () => {
    const scopes = Object.entries(WORKFLOWS.scopes!).filter(([, clauses]) => clauses.length);

    for (const event of REACHABLE_EVENTS) {
      const matching = scopes.filter(([, clauses]) => eventsOf(clauses).includes(event));
      expect(matching.length).toBeLessThanOrEqual(1);
    }
  });

  /*
   * `workflowCanceled` is fired once per attached document, so counting it would multiply a single
   * cancellation by the size of its attachment. `beforeWorkflowCanceled` fires once per instance.
   */
  it('counts a cancellation once, not once per attached document', () => {
    expect(eventsOf(WORKFLOWS.scopes!['cancelled'])).toEqual(['beforeWorkflowCanceled']);
  });

  /*
   * `logDate` is stamped when the journal is written, after commit, so a long transaction bunches
   * its entries onto one instant and the daily chart grows spikes that never happened.
   */
  it('reads eventDate, never logDate', () => {
    const body = JSON.stringify(planDashboard(WORKFLOWS, defaultFilterState(WORKFLOWS)).requests);

    expect(body).toContain('eventDate');
    expect(body).not.toContain('logDate');
  });

  /*
   * `extended.actors` is a keyword array on a reassignment but a single `"[bob, alice]"` string on
   * a task creation, a `LinkedHashSet` having fallen through to `toString()`. The top level
   * `comment` is `text` with no keyword sub-field, so any aggregation on it fails outright.
   */
  it('aggregates on neither extended.actors nor the comment field', () => {
    const aggs = JSON.stringify(
      planDashboard(WORKFLOWS, defaultFilterState(WORKFLOWS)).requests[0].body.aggs,
    );

    expect(aggs).not.toContain('actors');
    expect(aggs).not.toContain('comment');
  });

  /*
   * `extended.taskName` holds an i18n key, so it is translated. `extended.action` does not: the
   * audit records the button's `name` (`approve`, `reject`), while the key sits in the button's
   * `label`, which never leaves the model. Declaring a strategy there would promise a translation
   * that can never happen, and hide the fact that the raw identifier is what the reader sees.
   */
  it('translates the task name, and leaves the raw button identifier alone', () => {
    const widgets = WORKFLOWS.widgets as Record<string, { labels?: string }>;

    expect(widgets['byTaskName'].labels).toBe('message');
    expect(widgets['byModel'].labels).toBe('workflowModel');
    expect(widgets['taskOutcomes'].labels).toBeUndefined();
  });

  it('never emits a .keyword suffix', () => {
    const plan = planDashboard(WORKFLOWS, defaultFilterState(WORKFLOWS));
    expect(JSON.stringify(plan.requests)).not.toContain('.keyword');
  });

  it('spans the whole selected period, not only the days a workflow ran', () => {
    const aggs = planDashboard(WORKFLOWS, defaultFilterState(WORKFLOWS)).requests[0].body
      .aggs as Record<string, any>;

    expect(aggs['startedPerDay'].aggs.inner.date_histogram.extended_bounds).toBeDefined();
    expect(aggs['completedPerDay'].aggs.inner.date_histogram.extended_bounds).toBeDefined();
  });

  it('measures durations in milliseconds, as the audit records them', () => {
    const aggs = planDashboard(WORKFLOWS, defaultFilterState(WORKFLOWS)).requests[0].body
      .aggs as Record<string, any>;

    expect(aggs['averageDuration'].aggs.metric).toEqual({
      avg: { field: 'extended.timeSinceWfStarted' },
    });
    // One hour, one day and one week, spelled in the unit the field is stored in.
    const ranges = aggs['durationDistribution'].aggs.inner.range.ranges as { to?: number }[];
    expect(ranges[0].to).toBe(3_600_000);
  });

  it('starts on a bounded period, since the audit index grows faster than the repository', () => {
    expect(defaultFilterState(WORKFLOWS).range.from).not.toBeNull();
  });

  it('fills complete grid lines, for every date range', () => {
    for (const range of ['all', '7d', '30d', '90d', '12m', 'custom']) {
      for (const row of WORKFLOWS.layout) {
        const spans = row.cells.map((id) => resolveSpan(WORKFLOWS.widgets[id], range) ?? 0);
        expect(spans.reduce((total, span) => total + span, 0) % 12).toBe(0);
      }
    }
  });
});

describe('Workflows dashboard', () => {
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
        match: '/site/es/audit_wf/_search',
        matchBody: isAggregationsRequest,
        json: workflowResponse(),
      },
      ...supportRoutes(),
    ]);
    const fixture = TestBed.createComponent(DashboardPageComponent);
    fixture.componentRef.setInput('dashboardId', 'workflows');
    await settle(fixture);
    return fixture;
  }

  it('renders every widget from one request', async () => {
    const text = ((await render()).nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Workflows Dashboard');
    expect(text).toContain('Workflows Started');
    expect(text).toContain('Tasks Created');
    expect(text).toContain('Task Outcomes');
    expect(text).toContain('Workflow Duration');
    expect(stub.calls.filter((call) => call.url.includes('/site/es/'))).toHaveLength(1);
  });

  /*
   * An average over nothing is not zero, it is unmeasured. Rendering it as `0 s` would be
   * indistinguishable from a workflow that really did complete instantly, which is exactly what a
   * server where nothing has ever finished would show.
   */
  it('shows a dash rather than a zero when no workflow has completed', async () => {
    const text = ((await render()).nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Average Duration');
    expect(text).not.toContain('0 s');
    expect(text).toContain('2.0 h');
  });

  it('translates the i18n keys the audit stores for models and tasks', async () => {
    const text = ((await render()).nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Choose Participants');
    expect(text).not.toContain('wf.parallelDocumentReview.chooseParticipants.title');
  });

  it('resolves the users behind the initiator and assignee lists', async () => {
    const text = ((await render()).nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Kate Byrne');
  });

  it('names the missing prerequisite instead of showing an empty page', async () => {
    // Listed first, so it beats the generic `/site/es/` route a healthy server declares.
    stub = installFetchStub([
      { match: '/site/es/audit_wf/_search', status: 400, json: {} },
      ...supportRoutes(),
      ...healthyServerRoutes(),
    ]);
    await TestBed.inject(PreflightService).run();

    const fixture = TestBed.createComponent(DashboardPageComponent);
    fixture.componentRef.setInput('dashboardId', 'workflows');
    fixture.componentRef.setInput('requires', 'workflow');
    fixture.componentRef.setInput('requirementLabel', 'the workflow audit passthrough');
    await settle(fixture);

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('the workflow audit passthrough');
    expect(text).toContain('Diagnostics');
  });
});
