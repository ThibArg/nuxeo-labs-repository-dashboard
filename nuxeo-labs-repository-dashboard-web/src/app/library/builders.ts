/**
 * The shapes the library is made of.
 *
 * Fifty-four widgets ship today and they are eleven ideas; two of them — counting a population and
 * ranking the top values of a field — account for seventy-eight per cent. So the reuse worth
 * having is here, in a handful of builders, while the *names* stay one per idea: a composition
 * that said `topNChart('ecm:primaryType')` would be back to writing queries by hand.
 */
import {
  CalendarInterval,
  ChartWidgetType,
  KpiSeverity,
  LabelStrategy,
  ValueFormat,
} from '../config/dashboard-config.model';
import { ParamSpecs, WidgetBody } from './definition';
import { Predicate, anyOf, compilePredicates } from './predicates';

/** Parameters every repository widget accepts, so any of them can describe part of the content. */
export const RESTRICTION_PARAMS: ParamSpecs = {
  types: {
    type: 'string[]',
    describe: 'Restrict to these document types. Absent or empty means no constraint.',
  },
  facets: {
    type: 'string[]',
    describe: 'Restrict to documents carrying these facets. Absent or empty means no constraint.',
  },
};

export interface Restrictions {
  types?: string[];
  facets?: string[];
}

/** Predicates the restriction parameters add, which are silent when nothing was asked. */
export function restrict(params: Restrictions): Predicate[] {
  return [anyOf('ecm:primaryType', params.types), anyOf('ecm:mixinType', params.facets)];
}

export interface SecondaryFigure {
  of: Predicate[];
  /** Template where `{value}` is replaced by the formatted count. */
  label: string;
  hideWhenZero?: boolean;
  format?: ValueFormat;
}

/**
 * A single figure describing one population.
 *
 * `of` is the whole population, composed by the definition, because the order of the clauses is
 * what the planner hands to OpenSearch and a reader comparing two tiles is entitled to the same
 * reading of both.
 */
export function countTile(options: {
  of: Predicate[];
  severity?: KpiSeverity;
  hint?: string;
  format?: ValueFormat;
  secondary?: SecondaryFigure;
}): WidgetBody {
  const filter = compilePredicates(options.of);
  return {
    type: 'kpi',
    ...(options.hint ? { hint: options.hint } : {}),
    ...(options.severity ? { severity: options.severity } : {}),
    ...(options.format ? { format: options.format } : {}),
    ...(filter.length ? { filter } : {}),
    ...(options.secondary
      ? {
          secondary: {
            filter: compilePredicates(options.secondary.of),
            label: options.secondary.label,
            ...(options.secondary.format ? { format: options.secondary.format } : {}),
            ...(options.secondary.hideWhenZero ? { hideWhenZero: true } : {}),
          },
        }
      : {}),
  };
}

/** The values a field takes most often, drawn however the composition asked. */
export function topNChart(options: {
  of: Predicate[];
  field: string;
  size: number;
  chart: ChartWidgetType;
  labels?: LabelStrategy;
  hint?: string;
  format?: ValueFormat;
}): WidgetBody {
  const filter = compilePredicates(options.of);
  return {
    type: options.chart,
    ...(options.hint ? { hint: options.hint } : {}),
    ...(options.labels ? { labels: options.labels } : {}),
    ...(options.format ? { format: options.format } : {}),
    ...(filter.length ? { filter } : {}),
    agg: { terms: { field: options.field, size: options.size } },
  };
}

/**
 * Bucket key pattern that says as much as the interval carries and no more.
 *
 * A monthly histogram formatted `yyyy-MM-dd` would label every bar with a first of the month,
 * which reads as a day rather than as a month.
 */
function keyFormat(interval: CalendarInterval): string {
  switch (interval) {
    case 'hour':
      return 'yyyy-MM-dd HH:mm';
    case 'month':
      return 'yyyy-MM';
    case 'quarter':
    case 'year':
      return 'yyyy';
    default:
      return 'yyyy-MM-dd';
  }
}

/** How a volume moved over the period. */
export function trendChart(options: {
  of: Predicate[];
  field: string;
  interval: CalendarInterval;
  chart: ChartWidgetType;
  hint?: string;
}): WidgetBody {
  const filter = compilePredicates(options.of);
  return {
    type: options.chart,
    ...(options.hint ? { hint: options.hint } : {}),
    ...(filter.length ? { filter } : {}),
    agg: {
      date_histogram: {
        field: options.field,
        calendar_interval: options.interval,
        format: keyFormat(options.interval),
      },
    },
  };
}
