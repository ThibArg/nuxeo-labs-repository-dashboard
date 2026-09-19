import { Injectable, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { DashboardOverrideService, validateConfig } from '../engine/dashboard-override.service';
import { DashboardConfig } from './dashboard-config.model';

/**
 * Loads dashboard configurations, an administrator's edit taking precedence over the shipped one.
 *
 * The override lives in `localStorage` today; the resolution happens here so that moving it into a
 * Nuxeo document later changes nothing for any caller.
 *
 * An override that no longer compiles is **ignored rather than rendered broken**. A configuration
 * can stop working without being touched — a widget may name a field a later Studio change
 * removed — and a dashboard that silently falls back to what ships is far better than a column of
 * errors nobody can escape from. The editor is where the reason is shown.
 */
@Injectable({ providedIn: 'root' })
export class DashboardConfigService {
  private readonly document = inject(DOCUMENT);
  private readonly overrides = inject(DashboardOverrideService);
  private readonly cache = new Map<string, Promise<DashboardConfig>>();

  load(id: string): Promise<DashboardConfig> {
    let pending = this.cache.get(id);
    if (!pending) {
      pending = this.resolve(id);
      this.cache.set(id, pending);
    }
    return pending;
  }

  /** True when the page is showing an administrator's edit rather than what ships. */
  isOverridden(id: string): boolean {
    const raw = this.overrides.read(id);
    return raw !== null && validateConfig(raw, id).config !== null;
  }

  private async resolve(id: string): Promise<DashboardConfig> {
    const raw = this.overrides.read(id);
    const edited = raw === null ? null : validateConfig(raw, id).config;
    return edited ?? this.fetchBundled(id);
  }

  /** Drops the cache so that a refresh picks up an edited configuration. */
  invalidate(id?: string): void {
    if (id) {
      this.cache.delete(id);
    } else {
      this.cache.clear();
    }
  }

  private async fetchBundled(id: string): Promise<DashboardConfig> {
    // Relative to <base href>, so it works both under /nuxeo/dashboard/ and under ng serve.
    const base = this.document.querySelector('base')?.getAttribute('href') ?? '/';
    const url = `${base.replace(/\/*$/, '/')}assets/dashboards/${id}.json`;

    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) {
      throw new Error(`No dashboard configuration named "${id}" (${response.status} on ${url})`);
    }
    return (await response.json()) as DashboardConfig;
  }
}
