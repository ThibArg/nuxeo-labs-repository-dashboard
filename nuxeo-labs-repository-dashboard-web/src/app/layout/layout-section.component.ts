import { ChangeDetectionStrategy, Component, input, linkedSignal } from '@angular/core';
import { LayoutSection } from '../config/dashboard-config.model';
import { WidgetRowsComponent } from './widget-rows.component';

/**
 * A titled block of rows, foldable when the configuration says so.
 *
 * Folding removes the rows from the DOM rather than hiding them, because zrender sizes a canvas
 * against the box it is mounted in: a chart started inside a hidden block would paint itself at
 * zero width and stay that way. The cost is that a folded block carries nothing into the HTML
 * export either, which is the same bargain a closed tab makes.
 */
@Component({
  selector: 'nxd-layout-section',
  imports: [WidgetRowsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section class="flex flex-col gap-3">
      <header class="flex items-center gap-2">
        @if (node().collapsible) {
          <button
            type="button"
            class="nxd-section-toggle"
            [attr.aria-expanded]="open()"
            [title]="open() ? 'Fold this section' : 'Unfold this section'"
            (click)="open.set(!open())"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path
                [attr.d]="open() ? 'M6 9l6 6 6-6' : 'M9 6l6 6-6 6'"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            <span class="sr-only">{{ node().section }}</span>
          </button>
        }
        <h2 class="nxd-section-title">{{ node().section }}</h2>
      </header>

      @if (open()) {
        <nxd-widget-rows [rows]="node().rows" />
      }
    </section>
  `,
})
export class LayoutSectionComponent {
  readonly node = input.required<LayoutSection>();

  /*
   * Derived from the configuration and writable, so that a reader's fold survives every redraw but
   * is reset when the dashboard is edited into a different shape. An `effect` writing a plain
   * signal would do the same thing while also being the eighth one in the application.
   */
  protected readonly open = linkedSignal(() => this.node().collapsed !== true);
}
