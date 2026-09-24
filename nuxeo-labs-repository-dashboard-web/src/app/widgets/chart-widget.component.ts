import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
} from '@angular/core';
import { ECharts } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { ChartWidgetConfig, LabelStrategy, pickableField } from '../config/dashboard-config.model';
import { downloadCsv, downloadDataUrl, safeFilename } from '../core/export';
import { DataBucket, WidgetData, isEmptyData } from '../engine/result-mapper';
import { bucketIndexAt, buildChartOption } from './chart-options';
import { ChartSnapshotRegistry } from './chart-snapshot.registry';
import { bucketRows } from './widget-export';
import { truncationDetail, truncationFooter } from './truncation';
import { WidgetHostComponent } from './widget-host.component';

/** What a click on a bucket carries up to the page. */
export interface BucketClick {
  field: string;
  value: string;
  label: string;
  /** Carried along because the clause has to expand a principal the way the widget merged it. */
  labels?: LabelStrategy;
}

/** Renders the bucket based chart types backed by ECharts. */
@Component({
  selector: 'nxd-chart-widget',
  imports: [NgxEchartsDirective, WidgetHostComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full' },
  template: `
    <nxd-widget-host
      [label]="config().label"
      [hint]="config().hint ?? null"
      [period]="period()"
      [loading]="loading()"
      [error]="error()"
      [empty]="empty()"
      [footer]="footer()"
      [footerTitle]="footerTitle()"
      [canExportCsv]="true"
      [canExportPng]="true"
      (exportCsv)="onExportCsv()"
      (exportPng)="onExportPng()"
    >
      <div
        echarts
        [options]="option()"
        [autoResize]="true"
        class="h-64 w-full"
        [class.cursor-pointer]="pickable()"
        (chartInit)="chart = $event"
        (chartClick)="onChartClick($event)"
      ></div>
    </nxd-widget-host>
  `,
})
export class ChartWidgetComponent {
  private readonly snapshots = inject(ChartSnapshotRegistry);

  readonly config = input.required<ChartWidgetConfig>();
  /** Period the figures obey, or null when the page's period does not constrain them. */
  readonly period = input<string | null>(null);
  /** Identifies this chart to a whole page export. Empty outside a dashboard grid. */
  readonly widgetId = input('');
  readonly data = input<WidgetData | undefined>(undefined);

  protected readonly footer = computed(() => truncationFooter(this.data()));
  protected readonly footerTitle = computed(() => truncationDetail(this.data()));
  readonly labels = input<Map<string, string>>(new Map());
  readonly loading = input(false);
  readonly error = input<string | null>(null);

  readonly picked = output<BucketClick>();

  /** Held so that a PNG can be asked of the very instance on screen. */
  protected chart: ECharts | null = null;

  constructor() {
    effect((onCleanup) => {
      const id = this.widgetId();
      if (!id) {
        return;
      }
      this.snapshots.register(id, () => this.png());
      onCleanup(() => this.snapshots.unregister(id));
    });
  }

  /*
   * An explicit background, because ECharts renders onto a transparent canvas. A chart pasted into
   * a document would otherwise show whatever is behind it, which on a dark slide is nothing at all.
   */
  private png(): string | null {
    return (
      this.chart?.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' }) ?? null
    );
  }

  readonly empty = computed(() => isEmptyData(this.data()));

  /** Only a `terms` chart filters on a value; elsewhere the pointer must not promise one. */
  protected readonly pickable = computed(() => pickableField(this.config()) !== null);

  private readonly buckets = computed<DataBucket[]>(() => {
    const data = this.data();
    if (!data || data.kind !== 'buckets') {
      return [];
    }
    const limit = this.config().limit;
    return limit ? data.buckets.slice(0, limit) : data.buckets;
  });

  protected onChartClick(event: { dataIndex?: number }): void {
    const field = pickableField(this.config());
    const buckets = this.buckets();
    const index = bucketIndexAt(this.config().type, buckets.length, event.dataIndex ?? -1);
    const bucket = buckets[index];

    if (field && bucket) {
      this.picked.emit({
        field,
        value: bucket.key,
        label: this.labels().get(bucket.key) ?? bucket.key,
        labels: this.config().labels,
      });
    }
  }

  protected onExportCsv(): void {
    const label = this.config().label;
    downloadCsv(`${safeFilename(label)}.csv`, bucketRows(this.buckets(), this.labels()));
  }

  protected onExportPng(): void {
    const url = this.png();
    if (url) {
      downloadDataUrl(`${safeFilename(this.config().label)}.png`, url);
    }
  }

  readonly option = computed(() => {
    const config = this.config();
    return buildChartOption({
      type: config.type,
      buckets: this.buckets(),
      labels: this.labels(),
      format: config.format,
      seriesName: config.label,
    });
  });
}
