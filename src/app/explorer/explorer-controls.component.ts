import { Component, computed, inject, input } from '@angular/core';

import {
  CPI_LABELS,
  CPI_PERIOD_LABELS,
  FLOW_LABELS,
  MEASURE_LABELS,
  TRANSFER_LABELS,
  fundScopeLabel,
  isReal,
} from '../core/labels';
import { Flow } from '../core/models';
import { CpiIndex, CpiPeriod, Measure, TransferMode, fiscalYearLabel } from '../core/transform';
import { ExplorerStore } from './explorer-store';
import { RangeControlComponent } from './range-control.component';

export type ControlGroup = 'flow' | 'measure' | 'range' | 'funds' | 'inflation';

function entries<K extends string>(labels: Record<K, string>): { value: K; label: string }[] {
  return (Object.keys(labels) as K[]).map((value) => ({ value, label: labels[value] }));
}

/**
 * Settings controls. Renders every group (desktop side panel) or a single group
 * (phone bottom sheet). The range group is shown under the chart on all layouts,
 * so the side panel omits it.
 */
@Component({
  selector: 'app-explorer-controls',
  imports: [RangeControlComponent],
  templateUrl: './explorer-controls.component.html',
  styleUrl: './explorer-controls.component.scss',
})
export class ExplorerControlsComponent {
  /** Show only this group; null shows all groups except range. */
  readonly only = input<ControlGroup | null>(null);

  private readonly store = inject(ExplorerStore);
  readonly settings = this.store.settings;
  readonly years = this.store.years;

  readonly flows = entries(FLOW_LABELS);
  readonly measures = entries(MEASURE_LABELS);
  readonly cpiIndexes = entries(CPI_LABELS);
  readonly cpiPeriods = entries(CPI_PERIOD_LABELS);
  readonly transferModes = entries(TRANSFER_LABELS);
  readonly fyLabel = fiscalYearLabel;

  readonly real = computed(() => isReal(this.settings().measure));
  readonly scope = computed(() => fundScopeLabel(this.settings()));

  value(e: Event): string {
    return (e.target as HTMLSelectElement).value;
  }
  checked(e: Event): boolean {
    return (e.target as HTMLInputElement).checked;
  }

  show(group: ControlGroup): boolean {
    const only = this.only();
    return only === null ? group !== 'range' : only === group;
  }

  setFlow(flow: string): void {
    this.store.update({ flow: flow as Flow });
  }
  setMeasure(measure: string): void {
    this.store.update({ measure: measure as Measure });
  }
  setBaseYear(baseYear: number): void {
    this.store.update({ baseYear });
  }
  setIndexTo100(indexTo100: boolean): void {
    this.store.update({ indexTo100 });
  }
  setIncludeCustodial(includeCustodial: boolean): void {
    this.store.update({ includeCustodial });
  }
  setCpiIndex(cpiIndex: string): void {
    this.store.update({ cpiIndex: cpiIndex as CpiIndex });
  }
  setCpiPeriod(cpiPeriod: string): void {
    this.store.update({ cpiPeriod: cpiPeriod as CpiPeriod });
  }
  setTransfers(transfers: string): void {
    this.store.update({ transfers: transfers as TransferMode });
  }
  reset(): void {
    this.store.reset();
  }
}
