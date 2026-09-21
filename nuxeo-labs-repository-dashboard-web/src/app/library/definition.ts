/**
 * What a reusable widget is.
 *
 * A definition is a *recipe*, not a component: it names an idea, declares the parameters that
 * shape it, and returns the configuration the existing engine already knows how to plan, batch
 * and render. Nothing here talks to the server.
 *
 * That is deliberate. A widget that ran its own search would turn one request per page into
 * thirteen, and the cost would not be the round trips — those are affordable on a dashboard a few
 * administrators open. It would be arithmetic: Content shows
 * `total = live + trashed + versions + proxies`, and figures read from four separate requests over
 * a moving index only add up by luck. Worse, the expiry tiles are bounded by `now`, which
 * OpenSearch evaluates when it receives a request: one request means one instant, eight requests
 * mean eight, and a document expiring at exactly J+7 can then be counted twice or not at all.
 */
import { EsIndex } from '../core/nuxeo.types';
import { WidgetConfig } from '../config/dashboard-config.model';

/**
 * Everything a composition owns rather than the library.
 *
 * A builder never sets these: where a widget sits and what its card is called are decisions of the
 * page, not of the idea. `hint` is the exception — a definition carries a sensible one, and a
 * composition may still replace it.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** What a builder returns: a widget minus the presentation the composition decides. */
export type WidgetBody = DistributiveOmit<WidgetConfig, 'label' | 'span' | 'spanByRange'>;

/**
 * Declared shape of one parameter.
 *
 * A closed union, because a composition is JSON: TypeScript protects whoever writes a definition,
 * and nothing protects whoever writes a composition. This is what does.
 */
export type ParamSpec =
  | { type: 'number'; default?: number; min?: number; max?: number; describe?: string }
  | { type: 'string'; default?: string; describe?: string }
  | { type: 'string[]'; default?: string[]; describe?: string }
  | { type: 'enum'; values: readonly string[]; default?: string; describe?: string }
  | { type: 'boolean'; default?: boolean; describe?: string };

export type ParamSpecs = Record<string, ParamSpec>;

export type ParamValue = string | number | boolean | string[] | undefined;
export type ParamValues = Record<string, ParamValue>;

/** What one declared parameter is worth once it has been resolved. */
type ValueOf<S extends ParamSpec> = S extends { type: 'number' }
  ? number
  : S extends { type: 'string' }
    ? string
    : S extends { type: 'string[]' }
      ? string[]
      : S extends { type: 'boolean' }
        ? boolean
        : S extends { type: 'enum'; values: readonly (infer V)[] }
          ? V
          : never;

/**
 * The argument a `build` receives, derived from the parameters it declares.
 *
 * Deriving it rather than taking it as a second type argument is what keeps the two descriptions
 * from disagreeing. They used to be independent: a definition could declare `chart` and read
 * `colour`, and nothing said so — neither the compiler, which saw a hand written interface, nor
 * `resolveParams`, which fills only what is declared. The `undefined` then travelled all the way
 * into a widget the planner still accepted.
 *
 * A parameter with a default is always present; one without may be absent, which is what makes
 * `types` and `facets` optional without a second declaration saying so.
 */
export type ParamsOf<S extends ParamSpecs> = {
  [K in keyof S as S[K] extends { default: unknown } ? K : never]: ValueOf<S[K]>;
} & {
  [K in keyof S as S[K] extends { default: unknown } ? never : K]?: ValueOf<S[K]>;
};

export interface WidgetDefinition {
  /** Stable, semantic, kebab-case. This is what a composition names, and what an AI reads. */
  readonly id: string;
  /** Index this widget reads, which decides the batch it joins. */
  readonly index: EsIndex;
  /** Default card title. */
  readonly title: string;
  /** One sentence saying what it measures. The catalogue is made of these. */
  readonly summary: string;
  readonly params: ParamSpecs;
  build(params: ParamValues): WidgetBody;
}

/**
 * Declares a widget, typing its build function from the parameters it declares.
 *
 * `const S` is what makes an `enum` yield the union of its values rather than `string`: without
 * it the literals in `values` widen on the way in, and a misspelt chart type would compile.
 *
 * The registry holds definitions of unlike parameter shapes, so the type has to be erased
 * somewhere. Doing it here means it happens once, rather than as a cast in every definition.
 */
export function defineWidget<const S extends ParamSpecs = Record<string, never>>(spec: {
  id: string;
  index: EsIndex;
  title: string;
  summary: string;
  params?: S;
  build: (params: ParamsOf<S>) => WidgetBody;
}): WidgetDefinition {
  return {
    id: spec.id,
    index: spec.index,
    title: spec.title,
    summary: spec.summary,
    params: spec.params ?? {},
    build: (values) => spec.build(values as unknown as ParamsOf<S>),
  };
}

function typeOf(value: unknown): string {
  return Array.isArray(value) ? 'array' : typeof value;
}

/** Checks one value against its declared shape, answering the reason it is refused. */
function checkParam(name: string, spec: ParamSpec, value: unknown): string | null {
  switch (spec.type) {
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return `"${name}" expects a number, not ${typeOf(value)}.`;
      }
      if (spec.min !== undefined && value < spec.min) {
        return `"${name}" must be at least ${spec.min}.`;
      }
      if (spec.max !== undefined && value > spec.max) {
        return `"${name}" must be at most ${spec.max}.`;
      }
      return null;
    case 'string':
      return typeof value === 'string' ? null : `"${name}" expects a string, not ${typeOf(value)}.`;
    case 'boolean':
      return typeof value === 'boolean'
        ? null
        : `"${name}" expects true or false, not ${typeOf(value)}.`;
    case 'string[]':
      return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
        ? null
        : `"${name}" expects a list of strings.`;
    case 'enum':
      return typeof value === 'string' && spec.values.includes(value)
        ? null
        : `"${name}" must be one of ${spec.values.join(', ')}.`;
  }
}

export interface ResolvedParams {
  values: ParamValues;
  /** Empty when every given value is usable. */
  problems: string[];
}

/**
 * Fills in the defaults and refuses what a definition never declared.
 *
 * Refusing an unknown key matters more than it looks: a composition is written by hand or by an
 * assistant, and a misspelt parameter that is silently ignored produces a widget that renders
 * perfectly while describing something else.
 */
export function resolveParams(
  definition: WidgetDefinition,
  given: Record<string, unknown> | undefined,
): ResolvedParams {
  const problems: string[] = [];
  const values: ParamValues = {};

  for (const [name, spec] of Object.entries(definition.params)) {
    if (spec.default !== undefined) {
      values[name] = spec.default as ParamValue;
    }
  }

  for (const [name, value] of Object.entries(given ?? {})) {
    const spec = definition.params[name];
    if (!spec) {
      const known = Object.keys(definition.params);
      problems.push(
        `"${definition.id}" declares no parameter "${name}"` +
          (known.length ? `, only ${known.join(', ')}.` : '.'),
      );
      continue;
    }
    if (value === undefined || value === null) {
      continue;
    }
    const problem = checkParam(name, spec, value);
    if (problem) {
      problems.push(`"${definition.id}": ${problem}`);
      continue;
    }
    values[name] = value as ParamValue;
  }

  return { values, problems };
}
