import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DATE_RANGE_OPTIONS, DateRangeOption } from '../config/dashboard-config.model';

/** Segmented control selecting the global date range. */
@Component({
  selector: 'nxd-date-range-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="inline-flex items-center rounded-lg border border-border bg-surface p-0.5"
      role="group"
      [attr.aria-label]="'Date range on ' + field()"
    >
      @for (option of options; track option.id) {
        <button
          type="button"
          class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
          [class]="
            option.id === selected().id
              ? 'bg-accent-soft text-accent'
              : 'text-ink-muted hover:text-ink'
          "
          [attr.aria-pressed]="option.id === selected().id"
          [disabled]="disabled()"
          (click)="rangeChange.emit(option)"
        >
          {{ option.label }}
        </button>
      }
    </div>
  `,
})
export class DateRangePickerComponent {
  readonly selected = input.required<DateRangeOption>();
  /** Field the range applies to, surfaced to assistive technology. */
  readonly field = input('dc:created');
  readonly disabled = input(false);

  readonly rangeChange = output<DateRangeOption>();

  protected readonly options = DATE_RANGE_OPTIONS;
}
