import { describe, expect, it } from 'vitest';
import { CompositionCell, DashboardComposition, isComposition } from './composition.model';
import { compileComposition } from './composition-compiler';
import { validateConfig } from '../engine/dashboard-override.service';
import { planDashboard } from '../engine/query-planner';
import { defaultFilterState } from './dashboard-config.model';

function composition(cells: CompositionCell[]): DashboardComposition {
  return { id: 'demo', label: 'Demo', layout: [{ cells }] };
}

function compile(cells: CompositionCell[]) {
  return compileComposition(composition(cells));
}

describe('compiling a composition', () => {
  it('produces a configuration the planner accepts', () => {
    const { config, problems } = compile([{ use: 'documents-by-type', as: 'byType' }]);

    expect(problems).toEqual([]);
    expect(planDashboard(config!, defaultFilterState()).errors.size).toBe(0);
  });

  it('names the widget after its own id when the composition does not', () => {
    const { config } = compile([{ use: 'documents-by-type' }]);

    expect(Object.keys(config!.widgets)).toEqual(['documents-by-type']);
  });

  it('refuses a widget the library does not offer, and says what it does offer', () => {
    const { config, problems } = compile([{ use: 'documents-by-colour' }]);

    expect(config).toBeNull();
    expect(problems[0]).toContain('No widget is called "documents-by-colour"');
    expect(problems[0]).toContain('documents-by-type');
  });

  /**
   * Two cells under one name would write to the same aggregation, so one figure would silently
   * become the other's. Naming aggregations after the widget is what makes batching possible in
   * the first place, and this is the rule that keeps that naming trustworthy.
   */
  it('refuses two cells sharing a name', () => {
    const { config, problems } = compile([
      { use: 'documents-by-type', as: 'chart' },
      { use: 'documents-created', as: 'chart' },
    ]);

    expect(config).toBeNull();
    expect(problems[0]).toContain('Two cells are both called "chart"');
  });

  it('lets one widget appear twice under two names', () => {
    const { config, problems } = compile([
      { use: 'documents-by-type', as: 'types', with: { chart: 'donut' } },
      { use: 'documents-by-type', as: 'typesRanked', with: { chart: 'ranked-list' } },
    ]);

    expect(problems).toEqual([]);
    expect(Object.keys(config!.widgets)).toEqual(['types', 'typesRanked']);
  });

  describe('parameters', () => {
    it('refuses one the widget never declared, rather than ignoring it', () => {
      const { config, problems } = compile([{ use: 'documents-by-type', with: { colour: 'red' } }]);

      expect(config).toBeNull();
      expect(problems[0]).toContain('declares no parameter "colour"');
    });

    it('refuses a value outside the choices offered', () => {
      const { config, problems } = compile([{ use: 'documents-by-type', with: { chart: 'map' } }]);

      expect(config).toBeNull();
      expect(problems[0]).toContain('"chart" must be one of');
    });

    it('refuses a number where a list was declared', () => {
      const { config, problems } = compile([{ use: 'documents-by-type', with: { types: 'File' } }]);

      expect(config).toBeNull();
      expect(problems[0]).toContain('"types" expects a list of strings');
    });

    it('refuses a size outside the range the widget accepts', () => {
      const { problems } = compile([{ use: 'documents-by-type', with: { size: 0 } }]);

      expect(problems[0]).toContain('"size" must be at least 1');
    });

    it('fills in the defaults a composition leaves out', () => {
      const { config } = compile([{ use: 'documents-by-type', as: 'byType' }]);
      const widget = config!.widgets['byType'];

      expect(widget.type).toBe('donut');
      expect(JSON.stringify(widget)).toContain('"size":10');
    });

    it('narrows a widget to a few document types without any clause being written', () => {
      const { config } = compile([
        { use: 'documents-created', as: 'created', with: { types: ['File', 'Note'] } },
      ]);

      expect(config!.widgets['created'].filter).toContainEqual({
        terms: { 'ecm:primaryType': ['File', 'Note'] },
      });
    });

    /**
     * An empty list has to mean "no constraint", never "no value". Compiled the other way a widget
     * restricted to nothing in particular would match nothing at all.
     */
    it('adds no clause for an empty restriction', () => {
      const { config } = compile([
        { use: 'documents-created', as: 'created', with: { types: [], facets: [] } },
      ]);

      expect(JSON.stringify(config!.widgets['created'].filter)).not.toContain('ecm:primaryType');
    });
  });

  describe('presentation', () => {
    it('lets the page rename a card and replace its hint', () => {
      const { config } = compile([
        { use: 'documents-created', as: 'created', title: 'New Files', hint: 'Since Monday' },
      ]);

      expect(config!.widgets['created'].label).toBe('New Files');
      expect(config!.widgets['created'].hint).toBe('Since Monday');
    });

    /*
     * The width is left as a placeholder: it follows the period by default, and when OpenSearch
     * picks it only the response can say which, so the page fills it in once the data is back.
     */
    it('keeps the definition\u2019s own hint when the page has nothing to say', () => {
      const { config } = compile([{ use: 'documents-created', as: 'created' }]);

      expect(config!.widgets['created'].hint).toContain('created per {interval}');
      expect(JSON.stringify(config!.widgets['created'])).toContain('"calendar_interval":"auto"');
    });

    it('follows the interval a composition asks for', () => {
      const { config } = compile([
        { use: 'documents-created', as: 'created', with: { interval: 'month' } },
      ]);

      expect(JSON.stringify(config!.widgets['created'])).toContain('"calendar_interval":"month"');
    });
  });

  describe('what it refuses outright', () => {
    it('refuses a composition declaring no widget at all', () => {
      const { config, problems } = compileComposition({ id: 'demo', label: 'Demo', layout: [] });

      expect(config).toBeNull();
      expect(problems[0]).toContain('either a "layout" with at least one row, or a "widgets" list');
    });

    it('refuses a cell naming no widget', () => {
      const { problems } = compile([{ use: '' }]);

      expect(problems[0]).toContain('names no widget');
    });

    /**
     * Nothing is compiled on a best effort basis. A page built out of the widgets that happened to
     * resolve is a page whose figures nobody can account for.
     */
    it('compiles nothing at all when one cell is wrong', () => {
      const { config } = compile([
        { use: 'documents-by-type', as: 'fine' },
        { use: 'nonsense', as: 'broken' },
      ]);

      expect(config).toBeNull();
    });
  });

  it('passes the very validation the editor runs', () => {
    const { config } = compile([{ use: 'documents-by-type', as: 'byType' }]);

    expect(validateConfig(JSON.stringify(config), 'demo').problems).toEqual([]);
  });

  describe('the layout grammar', () => {
    const TABBED: DashboardComposition = {
      id: 'demo',
      label: 'Demo',
      layout: [
        { cells: [{ use: 'total-documents', as: 'total' }] },
        {
          section: 'Trends',
          collapsible: true,
          rows: [{ cells: [{ use: 'documents-created', as: 'created' }] }],
        },
        {
          tabs: [
            { label: 'By type', rows: [{ cells: [{ use: 'documents-by-type', as: 'byType' }] }] },
            {
              label: 'By author',
              rows: [{ cells: [{ use: 'top-contributors', as: 'authors' }] }],
            },
          ],
        },
      ],
    };

    it('keeps the shape it was written in', () => {
      const { config, problems } = compileComposition(TABBED);

      expect(problems).toEqual([]);
      expect(config!.layout).toEqual([
        { cells: ['total'] },
        { section: 'Trends', rows: [{ cells: ['created'] }], collapsible: true },
        {
          tabs: [
            { label: 'By type', rows: [{ cells: ['byType'] }] },
            { label: 'By author', rows: [{ cells: ['authors'] }] },
          ],
        },
      ]);
    });

    it('compiles a widget wherever the grammar put it', () => {
      const { config } = compileComposition(TABBED);

      expect(Object.keys(config!.widgets).sort()).toEqual([
        'authors',
        'byType',
        'created',
        'total',
      ]);
    });

    /**
     * A composition whose every widget sits inside a `tabs` has no `use` at the top level. Read as
     * already compiled, its cells would reach the planner as objects it cannot resolve, and the
     * page would render nothing while saying nothing either.
     */
    it('is still recognised as a composition when nothing sits at the top level', () => {
      const nested: DashboardComposition = {
        id: 'demo',
        label: 'Demo',
        layout: [TABBED.layout![2]],
      };

      expect(isComposition(nested)).toBe(true);
      expect(compileComposition(nested).problems).toEqual([]);
    });

    it('refuses a name reused across two different tabs', () => {
      const clashing: DashboardComposition = {
        id: 'demo',
        label: 'Demo',
        layout: [
          {
            tabs: [
              { label: 'One', rows: [{ cells: [{ use: 'documents-by-type', as: 'chart' }] }] },
              { label: 'Two', rows: [{ cells: [{ use: 'documents-created', as: 'chart' }] }] },
            ],
          },
        ],
      };

      expect(compileComposition(clashing).problems[0]).toContain('Two cells are both called');
    });

    it('names a layout entry that is none of the three kinds', () => {
      const wrong = {
        id: 'demo',
        label: 'Demo',
        layout: [{ panel: 'nope' }],
      } as unknown as DashboardComposition;

      expect(compileComposition(wrong).problems[0]).toContain('none of the three');
    });
  });
});
