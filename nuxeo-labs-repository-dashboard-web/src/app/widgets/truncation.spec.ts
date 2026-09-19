import { TestBed } from '@angular/core/testing';
import { ChartWidgetConfig } from '../config/dashboard-config.model';
import { WidgetData } from '../engine/result-mapper';
import { RankedListComponent } from './ranked-list.component';

const CONFIG: ChartWidgetConfig = {
  type: 'ranked-list',
  label: 'Documents Created by User',
  agg: { terms: { field: 'principalName', size: 10 } },
};

function render(data: WidgetData): string {
  const fixture = TestBed.createComponent(RankedListComponent);
  fixture.componentRef.setInput('config', CONFIG);
  fixture.componentRef.setInput('data', data);
  fixture.detectChanges();
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}

function buckets(count: number, extra: Partial<Extract<WidgetData, { kind: 'buckets' }>> = {}) {
  return {
    kind: 'buckets' as const,
    buckets: Array.from({ length: count }, (_, index) => ({
      key: `user${index}`,
      value: 10 - index,
      docCount: 10 - index,
    })),
    ...extra,
  };
}

describe('a ranked list owns up to what it left out', () => {
  it('says how many values it could not show', () => {
    // Ten bars out of forty-seven users read as the whole team unless the list says otherwise.
    const text = render(buckets(10, { others: 37, otherDocs: 1240 }));

    expect(text).toContain('37 more not shown');
  });

  it('stays silent when every value fits', () => {
    expect(render(buckets(4, { others: 0, otherDocs: 0 }))).not.toContain('not shown');
  });

  it('stays silent when the widget never counted the values', () => {
    expect(render(buckets(4))).not.toContain('not shown');
  });

  it('explains on hover how much of the total is hidden', () => {
    const fixture = TestBed.createComponent(RankedListComponent);
    fixture.componentRef.setInput('config', CONFIG);
    fixture.componentRef.setInput('data', buckets(10, { others: 37, otherDocs: 1240 }));
    fixture.detectChanges();

    const footer = (fixture.nativeElement as HTMLElement).querySelector('p[title]');
    expect(footer?.getAttribute('title')).toContain('1,240');
  });
});
