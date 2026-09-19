import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
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
import { LabelService } from '../core/label.service';
import { DashboardRunner } from '../engine/dashboard-runner.service';
import { FacetStorageService } from '../engine/facet-storage.service';
import { FacetValuesService, GroupValues } from '../engine/facet-values.service';
import { Container, PathBrowserService } from '../engine/path-browser.service';
import { DashboardGridComponent } from '../layout/dashboard-grid.component';
import { DateRangePickerComponent } from '../layout/date-range-picker.component';
import { FacetGroupButtonComponent } from '../layout/facet-group-button.component';
import { FacetGroupDialogComponent } from '../layout/facet-group-dialog.component';
import { FilterChipsComponent } from '../layout/filter-chips.component';
import { PathScopePickerComponent } from '../layout/path-scope-picker.component';
import { PageHeaderComponent } from '../layout/page-header.component';
import { BucketClick } from '../widgets/chart-widget.component';
import {
  PreflightFeature,
  RequirementNoticeComponent,
} from '../layout/requirement-notice.component';

/** Member id to (raw value -> label), for one group. */
type GroupLabels = Map<string, Map<string, string>>;

/**
 * Generic dashboard page.
 *
 * Everything on screen comes from the JSON configuration named by the route: adding a chart or a
 * filter means editing `assets/dashboards/<id>.json`, not this component.
 */
@Component({
  selector: 'nxd-dashboard-page',
  imports: [
    DashboardGridComponent,
    DateRangePickerComponent,
    FacetGroupButtonComponent,
    FacetGroupDialogComponent,
    FilterChipsComponent,
    PageHeaderComponent,
    PathScopePickerComponent,
    RequirementNoticeComponent,
  ],
  providers: [DashboardRunner],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nxd-page-header
      [title]="config()?.label ?? 'Dashboard'"
      [subtitle]="subtitle()"
      [busy]="runner.loading()"
      (refresh)="reload()"
    />

    <section class="px-8 pb-8">
      <nxd-requirement-notice
        class="mb-5 block"
        [requires]="requires()"
        [label]="requirementLabel()"
        [docUrl]="requirementDocUrl()"
      />

      @if (configError(); as message) {
        <div class="nxd-card border-danger-soft bg-danger-soft p-4 text-sm text-danger">
          <p class="font-semibold">This dashboard could not be loaded.</p>
          <p class="mt-1 break-words">{{ message }}</p>
        </div>
      } @else if (config(); as dashboard) {
        @if (hasFilters()) {
          <!--
            Sticky, because the filter bar is the only thing naming the population the figures
            describe. Scrolling down to a chart used to lose that context entirely.
          -->
          <div
            class="sticky top-0 z-20 -mx-8 mb-5 flex flex-wrap items-center gap-3 border-b border-subtle bg-canvas/95 px-8 py-3 backdrop-blur"
          >
            @if (dateFilter(); as range) {
              <nxd-date-range-picker
                [selected]="filters().range"
                [field]="range.field"
                [disabled]="runner.loading()"
                (rangeChange)="changeRange($event)"
              />
              <span class="text-xs text-ink-subtle">on {{ range.field }}</span>
            }

            @if (pathFilter(); as scope) {
              <nxd-path-scope-picker
                [label]="scope.label ?? 'Location'"
                [current]="browsedPath()"
                [selected]="filters().path"
                [containers]="containers()"
                [open]="pathPickerOpen()"
                [loading]="browsing()"
                [disabled]="runner.loading()"
                (opened)="openPathPicker()"
                (closed)="pathPickerOpen.set(false)"
                (browse)="browseTo($event)"
                (applied)="applyPath($event)"
              />
            }

            @for (group of groups(); track group.id) {
              <nxd-facet-group-button
                [group]="group"
                [selection]="selectionFor(group.id)"
                [labels]="labelsFor(group.id)"
                [disabled]="runner.loading()"
                (opened)="openGroup(group)"
              />
            }

            <nxd-filter-chips
              [picks]="filters().picks"
              [clearable]="anyConstrained()"
              [disabled]="runner.loading()"
              (removed)="removePick($event)"
              (cleared)="clearFilters()"
            />
          </div>
        }

        @if (runner.error(); as message) {
          <div class="nxd-card mb-5 border-danger-soft bg-danger-soft p-4 text-sm text-danger">
            <p class="font-semibold">The index could not be queried.</p>
            <p class="mt-1 break-words">{{ message }}</p>
          </div>
        }

        <nxd-dashboard-grid
          [config]="dashboard"
          [range]="filters().range"
          [data]="runner.data()"
          [bucketLabels]="runner.bucketLabels()"
          [columnLabels]="runner.columnLabels()"
          [widgetErrors]="runner.widgetErrors()"
          [loading]="runner.loading()"
          [error]="runner.error()"
          (picked)="pickBucket($event)"
        />

        @for (group of groups(); track group.id) {
          <nxd-facet-group-dialog
            [group]="group"
            [open]="openGroupId() === group.id"
            [values]="valuesFor(group.id)"
            [labels]="labelsFor(group.id)"
            [selection]="selectionFor(group.id)"
            (applied)="applyGroup(group, $event)"
            (closed)="closeGroup()"
          />
        }
      } @else {
        <p class="text-sm text-ink-muted">Loading configuration…</p>
      }
    </section>
  `,
})
export class DashboardPageComponent {
  private readonly configs = inject(DashboardConfigService);
  private readonly facetValues = inject(FacetValuesService);
  private readonly pathBrowser = inject(PathBrowserService);
  private readonly storage = inject(FacetStorageService);
  private readonly labelService = inject(LabelService);
  readonly runner = inject(DashboardRunner);

  /** Bound from the route data through `withComponentInputBinding()`. */
  readonly dashboardId = input('content');

  /** Server prerequisite this dashboard needs, surfaced as a notice when the preflight missed it. */
  readonly requires = input<PreflightFeature | ''>('');
  readonly requirementLabel = input('');
  readonly requirementDocUrl = input('');

  readonly config = signal<DashboardConfig | null>(null);
  readonly configError = signal<string | null>(null);
  readonly filters = signal<FilterState>(defaultFilterState());

  readonly openGroupId = signal<string | null>(null);
  readonly pathPickerOpen = signal(false);
  readonly browsedPath = signal(DEFAULT_PATH_ROOT);
  readonly containers = signal<Container[]>([]);
  readonly browsing = signal(false);
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

  constructor() {
    // Reloads whenever the route points at another dashboard.
    effect(() => {
      const id = this.dashboardId();
      void this.loadConfig(id);
    });
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
