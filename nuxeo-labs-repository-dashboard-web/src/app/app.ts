import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { PreflightService } from './core/preflight.service';
import { ShellComponent } from './layout/shell.component';
import { DiagnosticsPageComponent } from './pages/diagnostics-page.component';

type BootState = 'checking' | 'ready' | 'blocked';

/**
 * Root component.
 *
 * Runs the preflight checks before anything else: rendering a dashboard against a server whose
 * OpenSearch passthrough is disabled would only produce a wall of failed widgets, so the blocking
 * prerequisites are surfaced up front with their remediation.
 */
@Component({
  selector: 'nxd-root',
  imports: [ShellComponent, DiagnosticsPageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (state()) {
      @case ('checking') {
        <div class="flex h-screen items-center justify-center bg-canvas">
          <div class="flex flex-col items-center gap-3 text-ink-muted">
            <svg
              viewBox="0 0 24 24"
              class="h-6 w-6 animate-spin"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <path d="M20 11a8 8 0 1 0-2.3 5.7" />
            </svg>
            <p class="text-sm">Checking server prerequisites…</p>
          </div>
        </div>
      }
      @case ('ready') {
        <nxd-shell />
      }
      @case ('blocked') {
        <div class="min-h-screen bg-canvas">
          <div class="mx-auto max-w-3xl">
            <nxd-diagnostics-page />
          </div>
        </div>
      }
    }
  `,
})
export class App {
  private readonly preflight = inject(PreflightService);

  readonly state = signal<BootState>('checking');

  constructor() {
    void this.boot();
  }

  private async boot(): Promise<void> {
    await this.preflight.run();
    this.state.set(this.preflight.isReady() ? 'ready' : 'blocked');
  }
}
