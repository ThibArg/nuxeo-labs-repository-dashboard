/**
 * The two forms a Nuxeo principal takes, and how to reconcile them.
 *
 * `nt:actors` has neither a resolver nor any normalisation, so the platform writes verbatim what
 * the workflow node's expression produced. Two sources coexist, and they alternate *within a
 * single workflow instance*: a node assigning `workflowInitiator` stores a bare name, because
 * `getActingUser()` returns one, while a node assigning a variable fed by Web UI's picker stores a
 * prefixed one, because that widget carries the `prefixed` attribute. In `ParallelDocumentReview`,
 * "Choose Participants" and "Consolidate" are bare while "Give Opinion" is prefixed. A
 * reassignment then rewrites the list bare again (`TaskServiceImpl.java:539`), so the same task
 * changes form over its lifetime.
 *
 * The platform copes by querying both at once: `TaskActorsHelper.getTaskActors()` builds "prefixed
 * and unprefixed names of the principal and all its groups", and six page providers feed it to
 * `nt:actors/* IN ?`. Every "My tasks" screen in Nuxeo therefore searches both forms. A dashboard
 * that aggregates the field has to do the same, or it reports one person twice.
 *
 * The prefix exists to tell apart a user and a group sharing a name, which is why only the user
 * form is collapsed: `Josh` and `user:Josh` become one, while `group:sales` stays distinct from a
 * user named `sales`. A bare value is read as a user, as `UserManagerResolver` does.
 */

const USER_PREFIX = 'user:';
const GROUP_PREFIX = 'group:';

export interface ParsedPrincipal {
  group: boolean;
  /** Identifier without its prefix, which is what the REST API expects. */
  name: string;
}

export function parsePrincipal(raw: string): ParsedPrincipal {
  if (raw.startsWith(GROUP_PREFIX)) {
    return { group: true, name: raw.slice(GROUP_PREFIX.length) };
  }
  return { group: false, name: raw.startsWith(USER_PREFIX) ? raw.slice(USER_PREFIX.length) : raw };
}

/**
 * Key under which both forms of one principal meet.
 *
 * A user is keyed by its bare name, a group by its prefixed one: collapsing `group:sales` to
 * `sales` would merge it with a user of that name, undoing the very distinction the prefix was
 * introduced for.
 */
export function canonicalPrincipal(raw: string): string {
  const { group, name } = parsePrincipal(raw);
  return group ? `${GROUP_PREFIX}${name}` : name;
}

/**
 * Every form a canonical principal may take in the index, so a filter matches all of them.
 *
 * Mirrors `TaskActorsHelper.getTaskActors()`, groups included: the platform emits the bare form of
 * a group too. Both forms are always sent, rather than only those already seen in an aggregation,
 * because a reassignment can change the stored form after the value list was built.
 */
export function principalForms(canonical: string): string[] {
  const { group, name } = parsePrincipal(canonical);
  return group ? [`${GROUP_PREFIX}${name}`, name] : [name, `${USER_PREFIX}${name}`];
}
