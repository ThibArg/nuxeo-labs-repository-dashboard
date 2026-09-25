import { TestBed } from '@angular/core/testing';
import { formatDay } from '../config/dashboard-config.model';
import { NuxeoHttpService } from './nuxeo-http.service';
import { PreflightCheck, PreflightService } from './preflight.service';
import { FetchStub, healthyServerRoutes, installFetchStub } from '../../testing/fetch-stub';

function find(checks: PreflightCheck[], id: string): PreflightCheck {
  const check = checks.find((candidate) => candidate.id === id);
  if (!check) {
    throw new Error(`No check with id "${id}". Got: ${checks.map((c) => c.id).join(', ')}`);
  }
  return check;
}

describe('PreflightService', () => {
  let stub: FetchStub;

  afterEach(() => stub?.restore());

  it('reports a fully provisioned server as ready', async () => {
    stub = installFetchStub(healthyServerRoutes());

    const service = TestBed.inject(PreflightService);
    const result = await service.run();

    expect(result.checks.every((check) => check.status === 'ok')).toBe(true);
    expect(service.isReady()).toBe(true);
    expect(result.features).toEqual({
      repository: true,
      audit: true,
      workflow: true,
      retention: true,
    });
  });

  it('blocks when the session is not an administrator', async () => {
    stub = installFetchStub(
      healthyServerRoutes([
        {
          match: '/api/v1/me',
          json: {
            'entity-type': 'user',
            id: 'jdoe',
            isAdministrator: false,
            isAnonymous: false,
            properties: { username: 'jdoe' },
          },
        },
      ]),
    );

    const service = TestBed.inject(PreflightService);
    const result = await service.run();

    expect(find(result.checks, 'admin').status).toBe('failed');
    expect(service.isReady()).toBe(false);
  });

  it('blocks and explains how to fix a disabled passthrough', async () => {
    stub = installFetchStub(
      healthyServerRoutes([
        {
          match: '/api/v1/capabilities',
          json: {
            'entity-type': 'capabilities',
            passthrough: { elasticsearch: false, 'elasticsearch-audit': false },
          },
        },
      ]),
    );

    const service = TestBed.inject(PreflightService);
    const result = await service.run();

    const check = find(result.checks, 'capabilities');
    expect(check.status).toBe('failed');
    expect(check.remedy).toContain('nuxeo.passthrough.elasticsearch.enabled');
    expect(service.isReady()).toBe(false);
  });

  it('degrades, without blocking, when the retention addon is missing', async () => {
    stub = installFetchStub(
      healthyServerRoutes([{ match: '/api/v1/config/types/RetentionRule', status: 404, json: {} }]),
    );

    const service = TestBed.inject(PreflightService);
    const result = await service.run();

    expect(find(result.checks, 'retention').status).toBe('warning');
    expect(result.features.retention).toBe(false);
    // Optional checks must never prevent the dashboard from rendering.
    expect(service.isReady()).toBe(true);
  });

  it('reads where the audit starts, from the earliest entry it holds', async () => {
    const earliest = new Date('2026-03-12T09:14:00').getTime();
    stub = installFetchStub(
      healthyServerRoutes([
        {
          match: '/site/es/audit/_search',
          json: {
            took: 4,
            timed_out: false,
            hits: { total: { value: 1000, relation: 'gte' }, hits: [] },
            aggregations: { horizon: { value: earliest, value_as_string: '2026-03-12T09:14:00Z' } },
          },
        },
      ]),
    );

    const result = await TestBed.inject(PreflightService).run();

    expect(result.auditHorizon).toBe(earliest);
    expect(find(result.checks, 'index-audit').detail).toContain(formatDay('2026-03-12'));
  });

  /*
   * OpenSearch takes a segment's minimum from its point index, without visiting a single entry,
   * only when the query is a `match_all` and the `min` has no parent. A filter wrapper, or any
   * query at all, and the probe walks the whole audit at every start.
   */
  it('asks for that start with no query and no wrapper, through the compiler', async () => {
    stub = installFetchStub(healthyServerRoutes());

    await TestBed.inject(PreflightService).run();

    const index = stub.calls.findIndex((call) => call.url.includes('/site/es/audit/_search'));
    const body = JSON.parse(stub.calls[index].init?.body as string);
    expect(body).toEqual({ size: 0, aggs: { horizon: { min: { field: 'eventDate' } } } });
  });

  it('knows no start for an audit holding nothing, and still reaches it', async () => {
    stub = installFetchStub(
      healthyServerRoutes([
        {
          match: '/site/es/audit/_search',
          json: {
            took: 1,
            timed_out: false,
            hits: { total: { value: 0, relation: 'eq' }, hits: [] },
            aggregations: { horizon: { value: null } },
          },
        },
      ]),
    );

    const result = await TestBed.inject(PreflightService).run();

    expect(result.auditHorizon).toBeNull();
    expect(result.features.audit).toBe(true);
    expect(find(result.checks, 'index-audit').detail).toContain('holds no event yet');
  });

  describe('stopping a search that runs too long', () => {
    /** What the sandbox answered, OpenSearch 1.3.20 behind it, for a parameter it did not know. */
    const REFUSED = {
      'entity-type': 'exception',
      status: 500,
      message:
        'org.nuxeo.runtime.RuntimeServiceException: org.opensearch.client.ResponseException: ' +
        'method [GET], host [http://opensearch:9200], URI [/nuxeo/_search?' +
        'cancel_after_time_interval=90s], status line [HTTP/1.1 400 Bad Request]\n' +
        '{"error":{"root_cause":[{"type":"illegal_argument_exception","reason":"request ' +
        '[/nuxeo/_search] contains unrecognized parameter: [cancel_after_time_interval]"}]}}',
    };

    function searches(): string[] {
      return stub.calls.map((call) => call.url).filter((url) => url.includes('/site/es/'));
    }

    it('asks OpenSearch to stop every search after 90 s', async () => {
      stub = installFetchStub(healthyServerRoutes());

      const result = await TestBed.inject(PreflightService).run();

      expect(searches().length).toBeGreaterThan(0);
      expect(searches().every((url) => url.endsWith('?cancel_after_time_interval=90s'))).toBe(true);
      expect(find(result.checks, 'index-nuxeo').detail).toContain('stops any search after 90s');
      expect(result.checks.some((check) => check.id === 'search-cancellation')).toBe(false);
    });

    /*
     * A cluster older than OpenSearch 1.1 refuses the parameter on every search. Sent regardless,
     * it would take every screen down on the smallest repository.
     */
    it('drops it for the session on a cluster that does not know it, and says so', async () => {
      stub = installFetchStub(
        healthyServerRoutes([{ match: 'cancel_after_time_interval', status: 500, json: REFUSED }]),
      );
      const preflight = TestBed.inject(PreflightService);

      const result = await preflight.run();

      expect(preflight.isReady()).toBe(true);
      expect(result.features).toEqual({
        repository: true,
        audit: true,
        workflow: true,
        retention: true,
      });
      expect(find(result.checks, 'search-cancellation').status).toBe('warning');
      expect(
        searches()
          .slice(1)
          .every((url) => !url.includes('cancel_after')),
      ).toBe(true);
      expect(TestBed.inject(NuxeoHttpService).cancelsSearches).toBe(false);

      // Diagnostics runs the checks again; the cluster has not changed its mind.
      expect(find((await preflight.run()).checks, 'search-cancellation').status).toBe('warning');
    });

    it('does not take another failure of the repository index for an old cluster', async () => {
      stub = installFetchStub(
        healthyServerRoutes([
          {
            match: '/site/es/nuxeo/_search',
            status: 500,
            json: { message: 'index_not_found_exception: no such index [nuxeo]' },
          },
        ]),
      );

      const result = await TestBed.inject(PreflightService).run();

      expect(find(result.checks, 'index-nuxeo').status).toBe('failed');
      expect(searches().filter((url) => url.includes('/site/es/nuxeo/'))).toHaveLength(1);
      expect(TestBed.inject(NuxeoHttpService).cancelsSearches).toBe(true);
    });
  });

  it('treats an HTML login page as an expired session', async () => {
    stub = installFetchStub([
      { match: '/api/v1/me', text: '<html><body>login</body></html>' },
      ...healthyServerRoutes(),
    ]);

    const service = TestBed.inject(PreflightService);
    const result = await service.run();

    const check = find(result.checks, 'auth');
    expect(check.status).toBe('failed');
    expect(check.detail).toContain('sign in');
  });
});
