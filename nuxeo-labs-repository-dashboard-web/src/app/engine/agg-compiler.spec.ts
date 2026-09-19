import { AggConfig } from '../config/dashboard-config.model';
import {
  METRIC_AGG,
  UnsupportedAggregationError,
  browserTimeZone,
  compileAgg,
  compileMetric,
  shardSizeFor,
} from './agg-compiler';

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
  });
});
