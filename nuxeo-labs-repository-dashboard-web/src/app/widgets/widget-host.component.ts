import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

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
        @if (badge(); as text) {
          <span
            class="shrink-0 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent"
          >
            {{ text }}
          </span>
        }
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

  /** Heights of the loading placeholder bars, as a share of the available box. */
  protected readonly skeleton = [18, 34, 26, 44, 30];

  protected readonly describedState = computed(() =>
    this.loading() ? 'loading' : this.error() ? 'error' : this.empty() ? 'empty' : 'ready',
  );
}
