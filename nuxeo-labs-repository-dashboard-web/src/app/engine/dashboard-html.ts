/**
 * Builds a standalone HTML copy of a dashboard.
 *
 * The live grid is cloned rather than re-rendered. Re-implementing each widget would be a second
 * description of how a KPI, a ranked list and a table look, drifting from the first the moment a
 * widget type is added — the same argument that keeps the configuration editor a text area. What
 * the clone cannot carry is the charts: a canvas copies as a blank one, so each is swapped for the
 * PNG its component photographed.
 *
 * The result depends on no external file: the application's own stylesheet is inlined, and the
 * images are data URLs. It opens from a mail attachment, and a browser showing it can be copied
 * into a wiki with the charts intact.
 */

export interface DashboardDocument {
  title: string;
  subtitle: string | null;
  /** What the figures were filtered by, one phrase per constraint. */
  context: string[];
  /** Widget id to PNG data URL. */
  images: Map<string, string>;
  /** The application stylesheet, inlined so the file stands alone. */
  css: string;
  generatedAt: Date;
}

/** Elements that make no sense in a snapshot: they act on a page that is no longer there. */
const INTERACTIVE = 'button, dialog, input, select, textarea';

export function buildDashboardHtml(grid: Element, document: DashboardDocument): string {
  const clone = grid.cloneNode(true) as Element;

  for (const [widgetId, url] of document.images) {
    const cell = clone.querySelector(`[data-widget-id="${cssEscape(widgetId)}"]`);
    const canvas = cell?.querySelector('canvas');
    if (canvas) {
      canvas.replaceWith(imageFor(canvas, url));
    }
  }

  // A canvas no chart could photograph would otherwise serialise as a blank rectangle.
  clone.querySelectorAll('canvas').forEach((canvas) => canvas.remove());
  clone.querySelectorAll(INTERACTIVE).forEach((element) => element.remove());

  return document_(clone.outerHTML, document);
}

function imageFor(canvas: HTMLCanvasElement, url: string): HTMLImageElement {
  const image = canvas.ownerDocument.createElement('img');
  image.src = url;
  image.alt = '';
  image.style.width = '100%';
  image.style.height = 'auto';
  return image;
}

/** `CSS.escape` is not in jsdom, and a widget id is an identifier anyway. */
function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function document_(body: string, document: DashboardDocument): string {
  const context = document.context.length
    ? `<ul class="nxd-export-context">${document.context
        .map((line) => `<li>${escapeHtml(line)}</li>`)
        .join('')}</ul>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(document.title)}</title>
<style>${document.css}</style>
<style>
  body { padding: 2rem; }
  .nxd-export-header { margin-bottom: 1.5rem; }
  .nxd-export-context { margin: 0.75rem 0 0; padding-left: 1.1rem; font-size: 0.8rem; }
  .nxd-export-context li { margin-top: 0.15rem; }
  .nxd-export-stamp { margin-top: 0.75rem; font-size: 0.75rem; }
</style>
</head>
<body class="bg-canvas text-ink">
<header class="nxd-export-header">
  <h1 class="text-2xl font-semibold tracking-tight text-ink">${escapeHtml(document.title)}</h1>
  ${document.subtitle ? `<p class="mt-1 text-sm text-ink-muted">${escapeHtml(document.subtitle)}</p>` : ''}
  ${context}
  <p class="nxd-export-stamp text-ink-subtle">Exported ${escapeHtml(document.generatedAt.toLocaleString())}</p>
</header>
${body}
</body>
</html>
`;
}
