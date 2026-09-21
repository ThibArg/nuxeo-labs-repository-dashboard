import { describe, expect, it } from 'vitest';
import { NAV_ITEMS } from './navigation';
import { routes } from '../app.routes';

/**
 * The sidebar and the router have to agree, and nothing else makes them.
 *
 * `NAV_ITEMS` is a plain list read by `sidebar.component.ts` and by nothing that could notice a
 * path the router does not serve. The failure is the quietest kind: `app.routes.ts` ends with
 * `{ path: '**', redirectTo: 'content' }`, so an entry left behind after a screen is removed does
 * not 404 and does not log — the reader clicks "Governance" and lands on Content, and concludes
 * the dashboard is broken rather than that it is gone.
 *
 * The other direction matters too. A screen reachable only by typing its URL is a screen nobody
 * will find.
 */
const DECLARED = routes
  .filter((route) => route.component)
  .map((route) => route.path)
  .filter((path): path is string => typeof path === 'string');

describe('the sidebar and the router', () => {
  it('serves every entry the sidebar offers', () => {
    const offered = NAV_ITEMS.map((item) => item.path.replace(/^\//, ''));

    expect(offered).not.toHaveLength(0);
    expect(offered.filter((path) => !DECLARED.includes(path))).toEqual([]);
  });

  it('offers every screen the router serves', () => {
    expect(DECLARED.filter((path) => !NAV_ITEMS.some((item) => item.path === `/${path}`))).toEqual(
      [],
    );
  });

  /**
   * Deliberately *not* asserted: that a nav entry and its route require the same feature. They
   * answer different questions. `requires` on an entry greys it out; `requires` on a route makes
   * the page name what is missing. Users declares the second and not the first, on purpose — a
   * disabled menu entry cannot tell the reader which package to install.
   */
  it('names every entry and gives it an icon', () => {
    for (const item of NAV_ITEMS) {
      expect(item.label.trim(), item.path).not.toBe('');
      expect(item.icon.trim(), item.path).not.toBe('');
    }
  });
});
