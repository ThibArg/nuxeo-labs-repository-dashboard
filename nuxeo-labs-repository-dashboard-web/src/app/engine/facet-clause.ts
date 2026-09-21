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
  BucketPick,
  DashboardConfig,
  FilterState,
  GroupSelection,
  LabelStrategy,
  SELECT_ALL,
  TermsGroupConfig,
  TermsMemberConfig,
  dashboardIndices,
  dateRangeFilter,
  pathScopeFilter,
  termsGroups,
} from '../config/dashboard-config.model';
import { principalForms } from '../core/principal';
import { EsIndex } from '../core/nuxeo.types';
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
function clauseValues(labels: LabelStrategy | undefined, values: string[]): string[] {
  if (labels !== 'user') {
    return values;
  }
  return [...new Set(values.flatMap(principalForms))];
}

function termsClause(field: string, labels: LabelStrategy | undefined, values: string[]): EsClause {
  return { terms: { [field]: clauseValues(labels, values) } };
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
    return termsClause(active[0].member.field, active[0].member.labels, active[0].values);
  }

  const clauses = active.map((entry) =>
    termsClause(entry.member.field, entry.member.labels, entry.values),
  );

  return group.combine === 'and'
    ? { bool: { must: clauses } }
    : { bool: { should: clauses, minimum_should_match: 1 } };
}

/**
 * Compiles the constraints picked by clicking buckets.
 *
 * One clause per field, so two picks on the same field are alternatives rather than an
 * impossibility: nothing is at once a `File` and a `Note`, and a reader clicking both means "either
 * of these". Across fields the clauses stack, which is the ordinary reading of two filters.
 *
 * A pick carries the index of the chart it came from, and constrains that index alone. Clicking a
 * document type on a repository chart says nothing an audit entry could answer, and sending it
 * there would not widen the audit half but empty it.
 */
export function compilePicks(picks: BucketPick[], index?: EsIndex): EsClause[] {
  const byField = new Map<string, { labels: LabelStrategy | undefined; values: string[] }>();

  for (const pick of picks) {
    if (index !== undefined && pick.index !== undefined && pick.index !== index) {
      continue;
    }
    const entry = byField.get(pick.field) ?? { labels: pick.labels, values: [] };
    entry.values.push(pick.value);
    byField.set(pick.field, entry);
  }

  return [...byField].map(([field, entry]) => termsClause(field, entry.labels, entry.values));
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

/**
 * One phrase per constraint in force, for a reader who will see the figures out of context.
 *
 * An exported page outlives the screen it was taken from: a mail attachment showing 675 documents
 * says nothing unless it also says which 675. Every filter that narrowed them is named, including
 * the ones the filter bar shows as a button rather than as text.
 */
export function describeFilters(config: DashboardConfig, state: FilterState): string[] {
  const lines: string[] = [];
  const pageIndices = dashboardIndices(config);

  const range = dateRangeFilter(config);
  if (range) {
    /*
     * Every field the period actually constrains, not just the primary one. A mixed page bounds
     * `dc:created` on one half and `eventDate` on the other, and an exported sheet claiming
     * `dc:created` over an audit chart describes a filter that was never applied to it. An index
     * mapped to the empty string contributes nothing: it is unconstrained, and naming a field for
     * it would be naming one nothing was filtered on.
     */
    const fields = [
      ...new Set(pageIndices.map((index) => range.byIndex?.[index] ?? range.field)),
    ].filter((field) => !!field);
    if (fields.length) {
      lines.push(`Period: ${state.range.label} on ${fields.join(' and ')}`);
    }
  }

  if (state.path) {
    const scope = pathScopeFilter(config);
    lines.push(
      `Location: ${state.path} and everything inside it${only(scope?.indices, pageIndices)}`,
    );
  }

  for (const group of termsGroups(config)) {
    const active = activeMembers(group, state.groups[group.id] ?? {});
    const suffix = only(group.indices, pageIndices);
    for (const entry of active) {
      lines.push(`${group.label} — ${entry.member.label}: ${entry.values.join(', ')}${suffix}`);
    }
  }

  for (const pick of state.picks) {
    const suffix = only(pick.index ? [pick.index] : undefined, pageIndices);
    lines.push(`${pick.field}: ${pick.label}${suffix}`);
  }

  return lines;
}

/**
 * Names the half a constraint applies to, and only where there is more than one half.
 *
 * A reader of an exported sheet is entitled to know that a document type narrowed the repository
 * figures and left the audit ones alone. On the single-index pages that ship there is nothing to
 * say, so nothing is said.
 */
function only(indices: EsIndex[] | undefined, pageIndices: EsIndex[]): string {
  if (pageIndices.length < 2 || !indices?.length || indices.length >= pageIndices.length) {
    return '';
  }
  return ` (${indices.join(', ')} only)`;
}
