import { Component, computed, inject } from '@angular/core';

import { FLOW_LABELS, MEASURE_LABELS, fundScopeLabel, isPerCapita, isReal, transferLabel } from '../core/labels';
import { CpiSeriesFile, SourceRecord } from '../core/models';
import { fiscalYearLabel } from '../core/transform';
import { ExplorerStore } from './explorer-store';

/** Source caveats that must be visible, not only in the collapsed caveat list. */
const NOT_CROSS_CHECKED = /^Not cross-checked against the county/i;

/**
 * The caveat saying a county's EDR figures weren't cross-checked against the county-filed AFR.
 * Uses a structured flag when the data provides one (requested from the pipeline), else the
 * caveat's opening words. Exported for tests.
 */
export function crossCheckNotice(src: SourceRecord): string | null {
  const flags = src as SourceRecord & { countyAfrCrossCheck?: string; crossCheckedAgainstCountyAfr?: boolean };
  const flagged = flags.countyAfrCrossCheck === 'not-checked' || flags.crossCheckedAgainstCountyAfr === false;
  const text = src.caveats.find((c) => NOT_CROSS_CHECKED.test(c));
  if (flagged) return text ?? "Not cross-checked against the county's own Annual Financial Report.";
  return text ?? null;
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

  readonly sources = computed<SourceRecord[]>(() => {
    const data = this.store.data();
    if (!data) return [];
    const ids = new Set<string>();
    for (const p of this.store.points()) p.sourceIds.forEach((id) => ids.add(id));
    for (const a of this.store.annotations()) ids.add(a.sourceId);
    return data.sources.filter((src) => ids.has(src.id));
  });
}
