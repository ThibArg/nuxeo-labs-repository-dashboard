import { describe, expect, it } from 'vitest';
import { WIDGET_LIBRARY, findWidget, knownWidgetIds } from './registry';
import { resolveParams } from './definition';
import { compileComposition } from '../config/composition-compiler';
import { planDashboard } from '../engine/query-planner';
import { FilterState, customRange } from '../config/dashboard-config.model';

/**
 * The contract the library owes whoever composes with it, human or assistant.
 *
 * A developer points an assistant at this folder and it reads the definitions themselves: there
 * is no generated catalogue to fall out of step. That only works if every entry is self
 * describing, and if naming one in a composition is guaranteed to produce something that runs.
 */
const BOUNDED: FilterState = {
  range: customRange('2026-08-20', '2026-09-18'),
  groups: {},
  picks: [],
  path: null,
};

describe('the widget library', () => {
  it('is not empty, and answers by id', () => {
    expect(WIDGET_LIBRARY.length).toBeGreaterThan(0);
    expect(findWidget(WIDGET_LIBRARY[0].id)).toBe(WIDGET_LIBRARY[0]);
    expect(findWidget('no-such-widget')).toBeUndefined();
  });

  it('names every widget once', () => {
    const ids = WIDGET_LIBRARY.map((definition) => definition.id);

    expect([...new Set(ids)]).toHaveLength(ids.length);
    expect(knownWidgetIds()).toEqual([...ids].sort());
  });

  /** A composition is read aloud in review, so the ids have to read as names, not as symbols. */
  it('names them in kebab case', () => {
    for (const definition of WIDGET_LIBRARY) {
      expect(definition.id).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
    }
  });

  describe.each(WIDGET_LIBRARY.map((definition) => [definition.id, definition] as const))(
    '%s',
    (id, definition) => {
      /** The summary is the catalogue entry. A missing one is a widget nobody will pick. */
      it('says what it measures, in a sentence', () => {
        expect(definition.summary.length).toBeGreaterThan(20);
        expect(definition.summary.endsWith('.')).toBe(true);
        expect(definition.title.length).toBeGreaterThan(0);
      });

      it('documents every parameter it accepts', () => {
        for (const [name, spec] of Object.entries(definition.params)) {
          expect(spec.describe, `${id}.${name}`).toBeTruthy();
        }
      });

      it('offers a default this widget would itself accept', () => {
        const { problems } = resolveParams(definition, {});

        expect(problems).toEqual([]);
        for (const spec of Object.values(definition.params)) {
          if (spec.type === 'enum' && spec.default !== undefined) {
            expect(spec.values).toContain(spec.default);
          }
        }
      });

      /**
       * Naming a widget has to be enough. A definition that only works once a parameter is filled
       * in would fail in a composition rather than here, where the reason is legible.
       */
      it('builds and plans on its own, with nothing supplied', () => {
        const { config, problems } = compileComposition({
          id: 'probe',
          label: 'Probe',
          layout: [{ cells: [{ use: id }] }],
        });

        expect(problems).toEqual([]);

        const plan = planDashboard(config!, BOUNDED);
        expect(plan.errors.size).toBe(0);
        expect(plan.requests).toHaveLength(1);
        expect(plan.requests[0].index).toBe(definition.index);
      });
    },
  );
});
