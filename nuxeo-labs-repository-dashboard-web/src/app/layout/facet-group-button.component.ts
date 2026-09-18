import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { GroupSelection, SELECT_ALL, TermsGroupConfig } from '../config/dashboard-config.model';

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
  readonly disabled = input(false);

  readonly opened = output<void>();

  private readonly constrainedMembers = computed(() =>
    this.group()
      .members.map((member) => ({ member, selection: this.selection()[member.id] ?? SELECT_ALL }))
      .filter((entry) => entry.selection.mode === 'subset')
      .map((entry) => ({
        label: entry.member.label.toLowerCase(),
        count: entry.selection.mode === 'subset' ? entry.selection.values.length : 0,
      })),
  );

  readonly constrained = computed(() => this.constrainedMembers().length > 0);

  readonly label = computed(() => {
    const members = this.constrainedMembers();
    if (!members.length) {
      return `All ${this.group().label.toLowerCase()}`;
    }
    const joiner = this.group().combine === 'and' ? ' and ' : ' or ';
    return members.map((entry) => `${entry.count} ${entry.label}`).join(joiner);
  });
}
