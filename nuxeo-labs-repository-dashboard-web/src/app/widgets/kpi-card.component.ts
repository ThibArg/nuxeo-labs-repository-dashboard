import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { KpiSeverity, KpiWidgetConfig } from '../config/dashboard-config.model';
import { formatNumber } from '../core/format';
import { WidgetData } from '../engine/result-mapper';

/**
 * Single figure tile.
 *
 * The severity drives the colour scheme, so a configuration can turn a tile red or amber without
 * touching the component.
 */
@Component({
  selector: 'nxd-kpi-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full' },
  template: `
    <div class="nxd-card flex h-full min-h-28 flex-col justify-between p-4" [class]="cardClasses()">
      <span class="text-sm font-medium leading-snug" [class]="mutedClasses()">{{
        config().label
      }}</span>

      @if (loading()) {
        <span class="mt-3 block h-8 w-16 animate-pulse rounded bg-black/10" aria-busy="true"></span>
      } @else if (error(); as message) {
        <span class="mt-3 block text-sm font-medium text-danger" [title]="message"
          >Unavailable</span
        >
      } @else {
        <span class="mt-2 text-3xl font-semibold tabular-nums" [class]="valueClasses()">
          {{ formatted() }}
        </span>
        @if (secondaryLabel(); as text) {
          <span class="mt-0.5 text-xs tabular-nums" [class]="mutedClasses()">{{ text }}</span>
        }
      }

      @if (config().hint; as text) {
        <span class="mt-1 text-xs" [class]="mutedClasses()">{{ text }}</span>
      }
    </div>
  `,
})
export class KpiCardComponent {
  readonly config = input.required<KpiWidgetConfig>();
  readonly data = input<WidgetData | undefined>(undefined);
  readonly loading = input(false);
  readonly error = input<string | null>(null);

  private readonly severity = computed<KpiSeverity>(() => this.config().severity ?? 'neutral');

  readonly formatted = computed(() => {
    const data = this.data();
    if (!data || data.kind !== 'scalar') {
      return '—';
    }
    return formatNumber(data.value, this.config().format);
  });

  /** Rendered secondary line, or null when there is none, or when it is hidden at zero. */
  readonly secondaryLabel = computed<string | null>(() => {
    const secondary = this.config().secondary;
    const data = this.data();

    if (!secondary || !data || data.kind !== 'scalar' || data.secondary === undefined) {
      return null;
    }
    if (data.secondary === 0 && secondary.hideWhenZero) {
      return null;
    }

    return secondary.label.replace('{value}', formatNumber(data.secondary, secondary.format));
  });

  readonly cardClasses = computed(() => {
    switch (this.severity()) {
      case 'danger':
        return 'bg-danger-soft border-danger-soft';
      case 'warning':
        return 'bg-warning-soft border-warning-soft';
      case 'success':
        return 'bg-success-soft border-success-soft';
      case 'accent':
        return 'border-accent';
      default:
        return '';
    }
  });

  readonly valueClasses = computed(() => {
    switch (this.severity()) {
      case 'danger':
        return 'text-danger';
      case 'warning':
        return 'text-warning';
      case 'success':
        return 'text-success';
      default:
        return 'text-ink';
    }
  });

  readonly mutedClasses = computed(() => {
    switch (this.severity()) {
      case 'danger':
        return 'text-danger';
      case 'warning':
        return 'text-warning';
      case 'success':
        return 'text-success';
      default:
        return 'text-ink-muted';
    }
  });
}
