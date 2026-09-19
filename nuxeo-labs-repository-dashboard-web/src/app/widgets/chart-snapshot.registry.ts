import { Injectable } from '@angular/core';

/** Produces a PNG data URL of a chart as it stands, or null when it cannot be rendered. */
export type ChartSnapshot = () => string | null;

/**
 * Knows how to photograph every chart currently on screen.
 *
 * A whole page export has to turn each chart into an image, and only the chart component holds the
 * ECharts instance that can produce one. Passing a callback up through the grid and the outlet
 * would thread a function through two components that have no other reason to know about exports,
 * so the charts register themselves here instead and the page asks by widget id.
 *
 * Registrations are dropped on destroy, so a dashboard left for another one photographs its own
 * charts rather than the previous page's.
 */
@Injectable({ providedIn: 'root' })
export class ChartSnapshotRegistry {
  private readonly snapshots = new Map<string, ChartSnapshot>();

  register(widgetId: string, snapshot: ChartSnapshot): void {
    if (widgetId) {
      this.snapshots.set(widgetId, snapshot);
    }
  }

  unregister(widgetId: string): void {
    this.snapshots.delete(widgetId);
  }

  /** Widget id to PNG data URL, skipping any chart that could not answer. */
  capture(): Map<string, string> {
    const images = new Map<string, string>();
    for (const [widgetId, snapshot] of this.snapshots) {
      const url = snapshot();
      if (url) {
        images.set(widgetId, url);
      }
    }
    return images;
  }
}
