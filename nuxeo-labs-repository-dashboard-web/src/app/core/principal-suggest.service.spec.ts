import { TestBed } from '@angular/core/testing';
import { PrincipalSuggestService, SUGGEST_MIN_CHARS } from './principal-suggest.service';
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
    expect(stub.bodies[0]).toEqual({
      params: { searchTerm: 'kat', searchType: 'USER_GROUP_TYPE' },
      context: {},
    });
    expect(found).toEqual([
      { id: 'user:kate', label: 'Kate Byrne', group: false },
      { id: 'group:sales', label: 'Sales Team', group: true },
    ]);
  });

  /*
   * The prefixed identifier is what `nt:actors` stores, so a value picked here drops straight into
   * the selection with nothing to convert.
   */
  it('keeps the prefixed identifier, which is the form the index holds', async () => {
    stub = installFetchStub([{ match: '/automation/UserGroup.Suggestion', json: ENTRIES }]);

    const found = await service().suggest('kat');

    expect(found[0].id).toBe('user:kate');
  });

  it('spends no request on a term too short to narrow anything', async () => {
    stub = installFetchStub([{ match: '/automation/UserGroup.Suggestion', json: ENTRIES }]);

    expect(await service().suggest('k'.repeat(SUGGEST_MIN_CHARS - 1))).toEqual([]);
    expect(stub.calls).toHaveLength(0);
  });

  it('trims before measuring, so spaces do not buy a request', async () => {
    stub = installFetchStub([{ match: '/automation/UserGroup.Suggestion', json: ENTRIES }]);

    expect(await service().suggest('  k  ')).toEqual([]);
    expect(stub.calls).toHaveLength(0);
  });

  it('answers an empty list rather than failing when the operation is unavailable', async () => {
    stub = installFetchStub([{ match: '/automation/UserGroup.Suggestion', status: 404, json: {} }]);

    expect(await service().suggest('kat')).toEqual([]);
  });

  it('falls back to the identifier when the server composed no label', async () => {
    stub = installFetchStub([
      { match: '/automation/UserGroup.Suggestion', json: [{ id: 'jdoe', type: 'USER_TYPE' }] },
    ]);

    expect(await service().suggest('jdo')).toEqual([
      { id: 'user:jdoe', label: 'jdoe', group: false },
    ]);
  });
});
