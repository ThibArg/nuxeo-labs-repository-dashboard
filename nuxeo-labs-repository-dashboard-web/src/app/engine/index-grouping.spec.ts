import { describe, expect, it } from 'vitest';
import { DashboardConfig, FilterState } from '../config/dashboard-config.model';
import { planDashboard } from './query-planner';

/**
 * A page holding a repository figure beside an audit one.
 *
 * Until now a dashboard read one index and one only, which is why "documents created" and "who
 * logged in" could never sit on the same screen. Widgets now declare the index they read and the
 * planner groups them, so the limit is a request per index rather than a page per index.
 *
 * What is deliberately *not* done is one request per widget. Widgets of one index still travel
 * together, which is what keeps a partition adding up and `now` a single instant among the tiles
 * bounded by it.
 */
const BOUNDED: FilterState = {
  range: { id: '30d', label: 'Last 30 days', from: '2026-08-20', to: '2026-09-18' },
  groups: {},
  picks: [],
  path: null,
};

function mixed(overrides: Partial<DashboardConfig> = {}): DashboardConfig {
  return {
    id: 'mixed',
    label: 'Mixed',
    index: 'nuxeo',
    filters: [{ type: 'dateRange', field: 'dc:created', byIndex: { audit: 'eventDate' } }],
    layout: [{ cells: ['created', 'logins', 'byType'] }],
    widgets: {
      created: {
        type: 'area',
        label: 'Created',
        agg: { date_histogram: { field: 'dc:created', calendar_interval: 'day' } },
      },
      logins: {
        type: 'kpi',
        label: 'Logins',
        index: 'audit',
        filter: [{ term: { eventId: 'loginSuccess' } }],
      },
      byType: { type: 'donut', label: 'By type', agg: { terms: { field: 'ecm:primaryType' } } },
    },
    ...overrides,
  };
}

describe('planning a dashboard that reads two indices', () => {
  it('issues one request per index, not one per widget', () => {
    const plan = planDashboard(mixed(), BOUNDED);

    expect(plan.requests).toHaveLength(2);
    expect(plan.requests.map((request) => request.index)).toEqual(['nuxeo', 'audit']);
  });

  it('keeps the widgets of one index in one request', () => {
    const plan = planDashboard(mixed(), BOUNDED);
    const repository = plan.requests.find((request) => request.index === 'nuxeo')!;

    expect(Object.keys(repository.body.aggs ?? {}).sort()).toEqual(['byType', 'created']);
  });

  /**
   * One picker, two fields. A period means `dc:created` in the repository and `eventDate` in the
   * audit, and constraining the wrong one would silently answer over the whole history.
   */
  it('constrains each index on the date field that index carries', () => {
    const plan = planDashboard(mixed(), BOUNDED);
    const [repository, audit] = plan.requests;

    expect(JSON.stringify(repository.body.query)).toContain('dc:created');
    expect(JSON.stringify(audit.body.query)).toContain('eventDate');
    expect(JSON.stringify(audit.body.query)).not.toContain('dc:created');
  });

  it('pads the histogram of the index whose field the period constrains', () => {
    const aggs = planDashboard(mixed(), BOUNDED).requests[0].body.aggs as Record<string, any>;

    expect(aggs['created'].date_histogram.extended_bounds).toEqual({
      min: new Date('2026-08-20T00:00:00').getTime(),
      max: new Date('2026-09-18T00:00:00').getTime(),
    });
  });

  /**
   * A single-index dashboard must not pay for this. Everything that ships reads one index, and a
   * second round trip appearing there would be a regression nothing asked for.
   */
  it('still folds a single-index dashboard into one request', () => {
    const single = mixed({
      layout: [{ cells: ['created', 'byType'] }],
    });

    expect(planDashboard(single, BOUNDED).requests).toHaveLength(1);
  });

  it('leaves a period unapplied on an index the filter says nothing about', () => {
    const plan = planDashboard(
      mixed({ filters: [{ type: 'dateRange', field: 'dc:created', byIndex: { audit: '' } }] }),
      BOUNDED,
    );
    const audit = plan.requests.find((request) => request.index === 'audit')!;

    expect(JSON.stringify(audit.body.query)).not.toContain('dc:created');
  });
});
