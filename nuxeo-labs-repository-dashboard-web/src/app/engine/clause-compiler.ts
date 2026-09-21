/**
 * The only query clauses that may reach the server.
 *
 * Aggregations have been a closed union since the beginning, for a reason that applies just as
 * hard to filters and was left open: `DefaultSearchRequestFilter.getPayload()` forwards an
 * administrator's payload to OpenSearch **unmodified**, and for a non-administrator rewrites only
 * the `query` key, leaving every clause inside it intact. So a clause carrying
 * `{"script": {"script": {"lang": "painless", …}}}` executes per document, and one carrying a
 * `terms` lookup reads an index the URL never named.
 *
 * A composition cannot express a clause at all, so the shipped screens were never the risk. The
 * compiled form can, and a stored override *is* the compiled form: anything able to write
 * `localStorage` on the Nuxeo origin could plant one and wait for an administrator to open the
 * page. Closing the union here is what makes "no raw DSL reaches the passthrough" true of every
 * form rather than of the new one only.
 *
 * It also turns a convention into a guarantee on the way in. A widget definition is supposed to go
 * through `library/predicates.ts`; nothing stopped it from writing a clause by hand, because
 * `WidgetBody` carries `filter?: EsClause[]`. Now something does.
 */
import { EsClause } from './es-query';

export class UnsupportedClauseError extends Error {
  constructor(detail: string) {
    super(`Unsupported filter: ${detail}`);
    this.name = 'UnsupportedClauseError';
  }
}

/** Arms of a `bool` clause, each holding clauses of its own. */
const BOOL_ARMS = ['filter', 'must', 'should', 'must_not'] as const;

/** Keys a `bool` may carry beside its arms, and which are plain numbers. */
const BOOL_SCALARS = ['minimum_should_match', 'boost'] as const;

/**
 * Bounds a `range` accepts.
 *
 * Deliberately not `format`, `relation` or `time_zone`: none of them is used, and a closed set
 * that lists only what is needed is the point.
 */
const RANGE_BOUNDS = ['gt', 'gte', 'lt', 'lte'] as const;

function single<T>(clause: Record<string, T>, key: string): [string, T] {
  const entries = Object.entries(clause);
  if (entries.length !== 1) {
    throw new UnsupportedClauseError(
      `a ${key} clause names ${entries.length} fields, and must name exactly one`,
    );
  }
  return entries[0];
}

function compileTerm(body: unknown): EsClause {
  const [field, value] = single(body as Record<string, unknown>, 'term');
  const type = typeof value;
  if (type !== 'string' && type !== 'number' && type !== 'boolean') {
    throw new UnsupportedClauseError(`"${field}" is matched against ${type}, not a plain value`);
  }
  return { term: { [field]: value } };
}

/**
 * A `terms` clause, which must hold a list of values.
 *
 * The shape refused here is the interesting one: OpenSearch also accepts an *object* naming an
 * index, an id and a path, and reads the values from that document instead. That is a read of an
 * index this application never declared, expressed as an ordinary looking filter.
 */
function compileTerms(body: unknown): EsClause {
  const [field, values] = single(body as Record<string, unknown>, 'terms');
  if (!Array.isArray(values)) {
    throw new UnsupportedClauseError(
      `"${field}" must be given a list of values; an object there is a terms lookup, which reads another index`,
    );
  }
  if (values.some((value) => typeof value !== 'string' && typeof value !== 'number')) {
    throw new UnsupportedClauseError(`"${field}" must be given plain values`);
  }
  return { terms: { [field]: [...values] } };
}

function compileRange(body: unknown): EsClause {
  const [field, bounds] = single(body as Record<string, unknown>, 'range');
  if (!bounds || typeof bounds !== 'object' || Array.isArray(bounds)) {
    throw new UnsupportedClauseError(`"${field}" needs at least one bound`);
  }

  const kept: Record<string, string | number> = {};
  for (const [bound, value] of Object.entries(bounds)) {
    if (!(RANGE_BOUNDS as readonly string[]).includes(bound)) {
      throw new UnsupportedClauseError(`"${bound}" is not a range bound on "${field}"`);
    }
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new UnsupportedClauseError(`"${field}" is bounded by something that is not a value`);
    }
    kept[bound] = value;
  }
  if (!Object.keys(kept).length) {
    throw new UnsupportedClauseError(`"${field}" needs at least one bound`);
  }
  return { range: { [field]: kept } };
}

function compileExists(body: unknown): EsClause {
  const field = (body as { field?: unknown })?.field;
  if (typeof field !== 'string' || !field) {
    throw new UnsupportedClauseError('an exists clause needs a field name');
  }
  return { exists: { field } };
}

function compileBool(body: unknown): EsClause {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new UnsupportedClauseError('a bool clause needs at least one arm');
  }

  const compiled: EsClause = {};
  for (const [key, value] of Object.entries(body)) {
    if ((BOOL_ARMS as readonly string[]).includes(key)) {
      const arm = Array.isArray(value) ? value : [value];
      compiled[key] = arm.map(compileClause);
      continue;
    }
    if ((BOOL_SCALARS as readonly string[]).includes(key) && typeof value === 'number') {
      compiled[key] = value;
      continue;
    }
    throw new UnsupportedClauseError(`"${key}" is not part of a bool clause`);
  }

  if (!Object.keys(compiled).length) {
    throw new UnsupportedClauseError('a bool clause needs at least one arm');
  }
  return { bool: compiled };
}

/**
 * Rebuilds a clause out of what it is allowed to contain, rather than checking and forwarding it.
 *
 * Rebuilding is what makes the guarantee hold: a clause that passes leaves nothing behind it, so a
 * key nobody thought to refuse cannot ride along beside one that was accepted.
 */
export function compileClause(clause: unknown): EsClause {
  if (!clause || typeof clause !== 'object' || Array.isArray(clause)) {
    throw new UnsupportedClauseError('a filter must be an object');
  }

  const [kind, body] = single(clause as Record<string, unknown>, 'filter');
  switch (kind) {
    case 'term':
      return compileTerm(body);
    case 'terms':
      return compileTerms(body);
    case 'range':
      return compileRange(body);
    case 'exists':
      return compileExists(body);
    case 'bool':
      return compileBool(body);
    default:
      throw new UnsupportedClauseError(
        `"${kind}" is not a filter this dashboard may send; use term, terms, range, exists or bool`,
      );
  }
}

export function compileClauses(clauses: EsClause[] | undefined): EsClause[] {
  return (clauses ?? []).map(compileClause);
}
