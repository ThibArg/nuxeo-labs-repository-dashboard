import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import governanceConfig from '../config/dashboards/governance.json';
import {
  DashboardConfig,
  defaultFilterState,
  resolveSpan,
  scopeClauses,
} from '../config/dashboard-config.model';
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
  isHitsRequest,
} from '../../testing/fetch-stub';
import { settle } from '../../testing/settle';

const GOVERNANCE = governanceConfig as DashboardConfig;

const SHORT_RULE = '15285cbe-0fa5-4c38-98fd-b69bac31f02e';
const LONG_RULE = 'c667a0e3-e9b8-4cd8-a30d-5a12f00d7a71';

/** A scoped chart answers under a wrapper, with its bucket list nested. */
function wrapped(docCount: number, buckets: unknown[]) {
  return { doc_count: docCount, inner: { buckets }, distinct: { value: buckets.length } };
}

function aggregationsResponse(): unknown {
  return {
    took: 4,
    timed_out: false,
    // `liveDocuments` is unscoped and unfiltered, so the planner reads it off the total.
    hits: { total: { value: 866, relation: 'eq' }, hits: [] },
    aggregations: {
      records: { doc_count: 22, secondary: { doc_count: 19 } },
      underRetention: { doc_count: 19 },
      legalHold: { doc_count: 2 },
      expiringWeek: { doc_count: 9 },
      expiring60: { doc_count: 7 },
      expiringLater: { doc_count: 3 },
      byRule: wrapped(19, [
        { key: SHORT_RULE, doc_count: 9 },
        { key: LONG_RULE, doc_count: 3 },
      ]),
      byType: wrapped(22, [
        { key: 'File', doc_count: 16 },
        { key: 'Note', doc_count: 6 },
      ]),
    },
  };
}

function hitsResponse(): unknown {
  return {
    took: 3,
    timed_out: false,
    hits: {
      total: { value: 22, relation: 'eq' },
      hits: [
        {
          _id: 'r1',
          _source: {
            'ecm:uuid': 'r1',
            'dc:title': 'Invoice 002',
            'ecm:primaryType': 'File',
            'record:ruleIds': [SHORT_RULE],
            'ecm:retainUntil': '2026-09-24T15:41:48.791Z',
            'ecm:hasLegalHold': false,
          },
        },
        {
          _id: 'r2',
          _source: {
            'ecm:uuid': 'r2',
            'dc:title': 'Litigation exhibit 021',
            'ecm:primaryType': 'File',
            'ecm:hasLegalHold': true,
          },
        },
      ],
    },
  };
}

function supportRoutes(): StubRoute[] {
  return [
    { match: 'assets/dashboards/governance.json', json: governanceConfig },
    { match: '/ui/i18n/messages.json', json: { 'label.document.type.note': 'Note' } },
    { match: `/api/v1/id/${SHORT_RULE}`, json: { title: 'Invoices — 5 days' } },
    { match: `/api/v1/id/${LONG_RULE}`, json: { title: 'HR files — 2 years' } },
  ];
}

describe('governance.json', () => {
  it('declares a widget for every layout cell, and no orphan widget', () => {
    const referenced = new Set(GOVERNANCE.layout.flatMap((row) => row.cells));
    const declared = new Set(Object.keys(GOVERNANCE.widgets));

    expect([...referenced].filter((id) => !declared.has(id))).toEqual([]);
    expect([...declared].filter((id) => !referenced.has(id))).toEqual([]);
  });

  it('reads the repository in one aggregation request, plus the table it cannot batch', () => {
    const { requests } = planDashboard(GOVERNANCE, defaultFilterState(GOVERNANCE));

    expect(requests.map((request) => request.index)).toEqual(['nuxeo', 'nuxeo']);
    expect(requests.filter((request) => request.kind === 'hits')).toHaveLength(1);
  });

  /*
   * `dc:title` is `text` with fielddata rather than a keyword, so aggregating on it answers
   * something quite unlike the other fields. The table reads it out of `_source`, where it is
   * perfectly usable, and nothing else touches it.
   */
  it('reads dc:title from the source and never aggregates on it', () => {
    const { requests } = planDashboard(GOVERNANCE, defaultFilterState(GOVERNANCE));
    const aggregations = requests.filter((request) => request.kind === 'aggregations');
    const table = requests.find((request) => request.kind === 'hits');

    expect(JSON.stringify(aggregations.map((request) => request.body.aggs))).not.toContain(
      'dc:title',
    );
    expect(table?.body._source).toContain('dc:title');
  });

  /*
   * A record made by Document.Retain or Document.Hold carries no rule: only Retention.AttachRule
   * writes `record:ruleIds`, and it alone adds the `Record` facet. Grouping every record by rule
   * would therefore put the difference nowhere, and the chart would quietly describe a smaller
   * population than its title claims.
   */
  it('counts the rule breakdown over the records a rule was attached to', () => {
    expect(scopeClauses(GOVERNANCE, GOVERNANCE.widgets['byRule'])).toEqual([
      { term: { 'ecm:mixinType': 'Record' } },
    ]);
    expect(GOVERNANCE.widgets['byRule'].hint).toContain('carries no rule');
  });

  describe('retention horizon', () => {
    /*
     * The three tiles are presented as a breakdown of Under Retention, so a reader adds them up.
     * They must partition it exactly: every retained document in one tile, and in one only.
     *
     * The scope is evaluated with the widget's own filter rather than separately, because that is
     * what reaches the server: the lower bound of every tile comes from the scope alone.
     */
    const TILES = ['expiringWeek', 'expiring60', 'expiringLater'];
    const DAY = 86_400_000;
    const NOW = Date.UTC(2026, 8, 19, 10, 0, 0);

    /** Resolves the date math these tiles use, which is limited to `now` and `now+Nd`. */
    function resolve(math: string): number {
      const parsed = /^now(?:([+-])(\d+)d)?$/.exec(math);
      if (!parsed) {
        throw new Error(`Unsupported date math: ${math}`);
      }
      const [, sign, days] = parsed;
      return sign ? NOW + (sign === '-' ? -1 : 1) * Number(days) * DAY : NOW;
    }

    function counts(widgetId: string, retainUntil: number): boolean {
      const widget = GOVERNANCE.widgets[widgetId];
      const clauses = [...scopeClauses(GOVERNANCE, widget), ...(widget.filter ?? [])] as {
        range?: Record<string, Record<string, string>>;
      }[];

      return clauses
        .flatMap((clause) => Object.entries(clause.range?.['ecm:retainUntil'] ?? {}))
        .every(([operator, math]) => {
          const bound = resolve(math);
          switch (operator) {
            case 'gte':
              return retainUntil >= bound;
            case 'gt':
              return retainUntil > bound;
            case 'lte':
              return retainUntil <= bound;
            case 'lt':
              return retainUntil < bound;
            default:
              throw new Error(`Unsupported bound: ${operator}`);
          }
        });
    }

    const CASES: { name: string; days: number; tiles: string[] }[] = [
      { name: 'a retention that ran out yesterday', days: -1, tiles: [] },
      { name: 'retained for five more days', days: 5, tiles: ['expiringWeek'] },
      // Both boundaries are where a double count would show, the bounds being inclusive below.
      { name: 'retained for exactly seven more days', days: 7, tiles: ['expiringWeek'] },
      { name: 'retained for forty-five more days', days: 45, tiles: ['expiring60'] },
      { name: 'retained for exactly sixty more days', days: 60, tiles: ['expiring60'] },
      { name: 'retained for two more years', days: 730, tiles: ['expiringLater'] },
    ];

    it('counts a retained document in exactly one tile', () => {
      for (const { name, days, tiles } of CASES) {
        expect(
          TILES.filter((id) => counts(id, NOW + days * DAY)),
          name,
        ).toEqual(tiles);
      }
    });

    it('says on screen that the three are meant to be added up', () => {
      expect(GOVERNANCE.widgets['expiringLater'].hint).toBe('The three add up to Under Retention');
    });
  });

  it('fills complete grid lines, for every date range', () => {
    for (const range of ['all', '7d', '30d', '90d', '12m']) {
      for (const row of GOVERNANCE.layout) {
        const spans = row.cells.map((id) => resolveSpan(GOVERNANCE.widgets[id], range) ?? 0);
        expect(spans.reduce((total, span) => total + span, 0) % 12).toBe(0);
      }
    }
  });
});

describe('Governance dashboard', () => {
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

  async function render(preflightRoutes: StubRoute[] = []) {
    stub = installFetchStub([
      {
        match: '/site/es/nuxeo/_search',
        matchBody: isAggregationsRequest,
        json: aggregationsResponse(),
      },
      { match: '/site/es/nuxeo/_search', matchBody: isHitsRequest, json: hitsResponse() },
      ...supportRoutes(),
      // Last, because they end on a catch-all for every `/site/es/` call.
      ...preflightRoutes,
    ]);
    const fixture = TestBed.createComponent(DashboardPageComponent);
    fixture.componentRef.setInput('dashboardId', 'governance');
    await settle(fixture);
    return fixture;
  }

  it('renders the tiles, the breakdowns and the table', async () => {
    const text = ((await render()).nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Governance Dashboard');
    expect(text).toContain('Records');
    expect(text).toContain('Under Legal Hold');
    expect(text).toContain('By Retention Rule');
    expect(text).toContain('866');
    expect(text).toContain('19 governed by a rule');
  });

  /*
   * The whole reason the `document` label strategy exists. `record:ruleIds` holds uuids, and a
   * chart showing them names nothing a reader could act on.
   */
  it('names the retention rules rather than showing their uuids', async () => {
    const text = ((await render()).nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Invoices — 5 days');
    expect(text).toContain('HR files — 2 years');
    expect(text).not.toContain(SHORT_RULE);
  });

  it('names the rule and the legal hold in the table', async () => {
    const table = ((await render()).nativeElement as HTMLElement).querySelector('table');

    expect(table?.textContent).toContain('Invoice 002');
    expect(table?.textContent).toContain('Invoices — 5 days');
    // A record with no retention is held, and the column has to say so rather than stay blank.
    expect(table?.textContent).toContain('Yes');
  });

  /*
   * Only the rule breakdown needs nuxeo-retention. ecm:isRecord, ecm:retainUntil and
   * ecm:hasLegalHold are core fields, so greying the page out would hide figures that are
   * perfectly correct on a server without the addon.
   */
  it('names the missing package without hiding the figures that do not need it', async () => {
    const fixture = await render(
      healthyServerRoutes([{ match: '/api/v1/config/types/RetentionRule', status: 404, json: {} }]),
    );
    fixture.componentRef.setInput('requires', 'retention');
    fixture.componentRef.setInput('requirementLabel', 'the nuxeo-retention package');
    await TestBed.inject(PreflightService).run();
    await settle(fixture);

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('the nuxeo-retention package');
    expect(text).toContain('Under Legal Hold');
    expect(text).toContain('866');
  });
});
