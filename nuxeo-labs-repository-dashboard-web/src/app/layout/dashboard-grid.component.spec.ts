import { TestBed } from '@angular/core/testing';
import { DashboardConfig, DateRangeOption } from '../config/dashboard-config.model';
import { DashboardGridComponent } from './dashboard-grid.component';
import { ChartWidgetComponent } from '../widgets/chart-widget.component';
import { WidgetOutletComponent } from '../widgets/widget-outlet.component';
import { ChartWidgetStubComponent } from '../../testing/chart-widget.stub';
import { SessionStub, stubSession } from '../../testing/session.stub';

const ALL: DateRangeOption = { id: 'all', label: 'All time', from: null, to: null };
const LAST_30: DateRangeOption = {
  id: '30d',
  label: 'Last 30 days',
  from: '2026-08-20',
  to: '2026-09-18',
};

function config(overrides: Partial<DashboardConfig> = {}): DashboardConfig {
  return {
    id: 'test',
    label: 'Test',
    index: 'nuxeo',
    layout: [{ cells: ['created', 'modified'] }],
    widgets: {
      created: {
        type: 'area',
        label: 'Created',
        hint: 'per day ({range})',
        span: 12,
        spanByRange: { '30d': 6 },
        agg: { date_histogram: { field: 'dc:created', calendar_interval: 'day' } },
      },
      modified: {
        type: 'area',
        label: 'Modified',
        span: 12,
        spanByRange: { '30d': 6 },
        agg: { date_histogram: { field: 'dc:modified', calendar_interval: 'day' } },
      },
    },
    ...overrides,
  };
}

let session: SessionStub;

function mount(dashboard: DashboardConfig, range: DateRangeOption) {
  const stubbed = stubSession(dashboard, range);
  session = stubbed.state;
  TestBed.configureTestingModule({ providers: [stubbed.provider] });

  const fixture = TestBed.createComponent(DashboardGridComponent);
  fixture.detectChanges();
  return fixture;
}

function spans(fixture: { nativeElement: unknown }): number[][] {
  const grids = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.nxd-grid')];
  return grids.map((grid) =>
    [...grid.children].map((cell) => Number(cell.getAttribute('data-span'))),
  );
}

describe('DashboardGridComponent', () => {
  beforeEach(() => {
    TestBed.overrideComponent(WidgetOutletComponent, {
      remove: { imports: [ChartWidgetComponent] },
      add: { imports: [ChartWidgetStubComponent] },
    });
  });

  describe('spans', () => {
    it('uses the declared span when the range has no override', () => {
      // Twelve each: CSS grid auto placement wraps them onto two lines.
      expect(spans(mount(config(), ALL))).toEqual([[12, 12]]);
    });

    it('applies spanByRange for the active range', () => {
      // Six each: they sit side by side on a single line.
      expect(spans(mount(config(), LAST_30))).toEqual([[6, 6]]);
    });

    it('splits a row evenly when no span is declared', () => {
      const even = config({
        layout: [{ cells: ['a', 'b', 'c'] }],
        widgets: {
          a: { type: 'kpi', label: 'A' },
          b: { type: 'kpi', label: 'B' },
          c: { type: 'kpi', label: 'C' },
        },
      });

      expect(spans(mount(even, ALL))).toEqual([[4, 4, 4]]);
    });

    it('gives the leftover columns to the last cell so a row of five fills the width', () => {
      const five = config({
        layout: [{ cells: ['a', 'b', 'c', 'd', 'e'] }],
        widgets: Object.fromEntries(
          ['a', 'b', 'c', 'd', 'e'].map((id) => [id, { type: 'kpi' as const, label: id }]),
        ),
      });

      const row = spans(mount(five, ALL))[0];
      expect(row).toEqual([2, 2, 2, 2, 4]);
      expect(row.reduce((total, span) => total + span, 0)).toBe(12);
    });

    it('ignores a layout cell referencing an unknown widget', () => {
      const ghost = config({ layout: [{ cells: ['created', 'ghost'] }] });
      expect(spans(mount(ghost, ALL))).toEqual([[12]]);
    });

    it('drops a row whose cells are all unknown', () => {
      const ghost = config({ layout: [{ cells: ['ghost'] }, { cells: ['created'] }] });
      expect(spans(mount(ghost, ALL))).toHaveLength(1);
    });
  });

  describe('range reminder', () => {
    it('interpolates the active range into the hint', () => {
      const content = (mount(config(), ALL).nativeElement as HTMLElement).textContent ?? '';
      expect(content).toContain('per day (All time)');
    });

    it('follows a range change', () => {
      const content = (mount(config(), LAST_30).nativeElement as HTMLElement).textContent ?? '';
      expect(content).toContain('per day (Last 30 days)');
    });
  });

  /**
   * The print sheet matches `.nxd-grid > [data-span='12']` to give a full width widget both of its
   * paper columns, and a selector cannot match a custom property. So the span is written twice,
   * and this is what keeps the second copy from being tidied away as a duplicate.
   */
  describe('the span the print sheet reads', () => {
    it('sits on the cell as an attribute, beside the custom property', () => {
      const fixture = mount(config(), ALL);
      const cells = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.nxd-grid > *')];

      expect(cells.map((cell) => cell.getAttribute('data-span'))).toEqual(['12', '12']);
      expect(
        (fixture.nativeElement as HTMLElement).querySelectorAll(".nxd-grid > [data-span='12']"),
      ).toHaveLength(2);
    });

    it('follows spanByRange, so a widget halved for a short period prints halved', () => {
      const fixture = mount(config(), LAST_30);
      const cells = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.nxd-grid > *')];

      expect(cells.map((cell) => cell.getAttribute('data-span'))).toEqual(['6', '6']);
    });
  });

  describe('errors', () => {
    it('prefers a per widget error over the dashboard wide one', () => {
      const fixture = mount(config(), ALL);
      session.error.set('dashboard failed');
      session.widgetErrors.set(new Map([['created', 'bad field']]));
      fixture.detectChanges();

      const content = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(content).toContain('bad field');
      expect(content).toContain('dashboard failed');
    });
  });
});
