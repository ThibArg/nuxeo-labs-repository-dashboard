import { Injectable } from '@angular/core';
import { DashboardConfig, defaultFilterState } from '../config/dashboard-config.model';
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

  const config = parsed as DashboardConfig;
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

  // Cells and widgets have to match, which the planner cannot report: it only walks the layout.
  const referenced = new Set(config.layout.flatMap((row) => row.cells ?? []));
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
