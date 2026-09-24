import { AggConfig } from '../config/dashboard-config.model';
import {
  AUTO_BUCKETS,
  METRIC_AGG,
  UnsupportedAggregationError,
  browserTimeZone,
  compileAgg,
  compileMetric,
  intervalForPeriod,
  keyFormat,
  metricUndefinedWhenEmpty,
  shardSizeFor,
} from './agg-compiler';
import { startOfLocalDayMillis } from './es-query';

describe('agg-compiler', () => {
  describe('field validation', () => {
    it('rejects a .keyword suffix, which silently matches nothing on a Nuxeo index', () => {
      expect(() => compileAgg({ terms: { field: 'ecm:primaryType.keyword' } })).toThrow(
        UnsupportedAggregationError,
      );
    });

    it('rejects a slash, because complex properties are indexed with a dot', () => {
      expect(() => compileAgg({ terms: { field: 'file:content/length' } })).toThrow(
        /indexed with a dot/,
      );
    });

    it('rejects an empty field', () => {
      expect(() => compileAgg({ terms: { field: '' } })).toThrow(UnsupportedAggregationError);
    });
  });

  describe('whitelist', () => {
    it('refuses anything outside the declared aggregation types', () => {
      const hostile = {
        scripted_metric: { init_script: 'state.x = 0' },
      } as unknown as AggConfig;

      expect(() => compileAgg(hostile)).toThrow(UnsupportedAggregationError);
    });

    it('never forwards unknown keys of a known aggregation', () => {
      const agg = {
        terms: { field: 'dc:creator', size: 5, script: 'doc["x"].value' },
      } as unknown as AggConfig;

      expect(compileAgg(agg)).toEqual({
        terms: { field: 'dc:creator', size: 5, shard_size: shardSizeFor(5) },
      });
    });
  });

  describe('terms', () => {
    it('omits the order when the default count descending is wanted', () => {
      expect(compileAgg({ terms: { field: 'ecm:primaryType', size: 10 } })).toEqual({
        terms: { field: 'ecm:primaryType', size: 10, shard_size: shardSizeFor(10) },
      });
    });

    /*
     * Each shard ranks locally, so the coordinator needs a wider candidate list than the final
     * one to merge an exact top N. OpenSearch defaults to `size * 1.5 + 10`, which on the five
     * shard audit index is twenty-five candidates per shard.
     */
    it('asks each shard for more candidates than the list will hold', () => {
      const { terms } = compileAgg({ terms: { field: 'a', size: 10 } }) as {
        terms: { size: number; shard_size: number };
      };

      expect(terms.shard_size).toBeGreaterThan(terms.size * 1.5 + 10);
    });

    /*
     * The default on a keyword builds global ordinals over every value the shard holds, whatever
     * the filter selects: on `docUUID`, every document the audit ever named.
     */
    it('ranks the collected values rather than the whole shard\u2019s when asked to', () => {
      expect(compileAgg({ terms: { field: 'docUUID', size: 10, execution_hint: 'map' } })).toEqual({
        terms: { field: 'docUUID', size: 10, shard_size: shardSizeFor(10), execution_hint: 'map' },
      });
    });

    it('refuses any hint but map, the other one being the default already', () => {
      const other = {
        terms: { field: 'docUUID', execution_hint: 'global_ordinals' },
      } as unknown as AggConfig;

      expect(() => compileAgg(other)).toThrow(/only "map"/);
    });

    it('leaves the shard size out when no size was asked for', () => {
      expect(compileAgg({ terms: { field: 'a' } })).toEqual({ terms: { field: 'a' } });
    });

    it('maps the declared orders onto the OpenSearch syntax', () => {
      expect(compileAgg({ terms: { field: 'a', order: 'key_asc' } })).toEqual({
        terms: { field: 'a', order: { _key: 'asc' } },
      });
      expect(compileAgg({ terms: { field: 'a', order: 'count_asc' } })).toEqual({
        terms: { field: 'a', order: { _count: 'asc' } },
      });
    });

    it('orders by the nested metric when asked', () => {
      expect(
        compileAgg(
          { terms: { field: 'ecm:primaryType', order: 'metric_desc' } },
          { sum: 'file:content.length' },
        ),
      ).toEqual({
        terms: { field: 'ecm:primaryType', order: { [METRIC_AGG]: 'desc' } },
        aggs: { [METRIC_AGG]: { sum: { field: 'file:content.length' } } },
      });
    });

    it('refuses to order by a metric that was not declared', () => {
      expect(() => compileAgg({ terms: { field: 'a', order: 'metric_desc' } })).toThrow(
        /requires a metric/,
      );
    });

    /*
     * `percentiles` is multi-valued, so an order naming the aggregation alone leaves OpenSearch
     * unable to tell which percentile to sort on, and the request is rejected.
     */
    it('names the percentile in the order path, since percentiles is multi-valued', () => {
      const compiled = compileAgg(
        { terms: { field: 'extended.modelName', order: 'metric_desc' } },
        { percentile: { field: 'extended.timeSinceWfStarted', percent: 50 } },
      ) as { terms: { order: Record<string, string> } };

      expect(compiled.terms.order).toEqual({ [`${METRIC_AGG}.50`]: 'desc' });
    });
  });

  describe('date_histogram', () => {
    it('defaults min_doc_count to 0 so that empty days still appear on a trend', () => {
      const agg = compileAgg({
        date_histogram: { field: 'dc:created', calendar_interval: 'day' },
      }) as { date_histogram: Record<string, unknown> };

      expect(agg.date_histogram['field']).toBe('dc:created');
      expect(agg.date_histogram['calendar_interval']).toBe('day');
      expect(agg.date_histogram['min_doc_count']).toBe(0);
    });

    it('cuts the buckets in the reader own zone, not at UTC midnight', () => {
      const agg = compileAgg({
        date_histogram: { field: 'dc:created', calendar_interval: 'day' },
      }) as { date_histogram: Record<string, unknown> };

      // Without it, a document created at 23:30 in Paris is credited to the previous day.
      expect(agg.date_histogram['time_zone']).toBe(browserTimeZone());
      expect(agg.date_histogram['time_zone']).toBeTruthy();
    });

    it('lets a dashboard pin the zone, so it reads the same for everyone', () => {
      const agg = compileAgg({
        date_histogram: { field: 'dc:created', calendar_interval: 'day', time_zone: 'UTC' },
      }) as { date_histogram: Record<string, unknown> };

      expect(agg.date_histogram['time_zone']).toBe('UTC');
    });

    it('accepts an IANA name, which survives a daylight saving change', () => {
      const agg = compileAgg({
        date_histogram: {
          field: 'dc:created',
          calendar_interval: 'day',
          time_zone: 'Europe/Paris',
        },
      }) as { date_histogram: Record<string, unknown> };

      expect(agg.date_histogram['time_zone']).toBe('Europe/Paris');
    });

    it('rejects a zone that is not a zone', () => {
      expect(() =>
        compileAgg({
          date_histogram: {
            field: 'dc:created',
            calendar_interval: 'day',
            time_zone: '"; DROP',
          },
        }),
      ).toThrow(UnsupportedAggregationError);
    });
  });

  /**
   * `search.max_buckets` is 65,535 over the whole response, and a daily histogram spans whatever it
   * is given: one document dated 1899 on "All time", or a range typed from 1899, is 46,000 bars a
   * chart. Two such charts, or a date a century older, and the request fails for every widget on
   * the page.
   */
  describe('an automatic interval', () => {
    const AUTO: AggConfig = { date_histogram: { field: 'dc:created', calendar_interval: 'auto' } };

    function period(from: string, to: string, field = 'dc:created') {
      return { field, min: startOfLocalDayMillis(from), max: startOfLocalDayMillis(to) };
    }

    function widthOver(from: string, to: string): unknown {
      const agg = compileAgg(AUTO, undefined, period(from, to)) as {
        date_histogram: Record<string, unknown>;
      };
      return agg.date_histogram['calendar_interval'];
    }

    it('draws a period of known days by the day, the week, the month or the year', () => {
      expect(widthOver('2026-06-20', '2026-09-19')).toBe('day'); // 92 days
      expect(widthOver('2026-06-19', '2026-09-19')).toBe('week'); // 93 days
      expect(widthOver('2025-09-24', '2026-09-23')).toBe('week'); // Last 12 months
      expect(widthOver('2024-09-23', '2026-09-23')).toBe('week'); // two years, a day included
      expect(widthOver('2024-01-01', '2026-09-23')).toBe('month');
      expect(widthOver('2006-09-24', '2026-09-23')).toBe('month'); // twenty years
      expect(widthOver('1899-12-30', '2026-09-23')).toBe('year');
    });

    /*
     * Where the zone has one, the last Sunday of March is 23 hours long: ninety-three calendar days
     * across it are an hour short of ninety-three times twenty-four. Truncating would count
     * ninety-two and draw them by the day.
     */
    it('counts calendar days, so a daylight saving change cannot tip a period over', () => {
      const { min, max } = period('2026-01-01', '2026-04-03');

      expect(intervalForPeriod(min, max)).toBe('week');
      expect(widthOver('2026-08-01', '2026-10-31')).toBe('day'); // 92 days across October's
    });

    it('keys each width the way it reads, and pads the period as a daily chart would', () => {
      const bounds = period('2024-01-01', '2026-09-23');
      const agg = compileAgg(AUTO, undefined, bounds) as {
        date_histogram: Record<string, unknown>;
      };

      expect(agg.date_histogram['format']).toBe(keyFormat('month'));
      expect(agg.date_histogram['min_doc_count']).toBe(0);
      expect(agg.date_histogram['extended_bounds']).toEqual({ min: bounds.min, max: bounds.max });
    });

    it('leaves the width to OpenSearch on All time, where only the index knows the span', () => {
      const agg = compileAgg(AUTO) as { auto_date_histogram: Record<string, unknown> };

      expect(agg).toEqual({
        auto_date_histogram: {
          field: 'dc:created',
          buckets: AUTO_BUCKETS,
          minimum_interval: 'day',
          format: 'yyyy-MM-dd',
          time_zone: browserTimeZone(),
        },
      });
    });

    it('leaves it to OpenSearch too on a field the period does not bound', () => {
      const agg = compileAgg(
        { date_histogram: { field: 'dc:modified', calendar_interval: 'auto' } },
        undefined,
        period('2026-08-20', '2026-09-18'),
      );

      expect(Object.keys(agg)).toEqual(['auto_date_histogram']);
    });

    it('leaves it to OpenSearch on a period open at one end', () => {
      const agg = compileAgg(AUTO, undefined, {
        field: 'dc:created',
        min: startOfLocalDayMillis('1899-12-30'),
      });

      expect(Object.keys(agg)).toEqual(['auto_date_histogram']);
    });

    it('keeps the metric computed per bucket, whoever chose the width', () => {
      const agg = compileAgg(AUTO, { cardinality: 'principalName' }) as Record<string, any>;

      expect(agg['aggs'][METRIC_AGG]).toEqual({ cardinality: { field: 'principalName' } });
    });

    it('keeps a width a configuration names, whatever the period', () => {
      const agg = compileAgg(
        { date_histogram: { field: 'dc:created', calendar_interval: 'day' } },
        undefined,
        period('1899-12-30', '2026-09-23'),
      ) as { date_histogram: Record<string, unknown> };

      expect(agg.date_histogram['calendar_interval']).toBe('day');
      expect(agg.date_histogram['format']).toBeUndefined();
    });

    it('refuses min_doc_count beside it, which one of its two forms has no place for', () => {
      expect(() =>
        compileAgg({
          date_histogram: { field: 'dc:created', calendar_interval: 'auto', min_doc_count: 1 },
        }),
      ).toThrow(/min_doc_count/);
    });
  });

  describe('browserTimeZone', () => {
    it('returns an IANA name', () => {
      expect(browserTimeZone()).toMatch(/^[A-Za-z]+\/[A-Za-z_]+$|^UTC$/);
    });

    it('omits the zone rather than guessing when Intl has no data', () => {
      const original = Intl.DateTimeFormat;
      Intl.DateTimeFormat = (() => {
        throw new Error('no Intl data');
      }) as unknown as typeof Intl.DateTimeFormat;

      try {
        expect(browserTimeZone()).toBeUndefined();
      } finally {
        Intl.DateTimeFormat = original;
      }
    });
  });

  describe('ranges', () => {
    it('requires at least one range', () => {
      expect(() => compileAgg({ range: { field: 'a', ranges: [] } })).toThrow(/at least one range/);
      expect(() => compileAgg({ date_range: { field: 'a', ranges: [] } })).toThrow(
        /at least one range/,
      );
    });
  });

  describe('compileMetric', () => {
    it('returns null for a plain document count', () => {
      expect(compileMetric(undefined)).toBeNull();
      expect(compileMetric({ count: true })).toBeNull();
    });

    it('maps each operator onto a field based metric', () => {
      expect(compileMetric({ cardinality: 'ecm:uuid' })).toEqual({
        cardinality: { field: 'ecm:uuid' },
      });
      expect(compileMetric({ avg: 'file:content.length' })).toEqual({
        avg: { field: 'file:content.length' },
      });
    });

    it('validates the metric field too', () => {
      expect(() => compileMetric({ sum: 'file:content.length.keyword' })).toThrow(
        UnsupportedAggregationError,
      );
    });

    it('asks for a single percentile, which is what the reader is shown', () => {
      expect(
        compileMetric({ percentile: { field: 'extended.timeSinceWfStarted', percent: 50 } }),
      ).toEqual({
        percentiles: { field: 'extended.timeSinceWfStarted', percents: [50] },
      });
    });

    it('rejects a percentile outside the open interval, which OpenSearch cannot answer', () => {
      for (const percent of [0, 100, -5, 140]) {
        expect(() => compileMetric({ percentile: { field: 'a', percent } })).toThrow(
          UnsupportedAggregationError,
        );
      }
    });

    /**
     * The operator is read from the object, not inferred from it. TypeScript is erased at runtime,
     * so a metric parsed from JSON arrives carrying whatever key it was written with — and taking
     * the first one sent `significant_terms`, far more expensive than anything the union names,
     * where a single value was expected.
     */
    it('rejects an aggregation the union never named', () => {
      expect(() => compileMetric({ significant_terms: 'dc:creator' } as never)).toThrow(
        UnsupportedAggregationError,
      );
    });

    it('rejects a field that is not a name, rather than failing on it later', () => {
      expect(() => compileMetric({ sum: { field: 'x' } } as never)).toThrow(
        UnsupportedAggregationError,
      );
    });

    it('validates the percentile field like any other', () => {
      expect(() => compileMetric({ percentile: { field: 'a.keyword', percent: 50 } })).toThrow(
        UnsupportedAggregationError,
      );
    });

    it('marks as unmeasured the metrics that have no value over an empty set', () => {
      expect(metricUndefinedWhenEmpty({ percentile: { field: 'a', percent: 90 } })).toBe(true);
      expect(metricUndefinedWhenEmpty({ avg: 'a' })).toBe(true);
      // A sum and a cardinality of nothing really are zero.
      expect(metricUndefinedWhenEmpty({ sum: 'a' })).toBe(false);
      expect(metricUndefinedWhenEmpty({ cardinality: 'a' })).toBe(false);
    });
  });
});
