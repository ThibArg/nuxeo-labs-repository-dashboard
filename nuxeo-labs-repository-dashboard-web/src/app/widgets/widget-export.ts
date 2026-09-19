import { DataBucket } from '../engine/result-mapper';

/**
 * Rows a bucket based widget exports.
 *
 * Values are raw rather than formatted, unlike what the widget shows. A spreadsheet can render
 * 1258291 as 1.2 MB and cannot turn "1.2 MB" back into a number, so formatting here would cost the
 * reader the one thing a CSV is good for.
 *
 * Both figures are written. They are the same number on most widgets and differ on any widget
 * carrying a metric, where the value is an average or a sum and the count says over how many
 * documents it was taken — which is what tells a reader whether a mean of 12 is worth anything.
 */
export function bucketRows(buckets: DataBucket[], labels: Map<string, string>): unknown[][] {
  const rows: unknown[][] = [['key', 'label', 'value', 'documents']];
  for (const bucket of buckets) {
    rows.push([bucket.key, labels.get(bucket.key) ?? bucket.key, bucket.value, bucket.docCount]);
  }
  return rows;
}
