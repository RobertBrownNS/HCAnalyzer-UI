import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';

import { CountyContext, countyLabel, countyShortName } from '../core/county';
import { formatUsd, formatValue } from '../core/format';
import { fundScopeLabel } from '../core/labels';
import { formatShare } from './category-chart';
import { DrawerContent, accountName, drawerAnnotations, drawerSources } from './source-drawer';
import { categoryLabel, fundLabel, fundScopeText, fundsIncludedText, isAllFundsScope } from '../core/scope';
import { coverageFor, crossCheckByYear, crossCheckYearText, withFundSelection } from '../core/cross-check';
import { DataService } from '../core/data.service';
import { Flow } from '../core/models';
import {
  TransformSettings,
  annotationsForPoint,
  annotationsInRange,
  availableYears,
  buildSeries,
  defaultSettingsFor,
  fiscalYearLabel,
  availableCategories,
  availableFunds,
  buildCategorySeries,
  CategorySeries,
  netTransfersAllowed,
  pointBreakdown,
  selectCpi,
  settingsWithDefaults,
} from '../core/transform';
import { DEFAULT_CHART, VIEW_KEYS, ViewState, isCategoryChart, isLineChart, parseView, serializeView } from '../core/view-state';
import { SKELETON_DELAY_MS } from './skeleton';
import { Workbook, annotationNotes, labelBaseYearNotes } from './view-notes';
import {
  ALL_SETTING_KEYS,
  NO_COUNTY,
  normalizeCounty,
  normalizeScope,
  normalizeSettings,
  parseSettings,
  sameParams,
  serializeSettings,
} from '../core/url-state';

function sameOwn(a: OwnParams, b: OwnParams): boolean {
  return OWN_KEYS.every((k) => (a[k] ?? null) === (b[k] ?? null));
}

/** Every query key the explorer owns: settings, id lists and the view. */
const OWN_KEYS = [...ALL_SETTING_KEYS, ...VIEW_KEYS] as const;
type OwnParams = Partial<Record<(typeof OWN_KEYS)[number], string>>;

function paramsOf(map: ParamMap): OwnParams {
  const out: OwnParams = {};
  for (const k of OWN_KEYS) {
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
      return this.canonicalize(parsed, defaults);
    },
    { equal: (a, b) => sameParams(serializeSettings(a), serializeSettings(b)) },
  );

  readonly years = computed(() => this.yearsFor(this.settings().flow));

  /** How the data is shown (chart type; D-20). */
  readonly view = computed<ViewState>(() => parseView(this.queryParams()), {
    equal: (a, b) => a.chart === b.chart,
  });

  /** Fund types and categories the data offers for this county (and flow). */
  readonly fundsAvailable = computed(() => {
    const data = this.data();
    return data ? availableFunds(data, this.county()) : [];
  });
  readonly categoriesAvailable = computed(() => {
    const data = this.data();
    return data ? availableCategories(data, this.settings().flow, this.county()) : [];
  });

  /** Plain fund scope: a preset's name, the funds named, or "All funds as reported by EDR". */
  readonly fundScope = computed(() =>
    fundScopeText(this.settings().funds ?? null, this.fundsAvailable(), this.dataService.fundsMeta()),
  );
  /** Short form for the phone chip: the preset's own label ("All funds"). */
  readonly fundScopeShort = computed(() =>
    fundScopeText(this.settings().funds ?? null, this.fundsAvailable(), this.dataService.fundsMeta(), 'short'),
  );
  /**
   * For the every-fund scope, the funds it covers in this county (QA-07, QA-42): "Includes General,
   * Special Revenue … and Component Units." Null for any other selection.
   */
  readonly fundsIncluded = computed(() => {
    const available = this.fundsAvailable();
    const meta = this.dataService.fundsMeta();
    const selection = this.settings().funds ?? null;
    if (!available.length || !isAllFundsScope(selection, available, meta)) return null;
    return fundsIncludedText(available, available, meta) || null;
  });
  /** Display label per category id (categories.json, else readable ids). */
  readonly categoryLabels = computed<Record<string, string>>(() => {
    const meta = this.dataService.categoriesMeta();
    return Object.fromEntries(this.categoriesAvailable().map((id) => [id, categoryLabel(id, meta)]));
  });

  /** Net of transfers is allowed only with every fund selected (O-11 interim, R-19). */
  readonly netAllowed = computed(() => {
    const data = this.data();
    return data ? netTransfersAllowed(data, this.settings()) : true;
  });

  /**
   * Index to 100 is set, but the chart is stacked area, 100% share or bars, which show values
   * without the index (summed indexes have no meaning; DR-53, QA-39).
   */
  readonly indexNotShown = computed(() => this.settings().indexTo100 && !isLineChart(this.view().chart));

  /**
   * The settings as the current chart shows them: without index-to-100 when indexNotShown. Every
   * label, axis format, table, KPI and drawer value uses these, so units always match the values.
   */
  readonly displaySettings = computed<TransformSettings>(() =>
    this.indexNotShown() ? { ...this.settings(), indexTo100: false } : this.settings(),
  );

  /** The total as the current chart shows it (see displaySettings). */
  readonly chartTotal = computed(() => {
    const data = this.data();
    if (!data || !this.indexNotShown()) return this.points();
    return buildSeries(data, this.displaySettings());
  });

  /**
   * Category series for the category chart types. Stacked area, share and bars don't apply
   * index-to-100 (summing indexes has no meaning); lines by category do.
   */
  readonly categorySeries = computed<CategorySeries[] | null>(() => {
    const data = this.data();
    const chart = this.view().chart;
    if (!data || !isCategoryChart(chart)) return null;
    const s = this.settings();
    return buildCategorySeries(data, chart === 'lines' ? s : { ...s, indexTo100: false });
  });

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
    return data ? annotationsInRange(data, this.settings(), isCategoryChart(this.view().chart) ? 'categories' : 'total') : [];
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
    const s = this.settings();
    const coverage = coverageFor(data.sources, data.observations, this.county(), s.flow);
    const byYear = crossCheckByYear(
      this.points().map((p) => p.fiscalYear),
      coverage,
    );
    // A fund selection that splits a reclassified pair no longer matches the county filing (QA-40).
    return withFundSelection(byYear, data.annotations, data.observations, s);
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
      const canonical = { ...serializeSettings(this.settings()), ...serializeView(this.view()) };
      const current = paramsOf(this.queryParams());
      // Replace, don't push: canonicalizing isn't a user action, so Back skips it.
      if (!sameOwn(canonical, current)) untracked(() => this.navigate(canonical, { replace: true }));
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
      this.navigate(
        { ...serializeSettings(normalizeCounty(merged, this.counties(), fallback)), ...serializeView(this.view()) },
        { replace: false },
      );
      return;
    }
    const next = this.canonicalize(merged, this.defaultsFor(merged.flow));
    const params = serializeSettings(next);
    if (!sameParams(params, serializeSettings(this.settings()))) {
      this.navigate({ ...params, ...serializeView(this.view()) }, { replace: false });
    }
  }

  /**
   * Content for the source drawer: one point (the total, or one category) traced to the
   * observations behind it. Uses the same formatters as the chart and table; the rows sum to the
   * point's nominal value (pointBreakdown applies the same fund, custodial and transfer rules).
   */
  drawerContent(fiscalYear: number, category: string | null, valueLabel: string): DrawerContent | null {
    const data = this.data();
    if (!data) return null;
    const s = this.settings();
    const series = category ? this.categorySeries()?.find((c) => c.category === category) : null;
    const point = category
      ? series?.points.find((p) => p.fiscalYear === fiscalYear)
      : this.chartTotal().find((p) => p.fiscalYear === fiscalYear);
    if (!point) return null;
    const accounts = this.dataService.accountsFor(this.county()) ?? [];
    const fundsMeta = this.dataService.fundsMeta();
    const rows = pointBreakdown(data, s, fiscalYear, category ?? undefined).map((o) => ({
      account: o.account,
      name: accountName(o.account, o.flow, fiscalYear, accounts),
      fund: fundLabel(o.fundType, fundsMeta),
      amount: o.amount,
      ref: o.ref,
    }));
    const range = this.crossCheck()?.get(fiscalYear) ?? null;
    const annotations = drawerAnnotations(
      this.annotations().filter((a) => a.fiscalYear === fiscalYear),
      annotationsForPoint(data, s, fiscalYear, category ?? undefined),
    );
    const catLabel = category ? `${this.categoryLabels()[category] ?? category} · ` : '';
    const share = category && 'share' in point ? ` (${formatShare((point as { share: number | null }).share)} of the selected total)` : '';
    return {
      fiscalYearLabel: point.label,
      seriesLabel: `${catLabel}${valueLabel}`,
      context: `${this.countyLabel()} · ${fundScopeLabel(s, this.fundScope())}`,
      valueText: `${formatValue(point.value, this.displaySettings())}${share}`,
      nominalText: formatUsd(rows.reduce((sum, r) => sum + r.amount, 0)),
      rows,
      sources: drawerSources([...point.sourceIds, ...annotations.map((a) => a.sourceId)], data.sources, this.county()),
      crossCheck: range ? crossCheckYearText(range) : null,
      notes: point.notes,
      annotations: annotations.map((a) => (a.detail ? { label: a.label, detail: a.detail } : { label: a.label })),
    };
  }

  /** Change how the data is shown (chart type); pushes history like any setting. */
  updateView(patch: Partial<ViewState>): void {
    const next = { ...this.view(), ...patch };
    if (next.chart !== this.view().chart) {
      this.navigate({ ...serializeSettings(this.settings()), ...serializeView(next) }, { replace: false });
    }
  }

  /**
   * Fits settings to the selected county's data: years, base year, fund and category lists, and
   * the net-of-transfers rule (net needs every fund selected; otherwise transfers are as reported).
   */
  private canonicalize(s: TransformSettings, defaults: TransformSettings): TransformSettings {
    const data = this.data();
    let next = normalizeSettings(s, this.yearsFor(s.flow), defaults);
    if (!data) return next;
    next = normalizeScope(next, availableFunds(data, next.jurisdiction), availableCategories(data, next.flow, next.jurisdiction));
    if (next.transfers === 'net' && !netTransfersAllowed(data, next)) next = { ...next, transfers: 'gross' };
    return next;
  }

  /** Resets every setting to the data-derived defaults for the current flow. */
  reset(): void {
    this.navigate({ ...serializeSettings(this.defaultsFor(this.settings().flow)), ...serializeView({ chart: DEFAULT_CHART }) }, { replace: false });
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

  private navigate(params: OwnParams, opts: { replace: boolean }): void {
    // Every owned key is set; absent ones (an "all" id list) are removed with null, since the
    // navigation merges with the current query (unknown params are kept).
    const queryParams: Record<string, string | null> = {};
    for (const k of OWN_KEYS) queryParams[k] = params[k] ?? null;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: opts.replace,
    });
  }
}
