import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ChartWidgetConfig } from '../app/config/dashboard-config.model';
import { WidgetData, isEmptyData } from '../app/engine/result-mapper';

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
      <span>{{ config().label }}</span>
      <!-- Rendered so that hint interpolation stays observable through the stub. -->
      <span data-testid="chart-hint">{{ config().hint }}</span>
      <span data-testid="chart-bucket-count">{{ bucketCount() }}</span>
    </div>
  `,
})
export class ChartWidgetStubComponent {
  readonly config = input.required<ChartWidgetConfig>();
  readonly data = input<WidgetData | undefined>(undefined);
  readonly labels = input<Map<string, string>>(new Map());
  readonly loading = input(false);
  readonly error = input<string | null>(null);

  readonly empty = computed(() => isEmptyData(this.data()));

  readonly bucketCount = computed(() => {
    const data = this.data();
    return data?.kind === 'buckets' ? data.buckets.length : 0;
  });
}
