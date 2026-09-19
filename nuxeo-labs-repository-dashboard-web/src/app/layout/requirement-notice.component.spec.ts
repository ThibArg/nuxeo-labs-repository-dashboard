import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PreflightService } from '../core/preflight.service';
import { RequirementNoticeComponent } from './requirement-notice.component';
import { FetchStub, healthyServerRoutes, installFetchStub } from '../../testing/fetch-stub';

const DOC_URL = 'https://doc.nuxeo.com/nxdoc/nuxeo-retention-management/';

/** A server where the retention addon is absent, which is what the notice exists to report. */
function serverWithoutRetention(): FetchStub {
  return installFetchStub(
    healthyServerRoutes([{ match: '/api/v1/config/types/RetentionRule', status: 404, json: {} }]),
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
    stub = serverWithoutRetention();
    await TestBed.inject(PreflightService).run();

    const element = render({
      requires: 'retention',
      label: 'the nuxeo-retention package',
      docUrl: DOC_URL,
    }).nativeElement as HTMLElement;

    expect(element.textContent).toContain('the nuxeo-retention package');
    expect(element.querySelector('a')?.getAttribute('href')).toBe(DOC_URL);
  });

  it('says nothing about a prerequisite the server provides', async () => {
    stub = installFetchStub(healthyServerRoutes());
    await TestBed.inject(PreflightService).run();

    const element = render({ requires: 'retention', label: 'the nuxeo-retention package' })
      .nativeElement as HTMLElement;

    expect(element.textContent).not.toContain('nuxeo-retention');
  });

  it('claims nothing when the page declares no requirement', async () => {
    stub = serverWithoutRetention();
    await TestBed.inject(PreflightService).run();

    const element = render({ requires: '', label: '' }).nativeElement as HTMLElement;

    expect(element.textContent?.trim()).toBe('');
  });

  /*
   * A page renders before the preflight has answered. Reporting a missing prerequisite then would
   * accuse every server of lacking everything for the length of one round trip.
   */
  it('stays silent until the preflight has run', () => {
    stub = serverWithoutRetention();

    const element = render({ requires: 'retention', label: 'the nuxeo-retention package' })
      .nativeElement as HTMLElement;

    expect(element.textContent?.trim()).toBe('');
  });
});
