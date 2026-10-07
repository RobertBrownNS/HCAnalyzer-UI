import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatSliderModule } from '@angular/material/slider';

import { fiscalYearLabel } from '../core/transform';
import { ExplorerStore } from './explorer-store';

interface RangePreset {
  label: string;
  years: number | null; // null = all available years
}

const PRESETS: RangePreset[] = [
  { label: 'All years', years: null },
  { label: 'Last 10', years: 10 },
  { label: 'Last 5', years: 5 },
];

@Component({
  selector: 'app-range-control',
  imports: [MatSliderModule, MatButtonModule],
  template: `
    @if (years().length > 1) {
      <div class="readout" aria-live="polite">{{ fromLabel() }} to {{ toLabel() }}</div>
      <mat-slider
        class="slider"
        [min]="min()"
        [max]="max()"
        [step]="1"
        discrete
        [displayWith]="shortLabel"
      >
        <input
          matSliderStartThumb
          aria-label="First fiscal year"
          [value]="from()"
          (valueChange)="setRange($event, to())"
        />
        <input
          matSliderEndThumb
          aria-label="Last fiscal year"
          [value]="to()"
          (valueChange)="setRange(from(), $event)"
        />
      </mat-slider>
      <div class="presets" role="group" aria-label="Range presets">
        @for (p of presets; track p.label) {
          <button matButton="outlined" type="button" (click)="applyPreset(p)">{{ p.label }}</button>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .readout {
      font: var(--mat-sys-label-large);
      color: var(--mat-sys-on-surface-variant);
    }
    .slider {
      width: 100%;
      margin: 0;
    }
    .presets {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .presets button {
      min-height: var(--touch-target);
    }
  `,
})
export class RangeControlComponent {
  private readonly store = inject(ExplorerStore);
  readonly presets = PRESETS;

  readonly years = this.store.years;
  readonly min = computed(() => this.years()[0] ?? 0);
  readonly max = computed(() => this.years().at(-1) ?? 0);
  readonly from = computed(() => this.store.settings().range[0]);
  readonly to = computed(() => this.store.settings().range[1]);
  readonly fromLabel = computed(() => fiscalYearLabel(this.from()));
  readonly toLabel = computed(() => fiscalYearLabel(this.to()));

  /** Thumb label: "FY 2020-21" is too wide for the thumb, so show "20-21". */
  readonly shortLabel = (fy: number) => fiscalYearLabel(fy).slice(5);

  setRange(from: number, to: number): void {
    this.store.update({ range: [from, to] });
  }

  applyPreset(p: RangePreset): void {
    const max = this.max();
    this.setRange(p.years === null ? this.min() : Math.max(this.min(), max - p.years + 1), max);
  }
}
