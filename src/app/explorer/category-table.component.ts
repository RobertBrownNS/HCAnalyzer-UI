import { Component, computed, input, output } from '@angular/core';

import { formatValue } from '../core/format';
import { CategorySeries, SeriesPoint, TransformSettings } from '../core/transform';
import { ChartType } from '../core/view-state';
import { formatShare } from './category-chart';

/**
 * Table for the category charts: one row per fiscal year, one column per category, plus the total
 * for stacked area, share and bars. Shows shares on the 100% share chart, values otherwise. Every
 * cell opens the source drawer for that value.
 */
@Component({
  selector: 'app-category-table',
  template: `
    <div class="scroll" tabindex="0" role="region" [attr.aria-label]="caption()">
      <table>
        <caption>{{ caption() }}</caption>
        <thead>
          <tr>
            <th scope="col">Fiscal year</th>
            @for (c of categories(); track c.category) {
              <th scope="col" class="num-h">{{ labels()[c.category] ?? c.category }}</th>
            }
            @if (showTotal()) {
              <th scope="col" class="num-h">Total</th>
            }
          </tr>
        </thead>
        <tbody>
          @for (p of total(); track p.fiscalYear; let i = $index) {
            <tr>
              <th scope="row">{{ p.label }}</th>
              @for (c of categories(); track c.category) {
                <td class="num">
                  <button
                    type="button"
                    class="cell"
                    [attr.aria-label]="(labels()[c.category] ?? c.category) + ', ' + p.label + ': ' + cell(c.points[i]) + '. Show sources'"
                    (click)="cellSelect.emit({ fiscalYear: p.fiscalYear, category: c.category })"
                  >
                    {{ cell(c.points[i]) }}
                  </button>
                </td>
              }
              @if (showTotal()) {
                <td class="num total">
                  <button
                    type="button"
                    class="cell"
                    [attr.aria-label]="'Total, ' + p.label + ': ' + totalCell(p) + '. Show sources'"
                    (click)="cellSelect.emit({ fiscalYear: p.fiscalYear, category: null })"
                  >
                    {{ totalCell(p) }}
                  </button>
                </td>
              }
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-height: 0;
    }
    .scroll {
      overflow: auto;
      max-height: 100%;
      border: var(--fx-border-width) solid var(--fx-color-outline-variant);
      border-radius: var(--fx-radius-sm);
    }
    table {
      border-collapse: collapse;
      width: 100%;
      font: var(--fx-type-body-medium);
    }
    caption {
      text-align: left;
      padding: var(--fx-space-2) var(--fx-space-3);
      font: var(--fx-type-title-small);
    }
    th,
    td {
      padding: 0 var(--fx-space-2);
      border-top: var(--fx-border-width) solid var(--fx-color-outline-variant);
      text-align: left;
      vertical-align: middle;
    }
    thead th {
      position: sticky;
      top: 0;
      background: var(--fx-color-surface-container);
      padding: var(--fx-space-2);
    }
    tbody th {
      white-space: nowrap;
    }
    .num-h {
      text-align: right;
    }
    .num {
      text-align: right;
    }
    .total {
      font-weight: var(--fx-weight-semibold);
    }
    .cell {
      min-height: var(--fx-control-h);
      width: 100%;
      padding: 0;
      border: 0;
      background: transparent;
      color: inherit;
      font: var(--fx-type-numeric);
      font-variant-numeric: tabular-nums;
      text-align: right;
      white-space: nowrap;
      cursor: pointer;

      &:hover {
        text-decoration: underline;
      }
    }
  `,
})
export class CategoryTableComponent {
  readonly total = input.required<SeriesPoint[]>();
  readonly categories = input.required<readonly CategorySeries[]>();
  readonly labels = input<Readonly<Record<string, string>>>({});
  readonly settings = input.required<TransformSettings>();
  readonly chartType = input.required<ChartType>();
  readonly valueLabel = input.required<string>();
  readonly cellSelect = output<{ fiscalYear: number; category: string | null }>();

  readonly showTotal = computed(() => this.chartType() !== 'lines');
  private readonly isShare = computed(() => this.chartType() === 'share');

  readonly caption = computed(() => {
    const pts = this.total();
    const span = pts.length ? `, ${pts[0].label} to ${pts[pts.length - 1].label}` : '';
    const unit = this.isShare() ? 'share of the selected total (%)' : this.valueLabel();
    return `By category: ${unit}${span}`;
  });

  cell(p: { value: number | null; share: number | null } | undefined): string {
    if (!p) return '—';
    return this.isShare() ? formatShare(p.share) : formatValue(p.value, this.valueSettings());
  }

  totalCell(p: SeriesPoint): string {
    return this.isShare() ? formatShare(p.value === null ? null : 100) : formatValue(p.value, this.valueSettings());
  }

  /** Stacked area, share and bars show values without index-to-100 (see ExplorerStore.categorySeries). */
  private valueSettings(): TransformSettings {
    const s = this.settings();
    return this.chartType() === 'lines' ? s : { ...s, indexTo100: false };
  }
}
