import { formatNumber } from '../core/format';
import { WidgetData } from '../engine/result-mapper';

/**
 * Owns up to a truncated bucket list.
 *
 * A `terms` aggregation is a top N: with dozens of users a chart showing ten bars reads as the
 * whole population unless it says otherwise. The line is absent when nothing was left out, so it
 * stays silent on a small repository and speaks on a large one.
 */
export function truncationFooter(data: WidgetData | undefined): string | null {
  if (!data || data.kind !== 'buckets' || !data.others) {
    return null;
  }
  return `${formatNumber(data.others, 'integer')} more not shown`;
}

/** How much of the measured total those omitted values account for. */
export function truncationDetail(data: WidgetData | undefined): string | null {
  if (!data || data.kind !== 'buckets' || !data.others || data.otherDocs === undefined) {
    return null;
  }
  const shown = data.buckets.reduce((total, bucket) => total + bucket.docCount, 0);
  const share = shown + data.otherDocs > 0 ? data.otherDocs / (shown + data.otherDocs) : 0;
  return (
    `${formatNumber(data.others, 'integer')} values are not listed, ` +
    `accounting for ${formatNumber(data.otherDocs, 'integer')} of the matching documents ` +
    `(${formatNumber(share, 'percent')}).`
  );
}
