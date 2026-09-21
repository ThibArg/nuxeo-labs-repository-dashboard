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

  it('names the same widgets, in the same order, in the same rows', () => {
    const { config } = compileComposition(source);

    expect(Object.keys(config!.widgets)).toEqual(Object.keys(legacy.widgets));
    expect(config!.layout).toEqual(legacy.layout);
    expect(config!.index).toEqual(legacy.index);
  });

  it.each(migrationStates(groups))(
    'plans over %s exactly what the hand written configuration planned',
    (_name, filters) => {
      const { config } = compileComposition(source);

      expect(JSON.stringify(planDashboard(config!, filters).requests, null, 1)).toEqual(
        JSON.stringify(planDashboard(legacy, filters).requests, null, 1),
      );
    },
  );

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
