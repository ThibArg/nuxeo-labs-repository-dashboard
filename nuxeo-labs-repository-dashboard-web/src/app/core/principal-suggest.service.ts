import { Injectable, inject } from '@angular/core';
import { NuxeoHttpService } from './nuxeo-http.service';

/** What the picker shows for one suggestion. */
export interface SuggestedPrincipal {
  /** Prefixed identifier, which is the form `nt:actors` stores. */
  id: string;
  label: string;
  group: boolean;
}

interface SuggestionEntry {
  id?: string;
  prefixed_id?: string;
  displayLabel?: string;
  type?: string;
}

/** Same threshold and delay as Web UI's own picker, so the two behave alike. */
export const SUGGEST_MIN_CHARS = 3;
export const SUGGEST_DEBOUNCE_MS = 300;

/**
 * Searches users and groups in the directory, as the reader types.
 *
 * The filter dialog lists the values an aggregation returned, which answers "who is busiest" but
 * can never answer "where is Kate" past the top N. This fills that gap by asking the directory
 * instead of the index — and the two remain complementary, since the directory knows nothing of
 * document counts and the index knows nothing of people who have no task.
 *
 * `UserGroup.Suggestion` is what `nuxeo-user-suggestion` calls. It returns both users and groups
 * in one request, composes `displayLabel` server side according to that server's own settings, and
 * hands back `prefixed_id` — precisely the form `nt:actors` stores.
 */
@Injectable({ providedIn: 'root' })
export class PrincipalSuggestService {
  private readonly http = inject(NuxeoHttpService);

  private pending: AbortController | null = null;

  /**
   * @returns the matches, or an empty list when the term is too short to be worth a request.
   */
  async suggest(term: string): Promise<SuggestedPrincipal[]> {
    const searchTerm = term.trim();
    if (searchTerm.length < SUGGEST_MIN_CHARS) {
      this.cancel();
      return [];
    }

    // A reply that is no longer wanted would otherwise overwrite a later one.
    this.cancel();
    const controller = new AbortController();
    this.pending = controller;

    try {
      const entries = await this.http.operation<SuggestionEntry[]>(
        'UserGroup.Suggestion',
        { searchTerm, searchType: 'USER_GROUP_TYPE' },
        controller.signal,
      );
      return (Array.isArray(entries) ? entries : []).map((entry) => toPrincipal(entry));
    } catch {
      // Aborted, offline, or an operation this server does not expose: the list stays empty.
      return [];
    } finally {
      if (this.pending === controller) {
        this.pending = null;
      }
    }
  }

  cancel(): void {
    this.pending?.abort();
    this.pending = null;
  }
}

function toPrincipal(entry: SuggestionEntry): SuggestedPrincipal {
  const group = entry.type === 'GROUP_TYPE';
  const id = entry.prefixed_id ?? `${group ? 'group' : 'user'}:${entry.id ?? ''}`;
  return { id, label: entry.displayLabel || entry.id || id, group };
}
