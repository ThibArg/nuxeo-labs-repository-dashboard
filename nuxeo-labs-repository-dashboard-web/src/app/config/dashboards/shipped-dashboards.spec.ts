import contentConfig from './content.json';
import governanceConfig from './governance.json';
import tasksConfig from './tasks.json';
import usersConfig from './users.json';
import workflowsConfig from './workflows.json';
import {
  DashboardConfig,
  FilterState,
  customRange,
  dateRangeFilter,
  layoutCells,
} from '../dashboard-config.model';
import { planDashboard } from '../../engine/query-planner';
import { shippedConfig } from '../../../testing/shipped';

/**
 * Checks that apply to every dashboard that actually ships.
 *
 * A configuration file is the one thing a unit test cannot infer: adding a dashboard must not
 * require remembering these rules, so they are asserted over the whole set.
 */
const DASHBOARDS: [string, DashboardConfig][] = [
  ['content.json', shippedConfig('content.json', contentConfig)],
  ['governance.json', shippedConfig('governance.json', governanceConfig)],
  ['tasks.json', shippedConfig('tasks.json', tasksConfig)],
  ['users.json', shippedConfig('users.json', usersConfig)],
  ['workflows.json', shippedConfig('workflows.json', workflowsConfig)],
];

/** A bounded period, which is what makes the planner emit histogram bounds at all. */
const BOUNDED: FilterState = {
  range: customRange('2026-08-20', '2026-09-18'),
  groups: {},
  picks: [],
  path: null,
};

function everyAggregation(config: DashboardConfig): unknown[] {
  const found: unknown[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') {
      return;
    }
    found.push(node);
    Object.values(node as Record<string, unknown>).forEach(walk);
  };
  planDashboard(config, BOUNDED).requests.forEach((request) => walk(request.body.aggs));
  return found;
}

describe.each(DASHBOARDS)('%s', (_name, config) => {
  it('compiles without a single widget error', () => {
    expect([...planDashboard(config, BOUNDED).errors]).toEqual([]);
  });

  it('declares a widget for every layout cell, and no orphan widget', () => {
    const referenced = new Set(layoutCells(config.layout));
    const declared = new Set(Object.keys(config.widgets));

    expect([...referenced].filter((id) => !declared.has(id))).toEqual([]);
    expect([...declared].filter((id) => !referenced.has(id))).toEqual([]);
  });

  it('never appends a .keyword suffix, which Nuxeo maps nowhere', () => {
    expect(JSON.stringify(planDashboard(config, BOUNDED).requests)).not.toContain('.keyword');
  });

  /*
   * OpenSearch parses a string `extended_bounds` with the aggregation's own `format`. Every chart
   * here declares a day pattern to get readable bucket keys, so an ISO instant comes back as a 400
   * — the very failure that took the Users page down. Numbers are read as epoch milliseconds and
   * cannot be misread, whatever the format says.
   *
   * Only a histogram on the very field the period constrains gets padded: for any other field the
   * selected days say nothing. The count is asserted rather than a mere presence, so a dashboard
   * carrying no date filter at all — Tasks — is checked to emit no bounds instead of being skipped.
   */
  it('states histogram bounds as numbers, never as a date string', () => {
    const aggs = everyAggregation(config);
    const dateField = dateRangeFilter(config)?.field;
    const paddable = aggs.filter(
      (node) =>
        dateField !== undefined &&
        (node as { date_histogram?: { field?: string } }).date_histogram?.field === dateField,
    );
    const bounds = aggs
      .map((node) => (node as { extended_bounds?: Record<string, unknown> }).extended_bounds)
      .filter((value): value is Record<string, unknown> => value !== undefined);

    expect(bounds).toHaveLength(paddable.length);
    for (const bound of bounds) {
      expect(Object.values(bound).map((value) => typeof value)).not.toContain('string');
    }
  });

  /*
   * A `terms` list is a top N, and nothing on screen says so unless the count of distinct values
   * comes back with it. Every bucket list therefore asks for one, and asks each shard for a wide
   * enough candidate list that the merged ranking is exact rather than merely plausible.
   *
   * Only aggregations are considered: a scope may filter on `terms: { eventId: [...] }`, which is
   * a query clause carrying neither a size nor a shard size, and has no business here.
   */
  it('lets every top N say how many values it left out, and merges them exactly', () => {
    const aggs = everyAggregation(config);
    const lists = aggs.filter(
      (node) => (node as { terms?: { field?: string } }).terms?.field !== undefined,
    );

    expect(lists.length).toBeGreaterThan(0);
    for (const list of lists) {
      const terms = (list as { terms: { size?: number; shard_size?: number } }).terms;
      expect(terms.shard_size).toBeGreaterThan(terms.size! * 1.5 + 10);
    }

    const counted = aggs.filter(
      (node) => (node as Record<string, unknown>)['distinct'] !== undefined,
    );
    expect(counted).toHaveLength(lists.length);
  });
});
