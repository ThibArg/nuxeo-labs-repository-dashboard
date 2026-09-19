import { Injectable, inject } from '@angular/core';
import { LabelStrategy } from '../config/dashboard-config.model';
import { NuxeoHttpService } from './nuxeo-http.service';
import { parsePrincipal } from './principal';

interface NxUserEntity {
  id: string;
  properties?: { firstName?: string | null; lastName?: string | null; username?: string | null };
}

interface NxGroupEntity {
  id?: string;
  name?: string;
  /** Sits at the root of the entity; `properties.grouplabel` is null when none was set. */
  grouplabel?: string | null;
}

interface NxDocumentEntity {
  uid?: string;
  /** At the root of the entity, and falling back to the document name when `dc:title` is unset. */
  title?: string | null;
}

/** How many lookups run at once, to avoid flooding the server on a wide `dc:creator` facet. */
const LOOKUP_CONCURRENCY = 6;

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
 * Workflow values are already i18n keys when they come out of the audit: `extended.taskName` reads
 * `wf.parallelDocumentReview.chooseParticipants.title` and `extended.action` names a button key,
 * both of which the bundle translates as they stand. A model name is not a key but composes into
 * one, `wf.<name with a lower case initial>.<name>`, which is how Web UI's own workflow layouts
 * address it.
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
  private readonly documentCache = new Map<string, Promise<string>>();

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

  /** A value that is already an i18n key, such as `extended.taskName`. */
  translateMessage(key: string): string {
    return this.lookup(key, key);
  }

  /**
   * Translates a workflow model name, falling back to its words rather than to its identifier.
   *
   * Studio writes the `wf.<name with a lower case initial>.<name>` key into the model's `dc:title`
   * at generation time; nothing in the platform composes it, and the bundle that holds it belongs
   * to the Studio project rather than to Web UI. A model whose project is not deployed here — and
   * Nuxeo's own test fixtures, which carry a literal title — therefore resolves to nothing, and
   * `ClaimReview` would sit next to `Parallel Document Review`. Splitting the identifier is a
   * poorer answer than a translation, and a much better one than showing the identifier.
   */
  translateWorkflowModel(name: string): string {
    const key = `wf.${name.charAt(0).toLowerCase()}${name.slice(1)}.${name}`;
    return this.lookup(key, splitIdentifier(name));
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

      case 'message':
        await this.loadMessages();
        unique.forEach((key) => labels.set(key, this.translateMessage(key)));
        return labels;

      case 'workflowModel':
        await this.loadMessages();
        unique.forEach((key) => labels.set(key, this.translateWorkflowModel(key)));
        return labels;

      case 'user':
        return this.resolvePrincipals(unique);

      case 'document':
        return this.resolveDocuments(unique);

      case 'raw':
      case undefined:
      default:
        return labels;
    }
  }

  /**
   * Looks principals up through the REST API, caching both hits and misses.
   *
   * It is keyed by the raw value, so `jdoe` and `user:jdoe` are two entries resolving to one label.
   */
  async resolvePrincipals(ids: string[]): Promise<Map<string, string>> {
    return this.resolveCached(this.userCache, ids, (id) => this.fetchPrincipalLabel(id));
  }

  /**
   * Names the documents a set of uuids points at, for a field holding document references.
   *
   * `record:ruleIds` is the case in hand: it holds the uuid of the `RetentionRule` that made a
   * document a record, and a chart grouped by it would otherwise render bare uuids.
   */
  async resolveDocuments(ids: string[]): Promise<Map<string, string>> {
    return this.resolveCached(this.documentCache, ids, (id) => this.fetchDocumentLabel(id));
  }

  /**
   * Resolves ids through a cache holding the in-flight promise rather than the answer.
   *
   * Several widgets resolve their buckets in parallel, so caching the answer would let three
   * charts naming the same author each issue their own request: none of them has returned when
   * the others start. Registering the promise before the first await is what makes a concurrent
   * caller join instead of refetching.
   */
  private async resolveCached(
    cache: Map<string, Promise<string>>,
    ids: string[],
    fetch: (id: string) => Promise<string>,
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    const missing = unique.filter((id) => !cache.has(id));

    for (let i = 0; i < missing.length; i += LOOKUP_CONCURRENCY) {
      const slice = missing.slice(i, i + LOOKUP_CONCURRENCY);
      slice.forEach((id) => cache.set(id, fetch(id)));
      await Promise.all(slice.map((id) => cache.get(id)!));
    }

    const labels = new Map<string, string>();
    await Promise.all(
      unique.map(async (id) => {
        labels.set(id, await cache.get(id)!);
      }),
    );
    return labels;
  }

  private async fetchPrincipalLabel(raw: string): Promise<string> {
    const { group, name } = parsePrincipal(raw);
    try {
      if (group) {
        const entity = await this.http.get<NxGroupEntity>(`group/${encodeURIComponent(name)}`);
        return entity.grouplabel?.trim() || name;
      }
      const user = await this.http.get<NxUserEntity>(`user/${encodeURIComponent(name)}`);
      const fullName = [user.properties?.firstName, user.properties?.lastName]
        .filter(Boolean)
        .join(' ')
        .trim();
      return fullName || name;
    } catch {
      // Deleted principal, or a technical one such as "system": show the bare name, never a prefix.
      return name;
    }
  }

  private async fetchDocumentLabel(uuid: string): Promise<string> {
    try {
      const document = await this.http.get<NxDocumentEntity>(`id/${encodeURIComponent(uuid)}`);
      return document.title?.trim() || uuid;
    } catch {
      // A rule deleted after the records it governs keeps its uuid in `record:ruleIds`, and the
      // server answers 404. The uuid is a poor label but an honest one.
      return uuid;
    }
  }
}

/**
 * Reads the `user:` or `group:` prefix Nuxeo puts on a task assignee.
 *
 * `nt:actors` holds prefixed identifiers — the parameter is literally named `prefixedActorIds` in
 * `CreateTaskUnrestricted` — so looking `user:jdoe` up as a user id answers a 404 and the chart
 * falls back to showing the prefix. A bare value is treated as a user, which is what `dc:creator`
 * and the audit's `principalName` hold. See `core/principal.ts` for why both forms exist.
 */

/**
 * Splits a CamelCase identifier into words: `ClaimReview` reads `Claim Review`.
 *
 * The second replacement keeps an initialism whole, so `HRRequest` becomes `HR Request` rather
 * than `H R Request`. An identifier already containing a space or an underscore is left alone,
 * since whoever named it that way meant it.
 */
function splitIdentifier(name: string): string {
  if (/[\s_-]/.test(name)) {
    return name;
  }
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}
