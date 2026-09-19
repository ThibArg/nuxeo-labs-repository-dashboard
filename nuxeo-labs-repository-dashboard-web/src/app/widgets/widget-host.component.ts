import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

/**
 * Card frame shared by every non KPI widget: title, optional badge, and the four display states
 * (loading, error, empty, content). Keeping them here means no widget has to reimplement them.
 */
@Component({
  selector: 'nxd-widget-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full' },
  template: `
    <section class="nxd-card flex h-full flex-col p-5">
      <header class="mb-4 flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="nxd-card-title truncate">{{ label() }}</h2>
          @if (hint(); as text) {
            <p class="mt-1 truncate text-xs text-ink-subtle">{{ text }}</p>
          }
        </div>
        <div class="flex shrink-0 items-center gap-2">
          @if (badge(); as text) {
            <span class="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">
              {{ text }}
            </span>
          }
          <!--
            Shown only once there is something to write. Offering the action while a widget is
            loading, failing or empty would hand the reader a file describing nothing.
          -->
          @if (exportable()) {
            @if (canExportCsv()) {
              <button
                type="button"
                class="nxd-icon-button"
                title="Download the data as CSV"
                [attr.aria-label]="'Download ' + label() + ' as CSV'"
                (click)="exportCsv.emit()"
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
                  <path d="M12 4v10m0 0 4-4m-4 4-4-4M5 19h14" />
                </svg>
              </button>
            }
            @if (canExportPng()) {
              <button
                type="button"
                class="nxd-icon-button"
                title="Download the chart as PNG"
                [attr.aria-label]="'Download ' + label() + ' as PNG'"
                (click)="exportPng.emit()"
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
                  <path d="M4 5h16v14H4z" />
                  <path d="m4 16 5-5 4 4 3-3 4 4" />
                </svg>
              </button>
            }
          }
        </div>
      </header>

      <div class="min-h-0 flex-1">
        @if (loading()) {
          <div class="flex h-full min-h-40 flex-col justify-end gap-2" aria-busy="true">
            @for (bar of skeleton; track bar) {
              <span class="block animate-pulse rounded bg-black/5" [style.height.%]="bar"></span>
            }
          </div>
        } @else if (error(); as message) {
          <p class="text-sm text-danger" [title]="message">{{ message }}</p>
        } @else if (empty()) {
          <p class="flex h-full min-h-40 items-center justify-center text-sm text-ink-subtle">
            {{ emptyLabel() }}
          </p>
        } @else {
          <ng-content />
        }
      </div>

      @if (!loading() && !error() && footer(); as text) {
        <p class="mt-3 shrink-0 text-xs text-ink-subtle" [title]="footerTitle() || text">
          {{ text }}
        </p>
      }
    </section>
  `,
})
export class WidgetHostComponent {
  readonly label = input.required<string>();
  readonly hint = input<string | null>(null);
  readonly badge = input<string | null>(null);
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly empty = input(false);
  readonly emptyLabel = input('No data for the current filters');

  /** Whether this widget can write a file at all, whatever its current state. */
  readonly canExportCsv = input(false);
  readonly canExportPng = input(false);

  readonly exportCsv = output<void>();
  readonly exportPng = output<void>();

  /** Nothing to export while the widget is loading, failing, or has no data to describe. */
  protected readonly exportable = computed(() => !this.loading() && !this.error() && !this.empty());

  /** Discreet line under the content, used to own up to a truncated list. */
  readonly footer = input<string | null>(null);
  /** Fuller explanation, shown on hover. */
  readonly footerTitle = input<string | null>(null);

  /** Heights of the loading placeholder bars, as a share of the available box. */
  protected readonly skeleton = [18, 34, 26, 44, 30];

  protected readonly describedState = computed(() =>
    this.loading() ? 'loading' : this.error() ? 'error' : this.empty() ? 'empty' : 'ready',
  );
}
