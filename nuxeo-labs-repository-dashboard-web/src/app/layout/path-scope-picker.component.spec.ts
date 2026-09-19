import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Container } from '../engine/path-browser.service';
import { PathScopePickerComponent } from './path-scope-picker.component';

const CONTAINERS: Container[] = [
  { id: 'a', path: '/default-domain/workspaces/alpha', title: 'Alpha' },
  { id: 'b', path: '/default-domain/workspaces/beta', title: 'Beta' },
];

describe('PathScopePickerComponent', () => {
  function render(inputs: Record<string, unknown>): ComponentFixture<PathScopePickerComponent> {
    const fixture = TestBed.createComponent(PathScopePickerComponent);
    fixture.componentRef.setInput('current', '/default-domain');
    Object.entries(inputs).forEach(([name, value]) => fixture.componentRef.setInput(name, value));
    fixture.detectChanges();
    return fixture;
  }

  function buttons(fixture: ComponentFixture<PathScopePickerComponent>): HTMLButtonElement[] {
    return [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')];
  }

  it('says the figures cover everything when nothing is chosen', () => {
    expect(buttons(render({}))[0].textContent).toContain('Whole repository');
  });

  /*
   * The last segment, not the whole path: a filter bar has room for a name, and the full path is
   * on the button's own title for whoever needs to tell two containers of the same name apart.
   */
  it('names the chosen container by its last segment', () => {
    const fixture = render({ selected: '/default-domain/workspaces/governance-fixture' });

    expect(buttons(fixture)[0].textContent).toContain('governance-fixture');
  });

  it('walks the trail back up through every ancestor', () => {
    const fixture = render({
      open: true,
      current: '/default-domain/workspaces/alpha',
    });

    const trail = [...(fixture.nativeElement as HTMLElement).querySelectorAll('nav button')].map(
      (button) => button.textContent?.trim(),
    );

    expect(trail).toEqual(['default-domain', 'workspaces', 'alpha']);
  });

  it('browses into a container rather than choosing it on sight', () => {
    const fixture = render({ open: true, containers: CONTAINERS });
    const browsed: string[] = [];
    fixture.componentInstance.browse.subscribe((path) => browsed.push(path));

    const alpha = buttons(fixture).find((button) => button.textContent?.trim() === 'Alpha')!;
    alpha.click();

    expect(browsed).toEqual(['/default-domain/workspaces/alpha']);
  });

  it('chooses a container without having to open it first', () => {
    const fixture = render({ open: true, containers: CONTAINERS });
    const applied: (string | null)[] = [];
    fixture.componentInstance.applied.subscribe((path) => applied.push(path));

    const use = buttons(fixture).filter((button) => button.textContent?.trim() === 'Use');
    use[1].click();

    expect(applied).toEqual(['/default-domain/workspaces/beta']);
  });

  it('describes the whole repository again', () => {
    const fixture = render({ open: true, selected: '/default-domain/workspaces' });
    const applied: (string | null)[] = [];
    fixture.componentInstance.applied.subscribe((path) => applied.push(path));

    buttons(fixture)
      .find((button) => button.textContent?.trim() === 'Whole repository')!
      .click();

    expect(applied).toEqual([null]);
  });

  it('tells an empty level apart from one still loading', () => {
    const loading = render({ open: true, loading: true }).nativeElement as HTMLElement;
    expect(loading.textContent).toContain('Loading');

    const empty = render({ open: true, loading: false }).nativeElement as HTMLElement;
    expect(empty.textContent).toContain('Nothing inside this container');
  });
});
