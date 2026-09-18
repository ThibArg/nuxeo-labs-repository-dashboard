import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  GroupSelection,
  SELECT_ALL,
  TermsGroupConfig,
  TermsSelection,
} from '../config/dashboard-config.model';
import { describeTermsGroup } from '../engine/facet-clause';
import { GroupValues } from '../engine/facet-values.service';
import { FacetPanelComponent } from './facet-panel.component';

/**
 * Modal editor for a filter group.
 *
 * A native `<dialog>` is used rather than a component library: the browser already provides the
 * backdrop, Escape handling and focus trapping, and the alternative would pull in a UI toolkit
 * for a single screen.
 *
 * Changes are applied on confirmation. Selecting five document types would otherwise trigger five
 * useless reloads of the whole dashboard.
 */
@Component({
  selector: 'nxd-facet-group-dialog',
  imports: [FacetPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog
      #dialog
      class="w-[min(64rem,92vw)] rounded-xl border border-border bg-surface p-0 text-ink backdrop:bg-black/30"
      (close)="dismiss()"
    >
      <form method="dialog" class="flex max-h-[80vh] flex-col">
        <header class="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 class="text-lg font-semibold">{{ group().label }}</h2>
          <button
            type="button"
            class="rounded p-1 text-ink-muted hover:bg-canvas hover:text-ink"
            aria-label="Close"
            (click)="cancel()"
          >
            <svg
              viewBox="0 0 24 24"
              class="h-5 w-5"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div class="min-h-0 flex-1 overflow-hidden px-6 py-5">
          <div class="flex min-h-0 flex-col gap-4 md:h-[22rem] md:flex-row md:items-stretch">
            @for (member of group().members; track member.id; let last = $last) {
              <nxd-facet-panel
                [member]="member"
                [values]="valuesOf(member.id)"
                [labels]="labelsOf(member.id)"
                [selection]="selectionOf(member.id)"
                [truncated]="truncatedOf(member.id)"
                (selectionChange)="update(member.id, $event)"
              />
              @if (!last) {
                <div class="flex items-center justify-center md:flex-col">
                  <span class="hidden w-px flex-1 bg-border md:block"></span>
                  <span
                    class="my-2 rounded-full border border-border bg-canvas px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-ink-muted"
                  >
                    {{ joiner() }}
                  </span>
                  <span class="hidden w-px flex-1 bg-border md:block"></span>
                </div>
              }
            }
          </div>

          <p class="mt-4 text-xs text-ink-subtle">
            Alt-click a checkbox to apply it to every value in that list.
          </p>
        </div>

        <footer class="border-t border-border px-6 py-4">
          <p class="mb-3 text-sm text-ink">{{ summary() }}</p>
          <div class="flex items-center justify-end gap-3">
            @if (!anySelected()) {
              <span class="mr-auto text-sm text-danger">Select at least one value.</span>
            }
            <button type="button" class="nxd-toolbar-button" (click)="cancel()">Cancel</button>
            <button
              type="button"
              class="nxd-toolbar-button border-accent bg-accent-soft text-accent"
              [disabled]="!anySelected()"
              (click)="apply()"
            >
              Apply
            </button>
          </div>
        </footer>
      </form>
    </dialog>
  `,
})
export class FacetGroupDialogComponent {
  readonly group = input.required<TermsGroupConfig>();
  readonly values = input<GroupValues>(new Map());
  /** Member id to (raw value -> label). */
  readonly labels = input<Map<string, Map<string, string>>>(new Map());
  readonly selection = input.required<GroupSelection>();
  readonly open = input(false);

  readonly applied = output<GroupSelection>();
  readonly closed = output<void>();

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  /** Working copy, discarded on Cancel. */
  private readonly draft = signal<GroupSelection>({});

  constructor() {
    effect(() => {
      const element = this.dialog().nativeElement;
      if (this.open()) {
        this.draft.set({ ...this.selection() });
        if (!element.open) {
          element.showModal();
        }
      } else if (element.open) {
        element.close();
      }
    });
  }

  readonly joiner = computed(() => (this.group().combine === 'and' ? 'and' : 'or'));

  /** At least one member must keep a value, otherwise the dashboard would show nothing at all. */
  readonly anySelected = computed(() =>
    this.group().members.some((member) => {
      const selection = this.draft()[member.id] ?? SELECT_ALL;
      return selection.mode === 'all' || selection.values.length > 0;
    }),
  );

  readonly summary = computed(() => describeTermsGroup(this.group(), this.draft(), this.labels()));

  protected valuesOf(memberId: string) {
    return this.values().get(memberId)?.values ?? [];
  }

  protected truncatedOf(memberId: string): boolean {
    return this.values().get(memberId)?.truncated ?? false;
  }

  protected labelsOf(memberId: string): Map<string, string> {
    return this.labels().get(memberId) ?? new Map();
  }

  protected selectionOf(memberId: string): TermsSelection {
    return this.draft()[memberId] ?? SELECT_ALL;
  }

  protected update(memberId: string, selection: TermsSelection): void {
    this.draft.update((current) => ({ ...current, [memberId]: selection }));
  }

  protected apply(): void {
    if (this.anySelected()) {
      this.applied.emit(this.draft());
    }
  }

  protected cancel(): void {
    this.closed.emit();
  }

  /** Fired by Escape and by the backdrop, which bypass the buttons. */
  protected dismiss(): void {
    this.closed.emit();
  }
}
