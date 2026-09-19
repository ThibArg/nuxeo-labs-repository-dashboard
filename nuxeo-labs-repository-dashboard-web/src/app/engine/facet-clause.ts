/**
 * Compiles a group of term lists into a single OpenSearch clause.
 *
 * Members of a group are alternative classifications of the same dimension, so they are combined
 * with OR. The rule that makes this work is that an unconstrained member contributes *nothing*
 * to the union: were a fully selected member to emit `terms(field, [every value])`, it would
 * swallow whatever its siblings express, and a facet filter would silently do nothing while all
 * document types stayed checked.
 */
import {
  FilterState,
  GroupSelection,
  SELECT_ALL,
  TermsGroupConfig,
  TermsMemberConfig,
} from '../config/dashboard-config.model';
import { principalForms } from '../core/principal';
import { EsClause } from './es-query';

export interface ActiveMember {
  member: TermsMemberConfig;
  values: string[];
}

/** Members carrying an actual constraint, in declaration order. */
export function activeMembers(group: TermsGroupConfig, selection: GroupSelection): ActiveMember[] {
  const active: ActiveMember[] = [];

  for (const member of group.members) {
    const current = selection[member.id] ?? SELECT_ALL;
    if (current.mode === 'subset' && current.values.length > 0) {
      active.push({ member, values: current.values });
    }
  }

  return active;
}

/**
 * Expands a selection into the clause values that will actually match.
 *
 * A principal reaches the index under two forms, so selecting one person must search for both —
 * exactly what `TaskActorsHelper` does on the platform side. Both are always emitted rather than
 * only the forms already seen, because a reassignment rewrites the stored form after the value
 * list was built. See `core/principal.ts`.
 */
function clauseValues(member: TermsMemberConfig, values: string[]): string[] {
  if (member.labels !== 'user') {
    return values;
  }
  return [...new Set(values.flatMap(principalForms))];
}

function termsClause(member: TermsMemberConfig, values: string[]): EsClause {
  return { terms: { [member.field]: clauseValues(member, values) } };
}

/**
 * @returns the clause for this group, or `null` when no member is constrained.
 */
export function compileTermsGroup(group: TermsGroupConfig, state: FilterState): EsClause | null {
  const active = activeMembers(group, state.groups[group.id] ?? {});

  if (active.length === 0) {
    return null;
  }

  // A single constrained member needs no boolean wrapper.
  if (active.length === 1) {
    return termsClause(active[0].member, active[0].values);
  }

  const clauses = active.map((entry) => termsClause(entry.member, entry.values));

  return group.combine === 'and'
    ? { bool: { must: clauses } }
    : { bool: { should: clauses, minimum_should_match: 1 } };
}

/**
 * Plain language rendering of a group's selection, shown in the dialog so that the OR is never
 * a hidden surprise.
 *
 * @param labels member id to (raw value -> label)
 */
export function describeTermsGroup(
  group: TermsGroupConfig,
  selection: GroupSelection,
  labels: Map<string, Map<string, string>> = new Map(),
): string {
  const active = activeMembers(group, selection);

  if (active.length === 0) {
    return 'Including: all documents.';
  }

  const joiner = group.combine === 'and' ? ' and ' : ' or ';

  const parts = active.map((entry) => {
    const resolved = entry.values.map((value) => labels.get(entry.member.id)?.get(value) ?? value);
    return `${entry.member.label.toLowerCase()} ${listPhrase(resolved, joiner)}`;
  });

  return `Including: ${parts.join(joiner)}.`;
}

/** `a`, `a or b`, `a, b or c`, and beyond a threshold `a, b, c, d and 3 more`. */
function listPhrase(values: string[], joiner: string): string {
  const MAX = 4;
  if (values.length === 0) {
    return '';
  }
  if (values.length === 1) {
    return values[0];
  }
  if (values.length <= MAX) {
    return `${values.slice(0, -1).join(', ')}${joiner}${values[values.length - 1]}`;
  }
  return `${values.slice(0, MAX).join(', ')} and ${values.length - MAX} more`;
}
