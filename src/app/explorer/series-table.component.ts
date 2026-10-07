import { Component, computed, input } from '@angular/core';

import { crossCheckYearText } from '../core/cross-check';
import { formatCount, formatCpi, formatUsd, formatValue } from '../core/format';
import { CrossCheckRange } from '../core/models';
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
            @if (crossCheck()) {
              <th scope="col">Cross-check</th>
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
              @if (crossCheck(); as check) {
                <td class="check">{{ checkLabel(check.get(p.fiscalYear) ?? null) }}</td>
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
      padding: var(--fx-space-2) var(--fx-space-3);
      border-top: var(--fx-border-width) solid var(--fx-color-outline-variant);
      text-align: left;
      vertical-align: top;
    }
    tbody th {
      white-space: nowrap;
    }
    thead th.num {
      font: inherit; // headers are text: only the figures use the mono face
      font-weight: var(--fx-weight-semibold);
    }
    thead th {
      position: sticky;
      top: 0;
      background: var(--fx-color-surface-container);
    }
    .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .check {
      white-space: nowrap;
    }
    .notes {
      min-width: var(--fx-notes-min-width);
      color: var(--fx-color-on-surface-variant);
      font: var(--fx-type-body-small);
    }
  `,
})
export class SeriesTableComponent {
  readonly points = input.required<SeriesPoint[]>();
  readonly settings = input.required<TransformSettings>();
  readonly valueLabel = input.required<string>();
  /** Cross-check status per year; null = the source has no coverage, so no column. */
  readonly crossCheck = input<ReadonlyMap<number, CrossCheckRange | null> | null>(null);

  checkLabel(range: CrossCheckRange | null): string {
    return range ? crossCheckYearText(range, 'short') : '—';
  }

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
