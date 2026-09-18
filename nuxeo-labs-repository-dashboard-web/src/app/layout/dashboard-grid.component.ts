import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  DashboardConfig,
  DateRangeOption,
  WidgetConfig,
  resolveSpan,
} from '../config/dashboard-config.model';
import { WidgetData } from '../engine/result-mapper';
import { WidgetOutletComponent } from '../widgets/widget-outlet.component';

interface RenderedCell {
  id: string;
  widget: WidgetConfig;
  span: number;
}

const GRID_COLUMNS = 12;

@Component({
  selector: 'nxd-dashboard-grid',
  imports: [WidgetOutletComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-4">
      @for (row of rows(); track $index) {
        <div class="nxd-grid">
          @for (cell of row; track cell.id) {
            <div [style.--nxd-span]="cell.span">
              <nxd-widget-outlet
                [config]="cell.widget"
                [data]="data().get(cell.id)"
                [loading]="loading()"
                [error]="errorFor(cell.id)"
                [rangeLabel]="range().label"
                [bucketLabels]="bucketLabels().get(cell.id) ?? emptyBucketLabels"
                [columnLabels]="columnLabels().get(cell.id) ?? emptyColumnLabels"
              />
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class DashboardGridComponent {
  readonly config = input.required<DashboardConfig>();
  readonly range = input.required<DateRangeOption>();
  readonly data = input<Map<string, WidgetData>>(new Map());
  readonly bucketLabels = input<Map<string, Map<string, string>>>(new Map());
  readonly columnLabels = input<Map<string, Map<string, Map<string, string>>>>(new Map());
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly widgetErrors = input<Map<string, string>>(new Map());

  protected readonly emptyBucketLabels = new Map<string, string>();
  protected readonly emptyColumnLabels = new Map<string, Map<string, string>>();

  /**
   * Resolves the layout into rows of cells with an explicit span.
   *
   * A widget without a declared span shares the row evenly; leftover columns go to the last cell
   * so that a row of five always fills the full width. A row whose spans exceed twelve is not an
   * error: CSS grid auto placement wraps it onto further lines, which is how two full width
   * charts declared in the same row end up stacked.
   */
  readonly rows = computed<RenderedCell[][]>(() => {
    const config = this.config();
    const rangeId = this.range().id;

    return config.layout
      .map((row) => {
        const present = row.cells.filter((id) => id in config.widgets);
        if (!present.length) {
          return [];
        }

        const even = Math.max(Math.floor(GRID_COLUMNS / present.length), 1);
        const declared = present.map((id) => resolveSpan(config.widgets[id], rangeId));
        const remainder = GRID_COLUMNS - even * present.length;

        return present.map((id, index) => ({
          id,
          widget: config.widgets[id],
          span: declared[index] ?? (index === present.length - 1 ? even + remainder : even),
        }));
      })
      .filter((row) => row.length > 0);
  });

  /** A per widget configuration error takes precedence over the dashboard wide one. */
  errorFor(widgetId: string): string | null {
    return this.widgetErrors().get(widgetId) ?? this.error();
  }
}
