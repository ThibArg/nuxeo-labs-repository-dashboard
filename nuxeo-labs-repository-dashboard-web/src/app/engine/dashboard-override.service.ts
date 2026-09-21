import { Injectable } from '@angular/core';
import {
  DashboardConfig,
  LayoutNode,
  LayoutRow,
  defaultFilterState,
  isLayoutRow,
  isLayoutSection,
  isLayoutTabs,
  layoutCells,
} from '../config/dashboard-config.model';
import { compileComposition } from '../config/composition-compiler';
import { isComposition } from '../config/composition.model';
import { planDashboard } from './query-planner';

const STORAGE_VERSION = 1;
const KEY_PREFIX = 'nxd.config';

interface StoredOverride {
  v: number;
  /** The configuration as the administrator wrote it, formatting included. */
  json: string;
}

/**
 * Keeps an administrator's edited dashboard configuration.
 *
 * `localStorage`, for now, exactly as the filter selections are: the resolution order in
 * `DashboardConfigService` is what lets this be swapped for a Nuxeo document later without any
 * caller noticing. The limitation is stated rather than hidden — an edited dashboard stays on the
 * machine it was edited on, and the editor says so.
 *
 * The raw text is stored rather than the parsed object, so that indentation, key order and
 * comments-by-convention survive a round trip through the editor.
 */
@Injectable({ providedIn: 'root' })
export class DashboardOverrideService {
  /** Raw text of the override, or null when the shipped configuration is in force. */
  read(dashboardId: string): string | null {
    const raw = this.readRaw(this.key(dashboardId));
    if (!raw) {
      return null;
    }

    try {
      const stored = JSON.parse(raw) as StoredOverride;
      return stored?.v === STORAGE_VERSION && typeof stored.json === 'string' ? stored.json : null;
    } catch {
      return null;
    }
  }

  write(dashboardId: string, json: string): void {
    const stored: StoredOverride = { v: STORAGE_VERSION, json };
    try {
      globalThis.localStorage?.setItem(this.key(dashboardId), JSON.stringify(stored));
    } catch {
      // Quota exceeded or storage disabled: the edit simply will not survive a reload.
    }
  }

  clear(dashboardId: string): void {
    try {
      globalThis.localStorage?.removeItem(this.key(dashboardId));
    } catch {
      // Storage unavailable; nothing to clear.
    }
  }

  private key(dashboardId: string): string {
    return `${KEY_PREFIX}.${dashboardId}`;
  }

  private readRaw(key: string): string | null {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
}

export interface ValidationResult {
  config: DashboardConfig | null;
  /** Empty when the configuration is usable. */
  problems: string[];
}

/**
 * Decides whether a configuration can be rendered, using the very planner that will render it.
 *
 * Reimplementing the rules here would let the two drift, and the drift would show as a dashboard
 * that saves cleanly and then displays nothing. `planDashboard` already reports a message per
 * widget it cannot compile, which is exactly what an editor has to show.
 *
 * Both forms are accepted. A composition — the form that names library widgets — is compiled
 * first and then held to exactly the same checks, so the editor cannot approve something the page
 * would refuse, whichever way it was written.
 */
export function validateConfig(json: string, expectedId: string): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return { config: null, problems: [`Not valid JSON: ${describe(error)}`] };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { config: null, problems: ['A dashboard configuration must be a JSON object.'] };
  }

  if (isComposition(parsed)) {
    const compiled = compileComposition(parsed);
    if (!compiled.config) {
      return compiled;
    }
    return validateCompiled(compiled.config, expectedId);
  }

  return validateCompiled(parsed as DashboardConfig, expectedId);
}

function validateCompiled(config: DashboardConfig, expectedId: string): ValidationResult {
  const problems: string[] = [];

  if (config.id !== expectedId) {
    problems.push(`"id" must stay "${expectedId}", so the page keeps loading this configuration.`);
  }
  if (!config.index) {
    problems.push('"index" is required: nuxeo, audit or audit_wf.');
  }
  if (!Array.isArray(config.layout) || config.layout.length === 0) {
    problems.push('"layout" must list at least one row.');
  }
  if (!config.widgets || typeof config.widgets !== 'object') {
    problems.push('"widgets" is required.');
  }

  if (problems.length) {
    return { config: null, problems };
  }

  problems.push(...layoutProblems(config.layout));
  if (problems.length) {
    return { config: null, problems };
  }

  // Cells and widgets have to match, which the planner cannot report: it only walks the layout.
  const referenced = new Set(layoutCells(config.layout));
  const declared = new Set(Object.keys(config.widgets));
  for (const id of referenced) {
    if (!declared.has(id)) {
      problems.push(`Layout names "${id}", which no widget declares.`);
    }
  }
  for (const id of declared) {
    if (!referenced.has(id)) {
      problems.push(`Widget "${id}" is declared but no layout row shows it.`);
    }
  }

  try {
    for (const [widgetId, message] of planDashboard(config, defaultFilterState(config)).errors) {
      problems.push(`${widgetId}: ${message}`);
    }
  } catch (error) {
    problems.push(describe(error));
  }

  return { config: problems.length ? null : config, problems };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Checks the shape of the layout grammar, which the planner never sees.
 *
 * `layoutCells` walks whatever it is given and simply finds nothing in a malformed node, so a
 * mistyped `tabs` would otherwise save cleanly and render an empty page. Naming it here is the
 * whole point of validating against the real planner *and* against the grammar: one catches a
 * widget that cannot be compiled, the other a container that holds nothing.
 */
function layoutProblems(nodes: LayoutNode[]): string[] {
  const problems: string[] = [];

  const checkRows = (rows: LayoutRow[] | undefined, inside: string): void => {
    if (!Array.isArray(rows) || rows.length === 0) {
      problems.push(`${inside} needs a "rows" list holding at least one row.`);
      return;
    }
    rows.forEach((row, index) => {
      if (!Array.isArray(row?.cells)) {
        problems.push(`Row ${index + 1} of ${inside} needs a "cells" list.`);
      }
    });
  };

  nodes.forEach((node, index) => {
    const position = `Layout entry ${index + 1}`;

    if (!node || typeof node !== 'object') {
      problems.push(`${position} is not an object.`);
      return;
    }
    if (isLayoutRow(node)) {
      if (!Array.isArray(node.cells)) {
        problems.push(`${position} has a "cells" that is not a list.`);
      }
      return;
    }
    if (isLayoutSection(node)) {
      if (typeof node.section !== 'string' || !node.section.trim()) {
        problems.push(`${position} is a section with no title.`);
      }
      checkRows(node.rows, `section "${node.section}"`);
      return;
    }
    if (isLayoutTabs(node)) {
      if (!Array.isArray(node.tabs) || node.tabs.length === 0) {
        problems.push(`${position} is a "tabs" holding no tab.`);
        return;
      }
      node.tabs.forEach((tab, tabIndex) => {
        const named = typeof tab?.label === 'string' && tab.label.trim();
        if (!named) {
          problems.push(`Tab ${tabIndex + 1} of ${position} has no "label".`);
        }
        checkRows(tab?.rows, `tab "${named || tabIndex + 1}"`);
      });
      return;
    }

    problems.push(
      `${position} is none of the three a layout accepts: a row with "cells", ` +
        'a "section" with rows, or a "tabs" with labelled panels.',
    );
  });

  return problems;
}
