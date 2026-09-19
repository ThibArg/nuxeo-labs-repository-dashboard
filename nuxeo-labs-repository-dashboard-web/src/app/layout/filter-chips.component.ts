import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { BucketPick } from '../config/dashboard-config.model';

/**
 * Removable summary of the constraints added by clicking a chart.
 *
 * Only picks appear here. A group's selection is already named by its own button, which is also
 * the way to edit it, so rendering it a second time would give a reader two places to reconcile
 * and this application two places to keep in sync. A pick has no button, and without a chip it
 * would be a one way trip: nothing else on screen could say it exists, let alone undo it.
 */
@Component({
  selector: 'nxd-filter-chips',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (picks().length || clearable()) {
      <div class="flex flex-wrap items-center gap-2">
        @for (pick of picks(); track pick.field + '=' + pick.value) {
          <span
            class="inline-flex items-center gap-1.5 rounded-full border border-accent-soft bg-accent-soft py-1 pl-2.5 pr-1 text-xs text-accent"
            [title]="pick.field + ' = ' + pick.value"
          >
            <span class="text-accent/70">{{ pick.field }}</span>
            <span class="font-medium">{{ pick.label }}</span>
            <button
              type="button"
              class="rounded-full p-0.5 hover:bg-accent/15"
              [attr.aria-label]="'Remove filter ' + pick.label"
              [disabled]="disabled()"
              (click)="removed.emit(pick)"
            >
              <svg
                viewBox="0 0 24 24"
                class="h-3 w-3"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                aria-hidden="true"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </span>
        }

        @if (clearable()) {
          <button
            type="button"
            class="text-xs font-medium text-ink-muted underline hover:text-ink"
            [disabled]="disabled()"
            (click)="cleared.emit()"
          >
            Clear filters
          </button>
        }
      </div>
    }
  `,
})
export class FilterChipsComponent {
  readonly picks = input<BucketPick[]>([]);
  /** True when anything at all is constrained, groups included, so one click can undo the lot. */
  readonly clearable = input(false);
  readonly disabled = input(false);

  readonly removed = output<BucketPick>();
  readonly cleared = output<void>();
}
