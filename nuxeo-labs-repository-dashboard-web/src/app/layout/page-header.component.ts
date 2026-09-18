import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * Title bar of a dashboard page, with the Refresh / Export actions of the reference layout.
 * Export stays disabled until the export pipeline lands in a later phase.
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

        <button
          type="button"
          class="nxd-toolbar-button"
          disabled
          title="Available in a later phase"
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
            <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19h16" />
          </svg>
          Export
        </button>
      </div>
    </header>
  `,
})
export class PageHeaderComponent {
  readonly title = input.required<string>();
  readonly subtitle = input<string | null>(null);
  readonly busy = input(false);

  readonly refresh = output<void>();
}
