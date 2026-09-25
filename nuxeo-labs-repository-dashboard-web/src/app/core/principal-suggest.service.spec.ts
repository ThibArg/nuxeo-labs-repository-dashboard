import { TestBed } from '@angular/core/testing';
import {
  PrincipalSuggestService,
  SUGGEST_MAX_RESULTS,
  SUGGEST_MIN_CHARS,
} from './principal-suggest.service';
import { FetchStub, installFetchStub } from '../../testing/fetch-stub';

const ENTRIES = [
  {
    id: 'kate',
    prefixed_id: 'user:kate',
    displayLabel: 'Kate Byrne',
    type: 'USER_TYPE',
  },
  {
    id: 'sales',
    prefixed_id: 'group:sales',
    displayLabel: 'Sales Team',
    type: 'GROUP_TYPE',
  },
];

describe('PrincipalSuggestService', () => {
  let stub: FetchStub;

  afterEach(() => stub?.restore());

  function service() {
    return TestBed.inject(PrincipalSuggestService);
  }

  it('asks the operation Web UI uses, for users and groups at once', async () => {
    stub = installFetchStub([{ match: '/automation/UserGroup.Suggestion', json: ENTRIES }]);

    const found = await service().suggest('kat');

    expect(stub.calls[0].url).toContain('/api/v1/automation/UserGroup.Suggestion');
    expect(found).toEqual({
      principals: [
        { id: 'user:kate', label: 'Kate Byrne', group: false },
        { id: 'group:sales', label: 'Sales Team', group: true },
      ],
      tooMany: false,
    });
  });

  /*
   * Without a limit the operation reads every user the term matches, and a directory need not
   * apply its own `querySizeLimit`: the SQL one does not.
   */
  it('asks for no more than twenty people and groups', async () => {
    stub = installFetchStub([{ match: '/automation/UserGroup.Suggestion', json: ENTRIES }]);

    await service().suggest('kat');

    expect(stub.bodies[0]).toEqual({
      params: {
        searchTerm: 'kat',
        searchType: 'USER_GROUP_TYPE',
        userSuggestionMaxSearchResults: SUGGEST_MAX_RESULTS,
      },
      context: {},
    });
    expect(SUGGEST_MAX_RESULTS).toBe(20);
  });

  /*
   * Past the limit the operation lists nobody and answers one entry with a label and no
   * identifier. Taken for a person, it would put "user:" in the selection.
   */
  it('says too many matched rather than offering the overflow message as a person', async () => {
    stub = installFetchStub([
      {
        match: '/automation/UserGroup.Suggestion',
        json: [{ displayLabel: 'Please narrow your search.' }],
      },
    ]);

    expect(await service().suggest('adm')).toEqual({ principals: [], tooMany: true });
  });

  /*
   * The prefixed identifier is what `nt:actors` stores, so a value picked here drops straight into
   * the selection with nothing to convert.
   */
  it('keeps the prefixed identifier, which is the form the index holds', async () => {
    stub = installFetchStub([{ match: '/automation/UserGroup.Suggestion', json: ENTRIES }]);

    const found = await service().suggest('kat');

    expect(found.principals[0].id).toBe('user:kate');
  });

  it('spends no request on a term too short to narrow anything', async () => {
    stub = installFetchStub([{ match: '/automation/UserGroup.Suggestion', json: ENTRIES }]);

    expect((await service().suggest('k'.repeat(SUGGEST_MIN_CHARS - 1))).principals).toEqual([]);
    expect(stub.calls).toHaveLength(0);
  });

  it('trims before measuring, so spaces do not buy a request', async () => {
    stub = installFetchStub([{ match: '/automation/UserGroup.Suggestion', json: ENTRIES }]);

    expect((await service().suggest('  k  ')).principals).toEqual([]);
    expect(stub.calls).toHaveLength(0);
  });

  it('answers an empty list rather than failing when the operation is unavailable', async () => {
    stub = installFetchStub([{ match: '/automation/UserGroup.Suggestion', status: 404, json: {} }]);

    expect(await service().suggest('kat')).toEqual({ principals: [], tooMany: false });
  });

  it('falls back to the identifier when the server composed no label', async () => {
    stub = installFetchStub([
      { match: '/automation/UserGroup.Suggestion', json: [{ id: 'jdoe', type: 'USER_TYPE' }] },
    ]);

    expect((await service().suggest('jdo')).principals).toEqual([
      { id: 'user:jdoe', label: 'jdoe', group: false },
    ]);
  });
});
