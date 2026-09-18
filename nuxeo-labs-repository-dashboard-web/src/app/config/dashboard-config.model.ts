/**
 * Declarative description of a dashboard.
 *
 * Aggregations are expressed through a closed union rather than raw OpenSearch DSL. This is a
 * deliberate safety boundary: the passthrough forwards an administrator's payload verbatim, so
 * accepting arbitrary DSL from a configuration file would also accept `script` and
 * `runtime_mappings`. Everything that reaches the server goes through `agg-compiler.ts`, which
 * only knows how to emit the shapes below.
 */
import { EsIndex } from '../core/nuxeo.types';

/** A raw OpenSearch query clause, used for filters only (never for aggregations). */
export type EsClause = Record<string, unknown>;

/* ==================== Aggregations ==================== */

export type TermsOrder =
  'count_desc' | 'count_asc' | 'key_asc' | 'key_desc' | 'metric_desc' | 'metric_asc';

export type CalendarInterval = 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface NumericRange {
  key: string;
  from?: number;
  to?: number;
}

export interface DateRangeBucket {
  key: string;
  /** Date math, e.g. `now-30d`, or an ISO instant. */
  from?: string;
  to?: string;
}

export type AggConfig =
  | { terms: { field: string; size?: number; order?: TermsOrder; missing?: string } }
  | {
      date_histogram: {
        field: string;
        calendar_interval: CalendarInterval;
        /** Java date pattern used for the bucket key, e.g. `yyyy-MM-dd`. */
        format?: string;
        min_doc_count?: number;
        /**
         * IANA zone the buckets are cut in, e.g. `Europe/Paris`. Defaults to the reader's own
         * zone. Set it to `UTC` to make a dashboard read the same for everyone.
         */
        time_zone?: string;
      };
    }
  | { range: { field: string; ranges: NumericRange[] } }
  | { date_range: { field: string; ranges: DateRangeBucket[] } }
  | { filters: { filters: Record<string, EsClause> } };

/** Single value metric computed instead of the document count. */
export type MetricConfig =
  | { count: true }
  | { cardinality: string }
  | { sum: string }
  | { avg: string }
  | { min: string }
  | { max: string };

/* ==================== Presentation ==================== */

/** How bucket keys and column values are turned into human readable labels. */
export type LabelStrategy = 'raw' | 'doctype' | 'lifecycle' | 'user' | 'boolean';

export type ValueFormat =
  'integer' | 'decimal' | 'bytes' | 'percent' | 'duration' | 'date' | 'daysUntil' | 'text';

export type KpiSeverity = 'neutral' | 'accent' | 'warning' | 'danger' | 'success';

export interface ColumnConfig {
  /** Path inside `_source`, e.g. `dc:title` or `file:content.length`. */
  field: string;
  label: string;
  format?: ValueFormat;
  labels?: LabelStrategy;
  /** Renders the cell as a link to the document in Web UI. */
  link?: 'document';
  /** Tailwind width class suffix, e.g. `w-32`. */
  width?: string;
}

interface BaseWidgetConfig {
  label: string;
  /** Clauses applied to this widget only, on top of the dashboard filters and the scope. */
  filter?: EsClause[];
  /**
   * Named scope restricting which documents this widget describes, e.g. `versions`.
   * Defaults to the dashboard's `defaultScope`.
   */
  scope?: string;
  /** Columns spanned in the 12 column grid. Defaults to an even split within the row. */
  span?: number;
  /**
   * Overrides `span` for a given date range id.
   *
   * Two widgets declared in the same row both spanning 12 wrap onto separate lines, while both
   * spanning 6 sit side by side. That is how a pair of trend charts can be stacked over a long
   * period, where daily bars need the full width, and paired over a short one, where comparing
   * them matters more.
   */
  spanByRange?: Record<string, number>;
  /** Secondary line under the title. `{range}` is replaced by the active date range label. */
  hint?: string;
}

/**
 * A second figure rendered under a KPI, counted within the tile's own population.
 *
 * Used for facts that have no other home, such as how many proxies point at a trashed document.
 */
export interface KpiSecondaryConfig {
  filter: EsClause[];
  /** Template where `{value}` is replaced by the formatted count, e.g. `{value} trashed`. */
  label: string;
  format?: ValueFormat;
  /** Hides the line when the count is zero, which keeps a tile clean when the case never occurs. */
  hideWhenZero?: boolean;
}

export interface KpiWidgetConfig extends BaseWidgetConfig {
  type: 'kpi';
  severity?: KpiSeverity;
  metric?: MetricConfig;
  format?: ValueFormat;
  secondary?: KpiSecondaryConfig;
}

/** Chart types backed by an aggregation returning buckets. */
export type ChartWidgetType = 'donut' | 'pie' | 'bar' | 'hbar' | 'line' | 'area' | 'ranked-list';

export interface ChartWidgetConfig extends BaseWidgetConfig {
  type: ChartWidgetType;
  agg: AggConfig;
  metric?: MetricConfig;
  labels?: LabelStrategy;
  format?: ValueFormat;
  /** Caps how many buckets are rendered, independently of the aggregation size. */
  limit?: number;
}

export interface TableWidgetConfig extends BaseWidgetConfig {
  type: 'table';
  columns: ColumnConfig[];
  sort?: { field: string; order: 'asc' | 'desc' }[];
  size?: number;
}

export type WidgetConfig = KpiWidgetConfig | ChartWidgetConfig | TableWidgetConfig;

/* ==================== Filters ==================== */

export interface DateRangeFilterConfig {
  type: 'dateRange';
  field: string;
  label?: string;
  /** Identifier of a `DATE_RANGE_OPTIONS` entry. Defaults to `all`. */
  default?: string;
}

/** One list of checkable values inside a group. */
export interface TermsMemberConfig {
  id: string;
  /** Aggregatable keyword field, e.g. `ecm:primaryType` or `ecm:mixinType`. */
  field: string;
  label: string;
  labels?: LabelStrategy;
  /**
   * Number of distinct values fetched. The OpenSearch default is 10, far too low here, so an
   * explicit value is always sent.
   */
  size?: number;
  /** Displayed under the list, for caveats such as overlapping counts. */
  note?: string;
}

/**
 * A set of term lists describing the same dimension.
 *
 * Members are combined with OR, groups with AND. Document type and facet are two alternative
 * answers to "what kind of document is this", which is why they belong to one group and union
 * rather than intersect: `File AND Picture facet` would be empty in stock Nuxeo, since `File`
 * does not declare that facet.
 */
export interface TermsGroupConfig {
  type: 'termsGroup';
  id: string;
  label: string;
  /** Defaults to `or`. `and` is supported but not exposed in the UI. */
  combine?: 'or' | 'and';
  members: TermsMemberConfig[];
}

export type FilterConfig = DateRangeFilterConfig | TermsGroupConfig;

/* ==================== Dashboard ==================== */

export interface LayoutRow {
  cells: string[];
}

export interface DashboardConfig {
  id: string;
  label: string;
  subtitle?: string;
  index: EsIndex;
  /** Interactive filters shown above the grid. */
  filters?: FilterConfig[];
  /** Clauses applied to every widget, whatever its scope. */
  baseFilter?: EsClause[];
  /**
   * Named populations a widget can describe.
   *
   * This is what lets a dashboard mix figures that would otherwise contradict each other: the
   * charts describe live documents, while a composition row also counts versions and proxies.
   * Keeping the distinction out of `baseFilter` is what makes it possible, since a widget can
   * only ever narrow the shared query, never widen it.
   */
  scopes?: Record<string, EsClause[]>;
  /** Scope applied to widgets that do not declare one. */
  defaultScope?: string;
  layout: LayoutRow[];
  widgets: Record<string, WidgetConfig>;
}

export class UnknownScopeError extends Error {
  constructor(name: string) {
    super(`Unknown scope "${name}"`);
    this.name = 'UnknownScopeError';
  }
}

/** Clauses of the scope a widget describes. */
export function scopeClauses(config: DashboardConfig, widget: WidgetConfig): EsClause[] {
  const name = widget.scope ?? config.defaultScope;
  if (!name) {
    return [];
  }
  const clauses = config.scopes?.[name];
  if (clauses === undefined) {
    throw new UnknownScopeError(name);
  }
  return clauses;
}

/* ==================== Runtime filter state ==================== */

export interface DateRangeOption {
  id: string;
  label: string;
  /** Date math lower bound, or null for no bound at all. */
  from: string | null;
}

export const DATE_RANGE_OPTIONS: DateRangeOption[] = [
  { id: 'all', label: 'All time', from: null },
  { id: '7d', label: 'Last 7 days', from: 'now-7d' },
  { id: '30d', label: 'Last 30 days', from: 'now-30d' },
  { id: '90d', label: 'Last 90 days', from: 'now-90d' },
  { id: '12m', label: 'Last 12 months', from: 'now-12M' },
];

/**
 * Selection of one term list.
 *
 * `all` means "no constraint", not "every value". The distinction is what makes the union work:
 * a fully selected member must stay out of the union, otherwise it would swallow the constraints
 * expressed by its siblings.
 */
export type TermsSelection = { mode: 'all' } | { mode: 'subset'; values: string[] };

export const SELECT_ALL: TermsSelection = { mode: 'all' };

/** Member id to selection, for a single group. */
export type GroupSelection = Record<string, TermsSelection>;

export interface FilterState {
  range: DateRangeOption;
  /** Group id to member selections. */
  groups: Record<string, GroupSelection>;
}

export function dateRangeOption(id: string | undefined): DateRangeOption {
  return DATE_RANGE_OPTIONS.find((option) => option.id === id) ?? DATE_RANGE_OPTIONS[0];
}

export function dateRangeFilter(config: DashboardConfig): DateRangeFilterConfig | null {
  return (config.filters ?? []).find((filter) => filter.type === 'dateRange') ?? null;
}

export function termsGroups(config: DashboardConfig): TermsGroupConfig[] {
  return (config.filters ?? []).filter((filter) => filter.type === 'termsGroup');
}

/** Initial state: the configured default range, and no constraint on any group. */
export function defaultFilterState(config?: DashboardConfig): FilterState {
  if (!config) {
    return { range: DATE_RANGE_OPTIONS[0], groups: {} };
  }

  const groups: Record<string, GroupSelection> = {};
  for (const group of termsGroups(config)) {
    groups[group.id] = Object.fromEntries(group.members.map((member) => [member.id, SELECT_ALL]));
  }

  return { range: dateRangeOption(dateRangeFilter(config)?.default), groups };
}

/** Selection of one member, defaulting to "no constraint". */
export function selectionOf(state: FilterState, groupId: string, memberId: string): TermsSelection {
  return state.groups[groupId]?.[memberId] ?? SELECT_ALL;
}

export function isConstrained(selection: TermsSelection): boolean {
  return selection.mode === 'subset';
}

/* ==================== Type guards ==================== */

export function isTableWidget(widget: WidgetConfig): widget is TableWidgetConfig {
  return widget.type === 'table';
}

export function isKpiWidget(widget: WidgetConfig): widget is KpiWidgetConfig {
  return widget.type === 'kpi';
}

export function isChartWidget(widget: WidgetConfig): widget is ChartWidgetConfig {
  return !isTableWidget(widget) && !isKpiWidget(widget);
}

/** Width a widget takes for the active date range, or undefined to let the row split evenly. */
export function resolveSpan(widget: WidgetConfig, rangeId: string): number | undefined {
  return widget.spanByRange?.[rangeId] ?? widget.span;
}
