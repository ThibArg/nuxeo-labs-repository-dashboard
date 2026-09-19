import { DataBucket } from '../engine/result-mapper';
import { bucketIndexAt, buildChartOption } from './chart-options';

function buckets(...entries: [string, number][]): DataBucket[] {
  return entries.map(([key, value]) => ({ key, value, docCount: value }));
}

/** ECharts options are loosely typed by design; the tests read them through a narrow view. */
interface ReadableOption {
  series: { type: string; data: unknown[]; radius?: unknown; areaStyle?: unknown }[];
  xAxis?: { type: string; data?: string[] };
  yAxis?: { type: string; data?: string[] };
  legend?: { formatter?: (name: string) => string };
  color?: string[];
}

function read(option: unknown): ReadableOption {
  return option as ReadableOption;
}

describe('buildChartOption', () => {
  const labels = new Map([['File', 'Fichier']]);

  it('renders a donut as a pie with an inner radius', () => {
    const option = read(
      buildChartOption({
        type: 'donut',
        buckets: buckets(['File', 10], ['Note', 4]),
        labels,
        format: 'integer',
        seriesName: 'By type',
      }),
    );

    expect(option.series[0].type).toBe('pie');
    expect(option.series[0].radius).toEqual(['52%', '76%']);
    expect(option.series[0].data).toEqual([
      { name: 'Fichier', value: 10 },
      { name: 'Note', value: 4 },
    ]);
  });

  it('renders a plain pie without an inner radius', () => {
    const option = read(
      buildChartOption({
        type: 'pie',
        buckets: buckets(['File', 10]),
        labels: new Map(),
        format: undefined,
        seriesName: 's',
      }),
    );

    expect(option.series[0].radius).toBe('76%');
  });

  it('puts the formatted value in the pie legend', () => {
    const option = read(
      buildChartOption({
        type: 'donut',
        buckets: buckets(['File', 5_000_000_000]),
        labels: new Map(),
        format: 'bytes',
        seriesName: 's',
      }),
    );

    expect(option.legend?.formatter?.('File')).toContain('5.0 GB');
  });

  it('swaps the axes for a horizontal bar chart and reverses the order', () => {
    const vertical = read(
      buildChartOption({
        type: 'bar',
        buckets: buckets(['a', 1], ['b', 2]),
        labels: new Map(),
        format: undefined,
        seriesName: 's',
      }),
    );
    const horizontal = read(
      buildChartOption({
        type: 'hbar',
        buckets: buckets(['a', 1], ['b', 2]),
        labels: new Map(),
        format: undefined,
        seriesName: 's',
      }),
    );

    expect(vertical.xAxis?.type).toBe('category');
    expect(vertical.xAxis?.data).toEqual(['a', 'b']);

    expect(horizontal.yAxis?.type).toBe('category');
    // Reversed so that the largest value sits at the top of the chart.
    expect(horizontal.yAxis?.data).toEqual(['b', 'a']);
    expect(horizontal.series[0].data).toEqual([2, 1]);
  });

  it('adds an area only for the area variant', () => {
    const line = read(
      buildChartOption({
        type: 'line',
        buckets: buckets(['d1', 1]),
        labels: new Map(),
        format: undefined,
        seriesName: 's',
      }),
    );
    const area = read(
      buildChartOption({
        type: 'area',
        buckets: buckets(['d1', 1]),
        labels: new Map(),
        format: undefined,
        seriesName: 's',
      }),
    );

    expect(line.series[0].areaStyle).toBeUndefined();
    expect(area.series[0].areaStyle).toBeDefined();
    expect(area.series[0].type).toBe('line');
  });

  it('falls back to the raw key when no label was resolved', () => {
    const option = read(
      buildChartOption({
        type: 'donut',
        buckets: buckets(['Unknown', 1]),
        labels,
        format: undefined,
        seriesName: 's',
      }),
    );

    expect(option.series[0].data).toEqual([{ name: 'Unknown', value: 1 }]);
  });

  it('copes with an empty bucket list', () => {
    for (const type of ['donut', 'bar', 'hbar', 'line', 'area'] as const) {
      const option = read(
        buildChartOption({
          type,
          buckets: [],
          labels: new Map(),
          format: undefined,
          seriesName: 's',
        }),
      );
      expect(option.series[0].data).toEqual([]);
    }
  });

  it('returns an empty option for types it does not draw', () => {
    expect(
      buildChartOption({
        type: 'ranked-list',
        buckets: buckets(['a', 1]),
        labels: new Map(),
        format: undefined,
        seriesName: 's',
      }),
    ).toEqual({});
  });
});

describe('bucketIndexAt', () => {
  /*
   * The reversal a horizontal bar chart applies is invisible on a click in the middle of an odd
   * sized chart, which is exactly how a bug like this survives being looked at.
   */
  it('maps a click back through the reversal a horizontal bar chart applies', () => {
    expect([0, 1, 2, 3].map((index) => bucketIndexAt('hbar', 4, index))).toEqual([3, 2, 1, 0]);
  });

  it('leaves every other chart type alone', () => {
    for (const type of ['bar', 'line', 'area', 'donut', 'pie', 'ranked-list'] as const) {
      expect(
        [0, 1, 2, 3].map((index) => bucketIndexAt(type, 4, index)),
        type,
      ).toEqual([0, 1, 2, 3]);
    }
  });
});
