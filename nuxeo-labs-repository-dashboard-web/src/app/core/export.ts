/**
 * CSV serialisation and file download, for exporting what a widget is showing.
 *
 * Kept pure and separate from the widgets so that the escaping — the part that is easy to get
 * subtly wrong and impossible to notice until a title contains a comma — is unit tested on its
 * own rather than through a component.
 */

/** Fields that force quoting, per RFC 4180 plus the carriage return Excel writes. */
const NEEDS_QUOTES = /[",\r\n]/;

/**
 * Leading characters a spreadsheet reads as the start of a formula.
 *
 * Excel, LibreOffice Calc and Google Sheets all evaluate a cell beginning with one of these, and
 * quoting does not prevent it: the quotes belong to the CSV grammar and are consumed before the
 * cell text is looked at. Older Excel builds also honour `=cmd|'/c …'!A1`, which runs a program
 * behind a confirmation that reads like a routine link warning.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * Neutralises a field a spreadsheet would otherwise evaluate.
 *
 * The values written here are index contents — a document title, a bucket key, a display name —
 * so anybody able to name a document can aim this at whoever opens the file. Which is an
 * administrator, on their own desktop, outside everything Nuxeo controls.
 *
 * **Numbers are left alone**, and that is not an oversight: a figure is written as a number
 * precisely so a spreadsheet can compute on it, and prefixing a negative one would turn -5 into
 * text. The guard applies to what arrives as text, which is where a title can hide.
 */
function escapeField(value: unknown): string {
  if (typeof value === 'number') {
    return String(value);
  }
  const raw = value === null || value === undefined ? '' : String(value);
  // A leading apostrophe is what every spreadsheet reads as "this cell is text".
  const text = FORMULA_LEAD.test(raw) ? `'${raw}` : raw;
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * Serialises rows, the first of which is the header.
 *
 * `\r\n` rather than `\n`: RFC 4180 says so, and it is what keeps older Excel builds from reading
 * the whole file as a single line.
 */
export function toCsv(rows: unknown[][]): string {
  return rows.map((row) => row.map(escapeField).join(',')).join('\r\n');
}

/**
 * Byte order mark, without which Excel reads UTF-8 as the local single byte encoding.
 *
 * Every label on these dashboards can carry an accent or an em dash, so a file written without it
 * opens as mojibake on the machines most likely to open it.
 */
const BOM = '\uFEFF';

/** Turns a name into one a file system accepts, keeping it recognisable. */
export function safeFilename(...parts: string[]): string {
  return parts
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Hands a file to the browser.
 *
 * An anchor with `download` rather than a navigation: a data or blob URL opened in the tab would
 * replace the dashboard, and the reader would lose every filter they had set to get here.
 */
export function downloadFile(filename: string, mime: string, content: Blob | string): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Freed on the next task so the click has certainly been handled.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadCsv(filename: string, rows: unknown[][]): void {
  downloadFile(filename, 'text/csv;charset=utf-8', BOM + toCsv(rows));
}

/** Writes a PNG given as a data URL, which is what ECharts hands back. */
export function downloadDataUrl(filename: string, dataUrl: string): void {
  const anchor = document.createElement('a');
  anchor.href = dataUrl;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
