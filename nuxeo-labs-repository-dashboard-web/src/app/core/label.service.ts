import { Injectable, inject } from '@angular/core';
import { LabelStrategy } from '../config/dashboard-config.model';
import { NuxeoHttpService } from './nuxeo-http.service';

interface NxUserEntity {
  id: string;
  properties?: { firstName?: string | null; lastName?: string | null; username?: string | null };
}

/** How many user lookups run at once, to avoid flooding the server on a wide `dc:creator` facet. */
const USER_LOOKUP_CONCURRENCY = 6;

/**
 * Resolves raw aggregation keys into readable labels.
 *
 * Document types and lifecycle states reuse Web UI's own translation bundle, served statically at
 * `/nuxeo/ui/i18n/messages.json`, with the same key conventions and the same fallback as
 * `nuxeo-format-behavior.js`:
 *
 *   formatDocType(type)        -> label.document.type.<type in lower case>
 *   formatLifecycleState(state) -> label.ui.state.<state>
 *
 * When a key is missing, or Web UI is not installed at all, the raw value is displayed. That is a
 * deliberate degradation: an administrator reading `File` rather than a translated label still
 * gets a correct dashboard.
 */
@Injectable({ providedIn: 'root' })
export class LabelService {
  private readonly http = inject(NuxeoHttpService);

  private messages: Record<string, string> | null = null;
  private messagesPromise: Promise<void> | null = null;

  private readonly userCache = new Map<string, string>();

  /** Loads Web UI's translation bundle once. Failures are swallowed on purpose. */
  async loadMessages(): Promise<void> {
    if (this.messages) {
      return;
    }
    this.messagesPromise ??= this.http
      .getStatic<Record<string, string>>('ui/i18n/messages.json')
      .then((messages) => {
        this.messages = messages;
      })
      .catch(() => {
        // Web UI absent or the bundle moved: fall back to raw keys.
        this.messages = {};
      });
    return this.messagesPromise;
  }

  translateDocType(type: string): string {
    return this.lookup(`label.document.type.${type.toLowerCase()}`, type);
  }

  translateLifecycle(state: string): string {
    return this.lookup(`label.ui.state.${state}`, state);
  }

  private lookup(key: string, fallback: string): string {
    const translated = this.messages?.[key];
    return translated && translated !== key ? translated : fallback;
  }

  /**
   * Resolves keys according to a strategy.
   *
   * @returns a map from raw key to label, containing only the keys that resolved to something
   *          different from themselves.
   */
  async resolve(strategy: LabelStrategy | undefined, keys: string[]): Promise<Map<string, string>> {
    const labels = new Map<string, string>();
    const unique = [...new Set(keys)].filter((key) => key !== '');

    switch (strategy) {
      case 'doctype':
        await this.loadMessages();
        unique.forEach((key) => labels.set(key, this.translateDocType(key)));
        return labels;

      case 'lifecycle':
        await this.loadMessages();
        unique.forEach((key) => labels.set(key, this.translateLifecycle(key)));
        return labels;

      case 'boolean':
        unique.forEach((key) => labels.set(key, key === 'true' || key === '1' ? 'Yes' : 'No'));
        return labels;

      case 'user':
        return this.resolveUsers(unique);

      case 'raw':
      case undefined:
      default:
        return labels;
    }
  }

  /** Looks users up through the REST API, caching both hits and misses. */
  async resolveUsers(ids: string[]): Promise<Map<string, string>> {
    const labels = new Map<string, string>();
    const pending = ids.filter((id) => {
      const cached = this.userCache.get(id);
      if (cached !== undefined) {
        labels.set(id, cached);
        return false;
      }
      return true;
    });

    for (let i = 0; i < pending.length; i += USER_LOOKUP_CONCURRENCY) {
      const slice = pending.slice(i, i + USER_LOOKUP_CONCURRENCY);
      const resolved = await Promise.all(slice.map((id) => this.fetchUserLabel(id)));
      slice.forEach((id, index) => {
        const label = resolved[index];
        this.userCache.set(id, label);
        labels.set(id, label);
      });
    }

    return labels;
  }

  private async fetchUserLabel(id: string): Promise<string> {
    try {
      const user = await this.http.get<NxUserEntity>(`user/${encodeURIComponent(id)}`);
      const fullName = [user.properties?.firstName, user.properties?.lastName]
        .filter(Boolean)
        .join(' ')
        .trim();
      return fullName || id;
    } catch {
      // Deleted user, or a technical principal such as "system": show the raw id.
      return id;
    }
  }
}
