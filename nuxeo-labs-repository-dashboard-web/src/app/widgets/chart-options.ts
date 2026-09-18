/**
 * Shared ECharts option building.
 *
 * Colours are read from the CSS custom properties declared in `styles.css`, so the palette stays
 * defined in one place and a theme change does not require touching any chart code.
 */
import { EChartsCoreOption } from 'echarts/core';
import { ChartWidgetType, ValueFormat } from '../config/dashboard-config.model';
import { formatNumber } from '../core/format';
import { DataBucket } from '../engine/result-mapper';

const SERIES_TOKENS = [
  '--color-series-1',
  '--color-series-2',
  '--color-series-3',
  '--color-series-4',
  '--color-series-5',
  '--color-series-6',
  '--color-series-7',
  '--color-series-8',
  '--color-series-9',
  '--color-series-10',
];

const FALLBACK_PALETTE = [
  '#8b5cf6',
  '#22c55e',
  '#ef4444',
  '#3b82f6',
  '#f59e0b',
  '#78716c',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
  '#6366f1',
];

let cachedPalette: string[] | null = null;

/** Categorical palette, resolved once against the document's computed styles. */
export function chartPalette(): string[] {
  if (cachedPalette) {
    return cachedPalette;
  }
  if (typeof getComputedStyle !== 'function' || typeof document === 'undefined') {
    return FALLBACK_PALETTE;
  }
  const styles = getComputedStyle(document.documentElement);
  const resolved = SERIES_TOKENS.map((token, index) => {
    const value = styles.getPropertyValue(token).trim();
    return value || FALLBACK_PALETTE[index];
  });
  cachedPalette = resolved;
  return resolved;
}

const INK_MUTED = '#667085';
const BORDER = '#e4e8ef';

interface ChartOptionInput {
  type: ChartWidgetType;
  buckets: DataBucket[];
  labels: Map<string, string>;
  format: ValueFormat | undefined;
  seriesName: string;
}

function labelFor(bucket: DataBucket, labels: Map<string, string>): string {
  return labels.get(bucket.key) ?? bucket.key;
}

function valueFormatter(format: ValueFormat | undefined) {
  return (value: number) => formatNumber(value, format);
}

/** Builds the full ECharts option for a bucket based widget. */
export function buildChartOption(input: ChartOptionInput): EChartsCoreOption {
  switch (input.type) {
    case 'donut':
    case 'pie':
      return buildPieOption(input);
    case 'hbar':
      return buildBarOption(input, 'horizontal');
    case 'bar':
      return buildBarOption(input, 'vertical');
    case 'line':
    case 'area':
      return buildLineOption(input);
    default:
      return {};
  }
}

function buildPieOption(input: ChartOptionInput): EChartsCoreOption {
  const format = valueFormatter(input.format);
  const data = input.buckets.map((bucket) => ({
    name: labelFor(bucket, input.labels),
    value: bucket.value,
  }));

  return {
    color: chartPalette(),
    tooltip: {
      trigger: 'item',
      valueFormatter: format,
    },
    legend: {
      type: 'scroll',
      orient: 'vertical',
      right: 0,
      top: 'middle',
      itemWidth: 10,
      itemHeight: 10,
      icon: 'circle',
      textStyle: { color: INK_MUTED, fontSize: 12 },
      formatter: (name: string) => {
        const match = data.find((entry) => entry.name === name);
        return match ? `${name}  ${format(match.value)}` : name;
      },
    },
    series: [
      {
        name: input.seriesName,
        type: 'pie',
        radius: input.type === 'donut' ? ['52%', '76%'] : '76%',
        center: ['32%', '50%'],
        avoidLabelOverlap: true,
        label: { show: false },
        labelLine: { show: false },
        data,
      },
    ],
  };
}

function buildBarOption(
  input: ChartOptionInput,
  orientation: 'vertical' | 'horizontal',
): EChartsCoreOption {
  const format = valueFormatter(input.format);
  const categories = input.buckets.map((bucket) => labelFor(bucket, input.labels));
  const values = input.buckets.map((bucket) => bucket.value);

  const categoryAxis = {
    type: 'category' as const,
    data: orientation === 'horizontal' ? [...categories].reverse() : categories,
    axisLine: { lineStyle: { color: BORDER } },
    axisTick: { show: false },
    axisLabel: { color: INK_MUTED, fontSize: 11, hideOverlap: true },
  };

  const valueAxis = {
    type: 'value' as const,
    splitLine: { lineStyle: { color: BORDER } },
    axisLabel: { color: INK_MUTED, fontSize: 11, formatter: format },
  };

  return {
    color: chartPalette(),
    grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: format },
    xAxis: orientation === 'horizontal' ? valueAxis : categoryAxis,
    yAxis: orientation === 'horizontal' ? categoryAxis : valueAxis,
    series: [
      {
        name: input.seriesName,
        type: 'bar',
        barMaxWidth: 28,
        itemStyle: { borderRadius: orientation === 'horizontal' ? [0, 4, 4, 0] : [4, 4, 0, 0] },
        data: orientation === 'horizontal' ? [...values].reverse() : values,
      },
    ],
  };
}

function buildLineOption(input: ChartOptionInput): EChartsCoreOption {
  const format = valueFormatter(input.format);
  const palette = chartPalette();
  const accent = palette[3];

  return {
    color: [accent],
    grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
    tooltip: { trigger: 'axis', valueFormatter: format },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: input.buckets.map((bucket) => labelFor(bucket, input.labels)),
      axisLine: { lineStyle: { color: BORDER } },
      axisTick: { show: false },
      axisLabel: { color: INK_MUTED, fontSize: 11, hideOverlap: true },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: BORDER } },
      axisLabel: { color: INK_MUTED, fontSize: 11, formatter: format },
    },
    series: [
      {
        name: input.seriesName,
        type: 'line',
        smooth: 0.25,
        showSymbol: input.buckets.length <= 40,
        symbolSize: 6,
        lineStyle: { width: 2 },
        areaStyle: input.type === 'area' ? { opacity: 0.18 } : undefined,
        data: input.buckets.map((bucket) => bucket.value),
      },
    ],
  };
}
