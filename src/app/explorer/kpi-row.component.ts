import { Component, computed, input } from '@angular/core';

import { KpiCard, KpiId } from './kpi';

/** KPI cards for the current settings. `ids` picks which cards to show, in order. */
@Component({
  selector: 'app-kpi-row',
  template: `
    <ul class="row" [style.--kpi-cols]="shown().length" aria-label="Summary for the selected years">
      @for (c of shown(); track c.id) {
        <li class="fx-tile card" [style.border-top-color]="c.accent === 'series' ? seriesColor() : null">
          <div class="label">{{ c.label }}</div>
          <div class="value">{{ c.value }}</div>
          <div class="sub">{{ c.sub }}</div>
        </li>
      }
    </ul>
  `,
  styles: `
    :host {
      display: block;
    }
    .row {
      display: grid;
      grid-template-columns: repeat(var(--kpi-cols), minmax(0, 1fr));
      gap: var(--fx-space-2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .card {
      border-top: var(--fx-kpi-accent) solid var(--fx-color-kpi-neutral);
      padding: var(--fx-space-2) var(--fx-space-3);
    }
    .label {
      font: var(--fx-type-body-small);
      color: var(--fx-color-text-muted);
    }
    .value {
      margin-top: var(--fx-space-0);
      font: var(--fx-type-kpi-compact);
      color: var(--fx-color-text);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .sub {
      margin-top: var(--fx-space-0);
      font: var(--fx-type-caption);
      color: var(--fx-color-text-muted);
    }
    :host(.wide) .value {
      font: var(--fx-type-kpi);
    }
  `,
})
export class KpiRowComponent {
  readonly cards = input.required<KpiCard[]>();
  readonly ids = input<KpiId[]>(['end', 'start', 'change', 'custodial']);
  /** CSS color for 'series' accents, e.g. var(--fx-series-1). */
  readonly seriesColor = input.required<string>();

  readonly shown = computed(() => {
    const byId = new Map(this.cards().map((c) => [c.id, c]));
    return this.ids()
      .map((id) => byId.get(id))
      .filter((c): c is KpiCard => c !== undefined);
  });
}
