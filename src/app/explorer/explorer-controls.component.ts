import { Component, computed, inject, input } from '@angular/core';
import { MatBottomSheetRef } from '@angular/material/bottom-sheet';

import {
  CPI_LABELS,
  CPI_PERIOD_LABELS,
  FLOW_LABELS,
  MEASURE_LABELS,
  TRANSFER_LABELS,
  fundScopeLabel,
  isReal,
} from '../core/labels';
import { countyShortName } from '../core/county';
import { DataService } from '../core/data.service';
import { Flow } from '../core/models';
import { categoryLabel, fundGroups, fundsIncludedText, matchingPreset } from '../core/scope';
import { isCategoryChart } from '../core/view-state';
import { CpiIndex, CpiPeriod, Measure, TransferMode, fiscalYearLabel } from '../core/transform';
import { ExplorerStore } from './explorer-store';
import { MAPPING_ID } from './methodology.component';
import { RangeControlComponent } from './range-control.component';

export type ControlGroup = 'county' | 'flow' | 'measure' | 'range' | 'funds' | 'categories' | 'inflation';

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
  private readonly data = inject(DataService);
  readonly settings = this.store.settings;
  readonly years = this.store.years;

  readonly flows = entries(FLOW_LABELS);
  readonly measures = entries(MEASURE_LABELS);
  readonly cpiIndexes = entries(CPI_LABELS);
  readonly cpiPeriods = entries(CPI_PERIOD_LABELS);
  readonly transferModes = entries(TRANSFER_LABELS);
  readonly fyLabel = fiscalYearLabel;

  readonly real = computed(() => isReal(this.settings().measure));
  readonly county = this.store.county;
  /** Counties the data offers; before the list loads, the current county alone. */
  readonly counties = computed(() => {
    const ids = this.store.counties();
    const names = this.store.countyNames();
    return (ids.length ? ids : [this.county()]).map((id) => ({ value: id, label: countyShortName(id, names) }));
  });
  readonly scope = computed(() => fundScopeLabel(this.settings(), this.store.fundScope()));

  value(e: Event): string {
    return (e.target as HTMLSelectElement).value;
  }
  checked(e: Event): boolean {
    return (e.target as HTMLInputElement).checked;
  }

  show(group: ControlGroup): boolean {
    const only = this.only();
    if (only !== null) return only === group;
    // The side panel omits the range (shown under the chart); categories only for category charts.
    return group !== 'range' && (group !== 'categories' || isCategoryChart(this.store.view().chart));
  }

  // --- Funds (D-18) ---
  private readonly fundsMeta = this.data.fundsMeta;
  readonly fundGroups = computed(() => fundGroups(this.store.fundsAvailable(), this.fundsMeta()));
  readonly presets = computed(() => this.fundsMeta()?.presets ?? []);
  readonly matchedPreset = computed(() =>
    matchingPreset(this.settings().funds ?? null, this.store.fundsAvailable(), this.fundsMeta()),
  );
  /** What the matched preset includes, fund by fund (QA-07); empty for a custom selection. */
  readonly scopeDescription = computed(() => {
    const p = this.presets().find((x) => x.id === this.matchedPreset());
    return p ? fundsIncludedText(p.funds, this.store.fundsAvailable(), this.fundsMeta()) : '';
  });
  readonly netAllowed = this.store.netAllowed;
  private readonly selectedFunds = computed(() => this.settings().funds ?? this.store.fundsAvailable());
  readonly selectedFundCount = computed(() => this.selectedFunds().length);

  isFundSelected(id: string): boolean {
    return this.selectedFunds().includes(id);
  }
  toggleFund(id: string, on: boolean): void {
    const current = this.selectedFunds();
    const next = on ? [...new Set([...current, id])] : current.filter((f) => f !== id);
    if (next.length) this.store.update({ funds: next });
  }
  applyPreset(funds: readonly string[]): void {
    this.store.update({ funds: funds.filter((id) => this.store.fundsAvailable().includes(id)) });
  }

  // --- Categories (D-19) ---
  readonly categoryOptions = computed(() =>
    this.store.categoriesAvailable().map((id) => ({ id, label: categoryLabel(id, this.data.categoriesMeta()) })),
  );
  readonly hasMapping = computed(() => (this.data.categoriesMeta()?.length ?? 0) > 0);
  private readonly sheetRef = inject(MatBottomSheetRef, { optional: true });

  /** Moves to the mapping table in "Settings and sources", closing the phone sheet first. */
  showMapping(): void {
    const go = () => {
      const target = document.getElementById(MAPPING_ID);
      target?.scrollIntoView({ block: 'start' });
      target?.focus({ preventScroll: true });
    };
    if (this.sheetRef) {
      this.sheetRef.afterDismissed().subscribe(go);
      this.sheetRef.dismiss();
    } else {
      go();
    }
  }
  private readonly selectedCategories = computed(() => this.settings().categories ?? this.store.categoriesAvailable());
  readonly selectedCategoryCount = computed(() => this.selectedCategories().length);

  isCategorySelected(id: string): boolean {
    return this.selectedCategories().includes(id);
  }
  toggleCategory(id: string, on: boolean): void {
    const current = this.selectedCategories();
    const next = on ? [...new Set([...current, id])] : current.filter((c) => c !== id);
    if (next.length) this.store.update({ categories: next });
  }
  allCategories(): void {
    this.store.update({ categories: undefined });
  }

  setCounty(jurisdiction: string): void {
    this.store.update({ jurisdiction });
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
