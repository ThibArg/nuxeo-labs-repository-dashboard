import { TestBed } from '@angular/core/testing';
import { LabelService } from './label.service';
import { FetchStub, installFetchStub } from '../../testing/fetch-stub';

const MESSAGES = {
  'label.document.type.file': 'File',
  'label.document.type.picture': 'Picture',
  'label.ui.state.project': 'Project',
};

describe('LabelService', () => {
  let stub: FetchStub;

  afterEach(() => stub?.restore());

  it('translates document types using Web UI conventions', async () => {
    stub = installFetchStub([{ match: '/ui/i18n/messages.json', json: MESSAGES }]);

    const labels = await TestBed.inject(LabelService).resolve('doctype', ['File', 'Picture']);

    expect(labels.get('File')).toBe('File');
    expect(labels.get('Picture')).toBe('Picture');
    // The lookup lower cases the type, as nuxeo-format-behavior.js does.
    expect(stub.calls[0].url).toContain('/ui/i18n/messages.json');
  });

  it('falls back to the raw key when a translation is missing', async () => {
    stub = installFetchStub([{ match: '/ui/i18n/messages.json', json: MESSAGES }]);

    const labels = await TestBed.inject(LabelService).resolve('doctype', ['CustomContract']);

    expect(labels.get('CustomContract')).toBe('CustomContract');
  });

  it('degrades gracefully when Web UI is not installed', async () => {
    stub = installFetchStub([{ match: '/ui/i18n/messages.json', status: 404, json: {} }]);

    const labels = await TestBed.inject(LabelService).resolve('lifecycle', ['project']);

    expect(labels.get('project')).toBe('project');
  });

  it('loads the translation bundle once for several resolutions', async () => {
    stub = installFetchStub([{ match: '/ui/i18n/messages.json', json: MESSAGES }]);
    const service = TestBed.inject(LabelService);

    await service.resolve('doctype', ['File']);
    await service.resolve('lifecycle', ['project']);
    await service.resolve('doctype', ['Picture']);

    expect(stub.calls.filter((call) => call.url.includes('messages.json'))).toHaveLength(1);
  });

  it('resolves users to their full name and deduplicates lookups', async () => {
    stub = installFetchStub([
      {
        match: '/api/v1/user/jdoe',
        json: { id: 'jdoe', properties: { firstName: 'Jane', lastName: 'Doe' } },
      },
    ]);

    const service = TestBed.inject(LabelService);
    const labels = await service.resolve('user', ['jdoe', 'jdoe', 'jdoe']);

    expect(labels.get('jdoe')).toBe('Jane Doe');
    expect(stub.calls).toHaveLength(1);
  });

  it('caches user lookups across calls', async () => {
    stub = installFetchStub([
      {
        match: '/api/v1/user/jdoe',
        json: { id: 'jdoe', properties: { firstName: 'Jane', lastName: 'Doe' } },
      },
    ]);

    const service = TestBed.inject(LabelService);
    await service.resolve('user', ['jdoe']);
    await service.resolve('user', ['jdoe']);

    expect(stub.calls).toHaveLength(1);
  });

  it('shows the raw principal when the user cannot be read', async () => {
    stub = installFetchStub([{ match: '/api/v1/user/system', status: 404, json: {} }]);

    const labels = await TestBed.inject(LabelService).resolve('user', ['system']);

    expect(labels.get('system')).toBe('system');
  });

  it('renders booleans without any server call', async () => {
    stub = installFetchStub([]);

    const labels = await TestBed.inject(LabelService).resolve('boolean', ['true', 'false']);

    expect(labels.get('true')).toBe('Yes');
    expect(labels.get('false')).toBe('No');
    expect(stub.calls).toHaveLength(0);
  });
});
