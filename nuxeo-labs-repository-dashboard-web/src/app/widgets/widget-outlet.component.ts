import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import {
  ChartWidgetConfig,
  KpiWidgetConfig,
  TableWidgetConfig,
  WidgetConfig,
} from '../config/dashboard-config.model';
import { WidgetData } from '../engine/result-mapper';
import { BucketClick, ChartWidgetComponent } from './chart-widget.component';
import { DataTableComponent } from './data-table.component';
import { KpiCardComponent } from './kpi-card.component';
import { RankedListComponent } from './ranked-list.component';

/**
 * Renders whichever widget component matches the configured type.
 *
 * Narrowing happens here, once, so that each widget component keeps a precisely typed input
 * rather than a union it would have to re-narrow in its template.
 */
@Component({
  selector: 'nxd-widget-outlet',
  imports: [ChartWidgetComponent, DataTableComponent, KpiCardComponent, RankedListComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full' },
  template: `
    @if (asKpi(); as kpi) {
      <nxd-kpi-card [config]="kpi" [data]="data()" [loading]="loading()" [error]="error()" />
    } @else if (asRankedList(); as ranked) {
      <nxd-ranked-list
        [config]="ranked"
        [data]="data()"
        [labels]="bucketLabels()"
        [loading]="loading()"
        [error]="error()"
        (picked)="picked.emit($event)"
      />
    } @else if (asChart(); as chart) {
      <nxd-chart-widget
        [config]="chart"
        [data]="data()"
        [labels]="bucketLabels()"
        [loading]="loading()"
        [error]="error()"
        (picked)="picked.emit($event)"
      />
    } @else if (asTable(); as table) {
      <nxd-data-table
        [config]="table"
        [data]="data()"
        [labels]="columnLabels()"
        [loading]="loading()"
        [error]="error()"
      />
    }
  `,
})
export class WidgetOutletComponent {
  readonly config = input.required<WidgetConfig>();
  readonly data = input<WidgetData | undefined>(undefined);
  readonly loading = input(false);
  readonly error = input<string | null>(null);

  /** A bucket the reader clicked, on its way to the filter state. */
  readonly picked = output<BucketClick>();

  /** Label of the active date range, interpolated into a `{range}` placeholder in the hint. */
  readonly rangeLabel = input('');

  /** Bucket key to label, for chart and ranked list widgets. */
  readonly bucketLabels = input<Map<string, string>>(new Map());

  /** Column field to (raw value -> label), for table widgets. */
  readonly columnLabels = input<Map<string, Map<string, string>>>(new Map());

  /**
   * Configuration with the hint placeholders filled in.
   *
   * Resolving here, once, spares every widget from knowing about date ranges. The original object
   * is returned untouched when there is nothing to interpolate, so a widget without a placeholder
   * never sees a new reference and never re-renders for nothing.
   */
  private readonly resolved = computed<WidgetConfig>(() => {
    const config = this.config();
    if (!config.hint?.includes('{range}')) {
      return config;
    }
    return { ...config, hint: config.hint.replaceAll('{range}', this.rangeLabel()) };
  });

  readonly asKpi = computed<KpiWidgetConfig | null>(() => {
    const config = this.resolved();
    return config.type === 'kpi' ? config : null;
  });

  readonly asTable = computed<TableWidgetConfig | null>(() => {
    const config = this.resolved();
    return config.type === 'table' ? config : null;
  });

  readonly asRankedList = computed<ChartWidgetConfig | null>(() => {
    const config = this.resolved();
    return config.type === 'ranked-list' ? config : null;
  });

  readonly asChart = computed<ChartWidgetConfig | null>(() => {
    const config = this.resolved();
    return config.type !== 'kpi' && config.type !== 'table' && config.type !== 'ranked-list'
      ? config
      : null;
  });
}
