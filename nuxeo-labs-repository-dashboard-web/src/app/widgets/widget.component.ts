import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DashboardSession } from '../engine/dashboard-session.service';
import { resolveSpan } from '../config/dashboard-config.model';
import { coveredRange } from '../engine/audit-horizon';
import { dateFieldFor } from '../engine/query-planner';
import { WidgetOutletComponent } from './widget-outlet.component';

/**
 * One widget of the dashboard in force, drawn wherever this tag is put.
 *
 * `WidgetOutletComponent` takes its data through eight inputs, which is fine when a grid drills
 * them down and impossible anywhere else: a widget sitting in a tab, a panel or a bespoke layout
 * has no parent to receive them from. This reads the session instead, so placement stops being
 * the engine's business.
 *
 * What placement does *not* change is when the figures are fetched. Every widget the
 * configuration declares is planned and batched whether or not it is on screen, so a tab that has
 * never been opened costs nothing to open — and every tab describes the same instant, which is
 * what lets a reader compare them.
 */
@Component({
  selector: 'nxd-widget',
  imports: [WidgetOutletComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The id is what the HTML export looks for when it swaps each canvas for its photograph.
  host: { class: 'block h-full', '[attr.data-widget-id]': 'for()' },
  template: `
    @if (widget(); as config) {
      <nxd-widget-outlet
        [config]="config"
        [widgetId]="for()"
        [data]="session.runner.data().get(for())"
        [loading]="session.runner.loading()"
        [error]="error()"
        [rangeLabel]="rangeLabel()"
        [period]="period()"
        [bucketLabels]="session.runner.bucketLabels().get(for()) ?? emptyBucketLabels"
        [columnLabels]="session.runner.columnLabels().get(for()) ?? emptyColumnLabels"
        (picked)="session.pickBucket($event, for())"
      />
    } @else if (session.config()) {
      <!--
        Said rather than skipped. A template naming a widget the configuration no longer declares
        would otherwise leave a silent hole, and the administrator who removed it from the
        composition has no other way of finding where it was still being asked for.
      -->
      <div class="nxd-card p-4 text-xs text-ink-muted">
        This dashboard declares no widget called "{{ for() }}".
      </div>
    }
  `,
})
export class WidgetComponent {
  /** Name the configuration gives this widget — a composition's `as`, or its `use` by default. */
  readonly for = input.required<string>();

  protected readonly session = inject(DashboardSession);

  protected readonly emptyBucketLabels = new Map<string, string>();
  protected readonly emptyColumnLabels = new Map<string, Map<string, string>>();

  protected readonly widget = computed(() => this.session.config()?.widgets[this.for()] ?? null);

  /**
   * The period this widget's figures cover: the one chosen, begun no earlier than the index it
   * reads. On an audit purged in March, "All time" there is "Since Mar 12, 2026", and a tile
   * pasted into a slide has nothing else to say so.
   */
  protected readonly rangeLabel = computed(() => {
    const config = this.session.config();
    const widget = this.widget();
    const range = this.session.filters().range;
    if (!config || !widget) {
      return range.label;
    }
    return coveredRange(range, this.session.horizons()[widget.index ?? config.index]).label;
  });

  /**
   * The period this widget's figures obey, or null when the page's period does not constrain the
   * index it reads — Tasks declares none, and on a page mixing two indices a `byIndex` of `""`
   * leaves one half unfiltered. Saying "Last 12 months" over a figure no period touched would be
   * the same lie as leaving it unsaid over one that it did.
   */
  protected readonly period = computed(() => {
    const config = this.session.config();
    const widget = this.widget();
    if (!config || !widget || !dateFieldFor(config, widget.index ?? config.index)) {
      return null;
    }
    return this.rangeLabel();
  });

  /** Width in the twelve column grid, for a caller laying widgets out with `.nxd-grid`. */
  readonly span = computed(() => {
    const widget = this.widget();
    return widget ? resolveSpan(widget, this.session.filters().range.id) : undefined;
  });

  /** A per widget configuration error takes precedence over the dashboard wide one. */
  protected readonly error = computed(
    () => this.session.runner.widgetErrors().get(this.for()) ?? this.session.runner.error(),
  );
}
