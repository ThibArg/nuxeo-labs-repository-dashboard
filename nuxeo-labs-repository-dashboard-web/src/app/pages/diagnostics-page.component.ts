import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { PreflightService } from '../core/preflight.service';
import { PageHeaderComponent } from '../layout/page-header.component';

/**
 * Renders the preflight report.
 *
 * Doubles as the blocking error screen: when a mandatory check fails the application router is
 * bypassed and this page is shown standalone, so it must be readable without the shell.
 */
@Component({
  selector: 'nxd-diagnostics-page',
  imports: [PageHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nxd-page-header
      title="Diagnostics"
      subtitle="Server prerequisites required by the dashboard"
      [busy]="preflight.isRunning()"
      (refresh)="rerun()"
    />

    <section class="px-8 pb-8">
      @if (preflight.result(); as result) {
        @if (result.capabilities?.server; as server) {
          <p class="mb-4 text-sm text-ink-muted">
            {{ server.distributionName }} {{ server.distributionVersion }}
            @if (server.hotfixVersion) {
              <span>&nbsp;· hotfix {{ server.hotfixVersion }}</span>
            }
          </p>
        }

        <ul class="flex flex-col gap-3">
          @for (check of result.checks; track check.id) {
            <li class="nxd-card flex items-start gap-4 p-4">
              <span
                class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                [class]="badgeClass(check.status)"
                [attr.aria-label]="check.status"
              >
                {{ badgeGlyph(check.status) }}
              </span>

              <div class="min-w-0 flex-1">
                <p class="text-sm font-semibold text-ink">
                  {{ check.label }}
                  @if (!check.blocking) {
                    <span
                      class="ml-2 rounded bg-canvas px-1.5 py-0.5 text-xs font-normal text-ink-subtle"
                    >
                      optional
                    </span>
                  }
                </p>
                @if (check.detail) {
                  <p class="mt-1 break-words text-sm text-ink-muted">{{ check.detail }}</p>
                }
                @if (check.remedy && check.status !== 'ok') {
                  <p class="mt-2 rounded-md bg-canvas p-3 text-sm text-ink">{{ check.remedy }}</p>
                }
              </div>
            </li>
          }
        </ul>
      } @else {
        <p class="text-sm text-ink-muted">Running checks…</p>
      }
    </section>
  `,
})
export class DiagnosticsPageComponent {
  readonly preflight = inject(PreflightService);

  rerun(): void {
    void this.preflight.run();
  }

  badgeClass(status: string): string {
    switch (status) {
      case 'ok':
        return 'bg-success';
      case 'warning':
        return 'bg-warning';
      case 'failed':
        return 'bg-danger';
      default:
        return 'bg-ink-subtle';
    }
  }

  badgeGlyph(status: string): string {
    switch (status) {
      case 'ok':
        return '✓';
      case 'warning':
        return '!';
      case 'failed':
        return '✕';
      default:
        return '·';
    }
  }
}
