import { TestBed } from '@angular/core/testing';
import { DashboardConfig } from '../config/dashboard-config.model';
import { DashboardGridComponent } from './dashboard-grid.component';
import { ChartWidgetComponent } from '../widgets/chart-widget.component';
import { WidgetOutletComponent } from '../widgets/widget-outlet.component';
import { ChartWidgetStubComponent } from '../../testing/chart-widget.stub';
import { stubSession } from '../../testing/session.stub';

const WIDGETS: DashboardConfig['widgets'] = {
  a: { type: 'kpi', label: 'Tile A' },
  b: { type: 'kpi', label: 'Tile B' },
  c: { type: 'kpi', label: 'Tile C' },
};

function dashboard(layout: DashboardConfig['layout']): DashboardConfig {
  return { id: 'test', label: 'Test', index: 'nuxeo', layout, widgets: WIDGETS };
}

function mount(layout: DashboardConfig['layout']) {
  TestBed.configureTestingModule({ providers: [stubSession(dashboard(layout)).provider] });
  const fixture = TestBed.createComponent(DashboardGridComponent);
  fixture.detectChanges();
  return fixture;
}

function html(fixture: { nativeElement: unknown }): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function widgetIds(fixture: { nativeElement: unknown }): string[] {
  return [...html(fixture).querySelectorAll('[data-widget-id]')].map(
    (element) => element.getAttribute('data-widget-id') ?? '',
  );
}

describe('the layout grammar on screen', () => {
  beforeEach(() => {
    TestBed.overrideComponent(WidgetOutletComponent, {
      remove: { imports: [ChartWidgetComponent] },
      add: { imports: [ChartWidgetStubComponent] },
    });
  });

  describe('tabs', () => {
    const TABBED: DashboardConfig['layout'] = [
      {
        tabs: [
          { label: 'Creation', rows: [{ cells: ['a'] }] },
          { label: 'Modification', rows: [{ cells: ['b'] }] },
        ],
      },
    ];

    it('opens on the first panel', () => {
      const fixture = mount(TABBED);

      expect(widgetIds(fixture)).toEqual(['a']);
      expect(html(fixture).textContent).toContain('Tile A');
    });

    /**
     * A closed panel is removed rather than hidden: zrender sizes a canvas against the box it is
     * mounted in, so a chart started inside a hidden panel would paint itself at zero width and
     * stay that way.
     */
    it('leaves the other panel out of the page entirely', () => {
      expect(html(mount(TABBED)).textContent).not.toContain('Tile B');
    });

    it('swaps panels when a tab is clicked', () => {
      const fixture = mount(TABBED);
      const tabs = [...html(fixture).querySelectorAll<HTMLButtonElement>('.nxd-tab')];

      tabs[1].click();
      fixture.detectChanges();

      expect(widgetIds(fixture)).toEqual(['b']);
      expect(tabs[1].getAttribute('aria-selected')).toBe('true');
      expect(tabs[0].getAttribute('aria-selected')).toBe('false');
    });

    /**
     * The strip is a row of buttons, and both the print sheet and the HTML export drop those —
     * the export by removing every `button`. Without this the reader of a printed or exported
     * tabbed page would see figures belonging to a panel nothing names.
     */
    it('names the open panel in an element neither paper nor the export removes', () => {
      const fixture = mount(TABBED);
      const label = html(fixture).querySelector('.nxd-panel-label');

      expect(label?.textContent?.trim()).toBe('Creation');
      expect(label?.tagName).not.toBe('BUTTON');
    });
  });

  describe('sections', () => {
    it('draws its title and its rows', () => {
      const fixture = mount([{ section: 'Retention', rows: [{ cells: ['a', 'b'] }] }]);

      expect(html(fixture).querySelector('.nxd-section-title')?.textContent?.trim()).toBe(
        'Retention',
      );
      expect(widgetIds(fixture)).toEqual(['a', 'b']);
    });

    it('offers no fold unless the configuration asked for one', () => {
      const fixture = mount([{ section: 'Retention', rows: [{ cells: ['a'] }] }]);

      expect(html(fixture).querySelector('.nxd-section-toggle')).toBeNull();
      expect(widgetIds(fixture)).toEqual(['a']);
    });

    it('starts folded when the configuration says so, and unfolds on click', () => {
      const fixture = mount([
        { section: 'Retention', rows: [{ cells: ['a'] }], collapsible: true, collapsed: true },
      ]);

      expect(widgetIds(fixture)).toEqual([]);
      expect(html(fixture).querySelector('.nxd-section-title')?.textContent?.trim()).toBe(
        'Retention',
      );

      html(fixture).querySelector<HTMLButtonElement>('.nxd-section-toggle')!.click();
      fixture.detectChanges();

      expect(widgetIds(fixture)).toEqual(['a']);
    });
  });

  describe('order', () => {
    it('draws the nodes in the order they were declared', () => {
      const fixture = mount([
        { cells: ['a'] },
        { section: 'Middle', rows: [{ cells: ['b'] }] },
        { tabs: [{ label: 'Last', rows: [{ cells: ['c'] }] }] },
      ]);

      expect(widgetIds(fixture)).toEqual(['a', 'b', 'c']);
    });

    /**
     * Consecutive plain rows share one block, so the grid hands a stable array down rather than
     * building a fresh one on every change detection pass.
     */
    it('gathers consecutive rows into one run', () => {
      const fixture = mount([{ cells: ['a'] }, { cells: ['b'] }]);

      expect(html(fixture).querySelectorAll('nxd-widget-rows')).toHaveLength(1);
      expect(html(fixture).querySelectorAll('.nxd-grid')).toHaveLength(2);
    });
  });
});
