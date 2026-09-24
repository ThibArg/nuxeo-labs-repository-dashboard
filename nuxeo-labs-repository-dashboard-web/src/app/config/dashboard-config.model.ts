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

/**
 * Width of a histogram bucket, or `auto` to leave it to the planner.
 *
 * `auto` is derived from the period when the period bounds the very field the histogram groups
 * by, and is otherwise left to OpenSearch's `auto_date_histogram`, which keeps the bucket count
 * under a ceiling whatever dates the index holds. See `resolveHistogram`.
 */
export type HistogramInterval = CalendarInterval | 'auto';

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
  | {
      terms: {
        field: string;
        size?: number;
        order?: TermsOrder;
        missing?: string;
        /**
         * `map` ranks the values of the documents collected instead of the whole shard's. See
         * `compileAgg`; no other hint is accepted.
         */
        execution_hint?: 'map';
      };
    }
  | {
      date_histogram: {
        field: string;
        calendar_interval: HistogramInterval;
        /**
         * Java date pattern used for the bucket key, e.g. `yyyy-MM-dd`. Chosen by the planner
         * when absent and the interval is `auto`.
         */
        format?: string;
        /** Refused beside `auto`, which may compile to an aggregation that has no such key. */
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

/**
 * Single value metric computed instead of the document count.
 *
 * `percentile` answers the value below which that share of the population falls: `percent: 50` is
 * the median, `percent: 90` the figure a service level is written against. It is worth reaching
 * for whenever a few extreme members drag the mean somewhere no member actually sits.
 */
export type MetricConfig =
  | { count: true }
  | { cardinality: string }
  | { sum: string }
  | { avg: string }
  | { min: string }
  | { max: string }
  | { percentile: { field: string; percent: number } };

/* ==================== Presentation ==================== */

/**
 * How bucket keys and column values are turned into human readable labels.
 *
 * `message` translates a value that is already an i18n key, `workflowModel` composes one out of a
 * workflow model name. Both are what the audit index holds for workflows. `document` names the
 * document a uuid points at, which is what a reference field such as `record:ruleIds` holds.
 */
export type LabelStrategy =
  'raw' | 'doctype' | 'lifecycle' | 'user' | 'document' | 'boolean' | 'message' | 'workflowModel';

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
  /**
   * Index this widget reads, when it is not the dashboard's own.
   *
   * The planner groups widgets by index and issues one request per group, so a page can hold a
   * repository figure beside an audit one. Widgets of one group still travel together, which is
   * what keeps a partition adding up and `now` a single instant within it.
   */
  index?: EsIndex;
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

/**
 * True when a filter declaring these indices constrains that one.
 *
 * Absent means every index, which is what a single-index dashboard wants and what every shipped
 * file relies on. The declaration only becomes necessary on a page reading more than one, where
 * `validateConfig` refuses to leave it implicit: `ecm:path.children` sent to the audit matches
 * nothing at all, and a widget reading zero is a worse answer than a widget reading unfiltered.
 */
export function appliesTo(indices: EsIndex[] | undefined, index: EsIndex): boolean {
  return !indices?.length || indices.includes(index);
}

export interface DateRangeFilterConfig {
  type: 'dateRange';
  field: string;
  /**
   * Field to constrain instead of `field`, on the indices named here.
   *
   * A period means `dc:created` in the repository and `eventDate` in the audit, so a page mixing
   * the two needs both. The planner reads the one belonging to the group it is building.
   */
  byIndex?: Partial<Record<EsIndex, string>>;
  label?: string;
  /** Identifier of a `DATE_RANGE_SHORTCUTS` entry. Defaults to `all`. */
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
   * Turns the list into a directory backed picker.
   *
   * Values are ranked by volume rather than alphabetically, only the busiest are listed, and
   * typing queries the server instead of filtering the downloaded page. Meant for a field whose
   * cardinality follows the user base: three hundred claim adjusters make a checkbox list
   * unusable, and no top N can be relied on to hold the one person a reader is looking for.
   */
  lookup?: 'user';
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
  /**
   * Indices this group constrains. Absent means every index.
   *
   * A group names repository fields, so sending it to the audit would match nothing and empty the
   * audit half of a mixed page the moment a reader checks a document type. The group is also read
   * from here to decide which index its candidate values are counted on.
   */
  indices?: EsIndex[];
  members: TermsMemberConfig[];
}

/**
 * Restricts every figure to one container and its descendants.
 *
 * Only worth declaring on a dashboard whose documents are the business documents. A task lives
 * under `/task-root` and a workflow instance under `/document-route-instances-root`, so scoping
 * either by path says something about the plumbing rather than about the content.
 */
export interface PathScopeFilterConfig {
  type: 'pathScope';
  label?: string;
  /** Container the picker opens on. Defaults to `/default-domain`. */
  root?: string;
  /**
   * Indices this scope constrains. Absent means every index.
   *
   * The clause is `ecm:path.children`, which only the repository carries. An audit entry holds
   * `docPath` instead, and it is not the same question: the path recorded at the time of the event
   * is not where the document sits today.
   */
  indices?: EsIndex[];
}

export type FilterConfig = DateRangeFilterConfig | TermsGroupConfig | PathScopeFilterConfig;

/* ==================== Dashboard ==================== */

export interface LayoutRow {
  cells: string[];
}

/**
 * A titled block of rows, optionally foldable.
 *
 * `collapsible` is an attribute rather than a node of its own: a foldable block and a plain one
 * are the same idea seen twice, and two grammar nodes for it would be two things to keep in step.
 */
export interface LayoutSection {
  section: string;
  rows: LayoutRow[];
  collapsible?: boolean;
  /** Starts folded. Only read when `collapsible` is true, since nothing could unfold it. */
  collapsed?: boolean;
}

export interface LayoutTab {
  label: string;
  rows: LayoutRow[];
}

/** Named panels, one shown at a time. */
export interface LayoutTabs {
  tabs: LayoutTab[];
}

/**
 * What a layout is made of.
 *
 * Deliberately two levels deep and no more: a node at the top, rows inside it. Tabs within tabs
 * are a worse screen than the one they replace, and the bound is what keeps the grammar something
 * a reader can hold in their head — and something the grid can draw without recursing.
 */
export type LayoutNode = LayoutRow | LayoutSection | LayoutTabs;

export function isLayoutSection(node: LayoutNode): node is LayoutSection {
  return 'section' in node;
}

export function isLayoutTabs(node: LayoutNode): node is LayoutTabs {
  return 'tabs' in node;
}

export function isLayoutRow(node: LayoutNode): node is LayoutRow {
  return 'cells' in node;
}

/** Every row a layout holds, whatever wraps it, in declaration order. */
export function layoutRows(nodes: LayoutNode[]): LayoutRow[] {
  return nodes.flatMap((node) => {
    if (isLayoutRow(node)) {
      return [node];
    }
    if (isLayoutSection(node)) {
      return node.rows ?? [];
    }
    return (node.tabs ?? []).flatMap((tab) => tab.rows ?? []);
  });
}

/**
 * Every widget id a layout names, in declaration order.
 *
 * Reads the configuration, never the screen, which is what keeps the planner's promise: a widget
 * sitting in a tab nobody opened or in a section left folded is planned all the same, so opening
 * one costs nothing and the figures of two tabs describe the same instant.
 */
export function layoutCells(nodes: LayoutNode[]): string[] {
  return layoutRows(nodes).flatMap((row) => row.cells ?? []);
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
  layout: LayoutNode[];
  widgets: Record<string, WidgetConfig>;
}

export class UnknownScopeError extends Error {
  constructor(name: string) {
    super(`Unknown scope "${name}"`);
    this.name = 'UnknownScopeError';
  }
}

/**
 * Distinct indices the placed widgets read, in the order the planner will group them.
 *
 * More than one is what turns every shared filter into a question: a clause naming a repository
 * field is not merely useless against the audit, it matches nothing, so the widget reads zero and
 * says nothing about it. `validateConfig` uses this to refuse a mixed page whose filters have not
 * said which half they constrain.
 */
export function dashboardIndices(config: DashboardConfig): EsIndex[] {
  const indices: EsIndex[] = [];
  for (const widgetId of layoutCells(config.layout ?? [])) {
    const widget = config.widgets?.[widgetId];
    if (!widget) {
      continue;
    }
    const index = widget.index ?? config.index;
    if (!indices.includes(index)) {
      indices.push(index);
    }
  }
  // A configuration that places nothing still reads its own index, which is the honest answer.
  return indices.length ? indices : [config.index];
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

/**
 * The period every widget of a dashboard is restricted to.
 *
 * Bounds are calendar days in the reader's own zone, both inclusive, rather than the date math a
 * server would evaluate. Two reasons: a reader who picks "1 to 18 September" means whole local
 * days, not a window ending at the current time of day; and only concrete days can be shown in,
 * and edited through, the two date fields of the picker.
 */
export interface DateRangeOption {
  id: string;
  label: string;
  /** Inclusive first day, `YYYY-MM-DD`, or null for no lower bound. */
  from: string | null;
  /** Inclusive last day, `YYYY-MM-DD`, or null for no upper bound. */
  to: string | null;
}

/** Identifier the picker gives a range whose days were typed rather than chosen. */
export const CUSTOM_RANGE_ID = 'custom';

/**
 * A named period, resolved against today when it is selected.
 *
 * Declaring the span rather than the days is what lets a shortcut fill the two date fields: the
 * reader sees which days the figures actually cover.
 */
export interface DateRangeShortcut {
  id: string;
  label: string;
  /** Number of calendar days ending today, today included. Mutually exclusive with `months`. */
  days?: number;
  /** Number of calendar months back from today. */
  months?: number;
}

export const DATE_RANGE_SHORTCUTS: DateRangeShortcut[] = [
  { id: 'all', label: 'All time' },
  { id: '7d', label: 'Last 7 days', days: 7 },
  { id: '30d', label: 'Last 30 days', days: 30 },
  { id: '90d', label: 'Last 90 days', days: 90 },
  { id: '12m', label: 'Last 12 months', months: 12 },
];

/** `YYYY-MM-DD` of a date, read in the local zone rather than in UTC. */
export function toLocalDay(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function resolveShortcut(shortcut: DateRangeShortcut, today = new Date()): DateRangeOption {
  if (shortcut.days === undefined && shortcut.months === undefined) {
    return { id: shortcut.id, label: shortcut.label, from: null, to: null };
  }

  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (shortcut.months !== undefined) {
    start.setMonth(start.getMonth() - shortcut.months);
  } else {
    // Today counts as one of the days, so "last 7 days" starts six days ago.
    start.setDate(start.getDate() - (shortcut.days! - 1));
  }

  return { id: shortcut.id, label: shortcut.label, from: toLocalDay(start), to: toLocalDay(today) };
}

/** A `YYYY-MM-DD` day as the reader's locale writes it, e.g. `Mar 12, 2026`. */
export function formatDay(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Human readable rendering of a typed period, used wherever `{range}` is interpolated. */
export function formatDayRange(from: string | null, to: string | null): string {
  if (from && to) {
    return from === to ? formatDay(from) : `${formatDay(from)} – ${formatDay(to)}`;
  }
  if (from) {
    return `Since ${formatDay(from)}`;
  }
  if (to) {
    return `Until ${formatDay(to)}`;
  }
  return 'All time';
}

/**
 * A period whose days were typed.
 *
 * Bounds arriving in the wrong order are swapped rather than refused: the picker constrains its
 * own inputs, but a swap keeps any other caller from producing a range that matches nothing.
 */
export function customRange(from: string | null, to: string | null): DateRangeOption {
  const [start, end] = from && to && from > to ? [to, from] : [from, to];
  return {
    id: CUSTOM_RANGE_ID,
    label: formatDayRange(start, end),
    from: start,
    to: end,
  };
}

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

/**
 * A constraint added by clicking a bucket, on a field no declared group covers.
 *
 * Clicking a value whose field *is* a group member goes into that group instead, so the filter bar
 * never shows two renderings of one constraint. What lands here is the rest: a lifecycle state, a
 * retention rule, anything a configuration charted without also exposing it as a filter.
 *
 * The label is captured at click time because nothing downstream could resolve it again: it came
 * from the widget's own `LabelStrategy`, against a bucket list the chip has no access to.
 */
export interface BucketPick {
  /** Aggregatable field the bucket came from. */
  field: string;
  /** Raw bucket key, which is what the clause matches on. */
  value: string;
  /** What the chip displays. */
  label: string;
  /** Strategy the widget resolved its keys with, so a principal expands the way it merged it. */
  labels?: LabelStrategy;
  /**
   * Index of the widget the bucket was clicked on, which is the only index the pick constrains.
   *
   * A group declares the indices it applies to; a pick has no declaration to read, so it carries
   * the one thing that is certain about it — the chart it came from was reading this index, and
   * the field belongs to it. Absent means every index, which is what a single-index page gives.
   */
  index?: EsIndex;
}

export interface FilterState {
  range: DateRangeOption;
  /** Group id to member selections. */
  groups: Record<string, GroupSelection>;
  /**
   * Constraints picked by clicking a bucket.
   *
   * Deliberately not persisted, where a group selection is. A group is a stated preference, edited
   * through a dialog with an explicit Apply; a pick is a gesture made while reading a chart.
   * Restoring one a week later, over figures that have moved on, would be noise rather than
   * context — and the chips make the difference visible while the page is open.
   */
  picks: BucketPick[];
  /**
   * Container every figure is restricted to, or null for the whole repository.
   *
   * A path is a place rather than a preference, and the one filter a reader is most likely to
   * forget having set, so it is not persisted either.
   */
  path: string | null;
}

/** Resolves a configured shortcut id against today, falling back to the first shortcut. */
export function dateRangeOption(id: string | undefined, today = new Date()): DateRangeOption {
  const shortcut = DATE_RANGE_SHORTCUTS.find((entry) => entry.id === id) ?? DATE_RANGE_SHORTCUTS[0];
  return resolveShortcut(shortcut, today);
}

export function dateRangeFilter(config: DashboardConfig): DateRangeFilterConfig | null {
  return (config.filters ?? []).find((filter) => filter.type === 'dateRange') ?? null;
}

export function termsGroups(config: DashboardConfig): TermsGroupConfig[] {
  return (config.filters ?? []).filter((filter) => filter.type === 'termsGroup');
}

/**
 * Index a group's candidate values are counted on.
 *
 * The first index it declares, because that is where its fields live; the page's own otherwise.
 * Counting them on a page index the group does not constrain is how a fully populated dialog
 * comes back empty: `ecm:primaryType` aggregated against the audit answers nothing, and the
 * reader sees a filter with no values rather than a filter that does not apply here.
 */
export function indexOfGroup(config: DashboardConfig, group: TermsGroupConfig): EsIndex {
  return group.indices?.[0] ?? config.index;
}

export function pathScopeFilter(config: DashboardConfig): PathScopeFilterConfig | null {
  return (config.filters ?? []).find((filter) => filter.type === 'pathScope') ?? null;
}

/** Container the picker opens on when the reader has chosen nothing yet. */
export const DEFAULT_PATH_ROOT = '/default-domain';

/**
 * Initial state: the configured default range, and no constraint on any group.
 *
 * `today` is injectable so that a test can assert which days a shortcut resolves to without
 * freezing the clock of the whole suite.
 */
export function defaultFilterState(config?: DashboardConfig, today = new Date()): FilterState {
  if (!config) {
    return { range: dateRangeOption(undefined, today), groups: {}, picks: [], path: null };
  }

  const groups: Record<string, GroupSelection> = {};
  for (const group of termsGroups(config)) {
    groups[group.id] = Object.fromEntries(group.members.map((member) => [member.id, SELECT_ALL]));
  }

  return {
    range: dateRangeOption(dateRangeFilter(config)?.default, today),
    groups,
    picks: [],
    path: null,
  };
}

/**
 * Member a click on this field should be routed to, if any group declares one.
 *
 * Two paths exist to the same constraint, the facet dialog and a click on a chart, and they must
 * not produce two independent states for one field, which would put "All selected" on the button
 * while a chip said otherwise.
 */
export function memberForField(
  config: DashboardConfig,
  field: string,
): { group: TermsGroupConfig; member: TermsMemberConfig } | null {
  for (const group of termsGroups(config)) {
    const member = group.members.find((candidate) => candidate.field === field);
    if (member) {
      return { group, member };
    }
  }
  return null;
}

/**
 * Field a click on these buckets filters on, or null when the buckets are not values of one.
 *
 * Only `terms` qualifies. The bucket of a histogram or of a range aggregation names an interval,
 * and its key — `2026-09-15`, `over 30 days late` — is not something the field ever equals.
 */
export function pickableField(widget: WidgetConfig): string | null {
  if (isKpiWidget(widget) || isTableWidget(widget)) {
    return null;
  }
  return (widget.agg as { terms?: { field?: string } }).terms?.field ?? null;
}

/** True when that exact value is already picked. */
export function isPicked(state: FilterState, field: string, value: string): boolean {
  return state.picks.some((pick) => pick.field === field && pick.value === value);
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
