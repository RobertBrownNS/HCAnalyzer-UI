import { Component } from '@angular/core';

/** Chart placeholder: y-axis ticks, gridlines, x-axis labels and a shimmer block. Decorative only. */
@Component({
  selector: 'app-chart-skeleton',
  host: { 'aria-hidden': 'true' },
  template: `
    <div class="ticks">
      @for (t of rows; track t) {
        <span class="fx-skel fx-skel-line tick" style="--line: var(--fx-type-axis-line-height)"></span>
      }
    </div>
    <div class="plot">
      @for (t of rows; track t) {
        <span class="grid"></span>
      }
      <span class="fx-skel block"></span>
    </div>
    <div class="xaxis">
      @for (t of cols; track t) {
        <span class="fx-skel fx-skel-line xlabel" style="--line: var(--fx-type-axis-line-height)"></span>
      }
    </div>
  `,
  styles: `
    :host {
      display: grid;
      grid-template-columns: var(--fx-space-6) 1fr;
      grid-template-rows: 1fr auto;
      gap: var(--fx-space-2);
      height: 100%;
      min-height: var(--fx-chart-min-height);
      padding: var(--fx-space-6) var(--fx-space-4) var(--fx-space-2) var(--fx-space-2);
    }
    .ticks {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .tick {
      width: 100%;
    }
    .plot {
      position: relative;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      border-bottom: var(--fx-border-width) solid var(--fx-color-axis-line);
    }
    .grid {
      height: var(--fx-border-width);
      background: var(--fx-color-gridline);
    }
    .block {
      position: absolute;
      inset: 30% 0 0 0;
      border-radius: var(--fx-radius-sm) var(--fx-radius-sm) 0 0;
      opacity: 0.6;
    }
    .xaxis {
      grid-column: 2;
      display: flex;
      justify-content: space-between;
    }
    .xlabel {
      width: 12%;
    }
  `,
})
export class ChartSkeletonComponent {
  readonly rows = [0, 1, 2, 3, 4, 5];
  readonly cols = [0, 1, 2, 3, 4];
}
