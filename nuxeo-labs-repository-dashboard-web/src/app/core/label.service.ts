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

  private readonly userCache = new Map<string, Promise<string>>();

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

  /**
   * Looks users up through the REST API, caching both hits and misses.
   *
   * The cache holds the in-flight promise rather than the answer, because several widgets resolve
   * their buckets in parallel: caching the answer would let three charts naming the same author
   * each issue their own request, since none of them has returned yet when the others start.
   */
  async resolveUsers(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    const missing = unique.filter((id) => !this.userCache.has(id));

    for (let i = 0; i < missing.length; i += USER_LOOKUP_CONCURRENCY) {
      const slice = missing.slice(i, i + USER_LOOKUP_CONCURRENCY);
      // Registered before the first await, so a concurrent caller joins instead of refetching.
      slice.forEach((id) => this.userCache.set(id, this.fetchUserLabel(id)));
      await Promise.all(slice.map((id) => this.userCache.get(id)!));
    }

    const labels = new Map<string, string>();
    await Promise.all(
      unique.map(async (id) => {
        labels.set(id, await this.userCache.get(id)!);
      }),
    );
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
