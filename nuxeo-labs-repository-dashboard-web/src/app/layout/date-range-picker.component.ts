import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import {
  CUSTOM_RANGE_ID,
  DATE_RANGE_SHORTCUTS,
  DateRangeOption,
  customRange,
  resolveShortcut,
} from '../config/dashboard-config.model';

/**
 * Period selector: named shortcuts, plus the two days they resolve to.
 *
 * Picking a shortcut fills the two fields, so the reader always sees which days the figures cover.
 * Editing either field turns the selection into a typed range, which is why no shortcut stays
 * highlighted afterwards.
 */
@Component({
  selector: 'nxd-date-range-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-wrap items-center gap-3">
      <div
        class="inline-flex items-center rounded-lg border border-border bg-surface p-0.5"
        role="group"
        [attr.aria-label]="'Date range on ' + field()"
      >
        @for (shortcut of shortcuts; track shortcut.id) {
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
            [class]="
              shortcut.id === selected().id
                ? 'bg-accent-soft text-accent'
                : 'text-ink-muted hover:text-ink'
            "
            [attr.aria-pressed]="shortcut.id === selected().id"
            [disabled]="disabled()"
            (click)="rangeChange.emit(resolve(shortcut.id))"
          >
            {{ shortcut.label }}
          </button>
        }
      </div>

      <div class="inline-flex items-center gap-2 text-sm text-ink-muted">
        <label class="flex items-center gap-1.5">
          <span class="text-xs">From</span>
          <input
            type="date"
            class="nxd-date-input"
            [value]="from()"
            [max]="to() || null"
            [disabled]="disabled()"
            (change)="changeFrom($event)"
          />
        </label>
        <label class="flex items-center gap-1.5">
          <span class="text-xs">To</span>
          <input
            type="date"
            class="nxd-date-input"
            [value]="to()"
            [min]="from() || null"
            [disabled]="disabled()"
            (change)="changeTo($event)"
          />
        </label>
      </div>
    </div>
  `,
})
export class DateRangePickerComponent {
  readonly selected = input.required<DateRangeOption>();
  /** Field the range applies to, surfaced to assistive technology. */
  readonly field = input('dc:created');
  readonly disabled = input(false);

  readonly rangeChange = output<DateRangeOption>();

  protected readonly shortcuts = DATE_RANGE_SHORTCUTS;
  protected readonly customId = CUSTOM_RANGE_ID;

  protected readonly from = computed(() => this.selected().from ?? '');
  protected readonly to = computed(() => this.selected().to ?? '');

  protected resolve(id: string): DateRangeOption {
    return resolveShortcut(this.shortcuts.find((entry) => entry.id === id)!);
  }

  protected changeFrom(event: Event): void {
    this.rangeChange.emit(customRange(value(event), this.selected().to));
  }

  protected changeTo(event: Event): void {
    this.rangeChange.emit(customRange(this.selected().from, value(event)));
  }
}

/** Empty string when the field was cleared, which the model reads as "no bound". */
function value(event: Event): string | null {
  return (event.target as HTMLInputElement).value || null;
}
