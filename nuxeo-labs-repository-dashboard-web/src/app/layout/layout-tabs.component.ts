import { ChangeDetectionStrategy, Component, computed, input, linkedSignal } from '@angular/core';
import { LayoutTabs } from '../config/dashboard-config.model';
import { WidgetRowsComponent } from './widget-rows.component';

/**
 * Named panels, one shown at a time.
 *
 * Only the open panel is in the DOM, for the reason a folded section gives. What that does *not*
 * change is when the figures are fetched: every widget the configuration declares is planned and
 * batched whether or not its tab was ever opened, so opening one costs nothing and two tabs
 * describe the same instant — which is the whole reason they can be compared.
 *
 * The strip is made of buttons, so the HTML export strips it and the print sheet hides it. The
 * label is therefore repeated in an element neither of them removes, invisible on screen where
 * the strip already says it.
 */
@Component({
  selector: 'nxd-layout-tabs',
  imports: [WidgetRowsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section class="flex flex-col gap-3">
      <div role="tablist" class="nxd-tab-strip">
        @for (tab of node().tabs; track tab.label; let index = $index) {
          <button
            type="button"
            role="tab"
            class="nxd-tab"
            [attr.aria-selected]="index === active()"
            (click)="active.set(index)"
          >
            {{ tab.label }}
          </button>
        }
      </div>

      @if (current(); as tab) {
        <p class="nxd-panel-label">{{ tab.label }}</p>
        <nxd-widget-rows [rows]="tab.rows" />
      }
    </section>
  `,
})
export class LayoutTabsComponent {
  readonly node = input.required<LayoutTabs>();

  /** Back to the first panel whenever the configuration changes which panels there are. */
  protected readonly active = linkedSignal({
    source: () => this.node().tabs,
    computation: () => 0,
  });

  protected readonly current = computed(() => this.node().tabs[this.active()] ?? null);
}
