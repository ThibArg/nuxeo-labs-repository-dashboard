import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ChartWidgetConfig } from '../config/dashboard-config.model';
import { formatNumber } from '../core/format';
import { WidgetData, isEmptyData } from '../engine/result-mapper';
import { chartPalette } from './chart-options';
import { truncationDetail, truncationFooter } from './truncation';
import { WidgetHostComponent } from './widget-host.component';

interface RankedEntry {
  key: string;
  label: string;
  value: string;
  /** Share of the largest value, as a percentage of the track width. */
  share: number;
  colour: string;
}

/**
 * Ranked list with proportional bars.
 *
 * Deliberately plain DOM rather than a chart: this is how the reference dashboards render their
 * "by policy" and "by type" breakdowns, it stays readable with long labels, and it keeps ECharts
 * out of the picture for what is essentially a table.
 */
@Component({
  selector: 'nxd-ranked-list',
  imports: [WidgetHostComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full' },
  template: `
    <nxd-widget-host
      [label]="config().label"
      [hint]="config().hint ?? null"
      [loading]="loading()"
      [error]="error()"
      [empty]="empty()"
      [footer]="footer()"
      [footerTitle]="footerTitle()"
    >
      <ul class="flex flex-col gap-3">
        @for (entry of entries(); track entry.key) {
          <li class="grid grid-cols-[minmax(6rem,9rem)_1fr_auto] items-center gap-3">
            <span class="truncate text-sm text-ink" [title]="entry.label">{{ entry.label }}</span>
            <span class="h-2 overflow-hidden rounded-full bg-canvas">
              <span
                class="block h-full rounded-full"
                [style.width.%]="entry.share"
                [style.background-color]="entry.colour"
              ></span>
            </span>
            <span class="text-sm font-medium tabular-nums text-ink-muted">{{ entry.value }}</span>
          </li>
        }
      </ul>
    </nxd-widget-host>
  `,
})
export class RankedListComponent {
  readonly config = input.required<ChartWidgetConfig>();
  readonly data = input<WidgetData | undefined>(undefined);

  protected readonly footer = computed(() => truncationFooter(this.data()));
  protected readonly footerTitle = computed(() => truncationDetail(this.data()));
  readonly labels = input<Map<string, string>>(new Map());
  readonly loading = input(false);
  readonly error = input<string | null>(null);

  readonly empty = computed(() => isEmptyData(this.data()));

  readonly entries = computed<RankedEntry[]>(() => {
    const data = this.data();
    if (!data || data.kind !== 'buckets') {
      return [];
    }

    const config = this.config();
    const buckets = config.limit ? data.buckets.slice(0, config.limit) : data.buckets;
    const palette = chartPalette();
    // A single dominant bucket must not flatten every other bar to nothing visible.
    const largest = Math.max(...buckets.map((bucket) => bucket.value), 0);

    return buckets.map((bucket, index) => ({
      key: bucket.key,
      label: this.labels().get(bucket.key) ?? bucket.key,
      value: formatNumber(bucket.value, config.format),
      share: largest > 0 ? Math.max((bucket.value / largest) * 100, bucket.value > 0 ? 2 : 0) : 0,
      colour: palette[index % palette.length],
    }));
  });
}
