import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

/**
 * Fetches the application's own stylesheet, so an exported page can carry it.
 *
 * The build emits a hashed `styles-*.css` and links it from `index.html`; the link is read rather
 * than the name guessed, the hash changing at every build. It is same origin, so no credential and
 * no CORS question arises.
 *
 * A failure yields an empty string rather than an error: an export with no styling is a poor file
 * but still a readable one, and refusing to export because a stylesheet moved would be worse.
 */
@Injectable({ providedIn: 'root' })
export class AppStylesService {
  private readonly document = inject(DOCUMENT);
  private cached: Promise<string> | null = null;

  load(): Promise<string> {
    this.cached ??= this.fetchAll();
    return this.cached;
  }

  private async fetchAll(): Promise<string> {
    const links = [...this.document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')];
    const sheets = await Promise.all(links.map((link) => this.fetchOne(link.href)));
    return sheets.filter(Boolean).join('\n');
  }

  private async fetchOne(href: string): Promise<string> {
    try {
      const response = await fetch(href, { credentials: 'same-origin' });
      return response.ok ? await response.text() : '';
    } catch {
      return '';
    }
  }
}
