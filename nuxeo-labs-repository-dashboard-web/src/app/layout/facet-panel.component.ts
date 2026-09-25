import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TermsMemberConfig, TermsSelection } from '../config/dashboard-config.model';
import {
  PrincipalSuggestService,
  SUGGEST_DEBOUNCE_MS,
  SUGGEST_MAX_RESULTS,
  SUGGEST_MIN_CHARS,
  SuggestedPrincipal,
} from '../core/principal-suggest.service';
import { FacetValue } from '../engine/facet-values.service';

interface Row {
  value: string;
  label: string;
  /** Null for a directory match, which the index knows nothing about. */
  count: number | null;
  checked: boolean;
}

/**
 * One checkable list inside a filter group dialog.
 *
 * The component owns no state beyond its search box: the parent holds the working selection so
 * that Cancel can discard every panel at once.
 *
 * A member declaring `lookup` behaves differently, because a field whose cardinality follows the
 * user base cannot be browsed: values are ranked by volume rather than alphabetically, the list is
 * short, and typing asks the directory instead of filtering the page already downloaded. The two
 * halves answer different questions — "who is busiest" only the index knows, "where is Kate" only
 * the directory does.
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
      [placeholder]="placeholder()"
      [value]="query()"
      (input)="query.set($any($event.target).value)"
      [attr.aria-label]="placeholder()"
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
              {{ row.count === null ? '' : row.count.toLocaleString() }}
            </span>
          </label>
        </li>
      } @empty {
        <li class="px-3 py-6 text-center text-sm text-ink-subtle">
          @if (searching()) {
            Searching…
          } @else if (query().length && query().length < minChars && isLookup()) {
            Type {{ minChars }} characters or more.
          } @else if (values().length) {
            No value matches "{{ query() }}".
          } @else {
            No value found for this filter.
          }
        </li>
      }
    </ul>

    @if (tooMany()) {
      <p class="mt-2 text-xs text-ink-subtle">
        More than {{ maxResults }} people and groups match "{{ query().trim() }}". Type more of the
        name to find one.
      </p>
    }
    @if (member().note; as note) {
      <p class="mt-2 text-xs text-ink-subtle">{{ note }}</p>
    }
    @if (omitted(); as message) {
      <p class="mt-2 text-xs text-ink-subtle">{{ message }}</p>
    }
  `,
})
export class FacetPanelComponent {
  private readonly suggest = inject(PrincipalSuggestService);

  readonly member = input.required<TermsMemberConfig>();
  readonly values = input<FacetValue[]>([]);
  readonly labels = input<Map<string, string>>(new Map());
  readonly selection = input.required<TermsSelection>();
  readonly truncated = input(false);
  /** Distinct values the field holds, when the server counted them. */
  readonly total = input<number | undefined>(undefined);

  readonly selectionChange = output<TermsSelection>();

  protected readonly query = signal('');
  protected readonly searching = signal(false);
  protected readonly minChars = SUGGEST_MIN_CHARS;
  protected readonly maxResults = SUGGEST_MAX_RESULTS;

  private readonly matches = signal<SuggestedPrincipal[]>([]);
  protected readonly tooMany = signal(false);

  protected readonly isLookup = computed(() => this.member().lookup === 'user');

  protected readonly placeholder = computed(() =>
    this.isLookup()
      ? `Search ${this.member().label.toLowerCase()}…`
      : `Filter ${this.member().label.toLowerCase()}…`,
  );

  constructor() {
    effect((onCleanup) => {
      const term = this.query();
      if (!this.isLookup()) {
        return;
      }
      if (term.trim().length < SUGGEST_MIN_CHARS) {
        this.suggest.cancel();
        this.matches.set([]);
        this.tooMany.set(false);
        this.searching.set(false);
        return;
      }

      this.searching.set(true);
      const timer = setTimeout(() => {
        void this.suggest.suggest(term).then((found) => {
          this.matches.set(found.principals);
          this.tooMany.set(found.tooMany);
          this.searching.set(false);
        });
      }, SUGGEST_DEBOUNCE_MS);

      onCleanup(() => clearTimeout(timer));
    });
  }

  /**
   * Values the index returned, ranked by volume under `lookup` and by label otherwise.
   *
   * Sorting three hundred people alphabetically helps nobody; sorting eighteen document types by
   * volume makes them hard to find. The ordering follows the question the list answers.
   */
  private readonly indexRows = computed<Row[]>(() => {
    const selection = this.selection();
    const selected = selection.mode === 'subset' ? new Set(selection.values) : null;

    const rows = this.values().map((entry) => ({
      value: entry.value,
      label: this.labels().get(entry.value) ?? entry.value,
      count: entry.count as number | null,
      checked: selected ? selected.has(entry.value) : true,
    }));

    return this.isLookup()
      ? rows.sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
      : rows.sort((a, b) => a.label.localeCompare(b.label));
  });

  /**
   * What the list shows.
   *
   * Under `lookup`, the selected values are pinned first so that clearing the search box does not
   * hide what was just ticked, and directory matches are appended with no count, the directory
   * knowing nothing of documents.
   */
  readonly rows = computed<Row[]>(() => {
    if (!this.isLookup()) {
      const needle = this.query().trim().toLowerCase();
      if (!needle) {
        return this.indexRows();
      }
      return this.indexRows().filter(
        (row) =>
          row.label.toLowerCase().includes(needle) || row.value.toLowerCase().includes(needle),
      );
    }

    const selection = this.selection();
    const selected = selection.mode === 'subset' ? selection.values : [];
    const byValue = new Map(this.indexRows().map((row) => [row.value, row]));

    const pinned: Row[] = selected.map(
      (value) =>
        byValue.get(value) ?? {
          value,
          label: this.labels().get(value) ?? value,
          count: null,
          checked: true,
        },
    );

    const seen = new Set(pinned.map((row) => row.value));
    const rest = this.indexRows().filter((row) => !seen.has(row.value));
    rest.forEach((row) => seen.add(row.value));

    const found: Row[] = this.matches()
      .filter((match) => !seen.has(match.id))
      .map((match) => ({ value: match.id, label: match.label, count: null, checked: false }));

    return [...pinned, ...rest, ...found];
  });

  readonly summary = computed(() => {
    const total = this.indexRows().length;
    const selection = this.selection();
    const count = selection.mode === 'all' ? total : selection.values.length;
    return `${count} of ${total}`;
  });

  /** Says how many values the list leaves out, rather than merely warning that it does. */
  protected readonly omitted = computed(() => {
    if (!this.truncated()) {
      return null;
    }
    const total = this.total();
    const shown = this.indexRows().length;
    if (total === undefined || total <= shown) {
      return 'More values exist than could be listed.';
    }
    const noun = this.member().label.toLowerCase();
    return this.isLookup()
      ? `${total.toLocaleString()} ${noun} in all — the ${shown} busiest are listed. Search for the others.`
      : `${total.toLocaleString()} ${noun} in all — ${shown} are listed.`;
  });

  /** Alt-click applies the new state of the clicked row to every row shown, as power users expect. */
  protected onToggle(event: Event, row: Row): void {
    const checked = (event.target as HTMLInputElement).checked;

    if ((event as MouseEvent).altKey) {
      event.preventDefault();
      this.emit(checked ? this.shownValues() : []);
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

  /**
   * Selects what is on screen, not what was downloaded.
   *
   * Pressing it after a search used to tick the whole list, which is never what the reader who
   * narrowed it down meant.
   */
  protected selectAll(): void {
    this.emit(this.shownValues());
  }

  protected clear(): void {
    this.emit([]);
  }

  private shownValues(): string[] {
    return this.rows().map((row) => row.value);
  }

  private everyValue(): string[] {
    return this.indexRows().map((row) => row.value);
  }

  private currentValues(): string[] {
    const selection = this.selection();
    return selection.mode === 'subset' ? selection.values : this.everyValue();
  }

  /**
   * Collapses a complete selection back to `all`, so that a value appearing later is included
   * instead of being excluded by a snapshot of today's list.
   *
   * Never under `lookup`: the list is a top N, so holding all of it says nothing about holding
   * every value, and collapsing would silently widen the filter to people never shown.
   */
  private emit(values: string[]): void {
    const complete =
      !this.isLookup() && values.length === this.indexRows().length && values.length > 0;
    this.selectionChange.emit(complete ? { mode: 'all' } : { mode: 'subset', values });
  }
}
