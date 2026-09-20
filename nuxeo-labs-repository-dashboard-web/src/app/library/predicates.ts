/**
 * The only predicates a widget definition may express.
 *
 * `EsClause` is `Record<string, unknown>`, forwarded verbatim by a passthrough that runs as an
 * administrator, so a hand written clause is also a place where `script` or `runtime_mappings`
 * could appear. Aggregations have been closed against that since the beginning; filters never
 * were — the four dashboards not yet migrated carry 27 clauses written by hand, using, in the
 * end, two shapes only.
 *
 * Definitions go through these four instead, so the escape hatch simply is not there. A
 * composition names widgets and parameters and has no way to express a clause at all.
 */
import { EsClause } from '../config/dashboard-config.model';

/**
 * A window over a date field, expressed in date math such as `now` or `now+7d`.
 *
 * The four bounds are named rather than free, so nothing else can reach the compiled `range`.
 */
export interface DateWindow {
  field: string;
  /** Inclusive lower bound. */
  gte?: string;
  /** Exclusive lower bound, which is how two adjacent windows avoid overlapping. */
  gt?: string;
  /** Inclusive upper bound. */
  lte?: string;
  lt?: string;
}

export type Predicate =
  | { kind: 'equals'; field: string; value: string | number | boolean }
  | { kind: 'anyOf'; field: string; values: string[] }
  | { kind: 'dateWindow'; window: DateWindow }
  | { kind: 'exists'; field: string };

export function equals(field: string, value: string | number | boolean): Predicate {
  return { kind: 'equals', field, value };
}

/**
 * Restricts a field to a set of values, and to nothing at all when the set is empty.
 *
 * An empty list compiling to no clause is the same rule the filter dialog follows: "everything
 * selected" must mean "no constraint", never "every value". Compiled the other way, a widget
 * restricted to no type in particular would swallow whatever else narrowed the page.
 */
export function anyOf(field: string, values: string[] | undefined): Predicate {
  return { kind: 'anyOf', field, values: values ?? [] };
}

export function dateWindow(window: DateWindow): Predicate {
  return { kind: 'dateWindow', window };
}

export function exists(field: string): Predicate {
  return { kind: 'exists', field };
}

/** A predicate that constrains nothing, and so must not reach the query. */
function isVacuous(predicate: Predicate): boolean {
  if (predicate.kind === 'anyOf') {
    return predicate.values.length === 0;
  }
  if (predicate.kind === 'dateWindow') {
    const { gte, gt, lte, lt } = predicate.window;
    return gte === undefined && gt === undefined && lte === undefined && lt === undefined;
  }
  return false;
}

function compileOne(predicate: Predicate): EsClause {
  switch (predicate.kind) {
    case 'equals':
      return { term: { [predicate.field]: predicate.value } };
    case 'anyOf':
      return { terms: { [predicate.field]: predicate.values } };
    case 'exists':
      return { exists: { field: predicate.field } };
    case 'dateWindow': {
      const { field, ...bounds } = predicate.window;
      return { range: { [field]: bounds } };
    }
  }
}

/** Clauses a list of predicates compiles to, silent ones dropped. */
export function compilePredicates(predicates: Predicate[]): EsClause[] {
  return predicates.filter((predicate) => !isVacuous(predicate)).map(compileOne);
}
