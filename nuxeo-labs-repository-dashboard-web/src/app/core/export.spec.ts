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

/**
 * A CSV export is opened in a spreadsheet — that is what it is for — and a spreadsheet evaluates
 * a cell whose text begins with `=`, `+`, `-` or `@`. The values written are index contents, so
 * anybody able to name a document can aim a formula at whoever opens the file.
 */
describe('formula injection', () => {
  it.each([
    ['an equals, the ordinary case', '=HYPERLINK("https://evil.example","OK")'],
    ['a plus', '+1+1'],
    ['an at sign', '@SUM(A1)'],
    ['a tab, which some parsers trim before the cell is read', '\t=1+1'],
  ])('neutralises %s', (_name, payload) => {
    const [line] = toCsv([[payload]]).split('\r\n');

    expect(line.startsWith("'") || line.startsWith('"\'')).toBe(true);
    expect(line).toContain(payload.trim().slice(0, 4));
  });

  /**
   * The DDE form, which older Excel builds run after a confirmation that reads like a routine
   * link warning. Worth its own case: it is the one that leaves the browser entirely.
   */
  it('neutralises the form that starts a program', () => {
    expect(toCsv([["=cmd|'/c calc'!A1"]])).toContain("'=cmd");
  });

  /**
   * The trap in the obvious fix. A figure is written as a number so that a spreadsheet can
   * compute on it — the whole reason the CSV carries 1258291 rather than "1.2 MB" — and a
   * negative one starts with a character the guard is looking for.
   */
  it('leaves a negative number a number', () => {
    expect(toCsv([['value'], [-5], [-0.25]])).toBe('value\r\n-5\r\n-0.25');
  });

  it('leaves an ordinary value untouched', () => {
    expect(toCsv([['Contract-FR.pdf', 42]])).toBe('Contract-FR.pdf,42');
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
