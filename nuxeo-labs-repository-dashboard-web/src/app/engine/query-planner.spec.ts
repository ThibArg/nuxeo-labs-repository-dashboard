import { DashboardConfig, FilterState } from '../config/dashboard-config.model';
import { INNER_AGG, METRIC_AGG } from './agg-compiler';
import { SECONDARY_AGG, planDashboard } from './query-planner';

const NO_GROUPS = { kind: { types: { mode: 'all' as const }, facets: { mode: 'all' as const } } };

const RANGE_ALL: FilterState = {
  range: { id: 'all', label: 'All time', from: null, to: null },
  groups: NO_GROUPS,
  picks: [],
  path: null,
};
const RANGE_30D: FilterState = {
  range: { id: '30d', label: 'Last 30 days', from: '2026-08-20', to: '2026-09-18' },
  groups: NO_GROUPS,
  picks: [],
  path: null,
};

function config(overrides: Partial<DashboardConfig> = {}): DashboardConfig {
  return {
    id: 'test',
    label: 'Test',
    index: 'nuxeo',
    filters: [
      { type: 'dateRange', field: 'dc:created' },
      {
        type: 'termsGroup',
        id: 'kind',
        label: 'Document kinds',
        members: [
          { id: 'types', field: 'ecm:primaryType', label: 'Document types' },
          { id: 'facets', field: 'ecm:mixinType', label: 'Facets' },
        ],
      },
    ],
    baseFilter: [{ term: { 'ecm:isVersion': false } }],
    scopes: {
      all: [],
      live: [{ term: { 'ecm:isProxy': false } }],
      versions: [{ term: { 'ecm:isVersion': true } }],
    },
    layout: [{ cells: ['total', 'records', 'byType', 'trend'] }],
    widgets: {
      total: { type: 'kpi', label: 'Total' },
      records: { type: 'kpi', label: 'Records', filter: [{ term: { 'ecm:isRecord': true } }] },
      byType: { type: 'donut', label: 'By type', agg: { terms: { field: 'ecm:primaryType' } } },
      trend: {
        type: 'area',
        label: 'Trend',
        agg: { date_histogram: { field: 'dc:created', calendar_interval: 'day' } },
      },
    },
    ...overrides,
  };
}

describe('planDashboard', () => {
  it('folds every aggregation widget into a single request', () => {
    const plan = planDashboard(config(), RANGE_ALL);

    expect(plan.requests).toHaveLength(1);
    expect(plan.requests[0].kind).toBe('aggregations');
    expect(plan.requests[0].body.size).toBe(0);
    // `total` needs no aggregation at all: it reads hits.total.
    expect(Object.keys(plan.requests[0].body.aggs ?? {}).sort()).toEqual([
      'byType',
      'records',
      'trend',
    ]);
    expect(plan.widgets.get('total')?.read).toBe('total');
  });

  it('wraps a widget carrying its own predicate into a filter aggregation', () => {
    const aggs = planDashboard(config(), RANGE_ALL).requests[0].body.aggs as Record<string, any>;

    expect(aggs['records']).toEqual({
      filter: { bool: { filter: [{ term: { 'ecm:isRecord': true } }] } },
    });
    // A chart with a predicate nests its aggregation, a KPI does not.
    expect(aggs['byType']).toEqual({ terms: { field: 'ecm:primaryType' } });
  });

  it('nests a filtered chart under the inner key', () => {
    const filtered = config({
      layout: [{ cells: ['byType'] }],
      widgets: {
        byType: {
          type: 'donut',
          label: 'By type',
          filter: [{ term: { 'ecm:isRecord': true } }],
          agg: { terms: { field: 'ecm:primaryType' } },
        },
      },
    });

    const aggs = planDashboard(filtered, RANGE_ALL).requests[0].body.aggs as Record<string, any>;

    expect(aggs['byType'].filter).toBeDefined();
    expect(aggs['byType'].aggs[INNER_AGG]).toEqual({ terms: { field: 'ecm:primaryType' } });
    expect(planDashboard(filtered, RANGE_ALL).widgets.get('byType')?.wrapped).toBe(true);
  });

  it('puts the global date range in the query, never in the aggregations', () => {
    const plan = planDashboard(config(), RANGE_30D);
    const body = plan.requests[0].body;

    expect(body.query).toEqual({
      bool: {
        filter: [
          { term: { 'ecm:isVersion': false } },
          { range: { 'dc:created': { gte: expect.any(String), lt: expect.any(String) } } },
        ],
      },
    });
    // The trend aggregates on the same field, so the absence of a bound is what must be asserted.
    expect(JSON.stringify(body.aggs)).not.toContain('"gte"');
  });

  it('omits the date clause when the range is unbounded', () => {
    const body = planDashboard(config(), RANGE_ALL).requests[0].body;
    expect(JSON.stringify(body.query)).not.toContain('dc:created');
  });

  describe('daily charts span the selected period', () => {
    function histogram(filters: FilterState, dashboard = config()) {
      const aggs = planDashboard(dashboard, filters).requests[0].body.aggs as Record<string, any>;
      return aggs['trend'].date_histogram;
    }

    it('pads the chart so a quiet start of period does not shorten it', () => {
      // Without bounds a histogram only spans the days that hold a document.
      expect(histogram(RANGE_30D).extended_bounds).toEqual({
        min: new Date('2026-08-20T00:00:00').getTime(),
        max: new Date('2026-09-18T00:00:00').getTime(),
      });
    });

    /*
     * OpenSearch parses a string bound with the aggregation's own `format`. Every chart here
     * declares `yyyy-MM-dd` to get readable bucket keys, so an ISO instant is rejected with a 400:
     * "unparsed text found at index 10". Epoch milliseconds escape the format entirely.
     */
    it('states the bounds as numbers, which the aggregation format cannot misread', () => {
      const { extended_bounds } = histogram(RANGE_30D);

      expect(typeof extended_bounds.min).toBe('number');
      expect(typeof extended_bounds.max).toBe('number');
    });

    it('stops at the last selected day rather than inventing one beyond it', () => {
      const body = planDashboard(config(), RANGE_30D).requests[0].body;
      const aggs = body.aggs as Record<string, any>;
      const queryEnd = (body.query as any).bool.filter.find((clause: any) => clause.range).range[
        'dc:created'
      ].lt;

      // The query ends at the start of the day after the last one; a bucket there would be a day
      // nobody asked about.
      expect(aggs['trend'].date_histogram.extended_bounds.max).toBeLessThan(
        new Date(queryEnd).getTime(),
      );
    });

    it('leaves a histogram on another field alone', () => {
      const onModified = config({
        layout: [{ cells: ['trend'] }],
        widgets: {
          trend: {
            type: 'area',
            label: 'Trend',
            agg: { date_histogram: { field: 'dc:modified', calendar_interval: 'day' } },
          },
        },
      });

      // A document created in the period may well have been modified outside it.
      expect(histogram(RANGE_30D, onModified).extended_bounds).toBeUndefined();
    });

    it('pads nothing when the period is unbounded', () => {
      expect(histogram(RANGE_ALL).extended_bounds).toBeUndefined();
    });

    it('pads only the known side when a single bound is typed', () => {
      const openEnded: FilterState = {
        ...RANGE_ALL,
        range: { id: 'custom', label: '', from: '2026-08-20', to: null },
      };

      expect(histogram(openEnded).extended_bounds).toEqual({
        min: new Date('2026-08-20T00:00:00').getTime(),
      });
    });
  });

  /*
   * An audit purged in March holds nothing earlier, so a chart padded back to the start of the
   * period would draw those months as months nothing happened.
   */
  describe('charts over an audit that starts after the period does', () => {
    const LOGINS = [{ term: { eventId: 'loginSuccess' } }];

    function audit(): DashboardConfig {
      return {
        id: 'logins',
        label: 'Logins',
        index: 'audit',
        filters: [{ type: 'dateRange', field: 'eventDate' }],
        layout: [{ cells: ['logins', 'perDay'] }],
        widgets: {
          logins: { type: 'kpi', label: 'Logins', filter: LOGINS },
          perDay: {
            type: 'bar',
            label: 'Per day',
            filter: LOGINS,
            agg: { date_histogram: { field: 'eventDate', calendar_interval: 'auto' } },
          },
        },
      };
    }

    const LAST_12_MONTHS: FilterState = {
      ...RANGE_ALL,
      range: { id: '12m', label: 'Last 12 months', from: '2025-09-18', to: '2026-09-18' },
    };

    function histogram(filters: FilterState, horizons = {}, dashboard = audit()) {
      const plan = planDashboard(dashboard, filters, horizons);
      const aggs = plan.requests[0].body.aggs as Record<string, any>;
      return aggs['perDay'].aggs[INNER_AGG].date_histogram;
    }

    it('starts the padding on the first day the audit holds', () => {
      expect(histogram(RANGE_30D, { audit: '2026-09-01' }).extended_bounds).toEqual({
        min: new Date('2026-09-01T00:00:00').getTime(),
        max: new Date('2026-09-18T00:00:00').getTime(),
      });
    });

    it('pads to the period as before when the audit holds all of it', () => {
      expect(histogram(RANGE_30D, { audit: '2026-08-20' }).extended_bounds.min).toBe(
        new Date('2026-08-20T00:00:00').getTime(),
      );
    });

    /*
     * The query still bounds the data by the period, so that is what the width must fit. An entry
     * older than the horizon, restored after it was measured, would otherwise stretch a daily
     * chart chosen for three weeks across the whole year.
     */
    it('draws the bars as wide as the period asks, not as the audit holds', () => {
      const horizons = { audit: '2026-09-01' };

      expect(histogram(LAST_12_MONTHS, horizons).calendar_interval).toBe('week');
      expect(planDashboard(audit(), LAST_12_MONTHS, horizons).widgets.get('perDay')?.interval).toBe(
        'week',
      );
    });

    it('pads nothing over a period the audit holds none of', () => {
      // OpenSearch refuses a lower bound above the upper one.
      expect(histogram(RANGE_30D, { audit: '2026-10-01' }).extended_bounds).toBeUndefined();
    });

    it('adds no clause, so no figure changes', () => {
      const without = planDashboard(audit(), LAST_12_MONTHS).requests[0].body;
      const withHorizon = planDashboard(audit(), LAST_12_MONTHS, { audit: '2026-09-01' })
        .requests[0].body;

      expect(withHorizon.query).toEqual(without.query);
    });

    it('leaves the repository half of a mixed page padded to the period', () => {
      const mixed: DashboardConfig = {
        ...audit(),
        index: 'nuxeo',
        filters: [{ type: 'dateRange', field: 'dc:created', byIndex: { audit: 'eventDate' } }],
        layout: [{ cells: ['created', 'perDay'] }],
        widgets: {
          created: {
            type: 'area',
            label: 'Created',
            agg: { date_histogram: { field: 'dc:created', calendar_interval: 'day' } },
          },
          perDay: { ...audit().widgets['perDay'], index: 'audit' },
        },
      };
      const [repository] = planDashboard(mixed, RANGE_30D, { audit: '2026-09-01' }).requests;

      expect(repository.index).toBe('nuxeo');
      expect((repository.body.aggs as any)['created'].date_histogram.extended_bounds.min).toBe(
        new Date('2026-08-20T00:00:00').getTime(),
      );
    });
  });

  it('gives each table its own request, since tables need hits', () => {
    const withTable = config({
      layout: [{ cells: ['total', 'expired'] }],
      widgets: {
        total: { type: 'kpi', label: 'Total' },
        expired: {
          type: 'table',
          label: 'Expired',
          size: 5,
          filter: [{ range: { 'dc:expired': { lt: 'now' } } }],
          sort: [{ field: 'dc:expired', order: 'asc' }],
          columns: [
            { field: 'dc:title', label: 'Title' },
            { field: 'dc:expired', label: 'Expiry' },
          ],
        },
      },
    });

    const plan = planDashboard(withTable, RANGE_ALL);
    expect(plan.requests).toHaveLength(2);

    const table = plan.requests.find((request) => request.kind === 'hits')!;
    expect(table.body.size).toBe(5);
    expect(table.body.sort).toEqual([{ 'dc:expired': { order: 'asc' } }]);
    // ecm:uuid is always fetched so rows can link back to Web UI.
    expect(table.body._source).toContain('ecm:uuid');
    expect(table.body.query).toEqual({
      bool: {
        filter: [{ term: { 'ecm:isVersion': false } }, { range: { 'dc:expired': { lt: 'now' } } }],
      },
    });
  });

  it('records a per widget error instead of failing the whole dashboard', () => {
    const broken = config({
      layout: [{ cells: ['total', 'bad'] }],
      widgets: {
        total: { type: 'kpi', label: 'Total' },
        bad: { type: 'bar', label: 'Bad', agg: { terms: { field: 'dc:creator.keyword' } } },
      },
    });

    const plan = planDashboard(broken, RANGE_ALL);

    expect(plan.errors.get('bad')).toMatch(/keyword/);
    expect(plan.widgets.has('total')).toBe(true);
    expect(plan.requests).toHaveLength(1);
  });

  it('ignores layout cells referencing an unknown widget', () => {
    const plan = planDashboard(config({ layout: [{ cells: ['total', 'ghost'] }] }), RANGE_ALL);
    expect(plan.widgets.has('ghost')).toBe(false);
    expect(plan.widgets.has('total')).toBe(true);
  });

  it('declares a nested metric alongside its aggregation', () => {
    const withMetric = config({
      layout: [{ cells: ['storage'] }],
      widgets: {
        storage: {
          type: 'ranked-list',
          label: 'Storage',
          metric: { sum: 'file:content.length' },
          agg: { terms: { field: 'ecm:primaryType' } },
        },
      },
    });

    const plan = planDashboard(withMetric, RANGE_ALL);
    const aggs = plan.requests[0].body.aggs as Record<string, any>;

    expect(aggs['storage'].aggs[METRIC_AGG]).toEqual({ sum: { field: 'file:content.length' } });
    expect(plan.widgets.get('storage')?.hasMetric).toBe(true);
  });

  describe('scopes', () => {
    it('applies no scope when the dashboard declares no default', () => {
      const aggs = planDashboard(config(), RANGE_ALL).requests[0].body.aggs as Record<string, any>;
      expect(aggs['byType']).toEqual({ terms: { field: 'ecm:primaryType' } });
    });

    it('applies the default scope to widgets that do not declare one', () => {
      const scoped = config({ defaultScope: 'live' });
      const aggs = planDashboard(scoped, RANGE_ALL).requests[0].body.aggs as Record<string, any>;

      expect(aggs['byType'].filter).toEqual({
        bool: { filter: [{ term: { 'ecm:isProxy': false } }] },
      });
      expect(aggs['byType'].aggs[INNER_AGG]).toEqual({ terms: { field: 'ecm:primaryType' } });
    });

    it('lets a widget override the default scope', () => {
      const scoped = config({
        defaultScope: 'live',
        layout: [{ cells: ['versionsTile'] }],
        widgets: { versionsTile: { type: 'kpi', label: 'Versions', scope: 'versions' } },
      });

      const aggs = planDashboard(scoped, RANGE_ALL).requests[0].body.aggs as Record<string, any>;
      expect(aggs['versionsTile']).toEqual({
        filter: { bool: { filter: [{ term: { 'ecm:isVersion': true } }] } },
      });
    });

    it('still reads hits.total for an unscoped tile with no metric', () => {
      const scoped = config({
        defaultScope: 'live',
        layout: [{ cells: ['totalAll'] }],
        widgets: { totalAll: { type: 'kpi', label: 'Total', scope: 'all' } },
      });

      const plan = planDashboard(scoped, RANGE_ALL);
      expect(plan.widgets.get('totalAll')?.read).toBe('total');
      expect(plan.requests[0].body.aggs).toBeUndefined();
    });

    it('puts the scope before the widget predicate', () => {
      const scoped = config({
        defaultScope: 'live',
        layout: [{ cells: ['records'] }],
        widgets: {
          records: { type: 'kpi', label: 'Records', filter: [{ term: { 'ecm:isRecord': true } }] },
        },
      });

      const aggs = planDashboard(scoped, RANGE_ALL).requests[0].body.aggs as Record<string, any>;
      expect(aggs['records'].filter.bool.filter).toEqual([
        { term: { 'ecm:isProxy': false } },
        { term: { 'ecm:isRecord': true } },
      ]);
    });

    it('applies the scope to table requests too', () => {
      const scoped = config({
        defaultScope: 'live',
        layout: [{ cells: ['rows'] }],
        widgets: {
          rows: { type: 'table', label: 'Rows', columns: [{ field: 'dc:title', label: 'Title' }] },
        },
      });

      const table = planDashboard(scoped, RANGE_ALL).requests.find((r) => r.kind === 'hits')!;
      expect(JSON.stringify(table.body.query)).toContain('"ecm:isProxy":false');
    });

    it('reports an unknown scope as a widget error rather than ignoring it', () => {
      const broken = config({
        layout: [{ cells: ['total', 'ghost'] }],
        widgets: {
          total: { type: 'kpi', label: 'Total' },
          ghost: { type: 'kpi', label: 'Ghost', scope: 'nope' },
        },
      });

      const plan = planDashboard(broken, RANGE_ALL);
      expect(plan.errors.get('ghost')).toMatch(/Unknown scope "nope"/);
      expect(plan.widgets.has('total')).toBe(true);
    });
  });

  describe('secondary figures', () => {
    const withSecondary = () =>
      config({
        defaultScope: 'live',
        layout: [{ cells: ['proxies'] }],
        widgets: {
          proxies: {
            type: 'kpi',
            label: 'Proxies',
            scope: 'all',
            secondary: {
              filter: [{ term: { 'ecm:isTrashed': true } }],
              label: '{value} targeting trashed',
            },
          },
        },
      });

    it('forces a wrapper even for an unscoped tile, so the secondary has somewhere to hang', () => {
      const plan = planDashboard(withSecondary(), RANGE_ALL);
      const aggs = plan.requests[0].body.aggs as Record<string, any>;

      expect(plan.widgets.get('proxies')?.read).toBe('aggregation');
      expect(plan.widgets.get('proxies')?.hasSecondary).toBe(true);
      expect(aggs['proxies'].filter).toEqual({ match_all: {} });
      expect(aggs['proxies'].aggs[SECONDARY_AGG]).toEqual({
        filter: { bool: { filter: [{ term: { 'ecm:isTrashed': true } }] } },
      });
    });

    it('nests the secondary inside the scope, not beside it', () => {
      const scoped = config({
        layout: [{ cells: ['versions'] }],
        widgets: {
          versions: {
            type: 'kpi',
            label: 'Versions',
            scope: 'versions',
            secondary: { filter: [{ term: { 'ecm:isTrashed': true } }], label: '{value} trashed' },
          },
        },
      });

      const aggs = planDashboard(scoped, RANGE_ALL).requests[0].body.aggs as Record<string, any>;
      expect(aggs['versions'].filter.bool.filter).toEqual([{ term: { 'ecm:isVersion': true } }]);
      expect(aggs['versions'].aggs[SECONDARY_AGG]).toBeDefined();
    });

    it('leaves hasSecondary false when none is declared', () => {
      expect(planDashboard(config(), RANGE_ALL).widgets.get('records')?.hasSecondary).toBe(false);
    });
  });

  describe('filter groups', () => {
    const withTable = () =>
      config({
        layout: [{ cells: ['total', 'expired'] }],
        widgets: {
          total: { type: 'kpi', label: 'Total' },
          expired: {
            type: 'table',
            label: 'Expired',
            columns: [{ field: 'dc:title', label: 'Title' }],
          },
        },
      });

    it('emits no clause while every member is unconstrained', () => {
      const body = planDashboard(config(), RANGE_ALL).requests[0].body;
      expect(JSON.stringify(body.query)).not.toContain('ecm:primaryType');
    });

    it('adds the group clause to the query, never to the aggregations', () => {
      const filters: FilterState = {
        ...RANGE_ALL,
        groups: { kind: { types: { mode: 'subset', values: ['File'] }, facets: { mode: 'all' } } },
        picks: [],
        path: null,
      };

      const body = planDashboard(config(), filters).requests[0].body;

      expect(body.query).toEqual({
        bool: {
          filter: [
            { term: { 'ecm:isVersion': false } },
            { terms: { 'ecm:primaryType': ['File'] } },
          ],
        },
      });
      expect(JSON.stringify(body.aggs)).not.toContain("['File']");
    });

    it('applies the group to table requests as well', () => {
      const filters: FilterState = {
        ...RANGE_ALL,
        groups: {
          kind: { types: { mode: 'all' }, facets: { mode: 'subset', values: ['Picture'] } },
        },
      };

      const table = planDashboard(withTable(), filters).requests.find((r) => r.kind === 'hits')!;

      expect(JSON.stringify(table.body.query)).toContain('"ecm:mixinType":["Picture"]');
    });

    it('unions a type and a facet constraint', () => {
      const filters: FilterState = {
        ...RANGE_ALL,
        groups: {
          kind: {
            types: { mode: 'subset', values: ['File'] },
            facets: { mode: 'subset', values: ['Picture'] },
          },
        },
      };

      const body = planDashboard(config(), filters).requests[0].body;
      const clauses = (body.query as any).bool.filter;

      expect(clauses[1]).toEqual({
        bool: {
          should: [
            { terms: { 'ecm:primaryType': ['File'] } },
            { terms: { 'ecm:mixinType': ['Picture'] } },
          ],
          minimum_should_match: 1,
        },
      });
    });

    it('combines the date range and the group with AND', () => {
      const filters: FilterState = {
        ...RANGE_30D,
        groups: { kind: { types: { mode: 'subset', values: ['File'] }, facets: { mode: 'all' } } },
        picks: [],
        path: null,
      };

      const clauses = (planDashboard(config(), filters).requests[0].body.query as any).bool.filter;

      expect(clauses).toEqual([
        { term: { 'ecm:isVersion': false } },
        { range: { 'dc:created': { gte: expect.any(String), lt: expect.any(String) } } },
        { terms: { 'ecm:primaryType': ['File'] } },
      ]);
    });
  });

  /**
   * A `filter` wrapper decides what a widget counts, not what a shard walks: every entry the query
   * selects goes past every aggregation. Tasks counted a few thousand open tasks under a
   * `match_all`, so the whole repository index went past eight collectors.
   */
  describe('narrowing the query to what every widget counts', () => {
    const TASK = { term: { 'ecm:mixinType': 'Task' } };
    const OPENED = { term: { 'ecm:currentLifeCycleState': 'opened' } };
    const OVERDUE = { range: { 'nt:dueDate': { lt: 'now' } } };

    function queryOf(dashboard: DashboardConfig, filters = RANGE_ALL): unknown {
      return planDashboard(dashboard, filters).requests[0].body.query;
    }

    const tasks = (extra: DashboardConfig['widgets'] = {}) =>
      config({
        layout: [{ cells: ['open', 'overdue', 'byType', ...Object.keys(extra)] }],
        widgets: {
          open: { type: 'kpi', label: 'Open', filter: [TASK, OPENED] },
          overdue: { type: 'kpi', label: 'Overdue', filter: [TASK, OPENED, OVERDUE] },
          byType: {
            type: 'donut',
            label: 'By type',
            filter: [TASK, OPENED],
            agg: { terms: { field: 'ecm:primaryType' } },
          },
          ...extra,
        },
      });

    /*
     * No union follows: `open` counts every open task, so none could leave anything out. That is
     * Governance, whose Live tile carries the three clauses every other tile starts with.
     */
    it('states in the query the clauses every widget already restricts itself to', () => {
      expect(queryOf(tasks())).toEqual({
        bool: { filter: [{ term: { 'ecm:isVersion': false } }, TASK, OPENED] },
      });
    });

    it('leaves every widget counting exactly what it counted', () => {
      const aggs = planDashboard(tasks(), RANGE_ALL).requests[0].body.aggs as Record<string, any>;

      expect(aggs['overdue'].filter).toEqual({ bool: { filter: [TASK, OPENED, OVERDUE] } });
      expect(aggs['byType'].filter).toEqual({ bool: { filter: [TASK, OPENED] } });
    });

    it('keeps the shared filters ahead of what it lifts', () => {
      const clauses = (queryOf(tasks(), RANGE_30D) as any).bool.filter;

      expect(clauses).toEqual([
        { term: { 'ecm:isVersion': false } },
        { range: { 'dc:created': { gte: expect.any(String), lt: expect.any(String) } } },
        TASK,
        OPENED,
      ]);
    });

    /**
     * Content's Total tile reads `hits.total`, so its figure *is* the query. Narrowing it to the
     * live documents every other tile counts would turn the total into a second Live tile.
     */
    it('narrows nothing while one widget reads hits.total', () => {
      const withTotal = tasks({ total: { type: 'kpi', label: 'Total' } });

      expect(planDashboard(withTotal, RANGE_ALL).widgets.get('total')?.read).toBe('total');
      expect(queryOf(withTotal)).toEqual({
        bool: { filter: [{ term: { 'ecm:isVersion': false } }] },
      });
    });

    it('narrows nothing while one widget computes a metric over the whole query', () => {
      const withMetric = tasks({
        size: { type: 'kpi', label: 'Size', metric: { sum: 'file:content.length' } },
      });

      expect(planDashboard(withMetric, RANGE_ALL).widgets.get('size')?.wrapped).toBe(false);
      expect(JSON.stringify(queryOf(withMetric))).not.toContain('Task');
    });

    it('narrows nothing while one chart has no filter of its own', () => {
      const withChart = tasks({
        trend: {
          type: 'area',
          label: 'Trend',
          agg: { date_histogram: { field: 'dc:created', calendar_interval: 'day' } },
        },
      });

      expect(JSON.stringify(queryOf(withChart))).not.toContain('Task');
    });

    /**
     * Both of these get a `match_all` wrapper, one for its secondary figure, the other for the
     * count of distinct values beside a top N. Being wrapped is not the same as having a filter.
     */
    it('narrows nothing for a widget wrapped only to carry a figure beside its own', () => {
      const withSecondary = tasks({
        all: {
          type: 'kpi',
          label: 'All',
          secondary: { filter: [TASK], label: '{value} tasks' },
        },
      });
      const withTopN = tasks({
        creators: {
          type: 'ranked-list',
          label: 'Creators',
          agg: { terms: { field: 'dc:creator', size: 10 } },
        },
      });

      expect(JSON.stringify(queryOf(withSecondary))).not.toContain('Task');
      expect(JSON.stringify(queryOf(withTopN))).not.toContain('Task');
    });

    /**
     * Users and Workflows: no clause in common, each widget naming one event. The union of their
     * filters is still implied by each of them, and the audit holds a great many other events.
     */
    it('unions what remains when the widgets share no clause, once per distinct filter', () => {
      const event = (eventId: string) => [{ term: { eventId } }];
      const audit = config({
        baseFilter: undefined,
        layout: [{ cells: ['logins', 'failures', 'topUsers'] }],
        widgets: {
          logins: { type: 'kpi', label: 'Logins', filter: event('loginSuccess') },
          failures: { type: 'kpi', label: 'Failures', filter: event('loginFailed') },
          topUsers: {
            type: 'bar',
            label: 'Top users',
            filter: event('loginSuccess'),
            agg: { terms: { field: 'principalName' } },
          },
        },
      });

      expect(queryOf(audit)).toEqual({
        bool: {
          filter: [
            {
              bool: {
                should: [
                  { term: { eventId: 'loginSuccess' } },
                  { term: { eventId: 'loginFailed' } },
                ],
                minimum_should_match: 1,
              },
            },
          ],
        },
      });
    });

    it('unions what remains beside the common clauses, keeping a filter of several clauses whole', () => {
      const dueFrom = { range: { 'nt:dueDate': { gte: 'now' } } };
      const dueBy = { range: { 'nt:dueDate': { lte: 'now+7d' } } };
      const late = config({
        layout: [{ cells: ['overdue', 'dueThisWeek'] }],
        widgets: {
          overdue: { type: 'kpi', label: 'Overdue', filter: [TASK, OPENED, OVERDUE] },
          dueThisWeek: {
            type: 'kpi',
            label: 'Due this week',
            filter: [TASK, OPENED, dueFrom, dueBy],
          },
        },
      });

      expect((queryOf(late) as any).bool.filter).toEqual([
        { term: { 'ecm:isVersion': false } },
        TASK,
        OPENED,
        {
          bool: {
            should: [OVERDUE, { bool: { filter: [dueFrom, dueBy] } }],
            minimum_should_match: 1,
          },
        },
      ]);
    });

    it('leaves a table request as it was, since its own filter already sits in its query', () => {
      const withTable = tasks({
        rows: {
          type: 'table',
          label: 'Rows',
          filter: [OVERDUE],
          columns: [{ field: 'dc:title', label: 'Title' }],
        },
      });

      const table = planDashboard(withTable, RANGE_ALL).requests.find((r) => r.kind === 'hits')!;
      expect(table.body.query).toEqual({
        bool: { filter: [{ term: { 'ecm:isVersion': false } }, OVERDUE] },
      });
    });
  });
});
