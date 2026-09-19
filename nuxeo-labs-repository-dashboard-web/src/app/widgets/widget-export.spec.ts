import { DataBucket } from '../engine/result-mapper';
import { bucketRows } from './widget-export';

const BUCKETS: DataBucket[] = [
  { key: 'File', value: 3000, docCount: 3000 },
  { key: 'jdoe', value: 12.5, docCount: 40 },
];

describe('bucketRows', () => {
  it('writes a header a spreadsheet can read', () => {
    expect(bucketRows([], new Map())[0]).toEqual(['key', 'label', 'value', 'documents']);
  });

  it('keeps the raw key beside the label a reader saw', () => {
    const rows = bucketRows(BUCKETS, new Map([['jdoe', 'Jane Doe']]));

    expect(rows[1]).toEqual(['File', 'File', 3000, 3000]);
    expect(rows[2]).toEqual(['jdoe', 'Jane Doe', 12.5, 40]);
  });

  /*
   * A spreadsheet renders 1258291 as 1.2 MB and cannot turn "1.2 MB" back into a number, so
   * formatting here would cost the reader the one thing a CSV is good for.
   */
  it('writes numbers rather than what the widget displayed', () => {
    const rows = bucketRows([{ key: 'a', value: 1258291, docCount: 3 }], new Map());

    expect(rows[1][2]).toBe(1258291);
  });

  /*
   * The two figures differ on any widget carrying a metric: the value is then an average or a sum,
   * and the count says over how many documents it was taken, which is what tells a reader whether
   * a mean of 12.5 is worth anything at all.
   */
  it('keeps the count beside a metric, not only the metric', () => {
    expect(bucketRows(BUCKETS, new Map())[2]).toEqual(['jdoe', 'jdoe', 12.5, 40]);
  });
});
