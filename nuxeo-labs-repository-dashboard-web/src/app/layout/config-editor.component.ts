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

/**
 * Edits the JSON a dashboard is described by.
 *
 * A text area rather than a form. Every shape the configuration accepts is already a closed union
 * in `dashboard-config.model.ts`, so a form would be a second, hand maintained description of the
 * same grammar — one that drifts the first time a widget type is added. What the editor owes the
 * reader instead is a refusal to save something that cannot render, and a reason.
 */
@Component({
  selector: 'nxd-config-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dialog class="nxd-dialog w-[56rem] max-w-[94vw]" (close)="closed.emit()">
      <div class="flex max-h-[85vh] flex-col">
        <header class="border-b border-subtle px-5 py-4">
          <h2 class="text-sm font-semibold text-ink">Edit this dashboard</h2>
          <p class="mt-1 text-xs text-ink-muted">
            Saved in this browser only, so a colleague opening the same page sees what ships.
            Refresh restores the edit; "Use the shipped one" discards it for good.
          </p>
        </header>

        <div class="min-h-0 flex-1 overflow-auto p-5">
          <textarea
            class="nxd-code-area"
            spellcheck="false"
            rows="22"
            [value]="draft()"
            (input)="onInput($event)"
          ></textarea>

          @if (problems().length) {
            <div class="mt-3 rounded border border-danger-soft bg-danger-soft p-3">
              <p class="text-xs font-semibold text-danger">
                This configuration cannot be rendered:
              </p>
              <ul class="mt-1 list-disc space-y-0.5 pl-5 text-xs text-danger">
                @for (problem of problems(); track problem) {
                  <li>{{ problem }}</li>
                }
              </ul>
            </div>
          } @else if (dirty()) {
            <p class="mt-3 text-xs text-ink-muted">Ready to save.</p>
          }
        </div>

        <footer class="flex items-center justify-between gap-3 border-t border-subtle px-5 py-4">
          <button
            type="button"
            class="text-xs font-medium text-ink-muted underline hover:text-ink"
            [disabled]="!overridden()"
            (click)="reverted.emit()"
          >
            Use the shipped one
          </button>
          <div class="flex items-center gap-2">
            <button type="button" class="nxd-button-ghost" (click)="closed.emit()">Cancel</button>
            <button
              type="button"
              class="nxd-button"
              [disabled]="problems().length > 0 || !dirty()"
              (click)="saved.emit(draft())"
            >
              Save
            </button>
          </div>
        </footer>
      </div>
    </dialog>
  `,
})
export class ConfigEditorComponent {
  /** The configuration in force, pretty printed, which is what the editor opens on. */
  readonly source = input('');
  readonly open = input(false);
  /** True when an edit is already in force, which is what makes reverting meaningful. */
  readonly overridden = input(false);
  /** Result of validating the current draft, recomputed by the page as it is typed. */
  readonly problems = input<string[]>([]);

  readonly closed = output<void>();
  readonly saved = output<string>();
  readonly reverted = output<void>();
  readonly edited = output<string>();

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  readonly draft = signal('');

  readonly dirty = computed(() => this.draft().trim() !== this.source().trim());

  constructor() {
    effect(() => {
      const element = this.dialog().nativeElement;
      if (this.open()) {
        // Reopening discards an abandoned draft: the dialog always starts from what is in force.
        this.draft.set(this.source());
        if (!element.open) {
          element.showModal();
        }
      } else if (element.open) {
        element.close();
      }
    });
  }

  protected onInput(event: Event): void {
    const text = (event.target as HTMLTextAreaElement).value;
    this.draft.set(text);
    this.edited.emit(text);
  }
}
