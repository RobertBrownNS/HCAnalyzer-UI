import { Component, computed, inject } from '@angular/core';

import { FLOW_LABELS, MEASURE_LABELS, fundScopeLabel, isPerCapita, isReal, transferLabel } from '../core/labels';
import { CpiSeriesFile, SourceRecord } from '../core/models';
import { fiscalYearLabel } from '../core/transform';
import { ExplorerStore } from './explorer-store';

/**
 * The visible cross-check line for a county's EDR AFR source: the data's own summary of how the
 * figures were checked against the county-filed AFR ("Not cross-checked…", "Spot check: …").
 * Keyed off the structured `countyAfrCrossCheck` field; null for sources without it. Exported for tests.
 */
export function crossCheckNotice(src: SourceRecord): string | null {
  return src.countyAfrCrossCheck ? (src.crossCheckSummary ?? null) : null;
}

/** A source's caveats for one county: the shared ones plus that county's own. Exported for tests. */
export function caveatsForCounty(src: SourceRecord, county: string): readonly string[] {
  return [...src.caveats, ...(src.caveatsByJurisdiction?.[county] ?? [])];
}

/** Plain statement of the active settings and every source in view. */
@Component({
  selector: 'app-methodology',
  templateUrl: './methodology.component.html',
  styleUrl: './methodology.component.scss',
})
export class MethodologyComponent {
  private readonly store = inject(ExplorerStore);
  readonly s = this.store.settings;

  readonly flowLabel = computed(() => FLOW_LABELS[this.s().flow]);
  readonly measureLabel = computed(() => MEASURE_LABELS[this.s().measure]);
  readonly baseLabel = computed(() => fiscalYearLabel(this.s().baseYear));
  readonly scope = computed(() => fundScopeLabel(this.s()));
  readonly transfers = computed(() => transferLabel(this.s()));
  readonly real = computed(() => isReal(this.s().measure));
  readonly perCapita = computed(() => isPerCapita(this.s().measure));

  readonly span = computed(() => {
    const pts = this.store.points();
    return pts.length ? `${pts[0].label} to ${pts[pts.length - 1].label}` : '';
  });

  readonly gaps = computed(() =>
    this.store
      .points()
      .filter((p) => p.value === null)
      .map((p) => p.label)
      .join(', '),
  );

  readonly population = computed(() => this.store.data()?.population[this.store.county()] ?? null);
  readonly countyLabel = this.store.countyLabel;

  readonly cpi = computed(() => {
    const sel = this.store.cpiSelection();
    const data = this.store.data();
    if (!sel || !data) return null;
    const file: CpiSeriesFile | undefined = Object.values(data.cpi).find(
      (f: CpiSeriesFile) => f.sourceId === sel.sourceId,
    );
    const basis = file ? (sel.period === 'fiscal' ? file.fiscalYearBasis : file.calendarYearBasis) : '';
    return { label: sel.label, seriesId: file?.seriesId ?? '', basePeriod: file?.basePeriod ?? '', basis };
  });


  readonly crossCheckNotice = crossCheckNotice;

  /** Caveats shared by every county, plus those for the selected county only (QA-33). */
  caveatsFor(src: SourceRecord): readonly string[] {
    return caveatsForCounty(src, this.store.county());
  }

  readonly sources = computed<SourceRecord[]>(() => {
    const data = this.store.data();
    if (!data) return [];
    const ids = new Set<string>();
    for (const p of this.store.points()) p.sourceIds.forEach((id) => ids.add(id));
    for (const a of this.store.annotations()) ids.add(a.sourceId);
    return data.sources.filter((src) => ids.has(src.id));
  });
}
