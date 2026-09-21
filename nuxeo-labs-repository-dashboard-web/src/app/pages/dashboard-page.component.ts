import { ChangeDetectionStrategy, Component, effect, inject, input } from '@angular/core';
import { DashboardRunner } from '../engine/dashboard-runner.service';
import { DashboardSession } from '../engine/dashboard-session.service';
import { DashboardFiltersComponent } from '../layout/dashboard-filters.component';
import { DashboardGridComponent } from '../layout/dashboard-grid.component';
import { DashboardHeaderComponent } from '../layout/dashboard-header.component';
import { ExportRootDirective } from '../layout/export-root.directive';
import {
  PreflightFeature,
  RequirementNoticeComponent,
} from '../layout/requirement-notice.component';

/**
 * The dashboard page that ships: a filter bar and a twelve column grid.
 *
 * It owns its markup and nothing else. Everything a reader does to a dashboard — loading it,
 * filtering it, clicking a bucket, editing its configuration, taking it away — lives in
 * `DashboardSession`, and each piece of furniture reads that session directly. A bespoke screen
 * laying widgets out differently writes its own template and reuses all of this, which is what
 * this one is here to demonstrate as much as to serve.
 */
@Component({
  selector: 'nxd-dashboard-page',
  imports: [
    DashboardFiltersComponent,
    DashboardGridComponent,
    DashboardHeaderComponent,
    ExportRootDirective,
    RequirementNoticeComponent,
  ],
  providers: [DashboardRunner, DashboardSession],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nxd-dashboard-header />

    <section class="px-8 pb-8">
      <nxd-requirement-notice
        class="mb-5 block"
        [requires]="requires()"
        [label]="requirementLabel()"
        [docUrl]="requirementDocUrl()"
      />

      @if (session.configError(); as message) {
        <div class="nxd-card border-danger-soft bg-danger-soft p-4 text-sm text-danger">
          <p class="font-semibold">This dashboard could not be loaded.</p>
          <p class="mt-1 break-words">{{ message }}</p>
        </div>
      } @else if (session.config()) {
        <nxd-dashboard-filters />

        @if (session.runner.error(); as message) {
          <div class="nxd-card mb-5 border-danger-soft bg-danger-soft p-4 text-sm text-danger">
            <p class="font-semibold">The index could not be queried.</p>
            <p class="mt-1 break-words">{{ message }}</p>
          </div>
        }

        <div nxdExportRoot>
          <nxd-dashboard-grid />
        </div>
      } @else {
        <p class="text-sm text-ink-muted">Loading configuration…</p>
      }
    </section>
  `,
})
export class DashboardPageComponent {
  protected readonly session = inject(DashboardSession);

  /** Bound from the route data through `withComponentInputBinding()`. */
  readonly dashboardId = input('content');

  /** Server prerequisite this dashboard needs, surfaced as a notice when the preflight missed it. */
  readonly requires = input<PreflightFeature | ''>('');
  readonly requirementLabel = input('');
  readonly requirementDocUrl = input('');

  constructor() {
    // Reloads whenever the route points at another dashboard.
    effect(() => {
      const id = this.dashboardId();
      void this.session.open(id);
    });
  }
}
