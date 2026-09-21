import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { LayoutRow } from '../config/dashboard-config.model';
import { DashboardSession } from '../engine/dashboard-session.service';
import { WidgetComponent } from '../widgets/widget.component';
import { renderRows } from './grid-layout';

/**
 * A run of rows, drawn in the twelve column grid.
 *
 * Every layout node ends up here — a plain row, the body of a section, the panel of a tab — so the
 * span arithmetic and the two ways a span is written exist once rather than three times.
 */
@Component({
  selector: 'nxd-widget-rows',
  imports: [WidgetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-4">
      @for (row of rendered(); track $index) {
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
export class WidgetRowsComponent {
  readonly rows = input.required<LayoutRow[]>();

  private readonly session = inject(DashboardSession);

  protected readonly rendered = computed(() => {
    const config = this.session.config();
    if (!config) {
      return [];
    }
    return renderRows(this.rows(), config.widgets, this.session.filters().range.id);
  });
}
