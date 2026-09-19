import {
  DashboardConfig,
  DATE_RANGE_SHORTCUTS,
  customRange,
  dateRangeOption,
  defaultFilterState,
  resolveShortcut,
  toLocalDay,
} from './dashboard-config.model';

/** A fixed afternoon, so that a shortcut cannot silently resolve against the wall clock. */
const TODAY = new Date('2026-09-18T15:42:00');

function shortcut(id: string) {
  return DATE_RANGE_SHORTCUTS.find((entry) => entry.id === id)!;
}

describe('date range shortcuts', () => {
  it('counts today as one of the days', () => {
    const range = resolveShortcut(shortcut('7d'), TODAY);

    // The 12th to the 18th inclusive is seven days, not eight.
    expect(range).toMatchObject({ id: '7d', from: '2026-09-12', to: '2026-09-18' });
  });

  it('ignores the time of day, so the period does not move during the afternoon', () => {
    const morning = resolveShortcut(shortcut('30d'), new Date('2026-09-18T06:00:00'));
    const evening = resolveShortcut(shortcut('30d'), new Date('2026-09-18T23:59:00'));

    expect(morning).toEqual(evening);
  });

  it('walks back by calendar months rather than by a fixed number of days', () => {
    expect(resolveShortcut(shortcut('12m'), TODAY)).toMatchObject({
      from: '2025-09-18',
      to: '2026-09-18',
    });
  });

  it('leaves both bounds open for the whole history', () => {
    expect(resolveShortcut(shortcut('all'), TODAY)).toEqual({
      id: 'all',
      label: 'All time',
      from: null,
      to: null,
    });
  });

  it('falls back to the first shortcut when the configured one is unknown', () => {
    expect(dateRangeOption('last-fortnight', TODAY).id).toBe('all');
  });
});

describe('toLocalDay', () => {
  it('reads the calendar day of the reader, not the UTC one', () => {
    // 00:30 in a zone ahead of UTC still belongs to that day, even though UTC says otherwise.
    const midnightish = new Date('2026-03-01T00:30:00');
    expect(toLocalDay(midnightish)).toBe('2026-03-01');
  });

  it('pads months and days', () => {
    expect(toLocalDay(new Date('2026-01-05T12:00:00'))).toBe('2026-01-05');
  });
});

describe('customRange', () => {
  it('swaps bounds given in the wrong order rather than matching nothing', () => {
    expect(customRange('2026-09-18', '2026-09-01')).toMatchObject({
      from: '2026-09-01',
      to: '2026-09-18',
    });
  });

  it('names the period it covers', () => {
    expect(customRange('2026-09-01', '2026-09-18').label).toContain('–');
    expect(customRange('2026-09-01', '2026-09-01').label).not.toContain('–');
    expect(customRange('2026-09-01', null).label).toContain('Since');
    expect(customRange(null, '2026-09-18').label).toContain('Until');
    expect(customRange(null, null).label).toBe('All time');
  });

  it('is told apart from a shortcut, so no shortcut stays highlighted', () => {
    expect(customRange('2026-09-01', '2026-09-18').id).toBe('custom');
  });
});

describe('defaultFilterState', () => {
  const config = (defaultId?: string): DashboardConfig => ({
    id: 'test',
    label: 'Test',
    index: 'nuxeo',
    filters: [{ type: 'dateRange', field: 'dc:created', default: defaultId }],
    layout: [],
    widgets: {},
  });

  it('resolves the shortcut named by the configuration', () => {
    expect(defaultFilterState(config('30d'), TODAY).range).toMatchObject({
      id: '30d',
      from: '2026-08-20',
      to: '2026-09-18',
    });
  });

  it('covers the whole history when the configuration says nothing', () => {
    expect(defaultFilterState(config(), TODAY).range.from).toBeNull();
  });
});
