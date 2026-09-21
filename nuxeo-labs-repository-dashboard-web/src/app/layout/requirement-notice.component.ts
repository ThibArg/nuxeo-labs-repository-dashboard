import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { PreflightResult, PreflightService } from '../core/preflight.service';

export type PreflightFeature = keyof PreflightResult['features'];

/**
 * Tells the reader which server prerequisite a page needs, when the preflight found it missing.
 *
 * Naming the missing piece here, rather than greying out the navigation entry, is what lets
 * someone find out what to install or enable. The wording stays deliberately vague about the
 * cause: a prerequisite can be absent because a package was never installed, or because it ships
 * disabled, and the Diagnostics page is the only place that knows which.
 */
@Component({
  selector: 'nxd-requirement-notice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (missing()) {
      <div class="nxd-card border-warning-soft bg-warning-soft p-6">
        <p class="text-sm font-medium text-warning">
          This dashboard needs {{ label() }}, which this server does not provide.
        </p>
        <p class="mt-2 max-w-2xl text-sm text-warning">
          Open the Diagnostics page for the exact check and how to satisfy it.
        </p>
        @if (docUrl(); as url) {
          <a
            class="mt-3 inline-block text-sm font-medium text-warning underline"
            [href]="url"
            target="_blank"
            rel="noopener"
            >Documentation</a
          >
        }
      </div>
    }
  `,
})
export class RequirementNoticeComponent {
  private readonly preflight = inject(PreflightService);

  /** Preflight feature the page needs, e.g. `audit`. Empty when the page needs nothing. */
  readonly requires = input<PreflightFeature | ''>('');
  /** What an administrator would go looking for, e.g. `the nuxeo-retention package`. */
  readonly label = input('');
  readonly docUrl = input('');

  readonly missing = computed(() => {
    const feature = this.requires();
    const features = this.preflight.result()?.features;
    // Silent while the preflight has not run: an unchecked server is not a missing prerequisite.
    if (!feature || !features) {
      return false;
    }
    /*
     * A feature the preflight does not report is a mistake in whoever asked for it, not a server
     * without it. Reading the absence as "missing" is how removing a check from `PreflightResult`
     * puts a warning on every healthy server, which is exactly backwards.
     */
    return feature in features && !features[feature];
  });
}
