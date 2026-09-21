import { Directive, ElementRef, inject } from '@angular/core';
import { DashboardSession } from '../engine/dashboard-session.service';

/**
 * Marks the element the HTML export clones.
 *
 * A view query would not do: only the page knows which part of its markup is the dashboard and
 * which is chrome, and on a bespoke layout that boundary is wherever its author drew it. Putting
 * it on the element rather than in a service call also makes it impossible to forget in a way
 * that shows up as an export of the wrong thing.
 */
@Directive({ selector: '[nxdExportRoot]' })
export class ExportRootDirective {
  constructor() {
    const session = inject(DashboardSession);
    const element = inject(ElementRef).nativeElement as Element;
    session.registerExportRoot(element);
  }
}
