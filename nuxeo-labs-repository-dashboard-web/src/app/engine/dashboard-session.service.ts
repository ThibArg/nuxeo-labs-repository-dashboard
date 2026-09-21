import { Injectable, computed, inject, signal } from '@angular/core';
import {
  BucketPick,
  DEFAULT_PATH_ROOT,
  DashboardConfig,
  DateRangeOption,
  FilterState,
  GroupSelection,
  SELECT_ALL,
  TermsGroupConfig,
  TermsMemberConfig,
  dateRangeFilter,
  defaultFilterState,
  isConstrained,
  memberForField,
  pathScopeFilter,
  termsGroups,
} from '../config/dashboard-config.model';
import { DashboardConfigService } from '../config/dashboard-config.service';
import { AppStylesService } from '../core/app-styles.service';
import { downloadFile, safeFilename } from '../core/export';
import { LabelService } from '../core/label.service';
import { DashboardRunner } from './dashboard-runner.service';
import { FacetStorageService } from './facet-storage.service';
import { FacetValuesService, GroupValues } from './facet-values.service';
import { buildDashboardHtml } from './dashboard-html';
import { DashboardOverrideService, validateConfig } from './dashboard-override.service';
import { describeFilters } from './facet-clause';
import { Container, PathBrowserService } from './path-browser.service';
import { BucketClick } from '../widgets/chart-widget.component';
import { ChartSnapshotRegistry } from '../widgets/chart-snapshot.registry';

/** Member id to (raw value -> label), for one group. */
export type GroupLabels = Map<string, Map<string, string>>;

/**
 * One dashboard being looked at.
 *
 * Everything a reader does to a dashboard lives here — which configuration is in force, what it is
 * filtered by, what the last run answered, which dialog is open — and none of it says where a
 * widget is drawn. That separation is the point: a page component owns its markup and nothing
 * else, so a dashboard can be laid out in a bespoke screen, with tabs or panels or anything else,
 * without re-implementing a line of this.
 *
 * Provided per page rather than in root, like `DashboardRunner`: two dashboards open at once are
 * two sessions. A component placing widgets must therefore declare
 * `providers: [DashboardSession]`, or injection fails loudly at construction.
 */
@Injectable()
export class DashboardSession {
  private readonly configs = inject(DashboardConfigService);
  private readonly facetValues = inject(FacetValuesService);
  private readonly pathBrowser = inject(PathBrowserService);
  private readonly overrides = inject(DashboardOverrideService);
  private readonly snapshots = inject(ChartSnapshotRegistry);
  private readonly appStyles = inject(AppStylesService);
  private readonly storage = inject(FacetStorageService);
  private readonly labelService = inject(LabelService);

  readonly runner = inject(DashboardRunner);

  /** Dashboard this session is looking at, set by `open`. */
  readonly dashboardId = signal('');

  readonly config = signal<DashboardConfig | null>(null);
  readonly configError = signal<string | null>(null);
  readonly filters = signal<FilterState>(defaultFilterState());

  readonly openGroupId = signal<string | null>(null);
  readonly pathPickerOpen = signal(false);
  readonly browsedPath = signal(DEFAULT_PATH_ROOT);
  readonly containers = signal<Container[]>([]);
  readonly browsing = signal(false);

  readonly editorOpen = signal(false);
  readonly editorSource = signal('');
  readonly editorProblems = signal<string[]>([]);
  readonly overridden = signal(false);

  /**
   * Element the HTML export clones.
   *
   * Registered by `nxdExportRoot` rather than found by a view query, because only the page knows
   * which part of its markup is the dashboard and which is chrome.
   */
  private exportRoot: Element | null = null;

  private readonly values = signal<Map<string, GroupValues>>(new Map());
  private readonly labels = signal<Map<string, GroupLabels>>(new Map());

  readonly subtitle = computed(() => this.config()?.subtitle ?? this.runner.summary());
  readonly groups = computed<TermsGroupConfig[]>(() => {
    const config = this.config();
    return config ? termsGroups(config) : [];
  });
  readonly dateFilter = computed(() => {
    const config = this.config();
    return config ? dateRangeFilter(config) : null;
  });
  readonly pathFilter = computed(() => {
    const config = this.config();
    return config ? pathScopeFilter(config) : null;
  });
  readonly hasFilters = computed(
    () =>
      !!this.dateFilter() ||
      !!this.pathFilter() ||
      this.groups().length > 0 ||
      this.filters().picks.length > 0,
  );

  /** Anything at all narrowing the figures, which is what makes "Clear filters" worth offering. */
  readonly anyConstrained = computed(
    () =>
      this.filters().picks.length > 0 ||
      !!this.filters().path ||
      Object.values(this.filters().groups).some((group) =>
        Object.values(group).some(isConstrained),
      ),
  );

  /** Loads a dashboard and runs it. Called again when the route points at another one. */
  async open(dashboardId: string): Promise<void> {
    this.dashboardId.set(dashboardId);
    await this.loadConfig(dashboardId);
  }

  registerExportRoot(element: Element | null): void {
    this.exportRoot = element;
  }

  selectionFor(groupId: string): GroupSelection {
    return this.filters().groups[groupId] ?? {};
  }

  valuesFor(groupId: string): GroupValues {
    return this.values().get(groupId) ?? new Map();
  }

  labelsFor(groupId: string): GroupLabels {
    return this.labels().get(groupId) ?? new Map();
  }

  changeRange(range: DateRangeOption): void {
    this.filters.update((state) => ({ ...state, range }));
    void this.runCurrent();
  }

  /**
   * Values are fetched when the dialog is first opened rather than with the dashboard: a user who
   * never opens the editor never pays for the extra request.
   */
  async openGroup(group: TermsGroupConfig): Promise<void> {
    this.openGroupId.set(group.id);
    await this.loadGroupValues(group);
  }

  closeGroup(): void {
    this.openGroupId.set(null);
  }

  applyGroup(group: TermsGroupConfig, selection: GroupSelection): void {
    this.openGroupId.set(null);
    this.filters.update((state) => ({
      ...state,
      groups: { ...state.groups, [group.id]: selection },
    }));
    this.storage.write(this.dashboardId(), group, selection);
    void this.runCurrent();
  }

  reload(): void {
    this.configs.invalidate(this.dashboardId());
    this.facetValues.invalidate();
    void this.loadConfig(this.dashboardId());
  }

  /** Opens on what is in force, as it was written, whether that is an edit or what ships. */
  openEditor(): void {
    const config = this.config();
    if (!config) {
      return;
    }
    this.editorSource.set(
      this.overrides.read(this.dashboardId()) ??
        this.configs.sourceOf(this.dashboardId()) ??
        JSON.stringify(config, null, 2),
    );
    this.editorProblems.set([]);
    this.editorOpen.set(true);
  }

  closeEditor(): void {
    this.editorOpen.set(false);
  }

  validateDraft(json: string): void {
    this.editorProblems.set(validateConfig(json, this.dashboardId()).problems);
  }

  saveConfig(json: string): void {
    if (validateConfig(json, this.dashboardId()).problems.length) {
      return;
    }
    this.overrides.write(this.dashboardId(), json);
    this.editorOpen.set(false);
    this.reload();
  }

  revertConfig(): void {
    this.overrides.clear(this.dashboardId());
    this.editorOpen.set(false);
    this.reload();
  }

  /**
   * Writes the page as one file that depends on nothing.
   *
   * The charts are photographed before the clone is taken: a canvas copies as a blank one, so the
   * images have to come from the live instances rather than from the copy. A chart that has never
   * been rendered — one sitting in a tab nobody opened — has no photograph, so an export shows
   * what was on screen rather than everything the dashboard declares.
   */
  async exportHtml(): Promise<void> {
    const config = this.config();
    if (!config || !this.exportRoot) {
      return;
    }

    const html = buildDashboardHtml(this.exportRoot, {
      title: config.label,
      subtitle: config.subtitle ?? null,
      context: describeFilters(config, this.filters()),
      images: this.snapshots.capture(),
      css: await this.appStyles.load(),
      generatedAt: new Date(),
    });

    downloadFile(`${safeFilename(config.label)}.html`, 'text/html;charset=utf-8', html);
  }

  print(): void {
    globalThis.print?.();
  }

  /**
   * Narrows the dashboard to the bucket that was clicked, or widens it again if it was already the
   * constraint.
   *
   * A value whose field a group declares is routed into that group rather than kept apart, so the
   * two ways of expressing one constraint — this click and the facet dialog — never disagree on
   * screen. Everything else becomes a pick.
   */
  pickBucket(click: BucketClick): void {
    const config = this.config();
    if (!config) {
      return;
    }

    const routed = memberForField(config, click.field);
    if (routed) {
      this.toggleMemberValue(routed.group, routed.member, click.value);
    } else {
      this.togglePick(click);
    }
    void this.runCurrent();
  }

  removePick(pick: BucketPick): void {
    this.filters.update((state) => ({
      ...state,
      picks: state.picks.filter(
        (current) => current.field !== pick.field || current.value !== pick.value,
      ),
    }));
    void this.runCurrent();
  }

  /** Drops every constraint but the period, which is a reading window rather than a filter. */
  clearFilters(): void {
    const config = this.config();
    if (!config) {
      return;
    }

    for (const group of termsGroups(config)) {
      this.storage.clear(this.dashboardId(), group);
    }
    this.filters.update((state) => ({
      ...state,
      groups: defaultFilterState(config).groups,
      picks: [],
      path: null,
    }));
    void this.runCurrent();
  }

  /** Opens on the container in force, so the trail starts where the figures already are. */
  async openPathPicker(): Promise<void> {
    this.pathPickerOpen.set(true);
    const start = this.filters().path ?? this.pathFilter()?.root ?? DEFAULT_PATH_ROOT;
    await this.browseTo(start);
  }

  closePathPicker(): void {
    this.pathPickerOpen.set(false);
  }

  async browseTo(path: string): Promise<void> {
    const config = this.config();
    if (!config) {
      return;
    }

    this.browsedPath.set(path);
    this.browsing.set(true);
    try {
      this.containers.set(await this.pathBrowser.children(config.index, path));
    } catch {
      // A level that cannot be listed shows as empty; the trail still walks back up.
      this.containers.set([]);
    } finally {
      this.browsing.set(false);
    }
  }

  applyPath(path: string | null): void {
    this.pathPickerOpen.set(false);
    this.filters.update((state) => ({ ...state, path }));
    void this.runCurrent();
  }

  /**
   * Adds the value to the member's selection, or takes it out when it was already there.
   *
   * An emptied subset goes back to "all" rather than staying an empty list: an empty `terms` clause
   * matches nothing, so the dashboard would read zero everywhere instead of unfiltered.
   */
  private toggleMemberValue(
    group: TermsGroupConfig,
    member: TermsMemberConfig,
    value: string,
  ): void {
    const current = this.filters().groups[group.id]?.[member.id] ?? SELECT_ALL;
    const values = current.mode === 'subset' ? current.values : [];
    const next = values.includes(value)
      ? values.filter((candidate) => candidate !== value)
      : [...values, value];

    const selection: GroupSelection = {
      ...(this.filters().groups[group.id] ?? {}),
      [member.id]: next.length ? { mode: 'subset', values: next } : SELECT_ALL,
    };

    this.filters.update((state) => ({
      ...state,
      groups: { ...state.groups, [group.id]: selection },
    }));
    this.storage.write(this.dashboardId(), group, selection);
  }

  private togglePick(click: BucketClick): void {
    this.filters.update((state) => {
      const without = state.picks.filter(
        (pick) => pick.field !== click.field || pick.value !== click.value,
      );
      const removed = without.length !== state.picks.length;
      return { ...state, picks: removed ? without : [...state.picks, click] };
    });
  }

  private async loadConfig(id: string): Promise<void> {
    this.configError.set(null);
    this.values.set(new Map());
    this.labels.set(new Map());

    try {
      const config = await this.configs.load(id);
      this.config.set(config);
      this.overridden.set(this.configs.isOverridden(id));
      this.filters.set(this.restoreFilters(id, config));
      await this.runCurrent();
      /*
       * A persisted selection is restored before anything is displayed, so the filter bar would
       * name it by its raw value until the reader happened to open the dialog. Only constrained
       * groups are fetched, so an unfiltered dashboard still costs a single request.
       */
      await Promise.all(
        termsGroups(config)
          .filter((group) =>
            Object.values(this.filters().groups[group.id] ?? {}).some(isConstrained),
          )
          .map((group) => this.loadGroupValues(group)),
      );
    } catch (error) {
      this.config.set(null);
      this.configError.set(error instanceof Error ? error.message : String(error));
    }
  }

  /** Starts from the configured defaults, then overlays whatever was persisted for this dashboard. */
  private restoreFilters(dashboardId: string, config: DashboardConfig): FilterState {
    const state = defaultFilterState(config);
    for (const group of termsGroups(config)) {
      state.groups[group.id] = this.storage.read(dashboardId, group);
    }
    return state;
  }

  private async loadGroupValues(group: TermsGroupConfig): Promise<void> {
    const config = this.config();
    if (!config) {
      return;
    }

    try {
      const signature = FacetValuesService.signatureOf(config, group, this.filters());
      const values = await this.facetValues.load(config, group, this.filters(), signature);
      this.values.update((current) => new Map(current).set(group.id, values));

      const labels: GroupLabels = new Map();
      await Promise.all(
        group.members.map(async (member) => {
          const raw = values.get(member.id)?.values.map((entry) => entry.value) ?? [];
          labels.set(member.id, await this.labelService.resolve(member.labels, raw));
        }),
      );
      this.labels.update((current) => new Map(current).set(group.id, labels));
    } catch {
      // The dialog degrades to an empty list; the dashboard itself keeps working.
      this.values.update((current) => new Map(current).set(group.id, new Map()));
    }
  }

  private async runCurrent(): Promise<void> {
    const config = this.config();
    if (config) {
      await this.runner.run(config, this.filters());
    }
  }
}
