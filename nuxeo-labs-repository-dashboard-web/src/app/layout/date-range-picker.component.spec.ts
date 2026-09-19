import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DateRangeOption, customRange, resolveShortcut } from '../config/dashboard-config.model';
import { DateRangePickerComponent } from './date-range-picker.component';

const ALL: DateRangeOption = { id: 'all', label: 'All time', from: null, to: null };

function mount(selected: DateRangeOption): ComponentFixture<DateRangePickerComponent> {
  const fixture = TestBed.createComponent(DateRangePickerComponent);
  fixture.componentRef.setInput('selected', selected);
  fixture.detectChanges();
  return fixture;
}

function inputs(fixture: ComponentFixture<DateRangePickerComponent>): HTMLInputElement[] {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>('input[type=date]'),
  );
}

function button(
  fixture: ComponentFixture<DateRangePickerComponent>,
  label: string,
): HTMLButtonElement {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
  ).find((candidate) => candidate.textContent?.trim() === label)!;
}

/** Emissions of the component, in order. */
function captured(fixture: ComponentFixture<DateRangePickerComponent>): DateRangeOption[] {
  const seen: DateRangeOption[] = [];
  fixture.componentInstance.rangeChange.subscribe((range) => seen.push(range));
  return seen;
}

describe('DateRangePickerComponent', () => {
  it('shows the days the selected period covers', () => {
    const fixture = mount(resolveShortcut({ id: '7d', label: 'Last 7 days', days: 7 }));
    const [from, to] = inputs(fixture);

    expect(from.value).toBe(fixture.componentInstance.selected().from);
    expect(to.value).toBe(fixture.componentInstance.selected().to);
  });

  it('leaves both fields empty for the whole history', () => {
    const [from, to] = inputs(mount(ALL));

    expect(from.value).toBe('');
    expect(to.value).toBe('');
  });

  it('fills the two fields when a shortcut is picked', () => {
    const fixture = mount(ALL);
    const seen = captured(fixture);

    button(fixture, 'Last 7 days').click();

    expect(seen).toHaveLength(1);
    expect(seen[0].from).not.toBeNull();
    expect(seen[0].to).not.toBeNull();
    expect(seen[0].id).toBe('7d');
  });

  it('turns an edited field into a typed period, so no shortcut stays highlighted', () => {
    // Days chosen away from today on purpose: a value equal to the current date would make an
    // implementation that ignores the field indistinguishable from one that reads it.
    const fixture = mount(customRange('2026-06-01', '2026-06-30'));
    const seen = captured(fixture);
    const [, to] = inputs(fixture);

    to.value = '2026-06-15';
    to.dispatchEvent(new Event('change'));

    expect(seen).toHaveLength(1);
    expect(seen[0].id).toBe('custom');
    expect(seen[0].to).toBe('2026-06-15');
    // The other bound is left alone.
    expect(seen[0].from).toBe('2026-06-01');
  });

  it('keeps the fields from crossing each other', () => {
    const fixture = mount(customRange('2026-09-01', '2026-09-18'));
    const [from, to] = inputs(fixture);

    expect(from.max).toBe('2026-09-18');
    expect(to.min).toBe('2026-09-01');
  });

  it('highlights the shortcut in use, and none once the days are typed', () => {
    const shortcut = mount(resolveShortcut({ id: '30d', label: 'Last 30 days', days: 30 }));
    expect(button(shortcut, 'Last 30 days').getAttribute('aria-pressed')).toBe('true');

    const typed = mount(customRange('2026-09-01', '2026-09-18'));
    const pressed = Array.from(
      (typed.nativeElement as HTMLElement).querySelectorAll('button[aria-pressed=true]'),
    );
    expect(pressed).toEqual([]);
  });
});
