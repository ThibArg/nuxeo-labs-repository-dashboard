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

export interface DashboardComposition {
  id: string;
  label: string;
  subtitle?: string;
  /** Interactive filters shown above the grid. Unchanged from the compiled form. */
  filters?: FilterConfig[];
  layout: CompositionRow[];
}

/**
 * True for a composition rather than a compiled configuration.
 *
 * `use` inside a layout cell is the discriminator, and it is unambiguous: a compiled layout holds
 * plain strings there.
 */
export function isComposition(value: unknown): value is DashboardComposition {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const layout = (value as { layout?: unknown }).layout;
  if (!Array.isArray(layout)) {
    return false;
  }
  return layout.some((row) => {
    const cells = (row as { cells?: unknown })?.cells;
    return (
      Array.isArray(cells) &&
      cells.some((cell) => !!cell && typeof cell === 'object' && 'use' in cell)
    );
  });
}
