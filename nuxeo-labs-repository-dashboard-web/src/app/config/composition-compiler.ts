/**
 * Turns a composition into the configuration the engine already runs.
 *
 * A compiler in front of the existing engine rather than a new engine: `agg-compiler`,
 * `query-planner`, `result-mapper`, the four widget components, the exports and the label service
 * are untouched, and every invariant their tests hold keeps holding.
 */
import { DashboardConfig, LayoutRow, WidgetConfig } from './dashboard-config.model';
import { CompositionCell, CompositionRow, DashboardComposition } from './composition.model';
import { resolveParams } from '../library/definition';
import { findWidget, knownWidgetIds } from '../library/registry';

export interface CompilationResult {
  config: DashboardConfig | null;
  /** Empty when the composition is usable. */
  problems: string[];
}

function cellName(cell: CompositionCell): string {
  return cell.as ?? cell.use;
}

/**
 * Rows to walk, whichever way the composition declared its widgets.
 *
 * A flat `widgets` list becomes one row: the planner reads the layout to know what to ask for, so
 * widgets a bespoke page places itself still have to appear in one. What that row looks like
 * matters only if somebody renders the default grid anyway, which is a reasonable fallback rather
 * than a design.
 */
function rowsOf(composition: DashboardComposition): CompositionRow[] | null {
  if (Array.isArray(composition.widgets) && composition.widgets.length) {
    return [{ cells: composition.widgets }];
  }
  if (Array.isArray(composition.layout) && composition.layout.length) {
    return composition.layout;
  }
  return null;
}

/**
 * Compiles a composition, naming every reason it cannot be rendered.
 *
 * Nothing is compiled on a best effort basis: a page half built out of the widgets that happened
 * to resolve would be a page whose figures nobody can account for.
 */
export function compileComposition(composition: DashboardComposition): CompilationResult {
  const problems: string[] = [];
  const widgets: Record<string, WidgetConfig> = {};
  const layout: LayoutRow[] = [];
  const indices: string[] = [];

  const declared = rowsOf(composition);
  if (!declared) {
    return {
      config: null,
      problems: [
        'A composition needs either a "layout" with at least one row, or a "widgets" list.',
      ],
    };
  }

  for (const row of declared) {
    const cells: string[] = [];

    for (const cell of row.cells ?? []) {
      if (!cell?.use) {
        problems.push('A layout cell names no widget: every cell needs a "use".');
        continue;
      }

      const definition = findWidget(cell.use);
      if (!definition) {
        problems.push(
          `No widget is called "${cell.use}". The library offers ${knownWidgetIds().join(', ')}.`,
        );
        continue;
      }

      const name = cellName(cell);
      if (name in widgets) {
        problems.push(
          `Two cells are both called "${name}". Give one of them a different "as", ` +
            'since that name is what identifies its figures in the shared request.',
        );
        continue;
      }

      const { values, problems: paramProblems } = resolveParams(definition, cell.with);
      if (paramProblems.length) {
        problems.push(...paramProblems);
        continue;
      }

      let body;
      try {
        body = definition.build(values);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        problems.push(`"${cell.use}" could not be built: ${reason}`);
        continue;
      }

      const hint = cell.hint ?? body.hint;
      widgets[name] = {
        ...body,
        label: cell.title ?? definition.title,
        ...(hint ? { hint } : {}),
        ...(cell.span !== undefined ? { span: cell.span } : {}),
        ...(cell.spanByRange ? { spanByRange: cell.spanByRange } : {}),
      } as WidgetConfig;

      indices.push(definition.index);
      cells.push(name);
    }

    if (cells.length) {
      layout.push({ cells });
    }
  }

  if (problems.length) {
    return { config: null, problems };
  }
  if (!layout.length) {
    return { config: null, problems: ['This composition holds no widget.'] };
  }

  /*
   * The first widget's index is the page's, and any widget reading another one says so. That is
   * what lets one page mix the repository and the audit: the planner groups by index and issues
   * one request per group, rather than the single one a dashboard used to be limited to.
   */
  const primary = indices[0] as DashboardConfig['index'];

  return {
    config: {
      id: composition.id,
      label: composition.label,
      ...(composition.subtitle ? { subtitle: composition.subtitle } : {}),
      index: primary,
      ...(composition.filters ? { filters: composition.filters } : {}),
      layout,
      widgets: withIndexOverrides(widgets, layout, indices, primary),
    },
    problems: [],
  };
}

/** Marks the widgets that read an index other than the page's. */
function withIndexOverrides(
  widgets: Record<string, WidgetConfig>,
  layout: LayoutRow[],
  indices: string[],
  primary: string,
): Record<string, WidgetConfig> {
  const order = layout.flatMap((row) => row.cells);
  order.forEach((name, position) => {
    if (indices[position] !== primary) {
      widgets[name] = { ...widgets[name], index: indices[position] as DashboardConfig['index'] };
    }
  });
  return widgets;
}
