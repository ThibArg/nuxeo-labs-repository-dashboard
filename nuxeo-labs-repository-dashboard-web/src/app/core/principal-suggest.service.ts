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
 * Most people and groups the directory is asked to list for one term.
 *
 * Without it the operation reads every user matching the term: a directory does not always apply
 * its own `querySizeLimit` (the SQL one ignores it on the query-builder path the operation takes,
 * `SQLSession.doQuery`), so three letters could load thousands of entries to fill a list nobody
 * scrolls. With it the users are read up to one past the limit. The
 * groups are searched whole either way, the operation applying no limit to them.
 */
export const SUGGEST_MAX_RESULTS = 20;

/** What the directory answered for one term. */
export interface Suggestions {
  principals: SuggestedPrincipal[];
  /** More matched than the limit, in which case the directory lists none of them. */
  tooMany: boolean;
}

const NONE: Suggestions = { principals: [], tooMany: false };

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
   * @returns the matches, or none when the term is too short to be worth a request.
   */
  async suggest(term: string): Promise<Suggestions> {
    const searchTerm = term.trim();
    if (searchTerm.length < SUGGEST_MIN_CHARS) {
      this.cancel();
      return NONE;
    }

    // A reply that is no longer wanted would otherwise overwrite a later one.
    this.cancel();
    const controller = new AbortController();
    this.pending = controller;

    try {
      const entries = await this.http.operation<SuggestionEntry[]>(
        'UserGroup.Suggestion',
        {
          searchTerm,
          searchType: 'USER_GROUP_TYPE',
          userSuggestionMaxSearchResults: SUGGEST_MAX_RESULTS,
        },
        controller.signal,
      );
      const listed = Array.isArray(entries) ? entries : [];
      /*
       * Past the limit the operation lists nobody: it answers a single entry carrying a label and
       * no identifier, "Please narrow your search." (`SuggestUserEntries.searchOverflowMessage`).
       * Offered as it stands, it would be a person to tick, whose identifier is "user:".
       */
      const principals = listed.filter((entry) => entry.id || entry.prefixed_id).map(toPrincipal);
      return { principals, tooMany: principals.length < listed.length };
    } catch {
      // Aborted, offline, or an operation this server does not expose: the list stays empty.
      return NONE;
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
