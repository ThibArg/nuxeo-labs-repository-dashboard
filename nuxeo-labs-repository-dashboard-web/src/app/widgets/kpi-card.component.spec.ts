import { TestBed } from '@angular/core/testing';
import { KpiWidgetConfig } from '../config/dashboard-config.model';
import { WidgetData } from '../engine/result-mapper';
import { KpiCardComponent } from './kpi-card.component';

function mount(config: KpiWidgetConfig, data?: WidgetData) {
  const fixture = TestBed.createComponent(KpiCardComponent);
  fixture.componentRef.setInput('config', config);
  fixture.componentRef.setInput('data', data);
  fixture.detectChanges();
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}

const PROXIES: KpiWidgetConfig = {
  type: 'kpi',
  label: 'Proxies',
  secondary: {
    filter: [{ term: { 'ecm:isTrashed': true } }],
    label: '{value} targeting trashed',
  },
};

describe('KpiCardComponent', () => {
  it('renders the main figure', () => {
    const text = mount({ type: 'kpi', label: 'Total' }, { kind: 'scalar', value: 1234 });
    expect(text).toContain((1234).toLocaleString());
  });

  it('shows a dash rather than a zero when there is no data', () => {
    expect(mount({ type: 'kpi', label: 'Total' })).toContain('—');
  });

  it('interpolates the secondary template', () => {
    const text = mount(PROXIES, { kind: 'scalar', value: 300, secondary: 10 });
    expect(text).toContain('10 targeting trashed');
  });

  it('shows a zero secondary by default', () => {
    const text = mount(PROXIES, { kind: 'scalar', value: 300, secondary: 0 });
    expect(text).toContain('0 targeting trashed');
  });

  it('hides a zero secondary when asked, which keeps the versions tile clean', () => {
    const config: KpiWidgetConfig = {
      type: 'kpi',
      label: 'Versions',
      secondary: {
        filter: [{ term: { 'ecm:isTrashed': true } }],
        label: '{value} trashed',
        hideWhenZero: true,
      },
    };

    expect(mount(config, { kind: 'scalar', value: 700, secondary: 0 })).not.toContain('trashed');
    expect(mount(config, { kind: 'scalar', value: 700, secondary: 4 })).toContain('4 trashed');
  });

  it('renders no secondary line when the data carries none', () => {
    expect(mount(PROXIES, { kind: 'scalar', value: 300 })).not.toContain('targeting trashed');
  });

  it('formats the secondary with its own format', () => {
    const config: KpiWidgetConfig = {
      type: 'kpi',
      label: 'Storage',
      format: 'bytes',
      secondary: { filter: [], label: '{value} in trash', format: 'bytes' },
    };

    const text = mount(config, { kind: 'scalar', value: 5_000_000_000, secondary: 1_500_000 });
    expect(text).toContain('5.0 GB');
    expect(text).toContain('1.5 MB in trash');
  });
});
