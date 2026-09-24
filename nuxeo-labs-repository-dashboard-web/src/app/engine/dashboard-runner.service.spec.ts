import { TestBed } from '@angular/core/testing';
import { DashboardConfig, FilterState } from '../config/dashboard-config.model';
import { DashboardRunner } from './dashboard-runner.service';
import { FetchStub, installFetchStub } from '../../testing/fetch-stub';

const CONFIG: DashboardConfig = {
  id: 'content',
  label: 'Content',
  index: 'nuxeo',
  filters: [{ type: 'dateRange', field: 'dc:created' }],
  layout: [{ cells: ['records'] }],
  widgets: {
    records: { type: 'kpi', label: 'Records', filter: [{ term: { 'ecm:isRecord': true } }] },
  },
};

const ALL_TIME: FilterState = {
  range: { id: 'all', label: 'All time', from: null, to: null },
  groups: {},
  picks: [],
  path: null,
};
const LAST_7_DAYS: FilterState = {
  ...ALL_TIME,
  range: { id: '7d', label: 'Last 7 days', from: '2026-09-18', to: '2026-09-24' },
};

/** True for the request of the run bounded by a period, false for the one over All time. */
function bounded(expected: boolean) {
  return (body: unknown) => JSON.stringify(body).includes('"range"') === expected;
}

function answer(records: number): unknown {
  return {
    took: 1,
    timed_out: false,
    hits: { total: { value: records, relation: 'eq' }, hits: [] },
    aggregations: { records: { doc_count: records } },
  };
}

function held(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}

/*
 * Nothing awaits one run before starting the next, and the page is reused from one dashboard to the
 * next. Two runs in flight is the ordinary case of a reader who changes their mind, and the one
 * that answers last is not necessarily the one they asked for last.
 */
describe('DashboardRunner, with two runs in flight', () => {
  let stub: FetchStub;
  let runner: DashboardRunner;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [DashboardRunner] });
    runner = TestBed.inject(DashboardRunner);
  });

  afterEach(() => stub?.restore());

  function records(): number | undefined {
    const data = runner.data().get('records');
    return data?.kind === 'scalar' ? data.value : undefined;
  }

  it('keeps the latest run when an earlier one answers last', async () => {
    const allTime = held();
    stub = installFetchStub([
      {
        match: '/site/es/nuxeo/_search',
        matchBody: bounded(false),
        wait: allTime.promise,
        json: answer(5941),
      },
      { match: '/site/es/nuxeo/_search', matchBody: bounded(true), json: answer(12) },
    ]);

    const first = runner.run(CONFIG, ALL_TIME);
    const second = runner.run(CONFIG, LAST_7_DAYS);
    await second;
    allTime.release();
    await first;

    expect(records()).toBe(12);
    expect(runner.loading()).toBe(false);
  });

  it('stays loading until the latest run has answered, whichever finished first', async () => {
    const lastWeek = held();
    stub = installFetchStub([
      { match: '/site/es/nuxeo/_search', matchBody: bounded(false), json: answer(5941) },
      {
        match: '/site/es/nuxeo/_search',
        matchBody: bounded(true),
        wait: lastWeek.promise,
        json: answer(12),
      },
    ]);

    const first = runner.run(CONFIG, ALL_TIME);
    const second = runner.run(CONFIG, LAST_7_DAYS);
    await first;

    // The figures asked for have not arrived, and the ones that did were not asked for any more.
    expect(runner.loading()).toBe(true);
    expect(records()).toBeUndefined();

    lastWeek.release();
    await second;
    expect(records()).toBe(12);
    expect(runner.loading()).toBe(false);
  });

  it('drops the failure of a run already superseded', async () => {
    const allTime = held();
    stub = installFetchStub([
      {
        match: '/site/es/nuxeo/_search',
        matchBody: bounded(false),
        wait: allTime.promise,
        status: 500,
        json: { message: 'Read timed out' },
      },
      { match: '/site/es/nuxeo/_search', matchBody: bounded(true), json: answer(12) },
    ]);

    const first = runner.run(CONFIG, ALL_TIME);
    const second = runner.run(CONFIG, LAST_7_DAYS);
    await second;
    allTime.release();
    await first;

    expect(runner.error()).toBeNull();
    expect(records()).toBe(12);
  });
});
