import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { TermsMemberConfig, TermsSelection } from '../config/dashboard-config.model';
import { FacetValue } from '../engine/facet-values.service';

interface Row {
  value: string;
  label: string;
  count: number;
  checked: boolean;
}

/**
 * One checkable list inside a filter group dialog.
 *
 * The component owns no state: the parent holds the working selection so that Cancel can discard
 * every panel at once.
 */
@Component({
  selector: 'nxd-facet-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-w-0 flex-1 flex-col' },
  template: `
    <h3 class="nxd-card-title mb-2">{{ member().label }}</h3>

    <input
      type="search"
      class="mb-2 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
      [placeholder]="'Filter ' + member().label.toLowerCase() + '…'"
      [value]="query()"
      (input)="query.set($any($event.target).value)"
      [attr.aria-label]="'Filter ' + member().label"
    />

    <div class="mb-2 flex items-center gap-3 text-xs">
      <button type="button" class="text-accent hover:underline" (click)="selectAll()">
        Select all
      </button>
      <span class="text-ink-subtle">·</span>
      <button type="button" class="text-accent hover:underline" (click)="clear()">Clear</button>
      <span class="ml-auto text-ink-subtle">{{ summary() }}</span>
    </div>

    <ul class="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border">
      @for (row of rows(); track row.value) {
        <li>
          <label
            class="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-canvas"
            [title]="row.value"
          >
            <input
              type="checkbox"
              class="h-4 w-4 shrink-0 accent-accent"
              [checked]="row.checked"
              (click)="onToggle($event, row)"
            />
            <span class="min-w-0 flex-1 truncate text-ink">{{ row.label }}</span>
            <span class="shrink-0 tabular-nums text-xs text-ink-muted">
              {{ row.count.toLocaleString() }}
            </span>
          </label>
        </li>
      } @empty {
        <li class="px-3 py-6 text-center text-sm text-ink-subtle">
          @if (values().length) {
            No value matches "{{ query() }}".
          } @else {
            No value found for this filter.
          }
        </li>
      }
    </ul>

    @if (member().note; as note) {
      <p class="mt-2 text-xs text-ink-subtle">{{ note }}</p>
    }
    @if (truncated()) {
      <p class="mt-2 text-xs text-warning">
        More values exist than could be listed. Raise "size" in the dashboard configuration.
      </p>
    }
  `,
})
export class FacetPanelComponent {
  readonly member = input.required<TermsMemberConfig>();
  readonly values = input<FacetValue[]>([]);
  readonly labels = input<Map<string, string>>(new Map());
  readonly selection = input.required<TermsSelection>();
  readonly truncated = input(false);

  readonly selectionChange = output<TermsSelection>();

  protected readonly query = signal('');

  /** Sorted by resolved label, so a translated list reads alphabetically to its reader. */
  private readonly allRows = computed<Row[]>(() => {
    const selection = this.selection();
    const selected = selection.mode === 'subset' ? new Set(selection.values) : null;

    return this.values()
      .map((entry) => ({
        value: entry.value,
        label: this.labels().get(entry.value) ?? entry.value,
        count: entry.count,
        checked: selected ? selected.has(entry.value) : true,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  readonly rows = computed<Row[]>(() => {
    const needle = this.query().trim().toLowerCase();
    if (!needle) {
      return this.allRows();
    }
    return this.allRows().filter(
      (row) => row.label.toLowerCase().includes(needle) || row.value.toLowerCase().includes(needle),
    );
  });

  readonly summary = computed(() => {
    const total = this.allRows().length;
    const selection = this.selection();
    const count = selection.mode === 'all' ? total : selection.values.length;
    return `${count} of ${total}`;
  });

  /** Alt-click applies the new state of the clicked row to every row, as power users expect. */
  protected onToggle(event: Event, row: Row): void {
    const checked = (event.target as HTMLInputElement).checked;

    if ((event as MouseEvent).altKey) {
      event.preventDefault();
      this.emit(checked ? this.everyValue() : []);
      return;
    }

    const current = new Set(this.currentValues());
    if (checked) {
      current.add(row.value);
    } else {
      current.delete(row.value);
    }
    this.emit([...current]);
  }

  protected selectAll(): void {
    this.emit(this.everyValue());
  }

  protected clear(): void {
    this.emit([]);
  }

  private everyValue(): string[] {
    return this.allRows().map((row) => row.value);
  }

  private currentValues(): string[] {
    const selection = this.selection();
    return selection.mode === 'subset' ? selection.values : this.everyValue();
  }

  /**
   * Collapses a complete selection back to `all`, so that a value appearing later is included
   * instead of being excluded by a snapshot of today's list.
   */
  private emit(values: string[]): void {
    const complete = values.length === this.allRows().length && values.length > 0;
    this.selectionChange.emit(complete ? { mode: 'all' } : { mode: 'subset', values });
  }
}
