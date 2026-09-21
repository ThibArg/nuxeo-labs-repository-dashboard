import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
} from '@angular/core';
import { ChartWidgetConfig, pickableField } from '../app/config/dashboard-config.model';
import { WidgetData, isEmptyData } from '../app/engine/result-mapper';
import { BucketClick } from '../app/widgets/chart-widget.component';
import { ChartSnapshotRegistry } from '../app/widgets/chart-snapshot.registry';

/**
 * Stands in for `ChartWidgetComponent` in component tests.
 *
 * ECharts paints on a real canvas, which jsdom does not provide. Rather than mocking a graphics
 * context, chart rendering is covered where it actually lives: `buildChartOption` is a pure
 * function and is unit tested directly. This stub keeps the surrounding page testable while
 * still proving that the right data reaches the chart.
 */
@Component({
  selector: 'nxd-chart-widget',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div data-testid="chart-stub" [attr.data-empty]="empty()">
      <!--
        The real chart paints on a canvas, and a whole page export finds one to swap for its
        photograph. A stub without it would let that swap silently do nothing.
      -->
      <canvas></canvas>
      <span>{{ config().label }}</span>
      <!-- Rendered so that hint interpolation stays observable through the stub. -->
      <span data-testid="chart-hint">{{ config().hint }}</span>
      <!--
        The real chart hands its error to WidgetHostComponent, which this stub does not use. Without
        it, which of the two errors reached a widget — its own or the dashboard's — could not be
        observed from a page test at all.
      -->
      <span data-testid="chart-error">{{ error() }}</span>
      <span data-testid="chart-bucket-count">{{ bucketCount() }}</span>
      <!--
        Rendered for the same reason as the hint: label resolution happens before the chart is
        built, so a stub that swallowed it would let a broken LabelStrategy pass in silence.
        Same fallback as the real chart option builder.
      -->
      @for (label of bucketLabels(); track label) {
        <span data-testid="chart-bucket-label">{{ label }}</span>
      }
      <!--
        A clickable stand-in for an ECharts segment, so cross filtering stays reachable from a page
        test. The real component maps a dataIndex back to a bucket, which is unit tested separately
        against the reversal a horizontal bar chart applies.
      -->
      @for (bucket of pickableBuckets(); track bucket.value) {
        <button
          type="button"
          data-testid="chart-pick"
          [attr.data-field]="bucket.field"
          [attr.data-key]="bucket.value"
          (click)="picked.emit(bucket)"
        >
          {{ bucket.label }}
        </button>
      }
    </div>
  `,
})
export class ChartWidgetStubComponent {
  private readonly snapshots = inject(ChartSnapshotRegistry);

  readonly config = input.required<ChartWidgetConfig>();
  readonly widgetId = input('');
  readonly data = input<WidgetData | undefined>(undefined);
  readonly labels = input<Map<string, string>>(new Map());
  readonly loading = input(false);
  readonly error = input<string | null>(null);

  readonly picked = output<BucketClick>();

  readonly empty = computed(() => isEmptyData(this.data()));

  constructor() {
    /*
     * Registers a stand-in photograph. The real component asks ECharts, which jsdom cannot run,
     * but a page level export still has to be observable: without this the whole page HTML would
     * carry no image and the test proving charts survive the trip could not exist.
     */
    effect((onCleanup) => {
      const id = this.widgetId();
      if (!id) {
        return;
      }
      this.snapshots.register(id, () => `data:image/png;base64,${id}`);
      onCleanup(() => this.snapshots.unregister(id));
    });
  }

  readonly bucketCount = computed(() => {
    const data = this.data();
    return data?.kind === 'buckets' ? data.buckets.length : 0;
  });

  readonly bucketLabels = computed(() => {
    const data = this.data();
    if (data?.kind !== 'buckets') {
      return [];
    }
    const labels = this.labels();
    return data.buckets.map((bucket) => labels.get(bucket.key) ?? bucket.key);
  });

  readonly pickableBuckets = computed<BucketClick[]>(() => {
    const data = this.data();
    const field = pickableField(this.config());
    if (data?.kind !== 'buckets' || !field) {
      return [];
    }
    const labels = this.labels();
    return data.buckets.map((bucket) => ({
      field,
      value: bucket.key,
      label: labels.get(bucket.key) ?? bucket.key,
      labels: this.config().labels,
    }));
  });
}
