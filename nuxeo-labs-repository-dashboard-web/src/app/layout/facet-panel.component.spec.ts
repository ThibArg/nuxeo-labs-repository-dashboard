import { TestBed } from '@angular/core/testing';
import { TermsMemberConfig, TermsSelection } from '../config/dashboard-config.model';
import { FacetPanelComponent } from './facet-panel.component';
import { FacetValue } from '../engine/facet-values.service';

const MEMBER: TermsMemberConfig = {
  id: 'types',
  field: 'ecm:primaryType',
  label: 'Document types',
  labels: 'doctype',
};

const VALUES: FacetValue[] = [
  { value: 'Picture', count: 1500 },
  { value: 'File', count: 3000 },
  { value: 'Contract', count: 142 },
];

function mount(selection: TermsSelection, labels = new Map<string, string>()) {
  const fixture = TestBed.createComponent(FacetPanelComponent);
  fixture.componentRef.setInput('member', MEMBER);
  fixture.componentRef.setInput('values', VALUES);
  fixture.componentRef.setInput('selection', selection);
  fixture.componentRef.setInput('labels', labels);

  const emitted: TermsSelection[] = [];
  fixture.componentInstance.selectionChange.subscribe((value) => emitted.push(value));
  fixture.detectChanges();

  return { fixture, emitted };
}

function rows(fixture: { nativeElement: HTMLElement }): HTMLElement[] {
  return Array.from(fixture.nativeElement.querySelectorAll('li label'));
}

function checkboxes(fixture: { nativeElement: HTMLElement }): HTMLInputElement[] {
  return Array.from(fixture.nativeElement.querySelectorAll('input[type=checkbox]'));
}

describe('FacetPanelComponent', () => {
  it('sorts by resolved label, not by raw key', () => {
    const labels = new Map([
      ['File', 'Zebra'],
      ['Picture', 'Alpha'],
    ]);
    const { fixture } = mount({ mode: 'all' }, labels);

    const texts = rows(fixture).map((row) => row.querySelector('span')!.textContent!.trim());
    expect(texts).toEqual(['Alpha', 'Contract', 'Zebra']);
  });

  it('checks everything when the selection is unconstrained', () => {
    const { fixture } = mount({ mode: 'all' });
    expect(checkboxes(fixture).every((box) => box.checked)).toBe(true);
  });

  it('checks only the selected values of a subset', () => {
    const { fixture } = mount({ mode: 'subset', values: ['File'] });
    const checked = checkboxes(fixture).filter((box) => box.checked);
    expect(checked).toHaveLength(1);
  });

  it('emits a subset when one value is unchecked', () => {
    const { fixture, emitted } = mount({ mode: 'all' });

    // Rows are sorted: Contract, File, Picture. The click itself toggles the box.
    checkboxes(fixture)[0].click();

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual({ mode: 'subset', values: ['File', 'Picture'] });
  });

  it('collapses back to "all" when every value ends up checked', () => {
    const { fixture, emitted } = mount({ mode: 'subset', values: ['File', 'Picture'] });

    checkboxes(fixture)[0].click();

    // Storing the explicit list would silently exclude any type created later.
    expect(emitted[0]).toEqual({ mode: 'all' });
  });

  it('applies an alt-click to every value of the list', () => {
    const { fixture, emitted } = mount({ mode: 'all' });

    checkboxes(fixture)[0].dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }));

    expect(emitted[0]).toEqual({ mode: 'subset', values: [] });
  });

  it('applies an alt-click the other way round too', () => {
    const { fixture, emitted } = mount({ mode: 'subset', values: [] });

    checkboxes(fixture)[0].dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }));

    expect(emitted[0]).toEqual({ mode: 'all' });
  });

  it('clears everything through the Clear action', () => {
    const { fixture, emitted } = mount({ mode: 'all' });

    const clear = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((button) => button.textContent?.trim() === 'Clear')!;
    clear.click();

    expect(emitted[0]).toEqual({ mode: 'subset', values: [] });
  });

  it('narrows the list as the user searches, without touching the selection', () => {
    const { fixture, emitted } = mount({ mode: 'all' });

    const search = (fixture.nativeElement as HTMLElement).querySelector(
      'input[type=search]',
    ) as HTMLInputElement;
    search.value = 'contr';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(rows(fixture)).toHaveLength(1);
    expect(emitted).toHaveLength(0);
  });

  it('shows the counts', () => {
    const { fixture } = mount({ mode: 'all' });
    expect((fixture.nativeElement as HTMLElement).textContent).toContain((3000).toLocaleString());
  });

  /*
   * Pressing "Select all" after narrowing the list used to tick everything that had been
   * downloaded, which is never what the reader who narrowed it down meant.
   */
  it('selects what the search left on screen, not the whole downloaded list', () => {
    const { fixture, emitted } = mount({ mode: 'all' });

    const search = (fixture.nativeElement as HTMLElement).querySelector(
      'input[type=search]',
    ) as HTMLInputElement;
    search.value = 'contr';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button')[0].click();

    expect(emitted.at(-1)).toEqual({ mode: 'subset', values: ['Contract'] });
  });

  it('warns when the aggregation was truncated', () => {
    const fixture = TestBed.createComponent(FacetPanelComponent);
    fixture.componentRef.setInput('member', MEMBER);
    fixture.componentRef.setInput('values', VALUES);
    fixture.componentRef.setInput('selection', { mode: 'all' });
    fixture.componentRef.setInput('truncated', true);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('More values exist');
  });

  /*
   * "More values exist" tells a reader nothing they can act on. With the count in hand the line
   * says how much is missing, which is the difference between a warning and information.
   */
  it('says how many values are missing when the server counted them', () => {
    const fixture = TestBed.createComponent(FacetPanelComponent);
    fixture.componentRef.setInput('member', MEMBER);
    fixture.componentRef.setInput('values', VALUES);
    fixture.componentRef.setInput('selection', { mode: 'all' });
    fixture.componentRef.setInput('truncated', true);
    fixture.componentRef.setInput('total', 47);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('47');
    expect(text).toContain('3 are listed');
  });
});

/*
 * A field whose cardinality follows the user base cannot be browsed: an insurance company with
 * three hundred claim adjusters would get three hundred checkboxes, and no top N can be relied on
 * to hold the one person a reader is looking for.
 */
describe('FacetPanelComponent under lookup', () => {
  const ACTORS: TermsMemberConfig = {
    id: 'actors',
    field: 'nt:actors',
    label: 'Assignees',
    labels: 'user',
    lookup: 'user',
    size: 20,
  };

  const BUSY: FacetValue[] = [
    { value: 'alan', count: 2 },
    { value: 'Josh', count: 9 },
    { value: 'kate', count: 5 },
  ];

  function mountLookup(selection: TermsSelection, total?: number) {
    const fixture = TestBed.createComponent(FacetPanelComponent);
    fixture.componentRef.setInput('member', ACTORS);
    fixture.componentRef.setInput('values', BUSY);
    fixture.componentRef.setInput('selection', selection);
    if (total !== undefined) {
      fixture.componentRef.setInput('truncated', true);
      fixture.componentRef.setInput('total', total);
    }

    const emitted: TermsSelection[] = [];
    fixture.componentInstance.selectionChange.subscribe((value) => emitted.push(value));
    fixture.detectChanges();
    return { fixture, emitted };
  }

  function labelsOf(fixture: { nativeElement: unknown }): string[] {
    return [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('li span:first-of-type'),
    ].map((node) => node.textContent?.trim() ?? '');
  }

  it('ranks by volume, since three hundred names in alphabetical order help nobody', () => {
    const { fixture } = mountLookup({ mode: 'all' });

    expect(labelsOf(fixture)).toEqual(['Josh', 'kate', 'alan']);
  });

  /*
   * A value ticked through the search box must not vanish when the box is cleared, and a persisted
   * one must be visible even when its owner has dropped out of the busiest N.
   */
  it('pins the selected values, even when they are outside the listed page', () => {
    const { fixture } = mountLookup({ mode: 'subset', values: ['user:ghost'] });

    expect(labelsOf(fixture)[0]).toBe('user:ghost');
  });

  it('says how many people exist and points at the search box', () => {
    const { fixture } = mountLookup({ mode: 'all' }, 47);

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('47 assignees in all');
    expect(text).toContain('Search for the others');
  });

  /*
   * Holding every row of a top N says nothing about holding every value, so collapsing to `all`
   * would silently widen the filter to people who were never shown.
   */
  it('never collapses a full page to "all", since the page is only a top N', () => {
    const { fixture, emitted } = mountLookup({ mode: 'all' });

    (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button')[0].click();

    expect(emitted[0]).toEqual({ mode: 'subset', values: ['Josh', 'kate', 'alan'] });
  });
});
