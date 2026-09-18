import { TestBed } from '@angular/core/testing';
import { DashboardConfig, DateRangeOption } from '../config/dashboard-config.model';
import { DashboardGridComponent } from './dashboard-grid.component';
import { ChartWidgetComponent } from '../widgets/chart-widget.component';
import { WidgetOutletComponent } from '../widgets/widget-outlet.component';
import { ChartWidgetStubComponent } from '../../testing/chart-widget.stub';

const ALL: DateRangeOption = { id: 'all', label: 'All time', from: null };
const LAST_30: DateRangeOption = { id: '30d', label: 'Last 30 days', from: 'now-30d' };

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

function mount(dashboard: DashboardConfig, range: DateRangeOption) {
  const fixture = TestBed.createComponent(DashboardGridComponent);
  fixture.componentRef.setInput('config', dashboard);
  fixture.componentRef.setInput('range', range);
  fixture.detectChanges();
  return fixture;
}

function spans(fixture: { componentInstance: DashboardGridComponent }): number[][] {
  return fixture.componentInstance.rows().map((row) => row.map((cell) => cell.span));
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

  describe('errors', () => {
    it('prefers a per widget error over the dashboard wide one', () => {
      const fixture = mount(config(), ALL);
      fixture.componentRef.setInput('error', 'dashboard failed');
      fixture.componentRef.setInput('widgetErrors', new Map([['created', 'bad field']]));
      fixture.detectChanges();

      expect(fixture.componentInstance.errorFor('created')).toBe('bad field');
      expect(fixture.componentInstance.errorFor('modified')).toBe('dashboard failed');
    });
  });
});
