import { Component, ViewContainerRef, computed, inject, linkedSignal, signal } from '@angular/core';
import { MatBottomSheet } from '@angular/material/bottom-sheet';

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
import { CROSS_CHECK_LABELS, mismatchLegendLabel } from '../core/cross-check';
import { CrossCheckRange } from '../core/models';
import { fiscalYearLabel } from '../core/transform';
import { CHART_LABELS, CHART_TYPES, ChartType, isCategoryChart } from '../core/view-state';
import { CategoryTableComponent } from './category-table.component';
import { ChartSkeletonComponent } from './chart-skeleton.component';
import { ControlGroup, ExplorerControlsComponent } from './explorer-controls.component';
import { ExplorerStore } from './explorer-store';
import { kpiCards, measureCaption, unitPhrase } from './kpi';
import { KpiRowComponent } from './kpi-row.component';
import { MethodologyComponent } from './methodology.component';
import { RangeControlComponent } from './range-control.component';
import { SeriesChartComponent } from './series-chart.component';
import { SeriesTableComponent } from './series-table.component';
import { SettingsSheetComponent, SettingsSheetData } from './settings-sheet.component';
import { SourceDrawerService } from './source-drawer.service';
import { ViewNotesComponent } from './view-notes.component';

export interface SettingChip {
  group: ControlGroup;
  label: string;
  /** Accessible name: what the chip opens. */
  aria: string;
  /** Full accessible name, e.g. "Data: Revenues. Change"; no doubled prefix (QA-37). */
  ariaLabel?: string;
}

@Component({
  selector: 'app-explorer',
  imports: [
    CategoryTableComponent,
    ChartSkeletonComponent,
    ExplorerControlsComponent,
    KpiRowComponent,
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

  /** Data not loaded yet: placeholders hold every box the content will fill. */
  readonly loading = this.store.loading;
  /** Placeholders are laid out at once but shown only after SKELETON_DELAY_MS (once per load). */
  readonly reveal = this.store.revealSkeleton;
  /**
   * The Filters pane shows its controls from the first successful load (or a load error) on; after
   * that they stay, including while another county loads.
   */
  readonly controlsReady = linkedSignal<boolean, boolean>({
    source: () => this.store.loaded() || !!this.store.error(),
    computation: (ready, previous) => ready || (previous?.value ?? false),
  });
  readonly skeletonFields = ['30%', '25%', '35%', '40%', '45%', '35%', '50%'];
  readonly skeletonTiles = [
    { heading: 'notes', lines: ['90%', '75%', '85%', '60%'] },
    { heading: 'sources', lines: ['70%', '95%', '80%', '90%', '65%', '85%'] },
  ];

  constructor() {
    // Fetch the ECharts chunk in parallel with the data instead of after it (same module the
    // ngx-echarts provider imports, so it is downloaded once).
    void import('../core/echarts');
  }

  /** Units of what the chart shows (displaySettings: no index on stacked, share and bars). */
  readonly valueLabel = computed(() => {
    const s = this.store.displaySettings();
    const parts = [FLOW_LABELS[s.flow], MEASURE_LABELS[s.measure].toLowerCase()];
    if (isReal(s.measure)) parts.push(`${fiscalYearLabel(s.baseYear)} dollars`);
    if (s.indexTo100) parts.push(`index, ${fiscalYearLabel(s.baseYear)} = 100`);
    return parts.join(', ');
  });

  readonly countyLabel = this.store.countyLabel;

  readonly chartTypes = CHART_TYPES.map((value) => ({ value, label: CHART_LABELS[value] }));
  readonly chartType = computed(() => this.store.view().chart);
  setChartType(e: Event): void {
    this.store.updateView({ chart: (e.target as HTMLSelectElement).value as ChartType });
  }

  /** Series 1 is revenue, series 2 is spending (expenditure); see _tokens.scss. */
  readonly seriesIndex = computed<1 | 2>(() => (this.store.settings().flow === 'revenue' ? 1 : 2));
  readonly seriesColor = computed(() => `var(--fx-series-${this.seriesIndex()})`);
  /** Colour of the plotted total: the flow's series colour, or chart-total on category charts (QA-41). */
  readonly totalColor = computed(() =>
    this.chartType() === 'line' ? this.seriesColor() : 'var(--fx-color-chart-total)',
  );

  readonly chartTitle = computed(() => `${FLOW_LABELS[this.store.settings().flow]} by fiscal year`);
  readonly caption = computed(() => measureCaption(this.store.displaySettings()));
  /** Said whenever index-to-100 is on but this chart type shows values (QA-39). */
  readonly indexNote = computed(() =>
    this.store.indexNotShown()
      ? `Index to 100 applies to the line charts only; this chart shows values in ${unitPhrase(this.store.displaySettings())}.`
      : null,
  );
  /** Annotations that apply to every view (e.g. GASB 84), spelled out under the chart on phones. */
  readonly keyAnnotations = computed(() => this.store.annotationNotes().filter((a) => a.universal));

  /**
   * Legend for marked points, only for statuses actually in view: hollow circle = not cross-checked,
   * diamond = cross-checked with differences not resolved.
   */
  readonly crossCheckLegend = computed(() => {
    const check = this.store.crossCheck();
    // The markers sit on the total line; the 100% share chart has none (the drawer still says).
    if (!check || this.chartType() === 'share') return [];
    const ranges = [...check.values()].filter((r): r is CrossCheckRange => r !== null);
    const mismatches = ranges.filter((r) => r.status === 'mismatch');
    const items: { status: 'not-checked' | 'mismatch'; label: string }[] = [];
    if (ranges.some((r) => r.status === 'not-checked')) items.push({ status: 'not-checked', label: CROSS_CHECK_LABELS['not-checked'] });
    if (mismatches.length) items.push({ status: 'mismatch', label: mismatchLegendLabel(mismatches) });
    return items;
  });

  readonly kpis = computed(() =>
    // The KPIs describe what the chart shows: dollars, not index values, on stacked, share and bars.
    kpiCards(this.store.chartTotal(), this.store.displaySettings(), this.store.loaded() ? undefined : 'Data not loaded'),
  );

  /** The AFR workbook behind the selected flow, for the line under the chart. */
  readonly afrSource = computed(() => {
    const data = this.store.data();
    const flow = this.store.settings().flow;
    const id = data?.observations.find((o) => o.flow === flow)?.sourceId;
    return data?.sources.find((s) => s.id === id) ?? null;
  });

  /** "All funds as reported by EDR, excluding custodial. Transfers between funds: as reported (gross)" */
  readonly scopeLine = computed(() => {
    const s = this.store.settings();
    return `${fundScopeLabel(s, this.store.fundScope())}. ${transferLabel(s)}.`;
  });

  readonly chips = computed<SettingChip[]>(() => {
    const s = this.store.settings();
    const chips: SettingChip[] = [
      {
        group: 'county',
        label: this.store.countyShortName() ? `County: ${this.store.countyShortName()}` : 'County',
        aria: 'County',
      },
      { group: 'flow', label: FLOW_LABELS[s.flow], aria: 'Data' },
      { group: 'measure', label: MEASURE_LABELS[s.measure], aria: 'Measure' },
    ];
    if (isReal(s.measure) || s.indexTo100) {
      const base = fiscalYearLabel(s.baseYear);
      chips.push({ group: 'measure', label: s.indexTo100 ? `${base} = 100` : `${base} dollars`, aria: 'Base year' });
    }
    chips.push({
      group: 'range',
      // Until data has loaded successfully the range isn't checked against the years that exist:
      // don't state it (also after a failed load, QA-27).
      label: !this.store.loaded() ? 'Fiscal years' : `${fiscalYearLabel(s.range[0])} to ${fiscalYearLabel(s.range[1])}`,
      aria: 'Fiscal years',
    });
    chips.push({ group: 'funds', label: this.store.fundScopeShort(), aria: 'Funds' });
    if (isCategoryChart(this.store.view().chart)) {
      const n = s.categories?.length;
      chips.push({ group: 'categories', label: n ? `${n} categories` : 'All categories', aria: 'Categories' });
    }
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
    // Labels that already name their setting ("County: Pinellas") aren't prefixed again (QA-37).
    return chips.map((c) => ({
      ...c,
      ariaLabel: `${c.label === c.aria || c.label.startsWith(`${c.aria}:`) ? c.label : `${c.aria}: ${c.label}`}. Change`,
    }));
  });

  private readonly drawer = inject(SourceDrawerService);

  /** A point or table cell was chosen: open its source drawer. */
  openDrawer(fiscalYear: number, category: string | null): void {
    const content = this.store.drawerContent(fiscalYear, category, this.valueLabel());
    if (content) this.drawer.open(content);
  }

  openSheet(group: ControlGroup): void {
    this.sheet.open<SettingsSheetComponent, SettingsSheetData>(SettingsSheetComponent, {
      data: { group },
      // Lets the sheet inject this page's ExplorerStore.
      viewContainerRef: this.vcr,
      ariaLabel: 'Chart settings',
    });
  }
}
