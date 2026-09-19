import { buildDashboardHtml } from './dashboard-html';

/** A grid shaped like the real one: cells named by widget id, charts drawn on a canvas. */
function grid(): Element {
  const element = document.createElement('div');
  element.innerHTML = `
    <div class="nxd-grid">
      <div data-widget-id="totalAll"><section class="nxd-card"><h2>Total</h2><p>4821</p></section></div>
      <div data-widget-id="byType"><section class="nxd-card"><h2>By Type</h2><canvas></canvas></section></div>
      <div data-widget-id="byState"><section class="nxd-card"><h2>By State</h2><canvas></canvas></section></div>
    </div>`;
  return element;
}

function document_(overrides: Partial<Parameters<typeof buildDashboardHtml>[1]> = {}) {
  return {
    title: 'Content Dashboard',
    subtitle: null,
    context: [],
    images: new Map<string, string>(),
    css: '.nxd-card { border: 1px solid red }',
    generatedAt: new Date('2026-09-19T18:00:00Z'),
    ...overrides,
  };
}

describe('buildDashboardHtml', () => {
  it('stands alone: no link, no script, the stylesheet inlined', () => {
    const html = buildDashboardHtml(grid(), document_());

    expect(html).toContain('<style>.nxd-card { border: 1px solid red }</style>');
    expect(html).not.toContain('<link');
    expect(html).not.toContain('<script');
  });

  it('keeps the widgets that are already HTML', () => {
    const html = buildDashboardHtml(grid(), document_());

    expect(html).toContain('Total');
    expect(html).toContain('4821');
  });

  /*
   * A canvas clones as a blank rectangle, which is why the images come from the live components
   * rather than from the copy. Swapping in the photograph is what makes a chart survive the trip.
   */
  it('replaces a chart canvas with the image of it', () => {
    const html = buildDashboardHtml(
      grid(),
      document_({ images: new Map([['byType', 'data:image/png;base64,AAAA']]) }),
    );

    expect(html).toContain('<img src="data:image/png;base64,AAAA"');
    expect(html).not.toContain('<canvas');
  });

  /** A chart that could not be photographed would otherwise print as an empty white box. */
  it('drops a canvas no image was captured for', () => {
    const html = buildDashboardHtml(
      grid(),
      document_({ images: new Map([['byType', 'data:image/png;base64,AAAA']]) }),
    );

    expect(html).toContain('By State');
    expect((html.match(/<img/g) ?? []).length).toBe(1);
  });

  it('leaves out the controls, which act on a page that is no longer there', () => {
    const source = grid();
    source.querySelector('[data-widget-id="totalAll"]')!.innerHTML +=
      '<button>Download</button><dialog>editor</dialog>';

    const html = buildDashboardHtml(source, document_());

    expect(html).not.toContain('<button');
    expect(html).not.toContain('<dialog');
  });

  /*
   * The whole point of the context block: a file showing 675 documents says nothing a week later
   * unless it also says which 675 were counted.
   */
  it('writes out what the figures were filtered by', () => {
    const html = buildDashboardHtml(
      grid(),
      document_({ context: ['Period: Last 30 days on dc:created', 'Location: /default-domain'] }),
    );

    expect(html).toContain('Period: Last 30 days on dc:created');
    expect(html).toContain('Location: /default-domain');
  });

  it('says when it was taken, the figures having moved on since', () => {
    const html = buildDashboardHtml(grid(), document_());

    expect(html).toContain('Exported');
  });

  it('escapes a title rather than letting it close the tag', () => {
    const html = buildDashboardHtml(grid(), document_({ title: 'A <b>bold</b> "one"' }));

    expect(html).toContain('A &lt;b&gt;bold&lt;/b&gt; &quot;one&quot;');
    expect(html).not.toContain('<b>bold</b>');
  });

  it('is left readable when the stylesheet could not be read', () => {
    const html = buildDashboardHtml(grid(), document_({ css: '' }));

    expect(html).toContain('4821');
  });
});
