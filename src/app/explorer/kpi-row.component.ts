import { Component, computed, input } from '@angular/core';

import { KpiCard, KpiId } from './kpi';

/** KPI cards for the current settings. `ids` picks which cards to show, in order. */
@Component({
  selector: 'app-kpi-row',
  template: `
    @if (loading()) {
      <!-- Same grid and card boxes as the real cards, so nothing moves when data arrives. -->
      <div class="row" [style.--kpi-cols]="ids().length" aria-hidden="true" [class.fx-skel-pending]="!reveal()">
        @for (id of ids(); track id) {
          <div class="fx-tile card skel" [style.border-top-color]="id === 'custodial' ? null : seriesColor()">
            <span class="fx-skel fx-skel-line" style="--line: var(--fx-type-body-small-line-height); width: 55%"></span>
            <span class="fx-skel fx-skel-line value-skel"></span>
            <span class="fx-skel fx-skel-line" style="--line: var(--fx-type-caption-line-height); width: 70%"></span>
          </div>
        }
      </div>
    } @else {
    <ul class="row" [style.--kpi-cols]="shown().length" aria-label="Summary for the selected years">
      @for (c of shown(); track c.id) {
        <li class="fx-tile card" [style.border-top-color]="c.accent === 'series' ? seriesColor() : null">
          <div class="label">{{ c.label }}</div>
          <div class="value">{{ c.value }}</div>
          <div class="sub">{{ c.sub }}</div>
        </li>
      }
    </ul>
    }
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
      // Fixed minimum (label + value + sub-line rows) so cards keep their size whatever the
      // text, and the loading placeholder matches. Phones allow the sub-line to wrap once.
      --kpi-value-line: var(--fx-type-kpi-compact-line-height);
      --kpi-sub-lines: 2;
      min-height: calc(
        var(--fx-kpi-accent) + 2 * var(--fx-space-2) + var(--fx-type-body-small-line-height) +
          2 * var(--fx-space-0) + var(--kpi-value-line) +
          var(--kpi-sub-lines) * var(--fx-type-caption-line-height)
      );
    }
    :host(.wide) .card {
      --kpi-value-line: var(--fx-type-kpi-line-height);
      --kpi-sub-lines: 1;
    }
    .value-skel {
      --line: var(--kpi-value-line);
      width: 45%;
      margin-top: calc(var(--fx-space-0) + var(--kpi-value-line) * 0.15);
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
  /** Show placeholders in the same boxes (data still loading). */
  readonly loading = input(false);
  /** Placeholders become visible (after the short delay). */
  readonly reveal = input(false);

  readonly shown = computed(() => {
    const byId = new Map(this.cards().map((c) => [c.id, c]));
    return this.ids()
      .map((id) => byId.get(id))
      .filter((c): c is KpiCard => c !== undefined);
  });
}
