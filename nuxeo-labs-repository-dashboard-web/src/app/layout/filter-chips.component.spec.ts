import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BucketPick } from '../config/dashboard-config.model';
import { FilterChipsComponent } from './filter-chips.component';

const STATE: BucketPick = {
  field: 'ecm:currentLifeCycleState',
  value: 'project',
  label: 'Project',
};

describe('FilterChipsComponent', () => {
  function render(picks: BucketPick[], clearable = false): ComponentFixture<FilterChipsComponent> {
    const fixture = TestBed.createComponent(FilterChipsComponent);
    fixture.componentRef.setInput('picks', picks);
    fixture.componentRef.setInput('clearable', clearable);
    fixture.detectChanges();
    return fixture;
  }

  it('renders nothing at all when no filter is active', () => {
    const element = render([]).nativeElement as HTMLElement;

    expect(element.textContent?.trim()).toBe('');
  });

  /*
   * The field is shown beside the value, not only in the tooltip: two charts can resolve different
   * fields to the same word, and a chip that read "Project" twice would be two mysteries.
   */
  it('names the field beside the value it constrains', () => {
    const element = render([STATE]).nativeElement as HTMLElement;

    expect(element.textContent).toContain('Project');
    expect(element.textContent).toContain('ecm:currentLifeCycleState');
  });

  it('asks for a pick to be removed', async () => {
    const fixture = render([STATE]);
    const removed: BucketPick[] = [];
    fixture.componentInstance.removed.subscribe((pick) => removed.push(pick));

    const button = (fixture.nativeElement as HTMLElement).querySelector(
      'button[aria-label="Remove filter Project"]',
    ) as HTMLButtonElement;
    button.click();

    expect(removed).toEqual([STATE]);
  });

  /*
   * A dashboard can be narrowed through a facet dialog with no pick at all, and that reader still
   * needs one gesture to get back to the whole population.
   */
  it('offers to clear everything when a group is constrained but nothing is picked', () => {
    const element = render([], true).nativeElement as HTMLElement;

    expect(element.textContent).toContain('Clear filters');
  });

  it('stays silent about clearing when nothing is constrained', () => {
    const element = render([STATE], false).nativeElement as HTMLElement;

    expect(element.textContent).not.toContain('Clear filters');
  });
});
