import {
  DashboardConfig,
  DateRangeOption,
  formatDay,
  formatDayRange,
} from '../config/dashboard-config.model';
import {
  IndexHorizons,
  auditHorizons,
  coveredRange,
  horizonNotice,
  horizonReach,
} from './audit-horizon';

const HORIZON = '2026-03-12';
const HORIZONS: IndexHorizons = { audit: HORIZON, audit_wf: HORIZON };

const ALL_TIME: DateRangeOption = { id: 'all', label: 'All time', from: null, to: null };
const AFTER: DateRangeOption = {
  id: '30d',
  label: 'Last 30 days',
  from: '2026-08-26',
  to: '2026-09-24',
};
const ACROSS: DateRangeOption = {
  id: '12m',
  label: 'Last 12 months',
  from: '2025-09-24',
  to: '2026-09-24',
};
const BEFORE: DateRangeOption = {
  id: 'custom',
  label: 'Jan 1, 2025 – Jun 30, 2025',
  from: '2025-01-01',
  to: '2025-06-30',
};

function page(
  indices: ('nuxeo' | 'audit' | 'audit_wf')[],
  filters: DashboardConfig['filters'] = [{ type: 'dateRange', field: 'eventDate' }],
): DashboardConfig {
  const widgets = Object.fromEntries(
    indices.map((index) => [index, { type: 'kpi' as const, label: index, index }]),
  );
  return {
    id: 'page',
    label: 'Page',
    index: indices[0],
    filters,
    layout: [{ cells: indices }],
    widgets,
  };
}

describe('auditHorizons', () => {
  it('gives both audit names the day of the earliest entry, read in the local zone', () => {
    const earliest = new Date('2026-03-12T10:00:00').getTime();

    expect(auditHorizons(earliest)).toEqual({ audit: HORIZON, audit_wf: HORIZON });
  });

  it('knows no horizon when the audit was not reached or holds nothing', () => {
    expect(auditHorizons(null)).toEqual({});
    expect(auditHorizons(undefined)).toEqual({});
  });
});

describe('horizonReach', () => {
  it('tells a period the audit holds whole from one reaching before it', () => {
    expect(horizonReach(AFTER, HORIZON)).toBe('after');
    expect(horizonReach(ACROSS, HORIZON)).toBe('across');
    expect(horizonReach(ALL_TIME, HORIZON)).toBe('across');
    expect(horizonReach(BEFORE, HORIZON)).toBe('before');
  });

  it('counts a period starting on the first day the audit holds as whole', () => {
    expect(horizonReach({ ...AFTER, from: HORIZON }, HORIZON)).toBe('after');
  });

  it('counts a period ending on that day as reaching it, not as lying before it', () => {
    expect(horizonReach({ ...BEFORE, to: HORIZON }, HORIZON)).toBe('across');
  });
});

describe('coveredRange', () => {
  it('says All time over the audit starts where the audit does', () => {
    const covered = coveredRange(ALL_TIME, HORIZON);

    expect(covered.from).toBe(HORIZON);
    expect(covered.label).toBe(formatDayRange(HORIZON, null));
    // The shortcut stays the one chosen: only what the figures cover is restated.
    expect(covered.id).toBe('all');
  });

  it('starts a period reaching before the audit on its first day', () => {
    const covered = coveredRange(ACROSS, HORIZON);

    expect(covered.label).toBe(formatDayRange(HORIZON, ACROSS.to));
    expect(covered.to).toBe(ACROSS.to);
  });

  it('leaves alone a period the audit holds whole, one it holds none of, and the repository', () => {
    expect(coveredRange(AFTER, HORIZON)).toBe(AFTER);
    expect(coveredRange(BEFORE, HORIZON)).toBe(BEFORE);
    expect(coveredRange(ALL_TIME, undefined)).toBe(ALL_TIME);
  });
});

describe('horizonNotice', () => {
  const since = formatDay(HORIZON);

  it('says nothing on a page reading only the repository, which keeps its documents', () => {
    expect(horizonNotice(page(['nuxeo']), ALL_TIME, HORIZONS)).toBeNull();
  });

  it('says nothing while the start of the audit is unknown', () => {
    expect(horizonNotice(page(['audit']), ALL_TIME, {})).toBeNull();
  });

  it('names the start quietly when the period lies within what the audit holds', () => {
    const notice = horizonNotice(page(['audit']), AFTER, HORIZONS);

    expect(notice?.warn).toBe(false);
    expect(notice?.text).toContain(since);
  });

  it('says what All time means over the audit', () => {
    const notice = horizonNotice(page(['audit']), ALL_TIME, HORIZONS);

    expect(notice?.warn).toBe(true);
    expect(notice?.text).toContain('"All time" here starts on ' + since);
    expect(notice?.text).toContain('is not counted');
  });

  it('warns that a period reaching before the audit begins later than it says', () => {
    const notice = horizonNotice(page(['audit']), ACROSS, HORIZONS);

    expect(notice?.warn).toBe(true);
    expect(notice?.text).toContain(`nothing earlier than ${since} is kept`);
  });

  it('says a period lying wholly before the audit counts nothing', () => {
    const notice = horizonNotice(page(['audit']), BEFORE, HORIZONS);

    expect(notice?.warn).toBe(true);
    expect(notice?.text).toContain('audit figures read zero');
  });

  it('reads a page whose period leaves the audit alone as All time', () => {
    const unbounded = page(
      ['nuxeo', 'audit'],
      [{ type: 'dateRange', field: 'dc:created', byIndex: { audit: '' } }],
    );

    expect(horizonNotice(unbounded, AFTER, HORIZONS)?.warn).toBe(true);
  });

  it('tells a mixed page that its two halves do not go back to the same day', () => {
    const mixed = page(
      ['nuxeo', 'audit'],
      [{ type: 'dateRange', field: 'dc:created', byIndex: { audit: 'eventDate' } }],
    );

    expect(horizonNotice(mixed, AFTER, HORIZONS)?.text).toContain(
      'The repository figures are not bounded by it.',
    );
    expect(horizonNotice(page(['audit']), AFTER, HORIZONS)?.text).not.toContain('repository');
  });

  it('warns a page reading workflows that durations lean towards the shorter ones', () => {
    const notice = horizonNotice(page(['audit_wf']), AFTER, HORIZONS);

    expect(notice?.text).toContain(`A workflow started before ${since} may carry no duration`);
    expect(horizonNotice(page(['audit']), AFTER, HORIZONS)?.text).not.toContain('duration');
  });
});
