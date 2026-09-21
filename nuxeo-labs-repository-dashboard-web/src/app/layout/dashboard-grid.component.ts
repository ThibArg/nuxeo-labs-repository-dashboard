import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { resolveSpan } from '../config/dashboard-config.model';
import { DashboardSession } from '../engine/dashboard-session.service';
import { WidgetComponent } from '../widgets/widget.component';

interface RenderedCell {
  id: string;
  span: number;
}

const GRID_COLUMNS = 12;

/**
 * The twelve column grid a dashboard falls back on.
 *
 * It owns one thing only, the span arithmetic; drawing a widget is `<nxd-widget>`'s job, here as
 * anywhere else. A bespoke page that wants tabs or panels writes its own markup and drops the
 * same tag into it, rather than extending a layout grammar this would have to grow.
 */
@Component({
  selector: 'nxd-dashboard-grid',
  imports: [WidgetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-4">
      @for (row of rows(); track $index) {
        <div class="nxd-grid">
          @for (cell of row; track cell.id) {
            <!--
              The span is written twice on purpose. A custom property cannot be matched by a
              selector, and the print sheet has to single out a full width widget to keep both of
              its two paper columns.
            -->
            <nxd-widget
              [for]="cell.id"
              [style.--nxd-span]="cell.span"
              [attr.data-span]="cell.span"
            />
          }
        </div>
      }
    </div>
  `,
})
export class DashboardGridComponent {
  private readonly session = inject(DashboardSession);

  /**
   * Resolves the layout into rows of cells with an explicit span.
   *
   * A widget without a declared span shares the row evenly; leftover columns go to the last cell
   * so that a row of five always fills the full width. A row whose spans exceed twelve is not an
   * error: CSS grid auto placement wraps it onto further lines, which is how two full width
   * charts declared in the same row end up stacked.
   */
  readonly rows = computed<RenderedCell[][]>(() => {
    const config = this.session.config();
    if (!config) {
      return [];
    }
    const rangeId = this.session.filters().range.id;

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
          span: declared[index] ?? (index === present.length - 1 ? even + remainder : even),
        }));
      })
      .filter((row) => row.length > 0);
  });
}
