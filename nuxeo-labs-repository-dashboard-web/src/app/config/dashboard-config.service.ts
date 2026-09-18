import { Injectable, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { DashboardConfig } from './dashboard-config.model';

/**
 * Loads dashboard configurations.
 *
 * For now they are static assets shipped with the bundle. The resolution order is already in
 * place so that a later phase can let an administrator override a dashboard at runtime by storing
 * JSON in a Nuxeo document, without changing any caller.
 */
@Injectable({ providedIn: 'root' })
export class DashboardConfigService {
  private readonly document = inject(DOCUMENT);
  private readonly cache = new Map<string, Promise<DashboardConfig>>();

  load(id: string): Promise<DashboardConfig> {
    let pending = this.cache.get(id);
    if (!pending) {
      pending = this.fetchBundled(id);
      this.cache.set(id, pending);
    }
    return pending;
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
