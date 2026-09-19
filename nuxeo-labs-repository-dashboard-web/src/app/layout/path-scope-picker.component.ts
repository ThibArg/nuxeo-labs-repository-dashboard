import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';
import { Container } from '../engine/path-browser.service';

export interface Crumb {
  label: string;
  path: string;
}

/**
 * Chooses the container every figure is restricted to.
 *
 * Browsing rather than typing, because a path is only obvious to whoever created it: an
 * administrator reading somebody else's repository knows what they are looking for by its title,
 * not by its `ecm:name`. The trail doubles as the way back up, so no separate control is needed.
 */
@Component({
  selector: 'nxd-path-scope-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="nxd-toolbar-button"
      [class.border-accent]="!!selected()"
      [class.text-accent]="!!selected()"
      [disabled]="disabled()"
      (click)="opened.emit()"
    >
      <svg
        viewBox="0 0 24 24"
        class="h-4 w-4"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H3V7Z" />
      </svg>
      {{ buttonLabel() }}
    </button>

    <dialog
      #dialog
      class="nxd-dialog w-[32rem] max-w-[92vw]"
      (close)="closed.emit()"
      (click)="onBackdrop($event)"
    >
      <div class="flex flex-col gap-4 p-5">
        <div>
          <h2 class="text-sm font-semibold text-ink">{{ label() }}</h2>
          <p class="mt-1 text-xs text-ink-muted">
            Every figure on the page describes this container and everything inside it.
          </p>
        </div>

        <nav class="flex flex-wrap items-center gap-1 text-xs" aria-label="Container trail">
          @for (crumb of trail(); track crumb.path; let last = $last) {
            <button
              type="button"
              class="rounded px-1.5 py-0.5 text-accent hover:bg-accent-soft"
              [disabled]="last"
              [class.text-ink-muted]="last"
              (click)="browse.emit(crumb.path)"
            >
              {{ crumb.label }}
            </button>
            @if (!last) {
              <span class="text-ink-subtle" aria-hidden="true">/</span>
            }
          }
        </nav>

        <ul class="max-h-64 overflow-y-auto rounded border border-subtle">
          @for (container of containers(); track container.id) {
            <li class="border-b border-border/60 last:border-0">
              <div class="flex items-center justify-between gap-2 px-3 py-2">
                <button
                  type="button"
                  class="min-w-0 flex-1 truncate text-left text-sm text-ink hover:text-accent"
                  [title]="container.path"
                  (click)="browse.emit(container.path)"
                >
                  {{ container.title }}
                </button>
                <button
                  type="button"
                  class="shrink-0 rounded border border-subtle px-2 py-0.5 text-xs text-ink-muted hover:border-accent hover:text-accent"
                  (click)="applied.emit(container.path)"
                >
                  Use
                </button>
              </div>
            </li>
          } @empty {
            <li class="px-3 py-6 text-center text-sm text-ink-muted">
              @if (loading()) {
                Loading…
              } @else {
                Nothing inside this container.
              }
            </li>
          }
        </ul>

        <div class="flex items-center justify-between gap-3">
          <button
            type="button"
            class="text-xs font-medium text-ink-muted underline hover:text-ink"
            (click)="applied.emit(null)"
          >
            Whole repository
          </button>
          <div class="flex items-center gap-2">
            <button type="button" class="nxd-button-ghost" (click)="closed.emit()">Cancel</button>
            <button type="button" class="nxd-button" (click)="applied.emit(current())">
              Use this one
            </button>
          </div>
        </div>
      </div>
    </dialog>
  `,
})
export class PathScopePickerComponent {
  readonly label = input('Location');
  /** Container currently browsed, which is what the trail describes. */
  readonly current = input.required<string>();
  /** Container the figures are restricted to, or null for the whole repository. */
  readonly selected = input<string | null>(null);
  readonly containers = input<Container[]>([]);
  readonly open = input(false);
  readonly loading = input(false);
  readonly disabled = input(false);

  readonly opened = output<void>();
  readonly closed = output<void>();
  readonly browse = output<string>();
  /** Chosen container, or null to describe the whole repository again. */
  readonly applied = output<string | null>();

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    effect(() => {
      const element = this.dialog().nativeElement;
      if (this.open() && !element.open) {
        element.showModal();
      } else if (!this.open() && element.open) {
        element.close();
      }
    });
  }

  readonly buttonLabel = computed(() => {
    const path = this.selected();
    return path ? (path.split('/').filter(Boolean).pop() ?? path) : 'Whole repository';
  });

  readonly trail = computed<Crumb[]>(() => {
    const segments = this.current().split('/').filter(Boolean);
    return segments.map((segment, index) => ({
      label: segment,
      path: `/${segments.slice(0, index + 1).join('/')}`,
    }));
  });

  /** Clicking the backdrop rather than the panel closes, as a modal is expected to. */
  protected onBackdrop(event: MouseEvent): void {
    if (event.target instanceof HTMLDialogElement) {
      this.closed.emit();
    }
  }
}
