import { EsResponse } from '../core/nuxeo.types';
import { DISTINCT_AGG, INNER_AGG, METRIC_AGG } from './agg-compiler';
import { WidgetPlan } from './query-planner';
import { isEmptyData, readAggregationWidget, readHitsWidget } from './result-mapper';

function plan(overrides: Partial<WidgetPlan> = {}): WidgetPlan {
  return {
    widgetId: 'w',
    requestId: 'r',
    read: 'aggregation',
    wrapped: false,
    hasMetric: false,
    hasSecondary: false,
    ...overrides,
  };
}

function response(aggregations?: Record<string, unknown>, total = 0): EsResponse {
  return {
    took: 5,
    timed_out: false,
    hits: { total: { value: total, relation: 'eq' }, hits: [] },
    ...(aggregations ? { aggregations: aggregations as EsResponse['aggregations'] } : {}),
  };
}

describe('result-mapper', () => {
  it('reads hits.total for a widget with neither predicate nor metric', () => {
    const data = readAggregationWidget(response(undefined, 1234), plan({ read: 'total' }));
    expect(data).toEqual({ kind: 'scalar', value: 1234 });
  });

  it('reads doc_count out of a filter wrapper', () => {
    const data = readAggregationWidget(response({ w: { doc_count: 42 } }), plan({ wrapped: true }));
    expect(data).toEqual({ kind: 'scalar', value: 42 });
  });

  it('prefers the nested metric over doc_count on a filter wrapper', () => {
    const data = readAggregationWidget(
      response({ w: { doc_count: 42, [METRIC_AGG]: { value: 7 } } }),
      plan({ wrapped: true, hasMetric: true }),
    );
    expect(data).toEqual({ kind: 'scalar', value: 7 });
  });

  it('reads a direct single value metric', () => {
    const data = readAggregationWidget(response({ w: { value: 9 } }), plan());
    expect(data).toEqual({ kind: 'scalar', value: 9 });
  });

  it('treats a null cardinality as zero rather than as missing data', () => {
    const data = readAggregationWidget(response({ w: { value: null } }), plan());
    expect(data).toEqual({ kind: 'scalar', value: 0 });
  });

  it('maps terms buckets, using doc_count as the value', () => {
    const data = readAggregationWidget(
      response({
        w: {
          buckets: [
            { key: 'File', doc_count: 10 },
            { key: 'Note', doc_count: 3 },
          ],
        },
      }),
      plan(),
    );

    expect(data).toEqual({
      kind: 'buckets',
      buckets: [
        { key: 'File', value: 10, docCount: 10 },
        { key: 'Note', value: 3, docCount: 3 },
      ],
    });
  });

  describe('a top N owns up to what it left out', () => {
    function truncated(distinct: number, shown: string[], otherDocs: number) {
      return readAggregationWidget(
        response({
          w: {
            [DISTINCT_AGG]: { value: distinct },
            [INNER_AGG]: {
              sum_other_doc_count: otherDocs,
              buckets: shown.map((key) => ({ key, doc_count: 5 })),
            },
          },
        }),
        plan({ wrapped: true }),
      );
    }

    it('counts the values the list could not hold', () => {
      expect(truncated(47, ['kate', 'josh'], 1240)).toMatchObject({
        others: 45,
        otherDocs: 1240,
      });
    });

    it('reports nothing left out when the list is complete', () => {
      expect(truncated(2, ['kate', 'josh'], 0)).toMatchObject({ others: 0, otherDocs: 0 });
    });

    // A histogram has no top N, so no count of distinct values is asked for and none is expected.
    it('stays silent when the widget never counted distinct values', () => {
      const data = readAggregationWidget(
        response({ w: { buckets: [{ key: 'a', doc_count: 1 }] } }),
        plan(),
      );

      expect(data).not.toHaveProperty('others');
    });
  });

  it('uses the nested metric as the bucket value while keeping doc_count', () => {
    const data = readAggregationWidget(
      response({
        w: { buckets: [{ key: 'File', doc_count: 10, [METRIC_AGG]: { value: 5_000_000 } }] },
      }),
      plan({ hasMetric: true }),
    );

    expect(data).toEqual({
      kind: 'buckets',
      buckets: [{ key: 'File', value: 5_000_000, docCount: 10 }],
    });
  });

  it('prefers key_as_string on a date histogram', () => {
    // Verbatim from a live index: the epoch key is present alongside the formatted one.
    const data = readAggregationWidget(
      response({
        w: { buckets: [{ key: 1785369600000, key_as_string: '2026-07-30', doc_count: 12 }] },
      }),
      plan(),
    );

    expect(data).toEqual({
      kind: 'buckets',
      buckets: [{ key: '2026-07-30', value: 12, docCount: 12 }],
    });
  });

  it('unwraps a chart nested under a filter wrapper', () => {
    const data = readAggregationWidget(
      response({
        w: { doc_count: 12, [INNER_AGG]: { buckets: [{ key: 'File', doc_count: 12 }] } },
      }),
      plan({ wrapped: true }),
    );

    expect(data).toEqual({ kind: 'buckets', buckets: [{ key: 'File', value: 12, docCount: 12 }] });
  });

  it('normalises the keyed buckets of a filters aggregation', () => {
    /*
     * Verbatim from a live LTS 2025 passthrough: a `filters` aggregation answers an object keyed
     * by filter name, where `terms` answers an array. Both reach the same shape here.
     */
    const data = readAggregationWidget(
      response({ w: { buckets: { past: { doc_count: 32 }, soon: { doc_count: 70 } } } }),
      plan(),
    );

    expect(data).toEqual({
      kind: 'buckets',
      buckets: [
        { key: 'past', value: 32, docCount: 32 },
        { key: 'soon', value: 70, docCount: 70 },
      ],
    });
  });

  it('reads the secondary figure from the wrapper', () => {
    const data = readAggregationWidget(
      response({ w: { doc_count: 300, secondary: { doc_count: 10 } } }),
      plan({ wrapped: true, hasSecondary: true }),
    );

    expect(data).toEqual({ kind: 'scalar', value: 300, secondary: 10 });
  });

  it('reports a secondary of zero rather than omitting it', () => {
    const data = readAggregationWidget(
      response({ w: { doc_count: 300, secondary: { doc_count: 0 } } }),
      plan({ wrapped: true, hasSecondary: true }),
    );

    expect(data).toEqual({ kind: 'scalar', value: 300, secondary: 0 });
  });

  it('falls back to zero when the secondary aggregation is missing from the response', () => {
    const data = readAggregationWidget(
      response({ w: { doc_count: 300 } }),
      plan({ wrapped: true, hasSecondary: true }),
    );

    expect(data).toEqual({ kind: 'scalar', value: 300, secondary: 0 });
  });

  it('omits the secondary entirely when none was planned', () => {
    const data = readAggregationWidget(
      response({ w: { doc_count: 300, secondary: { doc_count: 10 } } }),
      plan({ wrapped: true }),
    );

    expect(data).toEqual({ kind: 'scalar', value: 300 });
  });

  it('returns undefined when the aggregation is missing from the response', () => {
    expect(readAggregationWidget(response({}), plan())).toBeUndefined();
  });

  describe('readHitsWidget', () => {
    it('keys rows on ecm:uuid so they can link back to Web UI', () => {
      const data = readHitsWidget({
        took: 1,
        timed_out: false,
        hits: {
          total: { value: 3, relation: 'eq' },
          hits: [
            { _id: 'internal', _index: 'nuxeo', _source: { 'ecm:uuid': 'abc', 'dc:title': 'T' } },
          ],
        },
      });

      expect(data).toEqual({
        kind: 'rows',
        total: 3,
        rows: [{ id: 'abc', source: { 'ecm:uuid': 'abc', 'dc:title': 'T' } }],
      });
    });
  });

  describe('isEmptyData', () => {
    it('treats a zero scalar as present, and an empty bucket list as absent', () => {
      expect(isEmptyData({ kind: 'scalar', value: 0 })).toBe(false);
      expect(isEmptyData({ kind: 'buckets', buckets: [] })).toBe(true);
      expect(isEmptyData({ kind: 'rows', rows: [], total: 0 })).toBe(true);
      expect(isEmptyData(undefined)).toBe(true);
    });
  });
});
