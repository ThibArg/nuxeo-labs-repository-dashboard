import { TestBed } from '@angular/core/testing';
import { TermsGroupConfig } from '../config/dashboard-config.model';
import { FacetGroupButtonComponent } from './facet-group-button.component';

const GROUP: TermsGroupConfig = {
  type: 'termsGroup',
  id: 'models',
  label: 'Workflow models',
  combine: 'or',
  members: [{ id: 'modelName', field: 'extended.modelName', label: 'Models' }],
};

function render(selection: unknown, labels?: Map<string, Map<string, string>>) {
  const fixture = TestBed.createComponent(FacetGroupButtonComponent);
  fixture.componentRef.setInput('group', GROUP);
  fixture.componentRef.setInput('selection', selection);
  if (labels) {
    fixture.componentRef.setInput('labels', labels);
  }
  fixture.detectChanges();
  return (fixture.nativeElement as HTMLElement).textContent?.trim() ?? '';
}

describe('FacetGroupButtonComponent', () => {
  it('says everything is selected when nothing constrains the group', () => {
    expect(render({})).toContain('All workflow models');
  });

  /*
   * The filter bar is the only thing naming the population the figures below describe, and it
   * stays on screen while the reader scrolls. "1 models" leaves them guessing which one.
   */
  it('names the chosen value rather than counting it', () => {
    const labels = new Map([['modelName', new Map([['ClaimReview', 'Claim Review']])]]);
    const selection = { modelName: { mode: 'subset', values: ['ClaimReview'] } };

    expect(render(selection, labels)).toContain('Claim Review');
    expect(render(selection, labels)).not.toContain('1 models');
  });

  it('falls back to the raw value when no label was resolved', () => {
    const selection = { modelName: { mode: 'subset', values: ['ClaimReview'] } };

    expect(render(selection)).toContain('ClaimReview');
  });

  it('counts them again past two, where the names would not fit', () => {
    const selection = {
      modelName: { mode: 'subset', values: ['AdHoc', 'ClaimReview', 'RequestDownload'] },
    };

    expect(render(selection)).toContain('3 models');
  });
});
