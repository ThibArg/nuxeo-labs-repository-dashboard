import { TestBed } from '@angular/core/testing';
import { TableWidgetConfig } from '../config/dashboard-config.model';
import { WidgetData } from '../engine/result-mapper';
import { DataTableComponent } from './data-table.component';

const YESTERDAY = new Date(Date.now() - 86_400_000).toISOString();

const CONFIG: TableWidgetConfig = {
  type: 'table',
  label: 'Expired Documents',
  columns: [
    { field: 'dc:title', label: 'Title', link: 'document' },
    { field: 'ecm:primaryType', label: 'Type', labels: 'doctype' },
    { field: 'dc:expired', label: 'Expiry date', format: 'date' },
    { field: 'dc:expired', label: 'Days left', format: 'daysUntil' },
    { field: 'file:content.length', label: 'Size', format: 'bytes' },
  ],
};

const ROWS: WidgetData = {
  kind: 'rows',
  total: 7,
  rows: [
    {
      id: 'uuid-1',
      source: {
        'ecm:uuid': 'uuid-1',
        'dc:title': 'Expired contract',
        'ecm:primaryType': 'File',
        'dc:expired': YESTERDAY,
        'file:content.length': 5_000_000,
      },
    },
  ],
};

function mount(data?: WidgetData, labels = new Map<string, Map<string, string>>()) {
  const fixture = TestBed.createComponent(DataTableComponent);
  fixture.componentRef.setInput('config', CONFIG);
  fixture.componentRef.setInput('data', data);
  fixture.componentRef.setInput('labels', labels);
  fixture.detectChanges();
  return fixture;
}

function text(fixture: { nativeElement: unknown }): string {
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}

describe('DataTableComponent', () => {
  it('renders one header per configured column', () => {
    const headers = Array.from(
      (mount(ROWS).nativeElement as HTMLElement).querySelectorAll('th'),
    ).map((cell) => cell.textContent?.trim());

    expect(headers).toEqual(['Title', 'Type', 'Expiry date', 'Days left', 'Size']);
  });

  it('applies each column format', () => {
    const content = text(mount(ROWS));

    expect(content).toContain('Expired contract');
    expect(content).toContain(new Date(YESTERDAY).toLocaleDateString());
    expect(content).toContain('1 days ago');
    expect(content).toContain('5.0 MB');
  });

  it('reads a dotted path out of a flattened source', () => {
    expect(text(mount(ROWS))).toContain('5.0 MB');
  });

  it('prefers a resolved label over the raw value', () => {
    const labels = new Map([['ecm:primaryType', new Map([['File', 'Fichier']])]]);
    const content = text(mount(ROWS, labels));

    expect(content).toContain('Fichier');
    expect(content).not.toContain('>File<');
  });

  it('links a column back to the document in Web UI', () => {
    const link = (mount(ROWS).nativeElement as HTMLElement).querySelector('a');
    expect(link?.getAttribute('href')).toContain('/ui/#!/doc/uuid-1');
  });

  it('shows the total, not the number of rows on the page', () => {
    expect(text(mount(ROWS))).toContain('7 documents');
  });

  it('uses the singular for a single document', () => {
    expect(text(mount({ kind: 'rows', total: 1, rows: ROWS.rows as never }))).toContain(
      '1 document',
    );
  });

  it('shows an empty state rather than an empty table', () => {
    const content = text(mount({ kind: 'rows', total: 0, rows: [] }));

    expect(content).toContain('No data for the current filters');
    expect(content).not.toContain('Expired contract');
  });

  it('shows a dash for a missing value', () => {
    const missing: WidgetData = {
      kind: 'rows',
      total: 1,
      rows: [{ id: 'uuid-2', source: { 'ecm:uuid': 'uuid-2', 'dc:title': 'No expiry' } }],
    };

    expect(text(mount(missing))).toContain('—');
  });
});
