import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PreflightService } from '../core/preflight.service';
import { RequirementNoticeComponent } from './requirement-notice.component';
import { FetchStub, healthyServerRoutes, installFetchStub } from '../../testing/fetch-stub';

/**
 * The witness is `audit`, deliberately, and it used to be `retention`.
 *
 * `setInput` is untyped — `setInput(name: string, value: unknown)` — so nothing here is checked
 * against `PreflightFeature`. Witnessing on the prerequisite of a single optional screen therefore
 * made this file fail the day that screen was removed, and fail *misleadingly*: an empty element
 * and an assertion complaining about a missing link, which reads as a broken component. Worse, the
 * natural repair is to delete the red test, and that would leave the whole `missing()` branch
 * uncovered for Workflows and Users, which still depend on it.
 *
 * `audit` is required by two shipped screens, so it is the prerequisite least likely to go away.
 */
const DOC_URL = 'https://doc.nuxeo.com/nxdoc/opensearch-audit/';

/** A server whose audit passthrough is off, which is what the notice exists to report. */
function serverWithoutAudit(): FetchStub {
  return installFetchStub(
    healthyServerRoutes([
      {
        match: '/api/v1/capabilities',
        json: {
          'entity-type': 'capabilities',
          server: { distributionName: 'Nuxeo', distributionVersion: '2025.22' },
          passthrough: { elasticsearch: true, 'elasticsearch-audit': false },
        },
      },
    ]),
  );
}

describe('RequirementNoticeComponent', () => {
  let stub: FetchStub;

  afterEach(() => stub?.restore());

  function render(inputs: Record<string, string>): ComponentFixture<RequirementNoticeComponent> {
    const fixture = TestBed.createComponent(RequirementNoticeComponent);
    Object.entries(inputs).forEach(([name, value]) => fixture.componentRef.setInput(name, value));
    fixture.detectChanges();
    return fixture;
  }

  it('names the missing prerequisite and links to its documentation', async () => {
    stub = serverWithoutAudit();
    await TestBed.inject(PreflightService).run();

    const element = render({
      requires: 'audit',
      label: 'the OpenSearch audit passthrough',
      docUrl: DOC_URL,
    }).nativeElement as HTMLElement;

    expect(element.textContent).toContain('the OpenSearch audit passthrough');
    expect(element.querySelector('a')?.getAttribute('href')).toBe(DOC_URL);
  });

  it('says nothing about a prerequisite the server provides', async () => {
    stub = installFetchStub(healthyServerRoutes());
    await TestBed.inject(PreflightService).run();

    const element = render({ requires: 'audit', label: 'the OpenSearch audit passthrough' })
      .nativeElement as HTMLElement;

    expect(element.textContent).not.toContain('audit passthrough');
  });

  it('claims nothing when the page declares no requirement', async () => {
    stub = serverWithoutAudit();
    await TestBed.inject(PreflightService).run();

    const element = render({ requires: '', label: '' }).nativeElement as HTMLElement;

    expect(element.textContent?.trim()).toBe('');
  });

  /*
   * A page renders before the preflight has answered. Reporting a missing prerequisite then would
   * accuse every server of lacking everything for the length of one round trip.
   */
  it('stays silent until the preflight has run', () => {
    stub = serverWithoutAudit();

    const element = render({ requires: 'audit', label: 'the OpenSearch audit passthrough' })
      .nativeElement as HTMLElement;

    expect(element.textContent?.trim()).toBe('');
  });

  /**
   * A feature the preflight does not report is a mistake in whoever asked for it, not a server
   * without it. Read the other way — and it was, until the absence was checked explicitly —
   * removing a check from `PreflightResult` puts this warning on every healthy server, which is
   * exactly backwards. `setInput` cannot refuse the value, so this is what does.
   */
  it('says nothing about a feature the preflight does not report', async () => {
    stub = installFetchStub(healthyServerRoutes());
    await TestBed.inject(PreflightService).run();

    const element = render({ requires: 'no-such-feature', label: 'a package nobody ships' })
      .nativeElement as HTMLElement;

    expect(element.textContent?.trim()).toBe('');
  });
});
