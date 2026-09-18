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

  it('warns when the aggregation was truncated', () => {
    const fixture = TestBed.createComponent(FacetPanelComponent);
    fixture.componentRef.setInput('member', MEMBER);
    fixture.componentRef.setInput('values', VALUES);
    fixture.componentRef.setInput('selection', { mode: 'all' });
    fixture.componentRef.setInput('truncated', true);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('More values exist');
  });
});
