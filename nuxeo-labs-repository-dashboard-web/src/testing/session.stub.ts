/**
 * A dashboard session standing still.
 *
 * `DashboardSession` injects eight services and talks to the server; a component that only draws
 * widgets needs none of that. This hands it a session whose state is whatever the test says it
 * is, which is what lets the grid, and any bespoke layout, be tested for what they actually do:
 * placing widgets.
 */
import { Provider, WritableSignal, signal } from '@angular/core';
import {
  DashboardConfig,
  DateRangeOption,
  FilterState,
  defaultFilterState,
} from '../app/config/dashboard-config.model';
import { DashboardSession } from '../app/engine/dashboard-session.service';
import { WidgetData } from '../app/engine/result-mapper';
import { BucketClick } from '../app/widgets/chart-widget.component';

export interface SessionStub {
  config: WritableSignal<DashboardConfig | null>;
  filters: WritableSignal<FilterState>;
  data: WritableSignal<Map<string, WidgetData>>;
  loading: WritableSignal<boolean>;
  error: WritableSignal<string | null>;
  widgetErrors: WritableSignal<Map<string, string>>;
  bucketLabels: WritableSignal<Map<string, Map<string, string>>>;
  /** Every bucket click the widgets emitted, in order. */
  picked: BucketClick[];
  /** Element `nxdExportRoot` registered, if any. */
  exportRoot: Element | null;
}

export interface StubbedSession {
  provider: Provider;
  state: SessionStub;
}

export function stubSession(
  config: DashboardConfig | null,
  range?: DateRangeOption,
): StubbedSession {
  const filters = defaultFilterState(config ?? undefined);
  const state: SessionStub = {
    config: signal(config),
    filters: signal(range ? { ...filters, range } : filters),
    data: signal(new Map<string, WidgetData>()),
    loading: signal(false),
    error: signal<string | null>(null),
    widgetErrors: signal(new Map<string, string>()),
    bucketLabels: signal(new Map<string, Map<string, string>>()),
    picked: [],
    exportRoot: null,
  };

  const session = {
    config: state.config,
    filters: state.filters,
    runner: {
      data: state.data,
      loading: state.loading,
      error: state.error,
      widgetErrors: state.widgetErrors,
      bucketLabels: state.bucketLabels,
      columnLabels: signal(new Map()),
    },
    pickBucket: (click: BucketClick) => state.picked.push(click),
    registerExportRoot: (element: Element | null) => {
      state.exportRoot = element;
    },
  };

  return { provider: { provide: DashboardSession, useValue: session }, state };
}
