import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The period a widget's figures obey, said on the widget itself.
 *
 * The picker sits at the top of the page and the printed sheet states it once. A tile read on its
 * own — below the fold, pasted into a slide, or on Content, where Total counts what the last
 * twelve months created rather than the repository — says nothing of it otherwise.
 */
@Component({
  selector: 'nxd-period',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="inline-flex items-center gap-1"
      data-testid="widget-period"
      [title]="'Period these figures cover: ' + text()"
    >
      <svg
        viewBox="0 0 24 24"
        class="h-3 w-3 shrink-0"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <rect x="4" y="5" width="16" height="15" rx="2" />
        <path d="M4 10h16M9 3v4M15 3v4" />
      </svg>
      <span class="sr-only">Period: </span>{{ text() }}
    </span>
  `,
})
export class PeriodLabelComponent {
  readonly text = input.required<string>();
}
