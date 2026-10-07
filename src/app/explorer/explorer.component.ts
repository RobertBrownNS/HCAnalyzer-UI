import { Component, ViewContainerRef, computed, inject, signal } from '@angular/core';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatProgressBarModule } from '@angular/material/progress-bar';

import {
  CPI_PERIOD_LABELS,
  CPI_SHORT_LABELS,
  FLOW_LABELS,
  MEASURE_LABELS,
  TRANSFER_LABELS,
  fundScopeLabel,
  isReal,
  transferLabel,
} from '../core/labels';
import { fiscalYearLabel } from '../core/transform';
import { ControlGroup, ExplorerControlsComponent } from './explorer-controls.component';
import { ExplorerStore } from './explorer-store';
import { MethodologyComponent } from './methodology.component';
import { RangeControlComponent } from './range-control.component';
import { SeriesChartComponent } from './series-chart.component';
import { SeriesTableComponent } from './series-table.component';
import { SettingsSheetComponent, SettingsSheetData } from './settings-sheet.component';
import { ViewNotesComponent } from './view-notes.component';

export interface SettingChip {
  group: ControlGroup;
  label: string;
  /** Accessible name: what the chip opens. */
  aria: string;
}

@Component({
  selector: 'app-explorer',
  imports: [
    ExplorerControlsComponent,
    MatButtonModule,
    MatButtonToggleModule,
    MatProgressBarModule,
    MethodologyComponent,
    RangeControlComponent,
    SeriesChartComponent,
    SeriesTableComponent,
    ViewNotesComponent,
  ],
  providers: [ExplorerStore],
  templateUrl: './explorer.component.html',
  styleUrl: './explorer.component.scss',
})
export class ExplorerComponent {
  readonly store = inject(ExplorerStore);
  private readonly sheet = inject(MatBottomSheet);
  private readonly vcr = inject(ViewContainerRef);

  readonly view = signal<'chart' | 'table'>('chart');

  readonly valueLabel = computed(() => {
    const s = this.store.settings();
    const parts = [FLOW_LABELS[s.flow], MEASURE_LABELS[s.measure].toLowerCase()];
    if (isReal(s.measure)) parts.push(`${fiscalYearLabel(s.baseYear)} dollars`);
    if (s.indexTo100) parts.push(`index, ${fiscalYearLabel(s.baseYear)} = 100`);
    return parts.join(', ');
  });

  /** "All funds as reported by EDR, excluding custodial. Transfers between funds: as reported (gross)" */
  readonly scopeLine = computed(() => {
    const s = this.store.settings();
    return `${fundScopeLabel(s)}. ${transferLabel(s)}.`;
  });

  readonly chips = computed<SettingChip[]>(() => {
    const s = this.store.settings();
    const chips: SettingChip[] = [
      { group: 'flow', label: FLOW_LABELS[s.flow], aria: 'Data' },
      { group: 'measure', label: MEASURE_LABELS[s.measure], aria: 'Measure' },
    ];
    if (isReal(s.measure) || s.indexTo100) {
      const base = fiscalYearLabel(s.baseYear);
      chips.push({ group: 'measure', label: s.indexTo100 ? `${base} = 100` : `${base} dollars`, aria: 'Base year' });
    }
    chips.push({
      group: 'range',
      label: `${fiscalYearLabel(s.range[0])} to ${fiscalYearLabel(s.range[1])}`,
      aria: 'Fiscal years',
    });
    chips.push({
      group: 'funds',
      label: s.includeCustodial ? 'Custodial included' : 'Custodial excluded',
      aria: 'Custodial fund',
    });
    chips.push({
      group: 'funds',
      label: `Transfers: ${TRANSFER_LABELS[s.transfers ?? 'gross'].toLowerCase()}`,
      aria: 'Transfers between funds',
    });
    if (isReal(s.measure)) {
      chips.push({
        group: 'inflation',
        label: `${CPI_SHORT_LABELS[s.cpiIndex]}, ${CPI_PERIOD_LABELS[s.cpiPeriod].split(' ')[0].toLowerCase()}`,
        aria: 'Inflation index',
      });
    }
    return chips;
  });

  openSheet(group: ControlGroup): void {
    this.sheet.open<SettingsSheetComponent, SettingsSheetData>(SettingsSheetComponent, {
      data: { group },
      // Lets the sheet inject this page's ExplorerStore.
      viewContainerRef: this.vcr,
      ariaLabel: 'Chart settings',
    });
  }
}
