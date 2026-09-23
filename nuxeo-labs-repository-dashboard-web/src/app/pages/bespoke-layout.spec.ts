import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DashboardRunner } from '../engine/dashboard-runner.service';
import { DashboardSession } from '../engine/dashboard-session.service';
import { ExportRootDirective } from '../layout/export-root.directive';
import { WidgetComponent } from '../widgets/widget.component';
import { ChartWidgetComponent } from '../widgets/chart-widget.component';
import { WidgetOutletComponent } from '../widgets/widget-outlet.component';
import { provideDashboardCharts } from '../widgets/echarts.setup';
import { ChartWidgetStubComponent } from '../../testing/chart-widget.stub';
import {
  FetchStub,
  StubRoute,
  installFetchStub,
  isAggregationsRequest,
} from '../../testing/fetch-stub';
import { settle } from '../../testing/settle';

/**
 * A dashboard laid out by hand rather than by the grid.
 *
 * This is the whole point of the seam, so it is proved by a component that uses it rather than
 * described. Nothing here knows about queries, filters or labels: it declares which session it
 * runs, marks what it exports, and puts widgets where it wants them — including inside a branch
 * that is not rendered at first, which is how tabs are built.
 */
@Component({
  selector: 'nxd-bespoke-page',
  imports: [WidgetComponent, ExportRootDirective],
  providers: [DashboardRunner, DashboardSession],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div nxdExportRoot>
      <section data-testid="first">
        <nxd-widget for="created" />
        <!-- The same widget twice, which only works because the page names them, not the library. -->
        <nxd-widget for="createdAgain" />
      </section>

      @if (second()) {
        <section data-testid="second">
          <nxd-widget for="modified" />
        </section>
      }

      <nxd-widget for="gone" />
    </div>
  `,
})
class BespokePageComponent {
  readonly session = inject(DashboardSession);
  readonly second = signal(false);

  constructor() {
    void this.session.open('bespoke');
  }
}

const COMPOSITION = {
  id: 'bespoke',
  label: 'Bespoke',
  filters: [{ type: 'dateRange', field: 'dc:created' }],
  widgets: [
    { use: 'documents-created', as: 'created' },
    { use: 'documents-created', as: 'createdAgain', with: { interval: 'week' } },
    { use: 'documents-modified', as: 'modified' },
  ],
};

function response(): unknown {
  const buckets = { buckets: [{ key: 1, key_as_string: '2026-09-15', doc_count: 12 }] };
  return {
    took: 9,
    timed_out: false,
    hits: { total: { value: 120, relation: 'eq' }, hits: [] },
    aggregations: {
      created: { doc_count: 120, inner: buckets },
      createdAgain: { doc_count: 120, inner: buckets },
      modified: { doc_count: 120, inner: buckets },
    },
  };
}

function routes(): StubRoute[] {
  return [
    { match: 'assets/dashboards/bespoke.json', json: COMPOSITION },
    { match: '/ui/i18n/messages.json', json: {} },
    { match: '/site/es/', json: response() },
  ];
}

describe('a dashboard laid out by hand', () => {
  let stub: FetchStub;

  beforeEach(() => {
    stub = installFetchStub(routes());
    TestBed.configureTestingModule({ providers: [provideDashboardCharts()] });
    TestBed.overrideComponent(WidgetOutletComponent, {
      remove: { imports: [ChartWidgetComponent] },
      add: { imports: [ChartWidgetStubComponent] },
    });
  });

  afterEach(() => stub.restore());

  async function render() {
    const fixture = TestBed.createComponent(BespokePageComponent);
    await settle(fixture);
    return fixture;
  }

  function searches(): unknown[] {
    return stub.bodies.filter(isAggregationsRequest);
  }

  it('draws a widget wherever the page puts it', async () => {
    const fixture = await render();
    const first = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="first"]');

    expect(first?.querySelectorAll('nxd-widget')).toHaveLength(2);
    expect(first?.textContent).toContain('Documents Created');
  });

  it('lets one library widget appear twice, parameterised differently', async () => {
    const fixture = await render();
    const aggs = (searches()[0] as { aggs: Record<string, any> }).aggs;

    // One follows the period, "All time" here, so OpenSearch sizes it; the other names its width.
    expect(JSON.stringify(aggs['created'])).toContain('"auto_date_histogram"');
    expect(JSON.stringify(aggs['createdAgain'])).toContain('"calendar_interval":"week"');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('created per week');
  });

  /**
   * The guarantee that makes tabs worth building this way. Every declared widget is planned
   * whether or not it is on screen, so the figures of a tab nobody opened describe the same
   * instant as the ones being read — and opening it is free.
   */
  it('asks for a widget the page has not drawn yet', async () => {
    await render();

    expect(searches()).toHaveLength(1);
    expect(Object.keys((searches()[0] as { aggs: object }).aggs).sort()).toEqual([
      'created',
      'createdAgain',
      'modified',
    ]);
  });

  it('costs nothing to reveal it', async () => {
    const fixture = await render();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="second"]'),
    ).toBeNull();

    fixture.componentInstance.second.set(true);
    await settle(fixture);

    const revealed = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="second"]');
    expect(revealed?.textContent).toContain('Documents Modified');
    expect(searches()).toHaveLength(1);
  });

  /**
   * A template outliving the configuration that declared its widget. Saying so beats rendering
   * nothing: the administrator who took it out of the composition has no other way of finding
   * where it is still being asked for.
   */
  it('names a widget the configuration no longer declares', async () => {
    const fixture = await render();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'declares no widget called "gone"',
    );
  });

  /** The contract the HTML export relies on: it finds each widget by this attribute. */
  it('carries the widget id the export looks for', async () => {
    const fixture = await render();
    const ids = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('[data-widget-id]'),
    ].map((element) => element.getAttribute('data-widget-id'));

    expect(ids).toContain('created');
    expect(ids).toContain('createdAgain');
  });
});
