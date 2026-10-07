import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { MatSliderModule } from '@angular/material/slider';

import { fiscalYearLabel } from '../core/transform';
import { ExplorerStore } from './explorer-store';
import { SKELETON_DELAY_MS } from './skeleton';

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
  imports: [MatSliderModule],
  template: `
    @if (years().length > 1) {
      <div class="readout" aria-live="polite">{{ fromLabel() }} – {{ toLabel() }}</div>
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
          (dragStart)="onDragStart()"
          (valueChange)="onThumbChange('start', $event)"
          (dragEnd)="onDragEnd('start', $event.value)"
        />
        <input
          matSliderEndThumb
          aria-label="Last fiscal year"
          [value]="to()"
          (dragStart)="onDragStart()"
          (valueChange)="onThumbChange('end', $event)"
          (dragEnd)="onDragEnd('end', $event.value)"
        />
      </mat-slider>
      <div class="presets" role="group" aria-label="Range presets">
        @for (p of presets; track p.label) {
          <button type="button" class="fx-button" (click)="applyPreset(p)">{{ p.label }}</button>
        }
      </div>
    } @else {
      <!-- Years not known yet (data loading): same boxes as above, so nothing moves later. -->
      <div class="pending" aria-hidden="true" [class.fx-skel-pending]="!revealSkeleton()">
        <span class="fx-skel fx-skel-line readout-skel"></span>
        <span class="slider-skel"><span class="fx-skel track-skel"></span></span>
        <div class="presets">
          @for (p of presets; track p.label) {
            <button type="button" class="fx-button" disabled tabindex="-1">{{ p.label }}</button>
          }
        </div>
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .readout {
      font: var(--fx-type-numeric);
      color: var(--fx-color-text);
    }
    .slider {
      width: 100%;
      margin: 0;
    }
    .readout-skel {
      --line: var(--fx-type-numeric-line-height);
      width: 12rem;
      max-width: 60%;
    }
    .slider-skel {
      display: flex;
      align-items: center;
      height: var(--fx-slider-height);
    }
    .track-skel {
      width: 100%;
      height: var(--fx-space-1);
      border-radius: var(--fx-radius-full);
    }
    .presets {
      display: flex;
      flex-wrap: wrap;
      gap: var(--fx-space-2);
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

  /** The placeholder appears only if the years take longer than SKELETON_DELAY_MS. */
  readonly revealSkeleton = signal(false);

  constructor() {
    const t = setTimeout(() => this.revealSkeleton.set(true), SKELETON_DELAY_MS);
    inject(DestroyRef).onDestroy(() => clearTimeout(t));
  }

  /** True between a thumb's pointer down and up. */
  private dragging = false;

  setRange(from: number, to: number): void {
    this.store.update({ range: [from, to] });
  }

  // QA-23: a pointer press moves the thumb (and emits valueChange) before the drag ends, which
  // made one drag two history entries. During a drag nothing is committed; the final value is
  // committed once on dragEnd. Keyboard changes (no drag) commit immediately.
  onDragStart(): void {
    this.dragging = true;
  }

  onThumbChange(thumb: 'start' | 'end', value: number): void {
    if (!this.dragging) this.commit(thumb, value);
  }

  onDragEnd(thumb: 'start' | 'end', value: number): void {
    this.dragging = false;
    this.commit(thumb, value);
  }

  private commit(thumb: 'start' | 'end', value: number): void {
    if (thumb === 'start') this.setRange(value, this.to());
    else this.setRange(this.from(), value);
  }

  applyPreset(p: RangePreset): void {
    const max = this.max();
    this.setRange(p.years === null ? this.min() : Math.max(this.min(), max - p.years + 1), max);
  }
}
