/**
 * ECharts registration.
 *
 * Only the chart types and components the dashboard actually renders are pulled in. Importing the
 * `echarts` barrel instead would add roughly a megabyte of maps, graphs and 3D renderers that no
 * widget uses.
 */
import { Provider } from '@angular/core';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { LabelLayout } from 'echarts/features';
import { CanvasRenderer } from 'echarts/renderers';
import { provideEchartsCore } from 'ngx-echarts';

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  LabelLayout,
  CanvasRenderer,
]);

export function provideDashboardCharts(): Provider {
  return provideEchartsCore({ echarts });
}
