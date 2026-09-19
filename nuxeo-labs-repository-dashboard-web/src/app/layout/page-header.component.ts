import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * Title bar of a dashboard page.
 *
 * Export used to sit here, disabled, waiting for a pipeline. It landed per widget instead, only
 * a widget knowing what it is showing, so the slot carries the configuration editor now.
 */
@Component({
  selector: 'nxd-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="flex flex-wrap items-center justify-between gap-4 px-8 py-6">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-ink">{{ title() }}</h1>
        @if (subtitle(); as text) {
          <p class="mt-1 text-sm text-ink-muted">{{ text }}</p>
        }
      </div>

      <div class="flex items-center gap-3">
        <button
          type="button"
          class="nxd-toolbar-button"
          [disabled]="busy()"
          (click)="refresh.emit()"
        >
          <svg
            viewBox="0 0 24 24"
            class="h-4 w-4"
            [class.animate-spin]="busy()"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" />
          </svg>
          Refresh
        </button>

        @if (configurable()) {
          <button
            type="button"
            class="nxd-toolbar-button"
            [class.border-accent]="overridden()"
            [class.text-accent]="overridden()"
            [title]="
              overridden() ? 'This dashboard is edited in this browser' : 'Edit this dashboard'
            "
            (click)="configure.emit()"
          >
            <svg
              viewBox="0 0 24 24"
              class="h-4 w-4"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
              <circle cx="16" cy="7" r="2" />
              <circle cx="8" cy="17" r="2" />
            </svg>
            Configure
          </button>
        }
      </div>
    </header>
  `,
})
export class PageHeaderComponent {
  readonly title = input.required<string>();
  readonly subtitle = input<string | null>(null);
  readonly busy = input(false);
  /** False on a page with no configuration to edit, such as Diagnostics. */
  readonly configurable = input(false);
  /** True when an administrator's edit is in force, which the button says rather than hides. */
  readonly overridden = input(false);

  readonly refresh = output<void>();
  readonly configure = output<void>();
}
