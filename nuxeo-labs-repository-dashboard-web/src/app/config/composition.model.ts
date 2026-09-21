/**
 * A dashboard described by the widgets it shows rather than by the queries it runs.
 *
 * This is the form an administrator, or an assistant, writes. It compiles to the `DashboardConfig`
 * the engine already plans, batches, renders and exports, so nothing downstream had to change to
 * accept it.
 *
 * It also closes a hole. `DashboardConfig` carries `EsClause` in four places — `baseFilter`,
 * `scopes`, a widget's `filter` and a secondary figure's — and the passthrough forwards an
 * administrator's payload verbatim, `script` included. A composition has no way to express a
 * clause at all: it names widgets and passes parameters.
 */
import { FilterConfig } from './dashboard-config.model';
import { EsIndex } from '../core/nuxeo.types';

export interface CompositionCell {
  /** Id of a widget definition in the library. */
  use: string;
  /**
   * Name this widget takes on the page, defaulting to `use`.
   *
   * It has to be unique, because it is what names the aggregation inside the shared request. That
   * naming — after the widget rather than after the field — is precisely what lets two widgets
   * reading the same field travel in one request instead of overwriting each other.
   */
  as?: string;
  /** Card title, overriding the definition's own. */
  title?: string;
  /** Secondary line under the title. `{range}` is replaced by the active period. */
  hint?: string;
  /** Width in the twelve column grid. Omitted spans share the row evenly. */
  span?: number;
  /** Overrides `span` for a given date range id. */
  spanByRange?: Record<string, number>;
  /** Parameters the definition declares. */
  with?: Record<string, unknown>;
}

export interface CompositionRow {
  cells: CompositionCell[];
}

/** A titled block of rows. `collapsible` makes it foldable; see `LayoutSection`. */
export interface CompositionSection {
  section: string;
  rows: CompositionRow[];
  collapsible?: boolean;
  collapsed?: boolean;
}

export interface CompositionTab {
  label: string;
  rows: CompositionRow[];
}

/** Named panels, one shown at a time. */
export interface CompositionTabs {
  tabs: CompositionTab[];
}

/** Mirrors `LayoutNode`, cell for cell, and is bounded to the same two levels. */
export type CompositionNode = CompositionRow | CompositionSection | CompositionTabs;

export function isCompositionSection(node: CompositionNode): node is CompositionSection {
  return 'section' in node;
}

export function isCompositionTabs(node: CompositionNode): node is CompositionTabs {
  return 'tabs' in node;
}

export function isCompositionRow(node: CompositionNode): node is CompositionRow {
  return 'cells' in node;
}

/** Every row a composition node holds, in declaration order. */
export function compositionRows(nodes: CompositionNode[]): CompositionRow[] {
  return nodes.flatMap((node) => {
    if (isCompositionRow(node)) {
      return [node];
    }
    if (isCompositionSection(node)) {
      return node.rows ?? [];
    }
    return (node.tabs ?? []).flatMap((tab) => tab.rows ?? []);
  });
}

export interface DashboardComposition {
  id: string;
  label: string;
  subtitle?: string;
  /**
   * Index the page is built around, which is the one its filters are written against.
   *
   * Optional, and inferred from the widgets when a page reads a single index — which is every
   * page that ships. It becomes required the moment a page mixes two, because otherwise the
   * answer is "whichever widget happens to come first": moving a cell would change which index
   * the facet value lists are counted on, and nothing on screen would say so.
   */
  index?: EsIndex;
  /** Interactive filters shown above the grid. Unchanged from the compiled form. */
  filters?: FilterConfig[];
  /** Widgets laid out by the twelve column grid, row by row, section by section. */
  layout?: CompositionNode[];
  /**
   * Widgets the page places itself, when the grid is not what it wants.
   *
   * Declaring without placing is what lets a bespoke screen — tabs, panels, anything its author
   * writes — reuse the library. The set still has to be declared here rather than discovered from
   * the markup, because the planner needs to know every widget before the first request: a widget
   * found only when its tab is opened would arrive in a request of its own, at its own instant.
   */
  widgets?: CompositionCell[];
}

/**
 * True for a composition rather than a compiled configuration.
 *
 * Two discriminators, neither of which a compiled configuration can satisfy: `use` inside a layout
 * cell, whose cells are plain strings there, and a `widgets` **array**, which is a record there.
 *
 * It walks into sections and tabs, which is not a detail: a composition whose every widget sits
 * inside a `tabs` has no `use` at the top level, and reading it as already compiled would hand the
 * planner cells it cannot resolve.
 */
export function isComposition(value: unknown): value is DashboardComposition {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as { layout?: unknown; widgets?: unknown };

  if (Array.isArray(candidate.widgets)) {
    return true;
  }
  if (!Array.isArray(candidate.layout)) {
    return false;
  }
  return compositionRows(candidate.layout as CompositionNode[]).some((row) => {
    const cells = (row as { cells?: unknown })?.cells;
    return (
      Array.isArray(cells) &&
      cells.some((cell) => !!cell && typeof cell === 'object' && 'use' in cell)
    );
  });
}
