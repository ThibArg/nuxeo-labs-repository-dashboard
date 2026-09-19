import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { GroupSelection, SELECT_ALL, TermsGroupConfig } from '../config/dashboard-config.model';

/** Past this many values the names no longer fit on a button, so their count is shown instead. */
const NAMED_VALUE_LIMIT = 2;

/** Filter bar entry showing the state of a group and opening its editor. */
@Component({
  selector: 'nxd-facet-group-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="nxd-toolbar-button"
      [class.border-accent]="constrained()"
      [class.text-accent]="constrained()"
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
        <path d="M4 5h16l-6 7v5l-4 2v-7L4 5Z" />
      </svg>
      {{ label() }}
    </button>
  `,
})
export class FacetGroupButtonComponent {
  readonly group = input.required<TermsGroupConfig>();
  readonly selection = input.required<GroupSelection>();
  /** Resolved labels per member, so the button can name a choice rather than count it. */
  readonly labels = input<Map<string, Map<string, string>>>(new Map());
  readonly disabled = input(false);

  readonly opened = output<void>();

  private readonly constrainedMembers = computed(() =>
    this.group()
      .members.map((member) => ({ member, selection: this.selection()[member.id] ?? SELECT_ALL }))
      .filter((entry) => entry.selection.mode === 'subset')
      .map((entry) => ({
        label: entry.member.label.toLowerCase(),
        values: entry.selection.mode === 'subset' ? entry.selection.values : [],
        resolved: this.labels().get(entry.member.id) ?? new Map<string, string>(),
      })),
  );

  readonly constrained = computed(() => this.constrainedMembers().length > 0);

  /**
   * What the button reads once a choice is made.
   *
   * Naming the values matters more than counting them: the filter bar is the only thing telling a
   * reader which population the figures below describe, and "1 models" says nothing when the
   * answer is "Claim Review". Past two values the names would not fit, so the count comes back.
   */
  readonly label = computed(() => {
    const members = this.constrainedMembers();
    if (!members.length) {
      return `All ${this.group().label.toLowerCase()}`;
    }
    const joiner = this.group().combine === 'and' ? ' and ' : ' or ';
    return members
      .map((entry) =>
        entry.values.length <= NAMED_VALUE_LIMIT
          ? entry.values.map((value) => entry.resolved.get(value) ?? value).join(', ')
          : `${entry.values.length} ${entry.label}`,
      )
      .join(joiner);
  });
}
