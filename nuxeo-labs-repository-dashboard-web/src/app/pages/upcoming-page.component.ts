import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { PageHeaderComponent } from '../layout/page-header.component';

/**
 * Placeholder for the dashboards delivered in later phases.
 *
 * Inputs are populated from the route `data` through `withComponentInputBinding()`. The input is
 * named `heading` rather than `title` to avoid colliding with the reserved route `title` property.
 */
@Component({
  selector: 'nxd-upcoming-page',
  imports: [PageHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nxd-page-header [title]="heading()" />
    <section class="px-8 pb-8">
      <div class="nxd-card p-6">
        <p class="text-sm font-medium text-ink">Planned for {{ phase() }}.</p>
        <p class="mt-2 max-w-2xl text-sm text-ink-muted">{{ description() }}</p>
      </div>
    </section>
  `,
})
export class UpcomingPageComponent {
  readonly heading = input('');
  readonly phase = input('');
  readonly description = input('');
}
