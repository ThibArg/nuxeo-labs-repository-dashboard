import { DashboardConfig, FilterState, customRange, layoutCells } from '../dashboard-config.model';
import { dateFieldFor, planDashboard } from '../../engine/query-planner';
import { validateConfig } from '../../engine/dashboard-override.service';
import { shippedConfig } from '../../../testing/shipped';

/**
 * Checks that apply to every dashboard that actually ships.
 *
 * A configuration file is the one thing a unit test cannot infer: adding a dashboard must not
 * require remembering these rules, so they are asserted over the whole set.
 *
 * The set is read off the folder rather than listed here. A hand written list is a second place
 * to remember, and the one that gets forgotten: a dashboard added and not listed would be checked
 * by nothing at all, and nothing would say so. `registry.spec.ts` walks the library folder for the
 * same reason. `import.meta.glob` is a Vite feature and so is confined to the specs; the
 * application itself fetches `assets/dashboards/<id>.json`, which `angular.json` fills with the
 * same glob.
 */
const MODULES = (
  import.meta as unknown as {
    glob: (pattern: string, options: { eager: true }) => Record<string, { default: unknown }>;
  }
).glob('./*.json', { eager: true });

const SHIPPED: [string, unknown, DashboardConfig][] = Object.entries(MODULES).map(
  ([path, module]) => {
    const name = path.slice(path.lastIndexOf('/') + 1);
    return [name, module.default, shippedConfig(name, module.default)];
  },
);

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

/**
 * Anchors the discovery itself.
 *
 * An empty glob would make every `describe.each` below vanish, and a suite that asserts nothing
 * is green. Naming one file rather than all five is deliberate: listing them would put back the
 * hand written set this replaces, and adding a dashboard would once again mean editing a test.
 */
it('finds the dashboards the folder holds', () => {
  expect(SHIPPED.length).toBeGreaterThan(0);
  expect(SHIPPED.map(([name]) => name)).toContain('content.json');
});

describe.each(SHIPPED)('%s', (_name, source, config) => {
  it('compiles without a single widget error', () => {
    expect([...planDashboard(config, BOUNDED).errors]).toEqual([]);
  });

  /**
   * Held to what an administrator's edit is held to, which is more than the planner alone checks:
   * a mixed page whose shared filters have not said which half they constrain is refused there,
   * and a shipped file has no business getting away with what the editor refuses.
   */
  it('passes the very validation an edited configuration passes', () => {
    expect(validateConfig(JSON.stringify(source), config.id).problems).toEqual([]);
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
   *
   * The field is resolved per index, not once: a mixed page bounds `dc:created` on one half and
   * `eventDate` on the other, and counting only the primary one would call the audit histogram an
   * unexpected bound and fail for the wrong reason.
   */
  it('states histogram bounds as numbers, never as a date string', () => {
    const paddable: unknown[] = [];
    const bounds: Record<string, unknown>[] = [];

    for (const request of planDashboard(config, BOUNDED).requests) {
      const dateField = dateFieldFor(config, request.index);
      const walk = (node: unknown): void => {
        if (!node || typeof node !== 'object') {
          return;
        }
        const histogram = (node as { date_histogram?: { field?: string } }).date_histogram;
        if (dateField && histogram?.field === dateField) {
          paddable.push(node);
        }
        const bound = (node as { extended_bounds?: Record<string, unknown> }).extended_bounds;
        if (bound !== undefined) {
          bounds.push(bound);
        }
        Object.values(node as Record<string, unknown>).forEach(walk);
      };
      walk(request.body.aggs);
    }

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
