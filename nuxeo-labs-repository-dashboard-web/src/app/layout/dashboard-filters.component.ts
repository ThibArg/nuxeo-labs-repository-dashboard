import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DashboardSession } from '../engine/dashboard-session.service';
import { DateRangePickerComponent } from './date-range-picker.component';
import { FacetGroupButtonComponent } from './facet-group-button.component';
import { FacetGroupDialogComponent } from './facet-group-dialog.component';
import { FilterChipsComponent } from './filter-chips.component';
import { PathScopePickerComponent } from './path-scope-picker.component';

/**
 * Everything narrowing the figures, and the dialogs behind it.
 *
 * Self-contained on purpose: the buttons and the dialogs they open travel together, so a bespoke
 * page gets a working period, facet groups and container picker from one tag rather than from
 * sixty lines it would have to keep in step with this one.
 *
 * Renders nothing when the dashboard declares no filter and reads no audit, which is what keeps it
 * droppable into a page without knowing whether that dashboard has any. The audit's start is said
 * even without a filter: a page with no period reads all of the audit, which is "All time".
 */
@Component({
  selector: 'nxd-dashboard-filters',
  imports: [
    DateRangePickerComponent,
    FacetGroupButtonComponent,
    FacetGroupDialogComponent,
    FilterChipsComponent,
    PathScopePickerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (session.hasFilters()) {
      <!--
        Sticky, because the filter bar is the only thing naming the population the figures
        describe. Scrolling down to a chart used to lose that context entirely.
      -->
      <div
        class="nxd-filter-bar sticky top-0 z-20 -mx-8 mb-5 flex flex-wrap items-center gap-3 border-b border-subtle bg-canvas/95 px-8 py-3 backdrop-blur"
      >
        @if (session.dateFilter(); as range) {
          <nxd-date-range-picker
            [selected]="session.filters().range"
            [field]="range.field"
            [disabled]="session.runner.loading()"
            (rangeChange)="session.changeRange($event)"
          />
          <span class="text-xs text-ink-subtle">on {{ range.field }}</span>
        }

        @if (session.pathFilter(); as scope) {
          <nxd-path-scope-picker
            [label]="scope.label ?? 'Location'"
            [current]="session.browsedPath()"
            [selected]="session.filters().path"
            [containers]="session.containers()"
            [open]="session.pathPickerOpen()"
            [loading]="session.browsing()"
            [disabled]="session.runner.loading()"
            (opened)="session.openPathPicker()"
            (closed)="session.closePathPicker()"
            (browse)="session.browseTo($event)"
            (applied)="session.applyPath($event)"
          />
        }

        @for (group of session.groups(); track group.id) {
          <nxd-facet-group-button
            [group]="group"
            [selection]="session.selectionFor(group.id)"
            [labels]="session.labelsFor(group.id)"
            [disabled]="session.runner.loading()"
            (opened)="session.openGroup(group)"
          />
        }

        <nxd-filter-chips
          [picks]="session.filters().picks"
          [clearable]="session.anyConstrained()"
          [disabled]="session.runner.loading()"
          (removed)="session.removePick($event)"
          (cleared)="session.clearFilters()"
        />
      </div>

      @for (group of session.groups(); track group.id) {
        <nxd-facet-group-dialog
          [group]="group"
          [open]="session.openGroupId() === group.id"
          [values]="session.valuesFor(group.id)"
          [labels]="session.labelsFor(group.id)"
          [selection]="session.selectionFor(group.id)"
          (applied)="session.applyGroup(group, $event)"
          (closed)="session.closeGroup()"
        />
      }
    }

    <!--
      Under the bar rather than in it, and not sticky: it describes the index, not a choice the
      reader made, and it asks for attention only when the period reaches before the audit.
    -->
    @if (session.horizonNotice(); as notice) {
      <p
        class="nxd-horizon-notice mb-5"
        [class]="
          notice.warn
            ? 'nxd-card border-warning-soft bg-warning-soft px-4 py-3 text-sm text-warning'
            : 'text-xs text-ink-subtle'
        "
        role="note"
        data-testid="audit-horizon"
      >
        {{ notice.text }}
      </p>
    }

    <!--
      The bar itself is dropped on paper: a row of seven period buttons and two empty date fields
      describes an application rather than its figures, and never says which period is in force.
      What a reader needs out of context is the constraints, in words, and where the audit starts.

      It lives here rather than on the page because this component owns the bar: a bespoke screen
      dropping this tag in would otherwise get the bar without the thing that replaces it.
    -->
    @if (session.filterContext().length) {
      <ul class="nxd-print-context">
        @for (line of session.filterContext(); track line) {
          <li>{{ line }}</li>
        }
      </ul>
    }
  `,
})
export class DashboardFiltersComponent {
  protected readonly session = inject(DashboardSession);
}
