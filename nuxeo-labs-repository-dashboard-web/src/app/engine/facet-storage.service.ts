import { Injectable } from '@angular/core';
import {
  GroupSelection,
  SELECT_ALL,
  TermsGroupConfig,
  TermsSelection,
} from '../config/dashboard-config.model';

const STORAGE_VERSION = 1;
const KEY_PREFIX = 'nxd.filters';

interface StoredMember {
  /** Recorded so that a configuration pointing at another field discards the stale value. */
  field: string;
  selection: TermsSelection;
}

interface StoredGroup {
  v: number;
  members: Record<string, StoredMember>;
}

/**
 * Persists filter group selections in `localStorage`, per dashboard.
 *
 * Two details matter.
 *
 * `{ mode: 'all' }` is stored as such rather than as the explicit list of every current value:
 * a document type created later must be included automatically, not silently excluded by a
 * snapshot taken today.
 *
 * The field of each member is recorded. If the dashboard configuration is later pointed at
 * another field, the stored values would express a filter on the wrong dimension, so they are
 * discarded instead.
 */
@Injectable({ providedIn: 'root' })
export class FacetStorageService {
  read(dashboardId: string, group: TermsGroupConfig): GroupSelection {
    const empty = this.emptySelection(group);
    const raw = this.readRaw(this.key(dashboardId, group.id));
    if (!raw) {
      return empty;
    }

    let stored: StoredGroup;
    try {
      stored = JSON.parse(raw) as StoredGroup;
    } catch {
      return empty;
    }

    if (stored?.v !== STORAGE_VERSION || typeof stored.members !== 'object') {
      return empty;
    }

    const selection: GroupSelection = { ...empty };
    for (const member of group.members) {
      const entry = stored.members[member.id];
      if (!entry || entry.field !== member.field || !isValidSelection(entry.selection)) {
        continue;
      }
      selection[member.id] = entry.selection;
    }
    return selection;
  }

  write(dashboardId: string, group: TermsGroupConfig, selection: GroupSelection): void {
    const stored: StoredGroup = {
      v: STORAGE_VERSION,
      members: Object.fromEntries(
        group.members.map((member) => [
          member.id,
          { field: member.field, selection: selection[member.id] ?? SELECT_ALL },
        ]),
      ),
    };
    this.writeRaw(this.key(dashboardId, group.id), JSON.stringify(stored));
  }

  clear(dashboardId: string, group: TermsGroupConfig): void {
    try {
      globalThis.localStorage?.removeItem(this.key(dashboardId, group.id));
    } catch {
      // Storage unavailable; nothing to clear.
    }
  }

  private emptySelection(group: TermsGroupConfig): GroupSelection {
    return Object.fromEntries(group.members.map((member) => [member.id, SELECT_ALL]));
  }

  private key(dashboardId: string, groupId: string): string {
    return `${KEY_PREFIX}.${dashboardId}.${groupId}`;
  }

  /** Private browsing and hardened profiles can make `localStorage` throw on access. */
  private readRaw(key: string): string | null {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  private writeRaw(key: string, value: string): void {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // Quota exceeded or storage disabled: the selection simply will not survive a reload.
    }
  }
}

function isValidSelection(selection: unknown): selection is TermsSelection {
  if (!selection || typeof selection !== 'object') {
    return false;
  }
  const candidate = selection as TermsSelection;
  if (candidate.mode === 'all') {
    return true;
  }
  return (
    candidate.mode === 'subset' &&
    Array.isArray(candidate.values) &&
    candidate.values.every((value) => typeof value === 'string')
  );
}
