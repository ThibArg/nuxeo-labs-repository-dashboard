import { TestBed } from '@angular/core/testing';
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
