import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { ChartWidgetConfig } from '../config/dashboard-config.model';
import { DataBucket, WidgetData, isEmptyData } from '../engine/result-mapper';
import { buildChartOption } from './chart-options';
import { truncationDetail, truncationFooter } from './truncation';
import { WidgetHostComponent } from './widget-host.component';

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
      [loading]="loading()"
      [error]="error()"
      [empty]="empty()"
      [footer]="footer()"
      [footerTitle]="footerTitle()"
    >
      <div echarts [options]="option()" [autoResize]="true" class="h-64 w-full"></div>
    </nxd-widget-host>
  `,
})
export class ChartWidgetComponent {
  readonly config = input.required<ChartWidgetConfig>();
  readonly data = input<WidgetData | undefined>(undefined);

  protected readonly footer = computed(() => truncationFooter(this.data()));
  protected readonly footerTitle = computed(() => truncationDetail(this.data()));
  readonly labels = input<Map<string, string>>(new Map());
  readonly loading = input(false);
  readonly error = input<string | null>(null);

  readonly empty = computed(() => isEmptyData(this.data()));

  private readonly buckets = computed<DataBucket[]>(() => {
    const data = this.data();
    if (!data || data.kind !== 'buckets') {
      return [];
    }
    const limit = this.config().limit;
    return limit ? data.buckets.slice(0, limit) : data.buckets;
  });

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
