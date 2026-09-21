/**
 * Proves a migration rather than describing it.
 *
 * A dashboard moving from hand written configuration to a composition must plan *exactly* what it
 * planned before — same requests, same aggregations, same clauses in the same order — and show
 * exactly what it showed: same labels, same hints. Anything else is a change dressed up as a
 * refactor.
 *
 * Each of these lives only as long as both forms of its dashboard do. Once the hand written file
 * goes, the proof has been made and belongs to the commit that made it.
 */
import { expect, it } from 'vitest';
import {
  DashboardConfig,
  FilterState,
  customRange,
  dateRangeOption,
} from '../dashboard-config.model';
import { DashboardComposition } from '../composition.model';
import { compileComposition } from '../composition-compiler';
import { planDashboard } from '../../engine/query-planner';

/**
 * Every clause one widget's figures are narrowed by, wherever the plan put it.
 *
 * A hand written dashboard could share clauses through `baseFilter`; a composition cannot express
 * a clause at all, so each widget states its whole population. The documents counted are the same
 * and the JSON is not, which is why equivalence is checked here rather than byte identity.
 */
function effectiveClauses(
  config: DashboardConfig,
  filters: FilterState,
  widgetId: string,
): string[] {
  const plan = planDashboard(config, filters);
  const request = plan.requests.find((candidate) => candidate.widgetIds.includes(widgetId))!;

  const query = request.body.query as { bool?: { filter?: unknown[] } } | undefined;
  const shared = query?.bool?.filter ?? [];

  const aggs = (request.body.aggs ?? {}) as Record<string, { filter?: unknown }>;
  const own = aggs[widgetId]?.filter;
  const ownClauses = own ? ((own as { bool?: { filter?: unknown[] } }).bool?.filter ?? [own]) : [];

  return [...shared, ...ownClauses].map((clause) => JSON.stringify(clause)).sort();
}

/** Three states that exercise different code: no bounds, bounds, and a constrained group. */
export function migrationStates(groups: FilterState['groups'] = {}): [string, FilterState][] {
  return [
    ['all time', { range: dateRangeOption('all'), groups: {}, picks: [], path: null }],
    [
      'a bounded period',
      { range: customRange('2026-08-20', '2026-09-18'), groups: {}, picks: [], path: null },
    ],
    [
      'a filtered period',
      { range: customRange('2026-08-20', '2026-09-18'), groups, picks: [], path: null },
    ],
  ];
}

/**
 * Asserts that a composition is the dashboard it replaces.
 *
 * @param groups a constrained group selection, for the dashboards that declare one
 */
export function provesMigrationOf(
  legacy: DashboardConfig,
  source: DashboardComposition,
  groups: FilterState['groups'] = {},
): void {
  it('compiles with nothing to report', () => {
    expect(compileComposition(source).problems).toEqual([]);
  });

  /*
   * The set of widgets and the rows, not the order of the keys: a composition declares in layout
   * order while a hand written file declared in whatever order it was typed, and nothing reads
   * that order — the planner and the grid both walk the layout.
   */
  it('names the same widgets, in the same rows, on the same index', () => {
    const { config } = compileComposition(source);

    expect(Object.keys(config!.widgets).sort()).toEqual(Object.keys(legacy.widgets).sort());
    expect(config!.layout).toEqual(legacy.layout);
    expect(config!.index).toEqual(legacy.index);
  });

  /*
   * The real claim: every widget is narrowed by the same clauses as before. A table works here
   * too — `planTable` merges the shared clauses into its own query, so reading that query gives
   * the whole set and there is no wrapper to unwrap.
   */
  it.each(migrationStates(groups))(
    'narrows every widget the same way over %s',
    (_name, filters) => {
      const { config } = compileComposition(source);

      for (const widgetId of Object.keys(legacy.widgets)) {
        expect(effectiveClauses(config!, filters, widgetId), widgetId).toEqual(
          effectiveClauses(legacy, filters, widgetId),
        );
      }
    },
  );

  /** What a table asks for beside its clauses: its columns, its page size and its sort. */
  it('asks for the same rows, in the same order', () => {
    const { config } = compileComposition(source);
    const [, filters] = migrationStates(groups)[1];

    const tables = (plan: DashboardConfig) =>
      planDashboard(plan, filters)
        .requests.filter((request) => request.kind === 'hits')
        .map((request) => JSON.stringify({ ...request.body, query: undefined }));

    expect(tables(config!)).toEqual(tables(legacy));
  });

  /*
   * Byte identity, where the hand written form shared nothing through `baseFilter`. Where it did,
   * the clauses move into the widgets and the JSON legitimately differs — the assertion above is
   * what covers that case, and asserting bytes here as well would only force the compiler to
   * reproduce an accident of how the file was typed.
   */
  if (!legacy.baseFilter?.length) {
    it.each(migrationStates(groups))(
      'plans over %s exactly what the hand written configuration planned',
      (_name, filters) => {
        const { config } = compileComposition(source);

        expect(JSON.stringify(planDashboard(config!, filters).requests, null, 1)).toEqual(
          JSON.stringify(planDashboard(legacy, filters).requests, null, 1),
        );
      },
    );
  }

  it('carries the labels and hints the page used to show', () => {
    const { config } = compileComposition(source);

    for (const [id, widget] of Object.entries(legacy.widgets)) {
      expect(config!.widgets[id].label, id).toBe(widget.label);
      expect(config!.widgets[id].hint, id).toBe(widget.hint);
    }
  });

  it('keeps the subtitle and the filters', () => {
    const { config } = compileComposition(source);

    expect(config!.subtitle).toBe(legacy.subtitle);
    expect(config!.filters).toEqual(legacy.filters);
  });
}
