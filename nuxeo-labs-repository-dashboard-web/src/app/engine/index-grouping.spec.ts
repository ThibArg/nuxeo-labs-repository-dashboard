import { describe, expect, it } from 'vitest';
import {
  DashboardConfig,
  FilterState,
  PathScopeFilterConfig,
  TermsGroupConfig,
} from '../config/dashboard-config.model';
import { compileComposition } from '../config/composition-compiler';
import { validateConfig } from './dashboard-override.service';
import { describeFilters } from './facet-clause';
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
 *
 * The other half of the contract is that a *shared* filter is only shared among the widgets that
 * can answer it. `ecm:path.children` and `ecm:primaryType` live on the repository and nowhere
 * else, and an audit request carrying them does not come back unfiltered — it comes back empty.
 * So every shared clause names the indices it constrains, and a page that leaves it unsaid is
 * refused rather than rendered.
 */
const BOUNDED: FilterState = {
  range: { id: '30d', label: 'Last 30 days', from: '2026-08-20', to: '2026-09-18' },
  groups: {},
  picks: [],
  path: null,
};

const KIND: TermsGroupConfig = {
  type: 'termsGroup',
  id: 'kind',
  label: 'Document kinds',
  indices: ['nuxeo'],
  members: [{ id: 'types', field: 'ecm:primaryType', label: 'Document types' }],
};

const LOCATION: PathScopeFilterConfig = { type: 'pathScope', indices: ['nuxeo'] };

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

/** The two requests, repository first, as `groupByIndex` orders them. */
function halves(config: DashboardConfig, filters: FilterState = BOUNDED): [string, string] {
  const plan = planDashboard(config, filters);
  const repository = plan.requests.find((request) => request.index === 'nuxeo')!;
  const audit = plan.requests.find((request) => request.index === 'audit')!;
  return [JSON.stringify(repository.body.query), JSON.stringify(audit.body.query)];
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
    const [repository, audit] = halves(mixed());

    expect(repository).toContain('dc:created');
    expect(audit).toContain('eventDate');
    expect(audit).not.toContain('dc:created');
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
    const [, audit] = halves(
      mixed({ filters: [{ type: 'dateRange', field: 'dc:created', byIndex: { audit: '' } }] }),
    );

    expect(audit).not.toContain('dc:created');
  });
});

/**
 * The shared filters, which used to be shared with the half that cannot answer them.
 *
 * Each of these three would have emptied the audit request rather than leaving it alone, and none
 * of them would have said so: the widget renders, the figure is zero, and a quiet week looks
 * exactly the same.
 */
describe('a shared filter on a page that reads two indices', () => {
  it('sends a filter group only to the indices it declares', () => {
    const [repository, audit] = halves(
      mixed({
        filters: [
          { type: 'dateRange', field: 'dc:created', byIndex: { audit: 'eventDate' } },
          KIND,
        ],
      }),
      { ...BOUNDED, groups: { kind: { types: { mode: 'subset', values: ['File'] } } } },
    );

    expect(repository).toContain('ecm:primaryType');
    expect(audit).not.toContain('ecm:primaryType');
    expect(audit).toContain('eventDate');
  });

  it('sends the path scope only to the indices it declares', () => {
    const [repository, audit] = halves(
      mixed({
        filters: [
          { type: 'dateRange', field: 'dc:created', byIndex: { audit: 'eventDate' } },
          LOCATION,
        ],
      }),
      { ...BOUNDED, path: '/default-domain/workspaces' },
    );

    expect(repository).toContain('ecm:path.children');
    expect(audit).not.toContain('ecm:path.children');
  });

  /**
   * A pick has no declaration to read, so it carries the index of the chart it was clicked on.
   * Clicking `File` on a repository donut is a statement about documents, and there is no reading
   * of it an audit entry could answer.
   */
  it('keeps a picked bucket on the index its chart was reading', () => {
    const [repository, audit] = halves(mixed(), {
      ...BOUNDED,
      picks: [{ field: 'ecm:primaryType', value: 'File', label: 'File', index: 'nuxeo' }],
    });

    expect(repository).toContain('ecm:primaryType');
    expect(audit).not.toContain('ecm:primaryType');
  });

  /**
   * A pick carrying no index is a pick made on a page that had only one, so it still applies
   * everywhere. This is what keeps every shipped screen, and every test written before picks
   * carried an index, behaving exactly as they did.
   */
  it('applies a pick that names no index to both halves', () => {
    const [repository, audit] = halves(mixed(), {
      ...BOUNDED,
      picks: [{ field: 'ecm:primaryType', value: 'File', label: 'File' }],
    });

    expect(repository).toContain('ecm:primaryType');
    expect(audit).toContain('ecm:primaryType');
  });

  /** An undeclared group is the ordinary single-index case, and must stay unconditional. */
  it('sends an undeclared group to every index, which is what one index wants', () => {
    const [repository, audit] = halves(
      mixed({
        filters: [
          { type: 'dateRange', field: 'dc:created', byIndex: { audit: 'eventDate' } },
          { ...KIND, indices: undefined },
        ],
      }),
      { ...BOUNDED, groups: { kind: { types: { mode: 'subset', values: ['File'] } } } },
    );

    expect(repository).toContain('ecm:primaryType');
    expect(audit).toContain('ecm:primaryType');
  });
});

/**
 * What the reader is told, on paper and in the standalone file.
 *
 * An exported page outlives the screen it came from, so a sheet announcing a filter that half its
 * figures never obeyed is the same lie as the empty widget, written down.
 */
describe('describing the filters of a page that reads two indices', () => {
  it('names every date field the period actually constrains', () => {
    expect(describeFilters(mixed(), BOUNDED)).toContain(
      'Period: Last 30 days on dc:created and eventDate',
    );
  });

  it('says which half a group narrowed', () => {
    const lines = describeFilters(
      mixed({
        filters: [
          { type: 'dateRange', field: 'dc:created', byIndex: { audit: 'eventDate' } },
          KIND,
        ],
      }),
      { ...BOUNDED, groups: { kind: { types: { mode: 'subset', values: ['File'] } } } },
    );

    expect(lines).toContain('Document kinds — Document types: File (nuxeo only)');
  });

  it('says nothing about halves on a page that has one', () => {
    const single = mixed({
      filters: [
        { type: 'dateRange', field: 'dc:created' },
        { ...KIND, indices: undefined },
      ],
      layout: [{ cells: ['created', 'byType'] }],
    });

    const lines = describeFilters(single, {
      ...BOUNDED,
      groups: { kind: { types: { mode: 'subset', values: ['File'] } } },
    });

    expect(lines).toEqual([
      'Period: Last 30 days on dc:created',
      'Document kinds — Document types: File',
    ]);
  });
});

/**
 * The gate, which is what makes all of the above a guarantee rather than an opportunity.
 *
 * Guessing which field lives on which index would mean a copy of the Nuxeo mapping, wrong the
 * first time somebody adds a field. Demanding the declaration costs the author one key and buys a
 * page whose figures can be accounted for — and `validateConfig` runs on a shipped file as well
 * as on an administrator's edit, so neither can get away with it.
 */
describe('refusing a page that reads two indices and leaves its filters implicit', () => {
  function problemsOf(config: DashboardConfig): string[] {
    return validateConfig(JSON.stringify(config), 'mixed').problems;
  }

  it('accepts the page once every filter has said which half it constrains', () => {
    expect(
      problemsOf(
        mixed({
          filters: [
            { type: 'dateRange', field: 'dc:created', byIndex: { audit: 'eventDate' } },
            KIND,
            LOCATION,
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('names the index the period says nothing about', () => {
    const problems = problemsOf(mixed({ filters: [{ type: 'dateRange', field: 'dc:created' }] }));

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"audit" does not carry');
    expect(problems[0]).toContain('byIndex');
  });

  it('names a group that has not said which half it constrains', () => {
    const problems = problemsOf(
      mixed({
        filters: [
          { type: 'dateRange', field: 'dc:created', byIndex: { audit: 'eventDate' } },
          { ...KIND, indices: undefined },
        ],
      }),
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"kind"');
    expect(problems[0]).toContain('indices');
  });

  it('names a path scope that has not said which half it constrains', () => {
    const problems = problemsOf(
      mixed({
        filters: [
          { type: 'dateRange', field: 'dc:created', byIndex: { audit: 'eventDate' } },
          { type: 'pathScope' },
        ],
      }),
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('path scope');
  });

  /**
   * `baseFilter` has no index to be attributed to: it is a list of raw clauses, and the compiled
   * form is the only place one can be written at all. On a page with two halves there is no
   * reading of it that is right for both, so it is refused rather than silently applied to the
   * half it was never meant for.
   */
  it('refuses a base filter, which cannot belong to both halves', () => {
    const problems = problemsOf(mixed({ baseFilter: [{ term: { 'ecm:isVersion': false } }] }));

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('baseFilter');
  });

  /** None of this may cost a single-index dashboard anything, and every shipped file is one. */
  it('asks nothing of a dashboard that reads one index', () => {
    const { created, byType } = mixed().widgets;
    const single = mixed({
      filters: [
        { type: 'dateRange', field: 'dc:created' },
        { ...KIND, indices: undefined },
      ],
      layout: [{ cells: ['created', 'byType'] }],
      widgets: { created, byType },
      baseFilter: [{ term: { 'ecm:isVersion': false } }],
    });

    expect(problemsOf(single)).toEqual([]);
  });
});

/**
 * The same thing, out of the library rather than out of a fixture.
 *
 * Until Users and Workflows were migrated the grouping was exercised by the synthetic
 * configuration above and by nothing else: no shipped widget read the audit, so a page mixing the
 * two indices could be written in a spec and nowhere near a screen. These are the real
 * definitions, and this is the composition somebody would actually write.
 */
describe('a composition mixing the repository and the audit', () => {
  const MIXED = {
    id: 'activity',
    label: 'Activity',
    index: 'nuxeo' as const,
    filters: [{ type: 'dateRange' as const, field: 'dc:created', byIndex: { audit: 'eventDate' } }],
    layout: [
      {
        cells: [
          { use: 'documents-created', as: 'created' },
          { use: 'distinct-users-per-day', as: 'people' },
          { use: 'documents-by-type', as: 'byType' },
        ],
      },
    ],
  };

  it('compiles, and marks the widget that reads another index', () => {
    const { config, problems } = compileComposition(MIXED);

    expect(problems).toEqual([]);
    expect(config!.index).toBe('nuxeo');
    expect(config!.widgets['people'].index).toBe('audit');
    expect(config!.widgets['created'].index).toBeUndefined();
  });

  /**
   * Inferring the page index from the first widget is right while there is only one. Past that it
   * makes the order of the cells decide which index the facet value lists are counted on, and
   * moving a cell would empty a dialog with nothing on screen to explain it.
   */
  it('refuses to infer the page index from whichever widget comes first', () => {
    const { config, problems } = compileComposition({ ...MIXED, index: undefined });

    expect(config).toBeNull();
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('nuxeo and audit');
    expect(problems[0]).toContain('"index"');
  });

  it('refuses an index no widget on the page reads', () => {
    const { config, problems } = compileComposition({ ...MIXED, index: 'audit_wf' as const });

    expect(config).toBeNull();
    expect(problems[0]).toContain('no widget on this page reads');
  });

  /** A single-index composition still says nothing, which is every dashboard that ships. */
  it('still infers the index of a composition that reads one', () => {
    const { config, problems } = compileComposition({
      id: 'content',
      label: 'Content',
      layout: [{ cells: [{ use: 'documents-created', as: 'created' }] }],
    });

    expect(problems).toEqual([]);
    expect(config!.index).toBe('nuxeo');
  });

  it('costs one request per index, not one per widget', () => {
    const { config } = compileComposition(MIXED);
    const plan = planDashboard(config!, BOUNDED);

    expect(plan.requests).toHaveLength(2);
    expect(plan.requests.map((request) => request.index)).toEqual(['nuxeo', 'audit']);
    expect(Object.keys(plan.requests[0].body.aggs ?? {}).sort()).toEqual(['byType', 'created']);
    expect(Object.keys(plan.requests[1].body.aggs ?? {})).toEqual(['people']);
  });

  it('constrains each half on the date field its own index carries', () => {
    const { config } = compileComposition(MIXED);
    const [repository, audit] = planDashboard(config!, BOUNDED).requests;

    expect(JSON.stringify(repository.body.query)).toContain('dc:created');
    expect(JSON.stringify(audit.body.query)).toContain('eventDate');
    expect(JSON.stringify(audit.body.query)).not.toContain('dc:created');
  });

  /**
   * The repository half keeps excluding versions and proxies while the audit half does not, each
   * widget carrying the population it describes. A shared base filter could not have done this:
   * `ecm:isVersion` means nothing to an audit entry.
   */
  it('lets each half keep a population the other could not express', () => {
    const { config } = compileComposition(MIXED);
    const [repository, audit] = planDashboard(config!, BOUNDED).requests;

    expect(JSON.stringify(repository.body.aggs)).toContain('ecm:isVersion');
    expect(JSON.stringify(audit.body.aggs)).toContain('loginSuccess');
    expect(JSON.stringify(audit.body.aggs)).not.toContain('ecm:isVersion');
  });

  /**
   * What every widget of a request counts is lifted into that request's query, and a request is
   * one index. Lifting across the page instead would hand the audit the live-document clauses of
   * the repository half, and an audit request carrying `ecm:isVersion` answers zero, not everything.
   */
  it('narrows each half by what its own widgets count, never by the other half', () => {
    const { config } = compileComposition(MIXED);
    const [repository, audit] = planDashboard(config!, BOUNDED).requests;

    expect(JSON.stringify(repository.body.query)).toContain('"ecm:isVersion":false');
    expect(JSON.stringify(repository.body.query)).not.toContain('loginSuccess');
    expect(JSON.stringify(audit.body.query)).toContain('loginSuccess');
    expect(JSON.stringify(audit.body.query)).not.toContain('ecm:isVersion');
  });
});
