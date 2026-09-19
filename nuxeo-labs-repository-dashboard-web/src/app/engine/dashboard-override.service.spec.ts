import { TestBed } from '@angular/core/testing';
import contentConfig from '../config/dashboards/content.json';
import { DashboardConfig } from '../config/dashboard-config.model';
import { DashboardOverrideService, validateConfig } from './dashboard-override.service';

const CONTENT = contentConfig as DashboardConfig;

/** The shipped configuration, which is what the editor opens on and must accept back unchanged. */
function shipped(): string {
  return JSON.stringify(CONTENT, null, 2);
}

function edited(change: (config: DashboardConfig) => void): string {
  const copy = JSON.parse(shipped()) as DashboardConfig;
  change(copy);
  return JSON.stringify(copy, null, 2);
}

describe('validateConfig', () => {
  it('accepts a configuration that ships', () => {
    expect(validateConfig(shipped(), 'content').problems).toEqual([]);
  });

  it('names the syntax error rather than failing silently', () => {
    const { config, problems } = validateConfig('{ "id": ', 'content');

    expect(config).toBeNull();
    expect(problems[0]).toContain('Not valid JSON');
  });

  it('refuses anything that is not an object', () => {
    expect(validateConfig('[]', 'content').problems).toEqual([
      'A dashboard configuration must be a JSON object.',
    ]);
  });

  /*
   * The id is what the route resolves, so an edit renaming it would be saved under `content` and
   * then never loaded again — an edit that vanishes without an error is the worst outcome here.
   */
  it('keeps the id the page loads this configuration by', () => {
    const problems = validateConfig(
      edited((config) => (config.id = 'something-else')),
      'content',
    ).problems;

    expect(problems[0]).toContain('"id" must stay "content"');
  });

  it('asks for the pieces without which nothing can be rendered', () => {
    expect(validateConfig('{"id":"content"}', 'content').problems).toEqual([
      '"index" is required: nuxeo, audit or audit_wf.',
      '"layout" must list at least one row.',
      '"widgets" is required.',
    ]);
  });

  it('reports a layout cell that names no widget', () => {
    const problems = validateConfig(
      edited((config) => config.layout[0].cells.push('ghost')),
      'content',
    ).problems;

    expect(problems).toContain('Layout names "ghost", which no widget declares.');
  });

  it('reports a widget no row would ever show', () => {
    const problems = validateConfig(
      edited((config) => (config.widgets['orphan'] = { type: 'kpi', label: 'Orphan' })),
      'content',
    ).problems;

    expect(problems).toContain('Widget "orphan" is declared but no layout row shows it.');
  });

  /*
   * Validation runs the very planner that will render the page, rather than a second description
   * of the same rules. A `.keyword` suffix matches nothing in Nuxeo, and the compiler already
   * refuses it — reimplementing that check here is how the two would drift.
   */
  it('refuses what the compiler would refuse, without restating its rules', () => {
    const problems = validateConfig(
      edited(
        (config) =>
          ((config.widgets['byType'] as { agg: { terms: { field: string } } }).agg.terms.field =
            'ecm:primaryType.keyword'),
      ),
      'content',
    ).problems;

    expect(problems.some((problem) => problem.includes('.keyword'))).toBe(true);
  });

  it('hands back the parsed configuration only when it is usable', () => {
    expect(validateConfig(shipped(), 'content').config?.id).toBe('content');
    expect(validateConfig('{"id":"content"}', 'content').config).toBeNull();
  });
});

describe('DashboardOverrideService', () => {
  let service: DashboardOverrideService;

  beforeEach(() => {
    localStorage.clear();
    service = TestBed.inject(DashboardOverrideService);
  });
  afterEach(() => localStorage.clear());

  it('has nothing to say until something is written', () => {
    expect(service.read('content')).toBeNull();
  });

  /** The text, not the parsed object: indentation and key order are the administrator's. */
  it('round trips the text exactly as it was written', () => {
    const json = '{\n  "id":   "content"\n}';
    service.write('content', json);

    expect(service.read('content')).toBe(json);
  });

  it('keeps dashboards independent', () => {
    service.write('content', '{"id":"content"}');

    expect(service.read('governance')).toBeNull();
  });

  it('forgets an override on request', () => {
    service.write('content', '{"id":"content"}');
    service.clear('content');

    expect(service.read('content')).toBeNull();
  });

  it('discards an entry written by another version', () => {
    localStorage.setItem('nxd.config.content', JSON.stringify({ v: 99, json: '{}' }));

    expect(service.read('content')).toBeNull();
  });

  it('survives a corrupted entry', () => {
    localStorage.setItem('nxd.config.content', 'not json at all');

    expect(service.read('content')).toBeNull();
  });
});
