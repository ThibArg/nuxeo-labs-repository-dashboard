import { describe, expect, it } from 'vitest';
import {
  DashboardConfig,
  LayoutNode,
  WidgetConfig,
  defaultFilterState,
  isLayoutRow,
  isLayoutSection,
  isLayoutTabs,
  layoutCells,
  layoutRows,
} from './dashboard-config.model';
import { planDashboard } from '../engine/query-planner';

/*
 * A charted widget rather than a bare tile: a KPI carrying neither predicate nor metric emits no
 * aggregation at all, reading `hits.total` instead, so it could not show that a widget in a closed
 * tab reaches the request.
 */
const CHART: WidgetConfig = {
  type: 'donut',
  label: 'By type',
  agg: { terms: { field: 'ecm:primaryType', size: 10 } },
};

/** Four widgets, one per place the grammar can put one. */
const LAYOUT: LayoutNode[] = [
  { cells: ['plain'] },
  { section: 'Folded away', rows: [{ cells: ['inSection'] }], collapsible: true, collapsed: true },
  {
    tabs: [
      { label: 'Open', rows: [{ cells: ['inFirstTab'] }] },
      { label: 'Never opened', rows: [{ cells: ['inSecondTab'] }] },
    ],
  },
];

function dashboard(layout: LayoutNode[] = LAYOUT): DashboardConfig {
  return {
    id: 'demo',
    label: 'Demo',
    index: 'nuxeo',
    layout,
    widgets: {
      plain: CHART,
      inSection: CHART,
      inFirstTab: CHART,
      inSecondTab: CHART,
    },
  };
}

describe('the layout grammar', () => {
  it('tells its three node kinds apart', () => {
    const [row, section, tabs] = LAYOUT;

    expect([isLayoutRow(row), isLayoutSection(row), isLayoutTabs(row)]).toEqual([
      true,
      false,
      false,
    ]);
    expect([isLayoutRow(section), isLayoutSection(section), isLayoutTabs(section)]).toEqual([
      false,
      true,
      false,
    ]);
    expect([isLayoutRow(tabs), isLayoutSection(tabs), isLayoutTabs(tabs)]).toEqual([
      false,
      false,
      true,
    ]);
  });

  it('gathers the rows of every node in declaration order', () => {
    expect(layoutRows(LAYOUT).map((row) => row.cells)).toEqual([
      ['plain'],
      ['inSection'],
      ['inFirstTab'],
      ['inSecondTab'],
    ]);
  });

  /**
   * The promise the whole grammar rests on.
   *
   * A widget is planned because the *configuration* names it, never because it happens to be on
   * screen. Were it otherwise, opening a tab would fire a request of its own, at its own instant,
   * and the figures of two tabs could no longer be compared — which is precisely the reason a
   * widget declares its query instead of running it.
   */
  it('names a widget sitting in a folded section or in a tab nobody opened', () => {
    expect(layoutCells(LAYOUT)).toEqual(['plain', 'inSection', 'inFirstTab', 'inSecondTab']);
  });

  it('plans every one of them, in a single request', () => {
    const { requests, errors } = planDashboard(dashboard(), defaultFilterState());

    expect([...errors]).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(Object.keys(requests[0].body.aggs ?? {}).sort()).toEqual([
      'inFirstTab',
      'inSecondTab',
      'inSection',
      'plain',
    ]);
  });

  it('reads nothing out of a node holding no row', () => {
    expect(layoutCells([{ section: 'Empty', rows: [] }, { tabs: [] }])).toEqual([]);
  });

  /**
   * What makes this change need no live check against a real index.
   *
   * The grammar decides where a widget is drawn and nothing else: the request is planned off the
   * widget ids the layout names, in the order it names them, so wrapping them in tabs and sections
   * emits the very same JSON. No new request shape reaches OpenSearch, and the shipped dashboards
   * — all of them flat — plan byte for byte what they planned before.
   */
  it('emits exactly what the same widgets in plain rows would', () => {
    const grouped = planDashboard(dashboard(), defaultFilterState());
    const flat = planDashboard(
      dashboard([{ cells: ['plain', 'inSection', 'inFirstTab', 'inSecondTab'] }]),
      defaultFilterState(),
    );

    expect(grouped.requests).toEqual(flat.requests);
  });
});
