import { Component, computed, input } from '@angular/core';

import { formatCount, formatCpi, formatUsd, formatValue } from '../core/format';
import { isPerCapita, isReal } from '../core/labels';
import { SeriesPoint, TransformSettings, fiscalYearLabel } from '../core/transform';

@Component({
  selector: 'app-series-table',
  template: `
    <div class="scroll" tabindex="0" role="region" [attr.aria-label]="caption()">
      <table>
        <caption>{{ caption() }}</caption>
        <thead>
          <tr>
            <th scope="col">Fiscal year</th>
            <th scope="col" class="num">{{ valueLabel() }}</th>
            <th scope="col" class="num">Nominal total</th>
            @if (showPopulation()) {
              <th scope="col" class="num">Population (April 1)</th>
            }
            @if (showCpi()) {
              <th scope="col" class="num">CPI</th>
              <th scope="col" class="num">CPI {{ baseLabel() }} (base)</th>
            }
            <th scope="col">Notes</th>
          </tr>
        </thead>
        <tbody>
          @for (p of points(); track p.fiscalYear) {
            <tr>
              <th scope="row">{{ p.label }}</th>
              <td class="num">{{ fmt(p.value) }}</td>
              <td class="num">{{ usd(p.nominal) }}</td>
              @if (showPopulation()) {
                <td class="num">{{ count(p.population) }}</td>
              }
              @if (showCpi()) {
                <td class="num">{{ cpi(p.cpi) }}</td>
                <td class="num">{{ cpi(p.cpiBase) }}</td>
              }
              <td class="notes">
                @for (n of p.notes; track $index) {
                  <div>{{ n }}</div>
                }
              </td>
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
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 8px;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      font: var(--mat-sys-body-medium);
    }
    caption {
      text-align: left;
      padding: 8px 12px;
      font: var(--mat-sys-title-small);
    }
    th,
    td {
      padding: 8px 12px;
      border-top: 1px solid var(--mat-sys-outline-variant);
      text-align: left;
      vertical-align: top;
    }
    tbody th {
      white-space: nowrap;
    }
    thead th {
      position: sticky;
      top: 0;
      background: var(--mat-sys-surface-container);
    }
    .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .notes {
      min-width: 16rem;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
  `,
})
export class SeriesTableComponent {
  readonly points = input.required<SeriesPoint[]>();
  readonly settings = input.required<TransformSettings>();
  readonly valueLabel = input.required<string>();

  readonly showPopulation = computed(() => isPerCapita(this.settings().measure));
  readonly showCpi = computed(() => isReal(this.settings().measure));
  readonly baseLabel = computed(() => fiscalYearLabel(this.settings().baseYear));
  readonly caption = computed(() => {
    const pts = this.points();
    const span = pts.length ? `, ${pts[0].label} to ${pts[pts.length - 1].label}` : '';
    return `${this.valueLabel()}${span}`;
  });

  fmt(v: number | null): string {
    return formatValue(v, this.settings());
  }
  usd = formatUsd;
  count = formatCount;
  cpi = formatCpi;
}
