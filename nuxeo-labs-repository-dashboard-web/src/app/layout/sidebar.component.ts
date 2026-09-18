import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NuxeoHttpService } from '../core/nuxeo-http.service';
import { PreflightService } from '../core/preflight.service';
import { NAV_ITEMS, NavItem } from './navigation';

interface RenderedNavItem extends NavItem {
  enabled: boolean;
}

@Component({
  selector: 'nxd-sidebar',
  imports: [RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="flex h-full w-64 shrink-0 flex-col bg-sidebar text-sidebar-ink">
      <div class="flex items-center gap-3 px-5 py-5">
        <span
          class="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10"
          aria-hidden="true"
        >
          <svg
            viewBox="0 0 24 24"
            class="h-5 w-5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
          >
            <path d="M4 5a2 2 0 0 1 2-2h5l2 2h5a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5Z" />
          </svg>
        </span>
        <span class="leading-tight">
          <span class="block text-sm font-bold tracking-wide">REPOSITORY</span>
          <span class="block text-[0.65rem] tracking-[0.25em] text-sidebar-ink-muted"
            >DASHBOARD</span
          >
        </span>
      </div>

      <ul class="mt-2 flex flex-1 flex-col gap-1 px-3">
        @for (item of items(); track item.path) {
          <li>
            @if (item.enabled) {
              <a
                [routerLink]="item.path"
                routerLinkActive="bg-sidebar-active text-white"
                class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors hover:bg-sidebar-hover"
              >
                <svg
                  viewBox="0 0 24 24"
                  class="h-5 w-5 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path [attr.d]="item.icon" />
                </svg>
                {{ item.label }}
              </a>
            } @else {
              <span
                class="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-ink-muted/60"
                [title]="item.disabledHint ?? 'Unavailable on this server'"
              >
                <svg
                  viewBox="0 0 24 24"
                  class="h-5 w-5 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path [attr.d]="item.icon" />
                </svg>
                {{ item.label }}
              </span>
            }
          </li>
        }
      </ul>

      <div class="border-t border-white/10 px-5 py-4 text-xs text-sidebar-ink-muted">
        @if (userLabel(); as label) {
          <div class="truncate" [title]="label">{{ label }}</div>
        }
        <a class="mt-1 inline-block hover:text-sidebar-ink" [href]="webUiUrl">Back to Web UI</a>
      </div>
    </nav>
  `,
})
export class SidebarComponent {
  private readonly preflight = inject(PreflightService);

  readonly webUiUrl = `${inject(NuxeoHttpService).serverRoot}/ui/`;

  readonly items = computed<RenderedNavItem[]>(() => {
    const features = this.preflight.result()?.features;
    return NAV_ITEMS.map((item) => ({
      ...item,
      enabled: !item.requires || !features || features[item.requires],
    }));
  });

  readonly userLabel = computed(() => {
    const user = this.preflight.result()?.user;
    if (!user) {
      return null;
    }
    const { firstName, lastName } = user.properties;
    const fullName = [firstName, lastName].filter(Boolean).join(' ');
    return fullName || user.id;
  });
}
