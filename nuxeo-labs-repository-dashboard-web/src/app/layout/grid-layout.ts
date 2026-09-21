/**
 * The arithmetic that turns a layout into rows of sized cells.
 *
 * Pure on purpose: it is the one thing the grid genuinely owns, and it is far easier to hold to
 * "a row fills whole lines" as a property of a function than as a property of a rendered tree.
 */
import {
  LayoutNode,
  LayoutRow,
  LayoutSection,
  LayoutTabs,
  WidgetConfig,
  isLayoutRow,
  isLayoutSection,
  isLayoutTabs,
  resolveSpan,
} from '../config/dashboard-config.model';

export interface RenderedCell {
  id: string;
  span: number;
}

const GRID_COLUMNS = 12;

/**
 * Resolves rows into cells with an explicit span.
 *
 * A widget without a declared span shares the row evenly; leftover columns go to the last cell so
 * that a row of five always fills the full width. A row whose spans exceed twelve is not an error:
 * CSS grid auto placement wraps it onto further lines, which is how two full width charts declared
 * in the same row end up stacked.
 */
export function renderRows(
  rows: LayoutRow[],
  widgets: Record<string, WidgetConfig>,
  rangeId: string,
): RenderedCell[][] {
  return rows
    .map((row) => {
      const present = (row.cells ?? []).filter((id) => id in widgets);
      if (!present.length) {
        return [];
      }

      const even = Math.max(Math.floor(GRID_COLUMNS / present.length), 1);
      const declared = present.map((id) => resolveSpan(widgets[id], rangeId));
      const remainder = GRID_COLUMNS - even * present.length;

      return present.map((id, index) => ({
        id,
        span: declared[index] ?? (index === present.length - 1 ? even + remainder : even),
      }));
    })
    .filter((row) => row.length > 0);
}

/**
 * One drawable piece of a layout.
 *
 * Consecutive plain rows are gathered into a single block rather than one each, so that the grid
 * hands a stable array down instead of building a fresh one per change detection pass. Exactly one
 * field is ever set.
 */
export interface LayoutBlock {
  rows: LayoutRow[];
  section: LayoutSection | null;
  tabs: LayoutTabs | null;
}

/** Splits a layout into the blocks the grid draws, preserving declaration order. */
export function toBlocks(nodes: LayoutNode[]): LayoutBlock[] {
  const blocks: LayoutBlock[] = [];
  let run: LayoutRow[] | null = null;

  for (const node of nodes) {
    if (isLayoutRow(node)) {
      if (!run) {
        run = [];
        blocks.push({ rows: run, section: null, tabs: null });
      }
      run.push(node);
      continue;
    }

    run = null;
    if (isLayoutSection(node)) {
      blocks.push({ rows: [], section: node, tabs: null });
    } else if (isLayoutTabs(node)) {
      blocks.push({ rows: [], section: null, tabs: node });
    }
  }

  return blocks;
}
