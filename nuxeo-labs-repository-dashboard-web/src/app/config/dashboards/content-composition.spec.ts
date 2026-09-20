import { describe, expect, it } from 'vitest';
import legacyConfig from './content.json';
import compositionSource from './content.composition.json';
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
 * Proves the migration rather than describing it.
 *
 * Content used to be three hundred lines of hand written configuration; it is now a composition
 * naming thirteen widgets. The only claim worth making about that is that nothing moved, and the
 * only way to make it is to plan both and compare — which is what this does, byte for byte, over
 * the two periods that exercise different code: an unbounded one emits no histogram bounds, a
 * bounded one does.
 *
 * Once the hand written file goes away this test goes with it. It belongs to the move, not to the
 * product.
 */
const composition = compositionSource as DashboardComposition;
const legacy = legacyConfig as DashboardConfig;

const ALL_TIME: FilterState = {
  range: dateRangeOption('all'),
  groups: {},
  picks: [],
  path: null,
};

const BOUNDED: FilterState = {
  range: customRange('2026-08-20', '2026-09-18'),
  groups: {},
  picks: [],
  path: null,
};

/** A period, plus a type constraint and a place, so the shared clauses are exercised too. */
const FILTERED: FilterState = {
  range: customRange('2026-08-20', '2026-09-18'),
  groups: {
    kind: { types: { mode: 'subset', values: ['File', 'Note'] }, facets: { mode: 'all' } },
  },
  picks: [],
  path: '/default-domain/workspaces',
};

describe('the Content composition', () => {
  it('compiles with nothing to report', () => {
    expect(compileComposition(composition).problems).toEqual([]);
  });

  it('names the same thirteen widgets, in the same order', () => {
    const { config } = compileComposition(composition);

    expect(Object.keys(config!.widgets)).toEqual(Object.keys(legacy.widgets));
    expect(config!.layout).toEqual(legacy.layout);
  });

  it.each([
    ['all time', ALL_TIME],
    ['a bounded period', BOUNDED],
    ['a filtered period', FILTERED],
  ])('plans over %s exactly what the hand written configuration planned', (_name, filters) => {
    const { config } = compileComposition(composition);

    expect(JSON.stringify(planDashboard(config!, filters).requests, null, 1)).toEqual(
      JSON.stringify(planDashboard(legacy, filters).requests, null, 1),
    );
  });

  it('still costs one request', () => {
    const { config } = compileComposition(composition);

    expect(planDashboard(config!, BOUNDED).requests).toHaveLength(1);
  });

  it('carries the labels and hints the page used to show', () => {
    const { config } = compileComposition(composition);

    for (const [id, widget] of Object.entries(legacy.widgets)) {
      expect(config!.widgets[id].label).toBe(widget.label);
      expect(config!.widgets[id].hint).toBe(widget.hint);
    }
  });
});
