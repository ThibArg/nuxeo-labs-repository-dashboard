import { toLocalDay } from '../config/dashboard-config.model';
import { dayRangeFilter } from './es-query';

/** Instant of a wall clock time, as the runtime's own zone reads it. */
function at(local: string): number {
  return new Date(local).getTime();
}

function bounds(from: string | null, to: string | null): { gte?: string; lt?: string } | null {
  const clause = dayRangeFilter('eventDate', from, to) as {
    range: { eventDate: { gte?: string; lt?: string } };
  } | null;
  return clause?.range.eventDate ?? null;
}

const HOUR = 3_600_000;

describe('dayRangeFilter', () => {
  it('adds no clause at all when the period is unbounded', () => {
    expect(dayRangeFilter('eventDate', null, null)).toBeNull();
  });

  it('covers the last day in full, including its local evening', () => {
    const { lt } = bounds('2026-09-01', '2026-09-18')!;

    // The reader asked for the 18th; an event that evening must be counted.
    expect(at('2026-09-18T23:30:00')).toBeLessThan(at(lt!));
    expect(at('2026-09-19T00:10:00')).toBeGreaterThanOrEqual(at(lt!));
  });

  it('starts at the first moment of the first day, in the zone of the reader', () => {
    const { gte } = bounds('2026-09-01', '2026-09-18')!;

    expect(at('2026-09-01T00:00:00')).toBe(at(gte!));
    expect(at('2026-08-31T23:30:00')).toBeLessThan(at(gte!));
  });

  it('accepts a single open bound', () => {
    expect(bounds('2026-09-01', null)).toEqual({ gte: expect.any(String) });
    expect(bounds(null, '2026-09-18')).toEqual({ lt: expect.any(String) });
  });

  /*
   * A day is not always 86 400 000 ms long. Stepping with `setDate` rather than with a fixed
   * number of milliseconds is what keeps two consecutive days adjacent across a daylight saving
   * change. In a zone without one the assertion simply holds; in a zone with one it is the only
   * thing standing between the dashboard and an hour counted twice, or not at all.
   */
  it('makes consecutive single day ranges tile the year without gap or overlap', () => {
    const day = new Date('2026-01-01T00:00:00');
    let previousEnd: string | undefined;

    for (let index = 0; index < 365; index++) {
      const key = toLocalDay(day);
      const { gte, lt } = bounds(key, key)!;
      const length = at(lt!) - at(gte!);

      if (previousEnd) {
        expect(gte, `${key} must start where the previous day ended`).toBe(previousEnd);
      }
      expect(length, `${key} lasts ${length / HOUR} hours`).toBeGreaterThanOrEqual(23 * HOUR);
      expect(length, `${key} lasts ${length / HOUR} hours`).toBeLessThanOrEqual(25 * HOUR);

      previousEnd = lt;
      day.setDate(day.getDate() + 1);
    }
  });
});
