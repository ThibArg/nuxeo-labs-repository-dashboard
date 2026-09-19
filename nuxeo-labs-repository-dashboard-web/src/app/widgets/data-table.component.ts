import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ColumnConfig, TableWidgetConfig } from '../config/dashboard-config.model';
import { NuxeoHttpService } from '../core/nuxeo-http.service';
import { formatCell, readSource } from '../core/format';
import { WidgetData, isEmptyData } from '../engine/result-mapper';
import { WidgetHostComponent } from './widget-host.component';

interface RenderedCell {
  text: string;
  href: string | null;
}

interface RenderedRow {
  id: string;
  cells: RenderedCell[];
}

@Component({
  selector: 'nxd-data-table',
  imports: [WidgetHostComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full' },
  template: `
    <nxd-widget-host
      [label]="config().label"
      [hint]="config().hint ?? null"
      [badge]="badge()"
      [loading]="loading()"
      [error]="error()"
      [empty]="empty()"
    >
      <div class="-mx-2 overflow-x-auto">
        <table class="w-full border-collapse text-sm">
          <thead>
            <tr class="border-b border-border">
              @for (column of config().columns; track $index) {
                <th
                  class="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-muted"
                  [class]="column.width ?? ''"
                >
                  {{ column.label }}
                </th>
              }
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track row.id) {
              <tr class="border-b border-border/60 last:border-0 hover:bg-canvas">
                @for (cell of row.cells; track $index) {
                  <td class="px-2 py-2.5 text-ink">
                    @if (cell.href) {
                      <a class="text-accent hover:underline" [href]="cell.href" [title]="cell.text">
                        {{ cell.text }}
                      </a>
                    } @else {
                      <span class="block max-w-xs truncate" [title]="cell.text">{{
                        cell.text
                      }}</span>
                    }
                  </td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
    </nxd-widget-host>
  `,
})
export class DataTableComponent {
  private readonly http = inject(NuxeoHttpService);

  readonly config = input.required<TableWidgetConfig>();
  readonly data = input<WidgetData | undefined>(undefined);
  readonly labels = input<Map<string, Map<string, string>>>(new Map());
  readonly loading = input(false);
  readonly error = input<string | null>(null);

  readonly empty = computed(() => isEmptyData(this.data()));

  readonly badge = computed(() => {
    const data = this.data();
    if (!data || data.kind !== 'rows') {
      return null;
    }
    return data.total === 1 ? '1 document' : `${data.total.toLocaleString()} documents`;
  });

  readonly rows = computed<RenderedRow[]>(() => {
    const data = this.data();
    if (!data || data.kind !== 'rows') {
      return [];
    }
    const columns = this.config().columns;
    return data.rows.map((row) => ({
      id: row.id,
      cells: columns.map((column) => this.renderCell(row.id, row.source, column)),
    }));
  });

  private renderCell(
    documentId: string,
    source: Record<string, unknown>,
    column: ColumnConfig,
  ): RenderedCell {
    const raw = readSource(source, column.field);
    const resolved = column.labels ? this.labels().get(column.field) : undefined;

    const one = (value: unknown): string =>
      resolved?.get(String(value)) ?? formatCell(value, column.format);
    // A multivalued property is labelled element by element, then joined as `formatCell` would.
    const text = Array.isArray(raw) && resolved ? raw.map(one).join(', ') : one(raw);

    return {
      text,
      href: column.link === 'document' ? this.documentUrl(documentId) : null,
    };
  }

  /** Deep link into Web UI's document view. */
  private documentUrl(documentId: string): string {
    return `${this.http.serverRoot}/ui/#!/doc/${documentId}`;
  }
}
