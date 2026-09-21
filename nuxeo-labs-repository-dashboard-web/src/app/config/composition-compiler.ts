/**
 * Turns a composition into the configuration the engine already runs.
 *
 * A compiler in front of the existing engine rather than a new engine: `agg-compiler`,
 * `query-planner`, `result-mapper`, the four widget components, the exports and the label service
 * are untouched, and every invariant their tests hold keeps holding.
 */
import { DashboardConfig, LayoutNode, LayoutRow, WidgetConfig } from './dashboard-config.model';
import {
  CompositionCell,
  CompositionNode,
  CompositionRow,
  DashboardComposition,
  isCompositionRow,
  isCompositionSection,
  isCompositionTabs,
} from './composition.model';
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
 * Nodes to walk, whichever way the composition declared its widgets.
 *
 * A flat `widgets` list becomes one row: the planner reads the layout to know what to ask for, so
 * widgets a bespoke page places itself still have to appear in one. What that row looks like
 * matters only if somebody renders the default grid anyway, which is a reasonable fallback rather
 * than a design.
 */
function nodesOf(composition: DashboardComposition): CompositionNode[] | null {
  if (Array.isArray(composition.widgets) && composition.widgets.length) {
    return [{ cells: composition.widgets }];
  }
  if (Array.isArray(composition.layout) && composition.layout.length) {
    return composition.layout;
  }
  return null;
}

/** Everything the walk accumulates, so that a cell is compiled in exactly one place. */
interface Compilation {
  widgets: Record<string, WidgetConfig>;
  /** Index each compiled widget reads, by name rather than by position. */
  indexByName: Map<string, string>;
  problems: string[];
}

/**
 * Compiles a composition, naming every reason it cannot be rendered.
 *
 * Nothing is compiled on a best effort basis: a page half built out of the widgets that happened
 * to resolve would be a page whose figures nobody can account for.
 */
export function compileComposition(composition: DashboardComposition): CompilationResult {
  const state: Compilation = { widgets: {}, indexByName: new Map(), problems: [] };

  const declared = nodesOf(composition);
  if (!declared) {
    return {
      config: null,
      problems: [
        'A composition needs either a "layout" with at least one row, or a "widgets" list.',
      ],
    };
  }

  const layout: LayoutNode[] = [];
  for (const node of declared) {
    const compiled = compileNode(node, state);
    if (compiled) {
      layout.push(compiled);
    }
  }

  if (state.problems.length) {
    return { config: null, problems: state.problems };
  }
  if (!layout.length) {
    return { config: null, problems: ['This composition holds no widget.'] };
  }

  /*
   * The page's index is the one its filters are written against, and any widget reading another
   * one says so. That is what lets one page mix the repository and the audit: the planner groups
   * by index and issues one request per group, rather than the single one a dashboard used to be
   * limited to.
   *
   * Inferring it from the first widget is right while there is only one; past that it makes the
   * order of the cells decide which index the facet value lists are counted on, so a mixed page
   * has to say it out loud.
   */
  const present = [...new Set(state.indexByName.values())] as DashboardConfig['index'][];
  const primary = composition.index ?? present[0];

  if (!present.includes(primary)) {
    return {
      config: null,
      problems: [
        `"index" says "${primary}", which no widget on this page reads. ` +
          `These do: ${present.join(', ')}.`,
      ],
    };
  }
  if (present.length > 1 && !composition.index) {
    return {
      config: null,
      problems: [
        `This dashboard reads ${present.join(' and ')}, so it has to name the one its filters ` +
          'are written against. Add "index" beside "label".',
      ],
    };
  }

  return {
    config: {
      id: composition.id,
      label: composition.label,
      ...(composition.subtitle ? { subtitle: composition.subtitle } : {}),
      index: primary,
      ...(composition.filters ? { filters: composition.filters } : {}),
      layout,
      widgets: withIndexOverrides(state, primary),
    },
    problems: [],
  };
}

/** Compiles one node, keeping its shape, or drops it when it turned out to hold nothing. */
function compileNode(node: CompositionNode, state: Compilation): LayoutNode | null {
  if (isCompositionSection(node)) {
    const rows = compileRows(node.rows ?? [], state);
    return rows.length
      ? {
          section: node.section,
          rows,
          ...(node.collapsible ? { collapsible: true } : {}),
          ...(node.collapsed ? { collapsed: true } : {}),
        }
      : null;
  }

  if (isCompositionTabs(node)) {
    const tabs = (node.tabs ?? [])
      .map((tab) => ({ label: tab.label, rows: compileRows(tab.rows ?? [], state) }))
      .filter((tab) => tab.rows.length);
    return tabs.length ? { tabs } : null;
  }

  if (isCompositionRow(node)) {
    const cells = compileCells(node.cells ?? [], state);
    return cells.length ? { cells } : null;
  }

  state.problems.push(
    'A layout entry is none of the three a layout accepts: a row with "cells", ' +
      'a "section" with rows, or a "tabs" with labelled panels.',
  );
  return null;
}

function compileRows(rows: CompositionRow[], state: Compilation): LayoutRow[] {
  const compiled: LayoutRow[] = [];
  for (const row of rows) {
    const cells = compileCells(row?.cells ?? [], state);
    if (cells.length) {
      compiled.push({ cells });
    }
  }
  return compiled;
}

function compileCells(cells: CompositionCell[], state: Compilation): string[] {
  const names: string[] = [];

  for (const cell of cells) {
    if (!cell?.use) {
      state.problems.push('A layout cell names no widget: every cell needs a "use".');
      continue;
    }

    const definition = findWidget(cell.use);
    if (!definition) {
      state.problems.push(
        `No widget is called "${cell.use}". The library offers ${knownWidgetIds().join(', ')}.`,
      );
      continue;
    }

    const name = cellName(cell);
    if (name in state.widgets) {
      state.problems.push(
        `Two cells are both called "${name}". Give one of them a different "as", ` +
          'since that name is what identifies its figures in the shared request.',
      );
      continue;
    }

    const { values, problems: paramProblems } = resolveParams(definition, cell.with);
    if (paramProblems.length) {
      state.problems.push(...paramProblems);
      continue;
    }

    let body;
    try {
      body = definition.build(values);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      state.problems.push(`"${cell.use}" could not be built: ${reason}`);
      continue;
    }

    const hint = cell.hint ?? body.hint;
    state.widgets[name] = {
      ...body,
      label: cell.title ?? definition.title,
      ...(hint ? { hint } : {}),
      ...(cell.span !== undefined ? { span: cell.span } : {}),
      ...(cell.spanByRange ? { spanByRange: cell.spanByRange } : {}),
    } as WidgetConfig;

    state.indexByName.set(name, definition.index);
    names.push(name);
  }

  return names;
}

/**
 * Marks the widgets that read an index other than the page's.
 *
 * Keyed by name rather than by position: a layout is a tree now, so pairing a flat list of indices
 * with a flat walk of the cells would be one refactor away from silently mislabelling a widget.
 */
function withIndexOverrides(state: Compilation, primary: string): Record<string, WidgetConfig> {
  for (const [name, index] of state.indexByName) {
    if (index !== primary) {
      state.widgets[name] = {
        ...state.widgets[name],
        index: index as DashboardConfig['index'],
      };
    }
  }
  return state.widgets;
}
