import { Injectable, computed, inject, signal } from '@angular/core';
import {
  ColumnConfig,
  DashboardConfig,
  FilterState,
  isChartWidget,
  isTableWidget,
} from '../config/dashboard-config.model';
import { LabelService } from '../core/label.service';
import { NuxeoHttpService } from '../core/nuxeo-http.service';
import { readSource } from '../core/format';
import { DashboardPlan, planDashboard } from './query-planner';
import { WidgetData, mapResponse } from './result-mapper';

interface RunnerState {
  data: Map<string, WidgetData>;
  /** widgetId -> bucket key -> label, for charts and ranked lists. */
  bucketLabels: Map<string, Map<string, string>>;
  /** widgetId -> column field -> raw value -> label, for tables. */
  columnLabels: Map<string, Map<string, Map<string, string>>>;
  /** widgetId -> reason, for widgets whose configuration failed to compile. */
  widgetErrors: Map<string, string>;
  /** Total round trip count of the last run, surfaced in the page subtitle. */
  requestCount: number;
  took: number | null;
}

function emptyState(): RunnerState {
  return {
    data: new Map(),
    bucketLabels: new Map(),
    columnLabels: new Map(),
    widgetErrors: new Map(),
    requestCount: 0,
    took: null,
  };
}

/**
 * Runs a dashboard: plans the requests, issues them, maps the responses, resolves labels.
 *
 * Reloading is explicit rather than reactive. An `effect` watching the filter state would fire on
 * every intermediate signal write and is easy to turn into a loop; an explicit `run()` keeps the
 * number of round trips obvious.
 */
@Injectable()
export class DashboardRunner {
  private readonly http = inject(NuxeoHttpService);
  private readonly labels = inject(LabelService);

  private readonly state = signal<RunnerState>(emptyState());
  private readonly loadingState = signal(false);
  private readonly errorState = signal<string | null>(null);

  readonly loading = this.loadingState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly data = computed(() => this.state().data);
  readonly bucketLabels = computed(() => this.state().bucketLabels);
  readonly columnLabels = computed(() => this.state().columnLabels);
  readonly widgetErrors = computed(() => this.state().widgetErrors);

  readonly summary = computed(() => {
    const { requestCount, took } = this.state();
    if (!requestCount) {
      return null;
    }
    const requests = requestCount === 1 ? '1 request' : `${requestCount} requests`;
    return took === null ? requests : `${requests}, slowest answered in ${took} ms`;
  });

  async run(config: DashboardConfig, filters: FilterState): Promise<void> {
    this.loadingState.set(true);
    this.errorState.set(null);

    let plan: DashboardPlan;
    try {
      plan = planDashboard(config, filters);
    } catch (error) {
      this.errorState.set(describe(error));
      this.state.set(emptyState());
      this.loadingState.set(false);
      return;
    }

    try {
      const responses = await Promise.all(
        plan.requests.map(async (request) => ({
          request,
          response: await this.http.search(request.index, request.body),
        })),
      );

      const data = new Map<string, WidgetData>();
      let took: number | null = null;
      for (const { request, response } of responses) {
        mapResponse(request, response, plan.widgets).forEach((value, key) => data.set(key, value));
        took = Math.max(took ?? 0, response.took ?? 0);
      }

      const { bucketLabels, columnLabels } = await this.resolveLabels(config, data);

      this.state.set({
        data,
        bucketLabels,
        columnLabels,
        widgetErrors: plan.errors,
        requestCount: plan.requests.length,
        took,
      });
    } catch (error) {
      this.errorState.set(describe(error));
      this.state.set({ ...emptyState(), widgetErrors: plan.errors });
    } finally {
      this.loadingState.set(false);
    }
  }

  /**
   * Resolves every label the rendered data needs.
   *
   * Lookups are grouped by strategy so that, for instance, a hundred `dc:creator` buckets spread
   * over several widgets still hit the user endpoint once per distinct principal.
   */
  private async resolveLabels(
    config: DashboardConfig,
    data: Map<string, WidgetData>,
  ): Promise<Pick<RunnerState, 'bucketLabels' | 'columnLabels'>> {
    const bucketLabels = new Map<string, Map<string, string>>();
    const columnLabels = new Map<string, Map<string, Map<string, string>>>();

    const bucketWork: Promise<void>[] = [];
    const columnWork: Promise<void>[] = [];

    for (const [widgetId, widget] of Object.entries(config.widgets)) {
      const widgetData = data.get(widgetId);
      if (!widgetData) {
        continue;
      }

      if (isChartWidget(widget) && widget.labels && widgetData.kind === 'buckets') {
        const keys = widgetData.buckets.map((bucket) => bucket.key);
        bucketWork.push(
          this.labels
            .resolve(widget.labels, keys)
            .then((resolved) => {
              bucketLabels.set(widgetId, resolved);
            })
            .catch(() => undefined),
        );
        continue;
      }

      if (isTableWidget(widget) && widgetData.kind === 'rows') {
        const perColumn = new Map<string, Map<string, string>>();
        columnLabels.set(widgetId, perColumn);

        for (const column of widget.columns.filter(hasLabelStrategy)) {
          /*
           * A multivalued property is resolved element by element: `nt:actors` holds a list, and
           * stringifying the array whole would ask the server for `user:jdoe,group:sales`.
           */
          const values = widgetData.rows
            .flatMap((row) => {
              const value = readSource(row.source, column.field);
              return Array.isArray(value) ? value : [value];
            })
            .filter((value) => value !== undefined && value !== null)
            .map(String);

          columnWork.push(
            this.labels
              .resolve(column.labels, values)
              .then((resolved) => {
                perColumn.set(column.field, resolved);
              })
              .catch(() => undefined),
          );
        }
      }
    }

    await Promise.all([...bucketWork, ...columnWork]);
    return { bucketLabels, columnLabels };
  }
}

function hasLabelStrategy(column: ColumnConfig): boolean {
  return !!column.labels && column.labels !== 'raw';
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
