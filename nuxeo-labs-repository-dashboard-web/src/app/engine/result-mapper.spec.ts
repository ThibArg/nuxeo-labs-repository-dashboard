import { EsResponse } from '../core/nuxeo.types';
import { DISTINCT_AGG, INNER_AGG, METRIC_AGG } from './agg-compiler';
import { WidgetPlan } from './query-planner';
import { WidgetData, isEmptyData, readAggregationWidget, readHitsWidget } from './result-mapper';

function plan(overrides: Partial<WidgetPlan> = {}): WidgetPlan {
  return {
    widgetId: 'w',
    requestId: 'r',
    read: 'aggregation',
    wrapped: false,
    hasMetric: false,
    metricUndefinedWhenEmpty: false,
    hasSecondary: false,
    mergePrincipals: false,
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

  /*
   * A count, a cardinality and a sum over nothing are all legitimately zero. An average, a minimum
   * and a maximum are not: rendering their null as `0` would state a measurement never made, and
   * an average duration tile would read `0 s` on a server where no workflow has ever completed.
   * NaN is what every formatter already turns into a dash.
   */
  it('treats a null average as unmeasured rather than as zero', () => {
    const data = readAggregationWidget(
      response({ w: { doc_count: 0, [METRIC_AGG]: { value: null } } }),
      plan({ wrapped: true, hasMetric: true, metricUndefinedWhenEmpty: true }),
    );

    expect(data?.kind).toBe('scalar');
    expect(Number.isNaN((data as { value: number }).value)).toBe(true);
  });

  it('leaves a bucket unmeasured too when its average has no value', () => {
    const data = readAggregationWidget(
      response({
        w: {
          buckets: [
            { key: 'SerialDocumentReview', doc_count: 4, [METRIC_AGG]: { value: null } },
            { key: 'ParallelDocumentReview', doc_count: 6, [METRIC_AGG]: { value: 90 } },
          ],
        },
      }),
      plan({ hasMetric: true, metricUndefinedWhenEmpty: true }),
    );

    const buckets = (data as { buckets: { key: string; value: number }[] }).buckets;
    // Falling back to doc_count here would show 4 documents as though they lasted four units.
    expect(Number.isNaN(buckets[0].value)).toBe(true);
    expect(buckets[1].value).toBe(90);
  });

  /*
   * `percentiles` answers a map rather than a scalar, keyed by the percentile as OpenSearch
   * formats it. Only one is ever asked for, so the single entry is read rather than the key
   * recomposed — `"99.9"` would not survive that.
   */
  it('reads a percentile out of the values map', () => {
    const data = readAggregationWidget(
      response({ w: { doc_count: 71, [METRIC_AGG]: { values: { '50.0': 86_400_000 } } } }),
      plan({ wrapped: true, hasMetric: true, metricUndefinedWhenEmpty: true }),
    );

    expect(data).toEqual({ kind: 'scalar', value: 86_400_000 });
  });

  it('treats a percentile over an empty set as unmeasured', () => {
    const data = readAggregationWidget(
      response({ w: { doc_count: 0, [METRIC_AGG]: { values: { '50.0': null } } } }),
      plan({ wrapped: true, hasMetric: true, metricUndefinedWhenEmpty: true }),
    );

    expect(Number.isNaN((data as { value: number }).value)).toBe(true);
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

  /*
   * `nt:actors` holds `Josh` for a task assigned through `workflowInitiator` and `user:Josh` for
   * one assigned through Web UI's picker — within the same workflow instance. Listing them apart
   * reports one person twice, each with part of their work.
   */
  describe('the two forms of a principal', () => {
    function actors(buckets: unknown[], distinct?: number) {
      return readAggregationWidget(
        response({
          w: {
            doc_count: 9,
            [INNER_AGG]: { buckets },
            ...(distinct === undefined ? {} : { [DISTINCT_AGG]: { value: distinct } }),
          },
        }),
        plan({ wrapped: true, mergePrincipals: true }),
      ) as { buckets: { key: string; value: number; docCount: number }[]; others?: number };
    }

    it('adds the counts of both forms onto one bucket', () => {
      const data = actors([
        { key: 'Josh', doc_count: 5 },
        { key: 'alan', doc_count: 2 },
        { key: 'user:Josh', doc_count: 1 },
      ]);

      expect(data.buckets).toEqual([
        { key: 'Josh', value: 6, docCount: 6 },
        { key: 'alan', value: 2, docCount: 2 },
      ]);
    });

    it('keeps a group apart from a user bearing the same name', () => {
      const data = actors([
        { key: 'sales', doc_count: 3 },
        { key: 'group:sales', doc_count: 4 },
      ]);

      expect(data.buckets.map((bucket) => bucket.key).sort()).toEqual(['group:sales', 'sales']);
    });

    /*
     * The cardinality counts raw values, so comparing it against the merged list would invent
     * omissions: three values came back, and three is what the server was able to distinguish.
     */
    it('counts omitted values against what the server returned, not the merged list', () => {
      const data = actors(
        [
          { key: 'Josh', doc_count: 5 },
          { key: 'user:Josh', doc_count: 1 },
          { key: 'alan', doc_count: 2 },
        ],
        3,
      );

      expect(data.buckets).toHaveLength(2);
      expect(data.others).toBe(0);
    });

    it('leaves buckets alone when the widget names no principal', () => {
      const data = readAggregationWidget(
        response({ w: { buckets: [{ key: 'user:Josh', doc_count: 1 }] } }),
        plan(),
      ) as { buckets: { key: string }[] };

      expect(data.buckets[0].key).toBe('user:Josh');
    });
  });

  /**
   * A trend's hint says how wide its bars are, and that width is known at two different moments:
   * when the planner chose it, before the request; when OpenSearch did, only in the response.
   */
  describe('the width of a date histogram', () => {
    const days = [
      { key: 1, key_as_string: '2026-09-14', doc_count: 3 },
      { key: 2, key_as_string: '2026-09-21', doc_count: 0 },
    ];

    it('names the width the planner chose', () => {
      const data = readAggregationWidget(
        response({ w: { buckets: days } }),
        plan({ interval: 'week' }),
      ) as Extract<WidgetData, { kind: 'buckets' }>;

      expect(data.interval).toBe('week');
      expect(data.buckets.map((bucket) => bucket.key)).toEqual(['2026-09-14', '2026-09-21']);
    });

    it('names the width OpenSearch chose, read off the response', () => {
      const data = readAggregationWidget(
        response({ w: { buckets: days, interval: '7d' } }),
        plan({ interval: 'auto' }),
      ) as Extract<WidgetData, { kind: 'buckets' }>;

      expect(data.interval).toBe('7d');
    });

    it('reads the width under a filter wrapper, where the buckets are', () => {
      const data = readAggregationWidget(
        response({ w: { doc_count: 3, [INNER_AGG]: { buckets: days, interval: '1d' } } }),
        plan({ interval: 'auto', wrapped: true }),
      ) as Extract<WidgetData, { kind: 'buckets' }>;

      expect(data.interval).toBe('1d');
    });

    /** A month labelled `2024-03-01` reads as a day; a decade labelled with a day, worse. */
    it('shortens the keys of buckets OpenSearch sized by the month or by the year', () => {
      const read = (interval: string) =>
        (
          readAggregationWidget(
            response({
              w: { buckets: [{ key: 1, key_as_string: '2024-03-01', doc_count: 3 }], interval },
            }),
            plan({ interval: 'auto' }),
          ) as Extract<WidgetData, { kind: 'buckets' }>
        ).buckets[0].key;

      expect(read('3M')).toBe('2024-03');
      expect(read('10y')).toBe('2024');
      expect(read('7d')).toBe('2024-03-01');
    });

    it('leaves alone the keys of a width chosen in advance, already formatted for it', () => {
      const data = readAggregationWidget(
        response({ w: { buckets: [{ key: 1, key_as_string: '2024-03-01', doc_count: 3 }] } }),
        plan({ interval: 'month' }),
      ) as Extract<WidgetData, { kind: 'buckets' }>;

      expect(data.buckets[0].key).toBe('2024-03-01');
    });

    it('says nothing of a width on a list that is not a histogram', () => {
      const data = readAggregationWidget(
        response({ w: { buckets: [{ key: 'File', doc_count: 3 }] } }),
        plan(),
      ) as Extract<WidgetData, { kind: 'buckets' }>;

      expect(data.interval).toBeUndefined();
    });
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
