import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DashboardSession } from '../engine/dashboard-session.service';
import { ConfigEditorComponent } from './config-editor.component';
import { PageHeaderComponent } from './page-header.component';

/**
 * The title bar of a dashboard, with the editor it opens.
 *
 * `PageHeaderComponent` stays a dumb component, since Diagnostics uses it with no dashboard behind
 * it at all. This wires it to the session, and carries the configuration editor with it so that
 * Configure works on a bespoke page without that page knowing what an override is.
 */
@Component({
  selector: 'nxd-dashboard-header',
  imports: [ConfigEditorComponent, PageHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nxd-page-header
      [title]="session.config()?.label ?? 'Dashboard'"
      [subtitle]="session.subtitle()"
      [busy]="session.runner.loading()"
      [configurable]="!!session.config()"
      [overridden]="session.overridden()"
      [exportable]="!!session.config() && !session.runner.loading()"
      (refresh)="session.reload()"
      (configure)="session.openEditor()"
      (exportHtml)="session.exportHtml()"
      (print)="session.print()"
    />

    <nxd-config-editor
      [source]="session.editorSource()"
      [open]="session.editorOpen()"
      [overridden]="session.overridden()"
      [problems]="session.editorProblems()"
      (edited)="session.validateDraft($event)"
      (saved)="session.saveConfig($event)"
      (reverted)="session.revertConfig()"
      (closed)="session.closeEditor()"
    />
  `,
})
export class DashboardHeaderComponent {
  protected readonly session = inject(DashboardSession);
}
