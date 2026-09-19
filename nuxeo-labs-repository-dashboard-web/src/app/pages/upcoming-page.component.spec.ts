import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PreflightService } from '../core/preflight.service';
import { UpcomingPageComponent } from './upcoming-page.component';
import { FetchStub, healthyServerRoutes, installFetchStub } from '../../testing/fetch-stub';

const DOC_URL = 'https://doc.nuxeo.com/nxdoc/nuxeo-retention-management/';

describe('UpcomingPageComponent', () => {
  let stub: FetchStub;

  afterEach(() => stub?.restore());

  /** Renders the Governance placeholder with the route data it is given in production. */
  async function renderGovernance(): Promise<ComponentFixture<UpcomingPageComponent>> {
    await TestBed.inject(PreflightService).run();

    const fixture = TestBed.createComponent(UpcomingPageComponent);
    fixture.componentRef.setInput('heading', 'Governance Dashboard');
    fixture.componentRef.setInput('phase', 'phase 5');
    fixture.componentRef.setInput('description', 'Records, legal holds and retention policies.');
    fixture.componentRef.setInput('requires', 'retention');
    fixture.componentRef.setInput('requirementLabel', 'nuxeo-retention');
    fixture.componentRef.setInput('requirementDocUrl', DOC_URL);
    fixture.detectChanges();

    return fixture;
  }

  it('names the missing package and links to its documentation', async () => {
    stub = installFetchStub(
      healthyServerRoutes([{ match: '/api/v1/config/types/RetentionRule', status: 404, json: {} }]),
    );

    const element = (await renderGovernance()).nativeElement as HTMLElement;

    expect(element.textContent).toContain('nuxeo-retention');
    expect(element.querySelector('a')?.getAttribute('href')).toBe(DOC_URL);
  });

  it('says nothing about a package that is installed', async () => {
    stub = installFetchStub(healthyServerRoutes());

    const element = (await renderGovernance()).nativeElement as HTMLElement;

    expect(element.textContent).toContain('Planned for phase 5');
    expect(element.textContent).not.toContain('nuxeo-retention');
    expect(element.querySelector('a')).toBeNull();
  });

  it('claims nothing when the page declares no requirement', async () => {
    stub = installFetchStub(
      healthyServerRoutes([{ match: '/api/v1/config/types/RetentionRule', status: 404, json: {} }]),
    );
    await TestBed.inject(PreflightService).run();

    const fixture = TestBed.createComponent(UpcomingPageComponent);
    fixture.componentRef.setInput('heading', 'Process Dashboard');
    fixture.componentRef.setInput('phase', 'phase 4');
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('a')).toBeNull();
  });
});
