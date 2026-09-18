/*
 * Turns the Angular build output `index.html` into a Nuxeo `index.jsp`.
 *
 * Two things happen:
 *  - `<base href="/">` becomes a JSP expression reading the `app.base.url` Nuxeo property,
 *    so the deployment path stays configurable at runtime (useful behind a reverse proxy);
 *  - a JSP page directive importing `Framework` is prepended.
 *
 * The source `src/index.html` keeps `<base href="/">` so that `ng serve` works untouched.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const BROWSER_DIR = resolve(process.cwd(), 'dist/nuxeo-labs-repository-dashboard/browser');
const SOURCE = resolve(BROWSER_DIR, 'index.html');
const TARGET = resolve(BROWSER_DIR, 'index.jsp');

const DEFAULT_BASE_URL = '/nuxeo/dashboard/';
const BASE_PATTERN = /<base\s+href="\/"\s*\/?>/g;
const BASE_EXPRESSION = `<base href="<%=Framework.getProperty("app.base.url","${DEFAULT_BASE_URL}")%>">`;
const PAGE_DIRECTIVE = '<%@ page import="org.nuxeo.runtime.api.Framework"%>';

try {
  const html = await readFile(SOURCE, 'utf8');

  const matches = html.match(BASE_PATTERN) ?? [];
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one '<base href="/">' in ${SOURCE}, found ${matches.length}. ` +
        'Check src/index.html.'
    );
  }

  /*
   * Jasper would choke on any other JSP scriptlet delimiter reaching the output, which can happen
   * if a build step inlines third party content. Fail loudly rather than at deployment time.
   */
  if (html.includes('<%')) {
    throw new Error(
      `${SOURCE} already contains a '<%' sequence, which Jasper would try to interpret. ` +
        'Disable critical CSS inlining or remove the offending content.'
    );
  }

  const withBase = html.replace(BASE_PATTERN, BASE_EXPRESSION);
  await writeFile(TARGET, `${PAGE_DIRECTIVE}\n${withBase}`, 'utf8');

  console.log(`[nuxeo:jsp] wrote ${TARGET}`);
} catch (error) {
  console.error(`[nuxeo:jsp] failed: ${error.message}`);
  process.exitCode = 1;
}
