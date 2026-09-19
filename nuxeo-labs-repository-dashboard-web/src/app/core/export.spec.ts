import { safeFilename, toCsv } from './export';

describe('toCsv', () => {
  it('writes a header and its rows', () => {
    expect(
      toCsv([
        ['key', 'value'],
        ['File', 3000],
      ]),
    ).toBe('key,value\r\nFile,3000');
  });

  /*
   * The case that makes an export silently wrong rather than visibly broken: a title containing a
   * comma shifts every column after it by one, and the file still opens.
   */
  it('quotes a field containing a comma', () => {
    expect(toCsv([['Smith, John']])).toBe('"Smith, John"');
  });

  it('doubles a quote inside a quoted field', () => {
    expect(toCsv([['He said "no"']])).toBe('"He said ""no"""');
  });

  it('quotes a field containing a line break', () => {
    expect(toCsv([['two\nlines']])).toBe('"two\nlines"');
  });

  it('writes an empty cell for a missing value', () => {
    expect(toCsv([['a', null, undefined, '']])).toBe('a,,,');
  });

  /** RFC 4180, and what keeps older Excel builds from reading the file as a single line. */
  it('separates rows with a carriage return and a line feed', () => {
    expect(toCsv([['a'], ['b']])).toBe('a\r\nb');
  });
});

describe('safeFilename', () => {
  it('turns a widget label into a name a file system accepts', () => {
    expect(safeFilename('By Document Type')).toBe('by-document-type');
  });

  it('keeps an em dash or an accent from reaching the file system', () => {
    expect(safeFilename('Fixture — Invoices (5 days)')).toBe('fixture-invoices-5-days');
  });

  it('leaves no leading or trailing separator', () => {
    expect(safeFilename('— Records —')).toBe('records');
  });

  it('joins the parts it is given', () => {
    expect(safeFilename('content', 'By Type')).toBe('content-by-type');
  });
});
