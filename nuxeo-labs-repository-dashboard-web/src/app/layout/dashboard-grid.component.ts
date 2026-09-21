import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DashboardSession } from '../engine/dashboard-session.service';
import { LayoutSectionComponent } from './layout-section.component';
import { LayoutTabsComponent } from './layout-tabs.component';
import { WidgetRowsComponent } from './widget-rows.component';
import { toBlocks } from './grid-layout';

/**
 * The layout a dashboard falls back on.
 *
 * It owns one thing only, the order the blocks come in; drawing a widget is `<nxd-widget>`'s job,
 * here as anywhere else, and sizing a row is `<nxd-widget-rows>`'s. A bespoke page that wants
 * something this grammar cannot say writes its own markup and drops the same tags into it.
 */
@Component({
  selector: 'nxd-dashboard-grid',
  imports: [LayoutSectionComponent, LayoutTabsComponent, WidgetRowsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      @for (block of blocks(); track $index) {
        @if (block.section; as section) {
          <nxd-layout-section [node]="section" />
        } @else if (block.tabs; as tabs) {
          <nxd-layout-tabs [node]="tabs" />
        } @else {
          <nxd-widget-rows [rows]="block.rows" />
        }
      }
    </div>
  `,
})
export class DashboardGridComponent {
  private readonly session = inject(DashboardSession);

  readonly blocks = computed(() => {
    const config = this.session.config();
    return config ? toBlocks(config.layout) : [];
  });
}
