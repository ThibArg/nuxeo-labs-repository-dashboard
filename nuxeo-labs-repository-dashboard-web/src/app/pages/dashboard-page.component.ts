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
  DashboardConfig,
  DateRangeOption,
  FilterState,
  GroupSelection,
  TermsGroupConfig,
  dateRangeFilter,
  defaultFilterState,
  termsGroups,
} from '../config/dashboard-config.model';
import { DashboardConfigService } from '../config/dashboard-config.service';
import { LabelService } from '../core/label.service';
import { DashboardRunner } from '../engine/dashboard-runner.service';
import { FacetStorageService } from '../engine/facet-storage.service';
import { FacetValuesService, GroupValues } from '../engine/facet-values.service';
import { DashboardGridComponent } from '../layout/dashboard-grid.component';
import { DateRangePickerComponent } from '../layout/date-range-picker.component';
import { FacetGroupButtonComponent } from '../layout/facet-group-button.component';
import { FacetGroupDialogComponent } from '../layout/facet-group-dialog.component';
import { PageHeaderComponent } from '../layout/page-header.component';
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
    PageHeaderComponent,
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
          <div class="mb-5 flex flex-wrap items-center gap-3">
            @if (dateFilter(); as range) {
              <nxd-date-range-picker
                [selected]="filters().range"
                [field]="range.field"
                [disabled]="runner.loading()"
                (rangeChange)="changeRange($event)"
              />
              <span class="text-xs text-ink-subtle">on {{ range.field }}</span>
            }

            @for (group of groups(); track group.id) {
              <nxd-facet-group-button
                [group]="group"
                [selection]="selectionFor(group.id)"
                [disabled]="runner.loading()"
                (opened)="openGroup(group)"
              />
            }
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
  readonly hasFilters = computed(() => !!this.dateFilter() || this.groups().length > 0);

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

  private async loadConfig(id: string): Promise<void> {
    this.configError.set(null);
    this.values.set(new Map());
    this.labels.set(new Map());

    try {
      const config = await this.configs.load(id);
      this.config.set(config);
      this.filters.set(this.restoreFilters(id, config));
      await this.runCurrent();
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
