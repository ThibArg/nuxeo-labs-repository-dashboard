import { TestBed } from '@angular/core/testing';
import { LabelService } from './label.service';
import { FetchStub, installFetchStub } from '../../testing/fetch-stub';

const MESSAGES = {
  'label.document.type.file': 'File',
  'label.document.type.picture': 'Picture',
  'label.ui.state.project': 'Project',
  'wf.parallelDocumentReview.chooseParticipants.title': 'Choose Participants',
  'wf.parallelDocumentReview.ParallelDocumentReview': 'Parallel Document Review',
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

  /*
   * `extended.taskName` and `extended.action` hold an i18n key rather than a label, so the bundle
   * translates them as they stand. `extended.modelName` holds a name that composes into one.
   */
  it('translates a value that is already an i18n key', async () => {
    stub = installFetchStub([{ match: '/ui/i18n/messages.json', json: MESSAGES }]);

    const labels = await TestBed.inject(LabelService).resolve('message', [
      'wf.parallelDocumentReview.chooseParticipants.title',
      'wf.someStudioModel.unknownTask',
    ]);

    expect(labels.get('wf.parallelDocumentReview.chooseParticipants.title')).toBe(
      'Choose Participants',
    );
    expect(labels.get('wf.someStudioModel.unknownTask')).toBe('wf.someStudioModel.unknownTask');
  });

  it('composes a workflow model name into the key Web UI uses for it', async () => {
    stub = installFetchStub([{ match: '/ui/i18n/messages.json', json: MESSAGES }]);

    const labels = await TestBed.inject(LabelService).resolve('workflowModel', [
      'ParallelDocumentReview',
    ]);

    expect(labels.get('ParallelDocumentReview')).toBe('Parallel Document Review');
  });

  /*
   * Studio writes the key into the model's `dc:title`, and the bundle holding it belongs to the
   * Studio project rather than to Web UI. A model whose project is not deployed therefore resolves
   * to nothing, and its identifier would sit next to properly translated names.
   */
  it('reads an untranslated model as words rather than as an identifier', async () => {
    stub = installFetchStub([{ match: '/ui/i18n/messages.json', json: MESSAGES }]);

    const labels = await TestBed.inject(LabelService).resolve('workflowModel', [
      'ClaimReview',
      'RequestDownload',
      'AdHoc',
      'HRRequest',
      'Invoice',
    ]);

    expect(labels.get('ClaimReview')).toBe('Claim Review');
    expect(labels.get('RequestDownload')).toBe('Request Download');
    expect(labels.get('AdHoc')).toBe('Ad Hoc');
    // An initialism stays whole: H R Request would be worse than the identifier itself.
    expect(labels.get('HRRequest')).toBe('HR Request');
    expect(labels.get('Invoice')).toBe('Invoice');
  });

  it('prefers a real translation over splitting the identifier', async () => {
    stub = installFetchStub([
      {
        match: '/ui/i18n/messages.json',
        json: { 'wf.claimReview.ClaimReview': 'Insurance Claim' },
      },
    ]);

    const labels = await TestBed.inject(LabelService).resolve('workflowModel', ['ClaimReview']);

    expect(labels.get('ClaimReview')).toBe('Insurance Claim');
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

  /*
   * `nt:actors` holds prefixed identifiers — the parameter is literally named `prefixedActorIds`
   * in `CreateTaskUnrestricted`. Looking `user:jdoe` up as a user id answers a 404, so without
   * this the chart would show the prefix on every real server, not only on a demo one.
   */
  it('strips the prefix Nuxeo puts on a task assignee', async () => {
    stub = installFetchStub([
      {
        match: '/api/v1/user/jdoe',
        json: { id: 'jdoe', properties: { firstName: 'Jane', lastName: 'Doe' } },
      },
    ]);

    const labels = await TestBed.inject(LabelService).resolve('user', ['user:jdoe']);

    expect(labels.get('user:jdoe')).toBe('Jane Doe');
    expect(stub.calls[0].url).toContain('/api/v1/user/jdoe');
    expect(stub.calls[0].url).not.toContain('user%3A');
  });

  it('resolves a group assignee against the group endpoint', async () => {
    stub = installFetchStub([
      { match: '/api/v1/group/sales', json: { id: 'sales', grouplabel: 'Sales Team' } },
    ]);

    const labels = await TestBed.inject(LabelService).resolve('user', ['group:sales']);

    expect(labels.get('group:sales')).toBe('Sales Team');
    // Looking a group up as a user would spend a request to earn a 404.
    expect(stub.calls.filter((call) => call.url.includes('/api/v1/user/'))).toEqual([]);
  });

  it('shows the bare name, never the prefix, when a principal cannot be resolved', async () => {
    stub = installFetchStub([{ match: '/api/v1/user/ghost', status: 404, json: {} }]);

    const labels = await TestBed.inject(LabelService).resolve('user', ['user:ghost']);

    expect(labels.get('user:ghost')).toBe('ghost');
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

  it('looks a user up once even when several widgets ask at the same time', async () => {
    stub = installFetchStub([
      {
        match: '/api/v1/user/jdoe',
        json: { id: 'jdoe', properties: { firstName: 'Jane', lastName: 'Doe' } },
      },
    ]);

    const service = TestBed.inject(LabelService);
    /*
     * A dashboard resolves the buckets of every widget in parallel, so three charts naming the
     * same author start before any of them has an answer. Caching the answer would not help here;
     * only caching the request in flight does.
     */
    const [first, second, third] = await Promise.all([
      service.resolve('user', ['jdoe']),
      service.resolve('user', ['jdoe']),
      service.resolve('user', ['jdoe']),
    ]);

    expect(stub.calls).toHaveLength(1);
    expect([first, second, third].map((labels) => labels.get('jdoe'))).toEqual([
      'Jane Doe',
      'Jane Doe',
      'Jane Doe',
    ]);
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

  it('names the document a uuid points at, and deduplicates lookups', async () => {
    stub = installFetchStub([
      {
        match: '/api/v1/id/c667a0e3',
        json: { uid: 'c667a0e3', title: 'Contracts — 2 years' },
      },
    ]);

    const service = TestBed.inject(LabelService);
    const labels = await service.resolve('document', ['c667a0e3', 'c667a0e3']);

    expect(labels.get('c667a0e3')).toBe('Contracts — 2 years');
    expect(stub.calls).toHaveLength(1);
  });

  /*
   * A rule deleted after the records it governs leaves its uuid behind in `record:ruleIds`, and
   * the server answers 404 on it. The bucket still holds documents, so it has to render as
   * something; the uuid is a poor label but the only honest one.
   */
  it('shows the bare uuid when the document it names no longer exists', async () => {
    stub = installFetchStub([{ match: '/api/v1/id/', status: 404, json: {} }]);

    const labels = await TestBed.inject(LabelService).resolve('document', ['deleted-rule']);

    expect(labels.get('deleted-rule')).toBe('deleted-rule');
  });

  it('shows the bare uuid when the document carries no title', async () => {
    stub = installFetchStub([{ match: '/api/v1/id/untitled', json: { uid: 'untitled' } }]);

    const labels = await TestBed.inject(LabelService).resolve('document', ['untitled']);

    expect(labels.get('untitled')).toBe('untitled');
  });

  it('looks a document up once even when several widgets ask at the same time', async () => {
    stub = installFetchStub([{ match: '/api/v1/id/rule', json: { title: 'Invoices' } }]);

    const service = TestBed.inject(LabelService);
    const [first, second] = await Promise.all([
      service.resolve('document', ['rule']),
      service.resolve('document', ['rule']),
    ]);

    expect(stub.calls).toHaveLength(1);
    expect([first.get('rule'), second.get('rule')]).toEqual(['Invoices', 'Invoices']);
  });

  /*
   * The two strategies share one caching helper, so a uuid that happens to read like a user name
   * must not pick up the other's answer.
   */
  it('keeps document and principal lookups in separate caches', async () => {
    stub = installFetchStub([
      { match: '/api/v1/id/jdoe', json: { title: 'A document called jdoe' } },
      {
        match: '/api/v1/user/jdoe',
        json: { id: 'jdoe', properties: { firstName: 'Jane', lastName: 'Doe' } },
      },
    ]);

    const service = TestBed.inject(LabelService);

    expect((await service.resolve('document', ['jdoe'])).get('jdoe')).toBe(
      'A document called jdoe',
    );
    expect((await service.resolve('user', ['jdoe'])).get('jdoe')).toBe('Jane Doe');
  });
});
