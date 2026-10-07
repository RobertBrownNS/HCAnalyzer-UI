import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';

import { CountyContext, countyLabel, countyShortName } from '../core/county';
import { coverageFor, crossCheckByYear } from '../core/cross-check';
import { DataService } from '../core/data.service';
import { Flow } from '../core/models';
import {
  TransformSettings,
  annotationsInRange,
  availableYears,
  buildSeries,
  defaultSettingsFor,
  fiscalYearLabel,
  selectCpi,
  settingsWithDefaults,
} from '../core/transform';
import { SKELETON_DELAY_MS } from './skeleton';
import { Workbook, annotationNotes, labelBaseYearNotes } from './view-notes';
import {
  NO_COUNTY,
  QUERY_KEYS,
  QueryParams,
  normalizeCounty,
  normalizeSettings,
  parseSettings,
  sameParams,
  serializeSettings,
} from '../core/url-state';

function paramsOf(map: ParamMap): Partial<QueryParams> {
  const out: Partial<QueryParams> = {};
  for (const k of QUERY_KEYS) {
    const v = map.get(k);
    if (v !== null) out[k] = v;
  }
  return out;
}

/**
 * Explorer state. The URL query string is the single source of truth: settings are computed
 * from it and update() writes back to it. Invalid or out-of-range params are replaced in the
 * URL by their normalized values.
 */
@Injectable()
export class ExplorerStore {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly dataService = inject(DataService);

  private readonly queryParams = toSignal(this.route.queryParamMap, { requireSync: true });

  /** Counties the data offers (empty until the manifest has loaded). */
  readonly counties = this.dataService.counties;
  readonly countyNames = this.dataService.countyNames;

  /**
   * The county being shown: from the URL, falling back to the default when the data doesn't offer
   * it. Settled first, because the data, the available years and the defaults all depend on it.
   */
  readonly county = computed(() => {
    const fromUrl = parseSettings(this.queryParams()).jurisdiction; // NO_COUNTY when absent or malformed
    const fallback = this.dataService.defaultCounty() ?? NO_COUNTY;
    return normalizeCounty(settingsWithDefaults(fromUrl), this.counties(), fallback).jurisdiction;
  });
  /** The county is settled: the data's county list has loaded. */
  private readonly countyKnown = computed(() => this.counties().length > 0 && this.county() !== NO_COUNTY);

  /** "Pinellas County" and "Pinellas", from the data's own names. */
  /** Empty until the county is known. */
  readonly countyLabel = computed(() => (this.county() ? countyLabel(this.county(), this.countyNames()) : ''));
  readonly countyShortName = computed(() => (this.county() ? countyShortName(this.county(), this.countyNames()) : ''));

  readonly status = computed(() => this.dataService.statusFor(this.county()));
  /** Data not loaded yet (idle or loading); not true after an error. */
  readonly loading = computed(() => {
    const s = this.status();
    return s === 'idle' || s === 'loading';
  });
  /** Data loaded successfully. */
  readonly loaded = computed(() => this.status() === 'ready');
  /**
   * Loading placeholders become visible once per load, SKELETON_DELAY_MS after it starts (page
   * open or a switch to a county not loaded yet), and stay revealed for the rest of that load.
   * Every placeholder (page, range control, chart) uses this one flag, so a placeholder that
   * appears later in the load is shown at once, not after a second delay (QA-26).
   */
  readonly revealSkeleton = signal(false);
  readonly error = computed(() => this.dataService.errorFor(this.county()));
  /** Shared files plus the selected county's observations; null until both have loaded. */
  readonly data = computed(() => this.dataService.dataFor(this.county()));

  /** Defaults come from the loaded data (full range, latest base year), not hardcoded years. */
  readonly settings = computed<TransformSettings>(
    () => {
      const params = this.queryParams();
      const flow = parseSettings(params).flow;
      const defaults = this.defaultsFor(flow);
      const parsed = { ...parseSettings(params, defaults), jurisdiction: this.county() };
      return normalizeSettings(parsed, this.yearsFor(flow), defaults);
    },
    { equal: (a, b) => sameParams(serializeSettings(a), serializeSettings(b)) },
  );

  readonly years = computed(() => this.yearsFor(this.settings().flow));

  /** buildSeries output; a CPI gap note about the base year is labelled as such (QA-19). */
  readonly points = computed(() => {
    const data = this.data();
    if (!data) return [];
    const s = this.settings();
    const t0 = performance.now();
    const points = buildSeries(data, s);
    // Timing for load profiling (DevTools Performance panel / performance.getEntriesByName).
    performance.measure?.('fx:buildSeries', { start: t0, end: performance.now() });
    if (s.measure !== 'real' && s.measure !== 'real_per_capita') return points;
    const cpi = selectCpi(data.cpi, s.cpiIndex, s.cpiPeriod);
    if (cpi.valueFor(s.baseYear) !== undefined) return points;
    const yearText = s.cpiPeriod === 'fiscal' ? fiscalYearLabel(s.baseYear) : `calendar year ${s.baseYear}`;
    return labelBaseYearNotes(points, cpi.unavailableReason(s.baseYear), yearText);
  });

  readonly annotations = computed(() => {
    const data = this.data();
    return data ? annotationsInRange(data, this.settings()) : [];
  });

  /** In-range annotations, numbered for the chart and the notes list. */
  readonly annotationNotes = computed(() =>
    annotationNotes(this.annotations(), this.data()?.sources ?? [], this.workbookSources()),
  );

  /** Source id behind each workbook an annotation ref can name ("expenditures:2023!P90"). */
  private readonly workbookSources = computed<Partial<Record<Workbook, string>>>(() => {
    const data = this.data();
    if (!data) return {};
    const afr = (flow: Flow) => data.observations.find((o) => o.flow === flow)?.sourceId;
    return {
      revenues: afr('revenue'),
      expenditures: afr('expenditure'),
      population: data.population[this.county()]?.sourceId,
    };
  });

  /** Cross-check status per fiscal year in view (county + flow source coverage); null = no coverage. */
  readonly crossCheck = computed(() => {
    const data = this.data();
    if (!data) return null;
    const coverage = coverageFor(data.sources, data.observations, this.county(), this.settings().flow);
    return crossCheckByYear(
      this.points().map((p) => p.fiscalYear),
      coverage,
    );
  });

  readonly cpiSelection = computed(() => {
    const data = this.data();
    const s = this.settings();
    return data ? selectCpi(data.cpi, s.cpiIndex, s.cpiPeriod) : null;
  });

  constructor() {
    let revealTimer: ReturnType<typeof setTimeout> | undefined;
    let wasLoading = false;
    inject(DestroyRef).onDestroy(() => clearTimeout(revealTimer));
    // One reveal delay per load: restart it each time a load begins.
    effect(() => {
      const loading = this.loading();
      if (loading && !wasLoading) {
        untracked(() => this.revealSkeleton.set(false));
        clearTimeout(revealTimer);
        revealTimer = setTimeout(() => this.revealSkeleton.set(true), SKELETON_DELAY_MS);
      }
      wasLoading = loading;
    });

    void this.dataService.load();
    // Load the selected county's observations once the county list is known (cached per county).
    effect(() => {
      const county = this.county();
      if (this.countyKnown()) untracked(() => void this.dataService.loadCounty(county));
    });
    // The page header names the county shown.
    const context = inject(CountyContext);
    effect(() => context.id.set(this.county() || null));
    inject(DestroyRef).onDestroy(() => context.id.set(null));

    // Keep the URL canonical: every key present, invalid values replaced.
    effect(() => {
      // Only once the county is settled (the data's county list and default have loaded).
      if (!this.countyKnown()) return;
      const canonical = serializeSettings(this.settings());
      const current = paramsOf(this.queryParams());
      // Replace, don't push: canonicalizing isn't a user action, so Back skips it.
      if (!sameParams(canonical, current)) untracked(() => this.navigate(canonical, { replace: true }));
    });
  }

  /**
   * User change: pushes a history entry, so Back/Forward restore earlier views. A county switch
   * keeps the other settings; range and base year are re-clamped to that county's years once its
   * data is in (a replace, so it adds no history entry).
   */
  update(patch: Partial<TransformSettings>): void {
    const merged = { ...this.settings(), ...patch };
    if (merged.jurisdiction !== this.county()) {
      const fallback = this.dataService.defaultCounty() ?? NO_COUNTY;
      this.navigate(serializeSettings(normalizeCounty(merged, this.counties(), fallback)), { replace: false });
      return;
    }
    const next = normalizeSettings(merged, this.yearsFor(merged.flow), this.defaultsFor(merged.flow));
    const params = serializeSettings(next);
    if (!sameParams(params, serializeSettings(this.settings()))) this.navigate(params, { replace: false });
  }

  /** Resets every setting to the data-derived defaults for the current flow. */
  reset(): void {
    this.navigate(serializeSettings(this.defaultsFor(this.settings().flow)), { replace: false });
  }

  /** Defaults for the selected county, from its data (full range, latest base year). */
  private defaultsFor(flow: Flow): TransformSettings {
    const data = this.data();
    const jurisdiction = this.county();
    return data
      ? defaultSettingsFor(data, flow, jurisdiction)
      : settingsWithDefaults(jurisdiction, { flow });
  }

  retry(): void {
    void this.dataService.load();
    void this.dataService.loadCounty(this.county());
  }

  private yearsFor(flow: Flow): number[] {
    const data = this.data();
    return data ? availableYears(data, flow, this.county()) : [];
  }

  private navigate(queryParams: QueryParams, opts: { replace: boolean }): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: opts.replace,
    });
  }
}
