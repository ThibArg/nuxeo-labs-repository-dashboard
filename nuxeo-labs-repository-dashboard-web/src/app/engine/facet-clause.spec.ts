import { FilterState, GroupSelection, TermsGroupConfig } from '../config/dashboard-config.model';
import { compileTermsGroup, describeTermsGroup } from './facet-clause';

const GROUP: TermsGroupConfig = {
  type: 'termsGroup',
  id: 'kind',
  label: 'Document kinds',
  combine: 'or',
  members: [
    { id: 'types', field: 'ecm:primaryType', label: 'Document types', labels: 'doctype' },
    { id: 'facets', field: 'ecm:mixinType', label: 'Facets' },
  ],
};

function state(selection: GroupSelection): FilterState {
  return {
    range: { id: 'all', label: 'All time', from: null, to: null },
    groups: { kind: selection },
  };
}

const ALL: GroupSelection = { types: { mode: 'all' }, facets: { mode: 'all' } };

describe('compileTermsGroup', () => {
  it('emits nothing when every member is unconstrained', () => {
    expect(compileTermsGroup(GROUP, state(ALL))).toBeNull();
  });

  it('emits nothing for a member selected down to an empty list', () => {
    expect(
      compileTermsGroup(
        GROUP,
        state({ types: { mode: 'subset', values: [] }, facets: { mode: 'all' } }),
      ),
    ).toBeNull();
  });

  it('emits a bare terms clause for a single constrained member, with no boolean wrapper', () => {
    const clause = compileTermsGroup(
      GROUP,
      state({ types: { mode: 'subset', values: ['File', 'Note'] }, facets: { mode: 'all' } }),
    );

    expect(clause).toEqual({ terms: { 'ecm:primaryType': ['File', 'Note'] } });
  });

  it('lets a facet constraint stand alone while all types stay selected', () => {
    // This is the case that breaks if "all" is compiled as "every value": the union would
    // swallow the facet constraint and the filter would silently do nothing.
    const clause = compileTermsGroup(
      GROUP,
      state({ types: { mode: 'all' }, facets: { mode: 'subset', values: ['Picture'] } }),
    );

    expect(clause).toEqual({ terms: { 'ecm:mixinType': ['Picture'] } });
  });

  it('unions two constrained members', () => {
    const clause = compileTermsGroup(
      GROUP,
      state({
        types: { mode: 'subset', values: ['File'] },
        facets: { mode: 'subset', values: ['Picture'] },
      }),
    );

    expect(clause).toEqual({
      bool: {
        should: [
          { terms: { 'ecm:primaryType': ['File'] } },
          { terms: { 'ecm:mixinType': ['Picture'] } },
        ],
        minimum_should_match: 1,
      },
    });
  });

  it('intersects instead when the group declares combine: and', () => {
    const clause = compileTermsGroup(
      { ...GROUP, combine: 'and' },
      state({
        types: { mode: 'subset', values: ['File'] },
        facets: { mode: 'subset', values: ['Picture'] },
      }),
    );

    expect(clause).toEqual({
      bool: {
        must: [
          { terms: { 'ecm:primaryType': ['File'] } },
          { terms: { 'ecm:mixinType': ['Picture'] } },
        ],
      },
    });
  });

  it('treats a missing group in the state as unconstrained', () => {
    expect(
      compileTermsGroup(GROUP, {
        range: { id: 'all', label: '', from: null, to: null },
        groups: {},
      }),
    ).toBeNull();
  });
});

describe('a member naming principals', () => {
  const ACTORS: TermsGroupConfig = {
    type: 'termsGroup',
    id: 'assignees',
    label: 'Assignees',
    combine: 'or',
    members: [{ id: 'actors', field: 'nt:actors', label: 'Assigned to', labels: 'user' }],
  };

  function actorState(values: string[]): FilterState {
    return {
      range: { id: 'all', label: 'All time', from: null, to: null },
      groups: { assignees: { actors: { mode: 'subset', values } } },
    };
  }

  /*
   * The same person reaches the index as `Josh` or `user:Josh` depending on which workflow node
   * created the task, so searching one form finds part of their work. `TaskActorsHelper` does
   * exactly this on the platform side, for every "My tasks" screen.
   */
  it('searches both forms of the selected user', () => {
    const clause = compileTermsGroup(ACTORS, actorState(['Josh'])) as {
      terms: { 'nt:actors': string[] };
    };

    expect(clause.terms['nt:actors'].sort()).toEqual(['Josh', 'user:Josh']);
  });

  it('searches both forms of a group as well', () => {
    const clause = compileTermsGroup(ACTORS, actorState(['group:sales'])) as {
      terms: { 'nt:actors': string[] };
    };

    expect(clause.terms['nt:actors'].sort()).toEqual(['group:sales', 'sales']);
  });

  // A selection persisted before the merge existed holds a raw value; it must still work.
  it('accepts a value stored under its raw form', () => {
    const clause = compileTermsGroup(ACTORS, actorState(['user:Josh'])) as {
      terms: { 'nt:actors': string[] };
    };

    expect(clause.terms['nt:actors'].sort()).toEqual(['Josh', 'user:Josh']);
  });

  it('leaves a member that names no principal untouched', () => {
    const clause = compileTermsGroup(
      GROUP,
      state({ types: { mode: 'subset', values: ['File'] }, facets: { mode: 'all' } }),
    );

    expect(clause).toEqual({ terms: { 'ecm:primaryType': ['File'] } });
  });
});

describe('describeTermsGroup', () => {
  const labels = new Map([['types', new Map([['File', 'Fichier']])]]);

  it('states that everything is included when nothing is constrained', () => {
    expect(describeTermsGroup(GROUP, ALL)).toBe('Including: all documents.');
  });

  it('names a single constrained member', () => {
    expect(
      describeTermsGroup(GROUP, {
        types: { mode: 'subset', values: ['File'] },
        facets: { mode: 'all' },
      }),
    ).toBe('Including: document types File.');
  });

  it('spells out the union of both members', () => {
    expect(
      describeTermsGroup(GROUP, {
        types: { mode: 'subset', values: ['Contract', 'Invoice'] },
        facets: { mode: 'subset', values: ['Picture'] },
      }),
    ).toBe('Including: document types Contract or Invoice or facets Picture.');
  });

  it('uses resolved labels when they are available', () => {
    expect(
      describeTermsGroup(
        GROUP,
        { types: { mode: 'subset', values: ['File'] }, facets: { mode: 'all' } },
        labels,
      ),
    ).toContain('Fichier');
  });

  it('abbreviates a long list rather than printing forty values', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(
      describeTermsGroup(GROUP, {
        types: { mode: 'subset', values: many },
        facets: { mode: 'all' },
      }),
    ).toBe('Including: document types a, b, c, d and 2 more.');
  });
});
