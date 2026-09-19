import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChartWidgetConfig } from '../config/dashboard-config.model';
import { WidgetData } from '../engine/result-mapper';
import { RankedListComponent } from './ranked-list.component';
import { DownloadCapture, captureDownloads, textOf } from '../../testing/downloads';

const CONFIG: ChartWidgetConfig = {
  type: 'ranked-list',
  label: 'Top Contributors',
  agg: { terms: { field: 'dc:creator', size: 10 } },
};

const DATA: WidgetData = {
  kind: 'buckets',
  buckets: [
    { key: 'jdoe', value: 900, docCount: 900 },
    { key: 'comma', value: 12, docCount: 12 },
  ],
};

describe('RankedListComponent export', () => {
  let capture: DownloadCapture;

  beforeEach(() => (capture = captureDownloads()));
  afterEach(() => capture.restore());

  function render(
    labels = new Map<string, string>(),
    data: WidgetData | undefined = DATA,
  ): ComponentFixture<RankedListComponent> {
    const fixture = TestBed.createComponent(RankedListComponent);
    fixture.componentRef.setInput('config', CONFIG);
    fixture.componentRef.setInput('data', data);
    fixture.componentRef.setInput('labels', labels);
    fixture.detectChanges();
    return fixture;
  }

  function csvButton(fixture: ComponentFixture<RankedListComponent>): HTMLButtonElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector(
      'button[aria-label="Download Top Contributors as CSV"]',
    );
  }

  it('writes the resolved label beside the raw key', async () => {
    const fixture = render(new Map([['jdoe', 'Jane Doe']]));

    csvButton(fixture)!.click();

    expect(capture.files[0].filename).toBe('top-contributors.csv');
    expect(await textOf(capture.files[0])).toBe(
      'key,label,value,documents\r\njdoe,Jane Doe,900,900\r\ncomma,comma,12,12',
    );
  });

  /*
   * The whole reason the escaping is tested on its own: a name containing a comma shifts every
   * column after it, and the file still opens.
   */
  it('quotes a label that would otherwise shift the columns', async () => {
    const fixture = render(new Map([['comma', 'Smith, John']]));

    csvButton(fixture)!.click();

    expect(await textOf(capture.files[0])).toContain('comma,"Smith, John",12,12');
  });

  /*
   * Asserted on the bytes, because no reading of the text can see this: `Blob.text()` runs the
   * UTF-8 decode algorithm, which strips a leading byte order mark by definition. And the mark is
   * what keeps Excel from reading UTF-8 as the local single byte encoding, which turns every
   * accent and em dash on these dashboards into mojibake on the machines most likely to open it.
   */
  it('starts the file with a byte order mark, for Excel', async () => {
    const fixture = render();

    csvButton(fixture)!.click();

    const bytes = new Uint8Array(await capture.files[0].blob!.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  /** A file describing nothing is worse than no file, so the action is not offered. */
  it('offers no export while there is nothing to write', () => {
    expect(csvButton(render(new Map(), { kind: 'buckets', buckets: [] }))).toBeNull();
  });

  it('offers no PNG, there being no canvas to ask one of', () => {
    const fixture = render();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('button[aria-label*="as PNG"]'),
    ).toBeNull();
  });
});
