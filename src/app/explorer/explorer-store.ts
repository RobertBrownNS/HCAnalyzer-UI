import { Injectable, computed, effect, inject, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';

import { DataService } from '../core/data.service';
import { Flow } from '../core/models';
import {
  DEFAULT_JURISDICTION,
  DEFAULT_SETTINGS,
  TransformSettings,
  annotationsInRange,
  availableYears,
  buildSeries,
  defaultSettingsFor,
  fiscalYearLabel,
  selectCpi,
} from '../core/transform';
import { Workbook, annotationNotes, labelBaseYearNotes } from './view-notes';
import {
  QUERY_KEYS,
  QueryParams,
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

  readonly status = this.dataService.status;
  readonly error = this.dataService.error;
  readonly data = this.dataService.data;

  /** Defaults come from the loaded data (full range, latest base year), not hardcoded years. */
  readonly settings = computed<TransformSettings>(
    () => {
      const params = this.queryParams();
      const flow = parseSettings(params).flow;
      const defaults = this.defaultsFor(flow);
      return normalizeSettings(parseSettings(params, defaults), this.yearsFor(flow), defaults);
    },
    { equal: (a, b) => sameParams(serializeSettings(a), serializeSettings(b)) },
  );

  readonly years = computed(() => this.yearsFor(this.settings().flow));

  /** buildSeries output; a CPI gap note about the base year is labelled as such (QA-19). */
  readonly points = computed(() => {
    const data = this.data();
    if (!data) return [];
    const s = this.settings();
    const points = buildSeries(data, s);
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
      population: data.population[DEFAULT_JURISDICTION]?.sourceId,
    };
  });

  readonly cpiSelection = computed(() => {
    const data = this.data();
    const s = this.settings();
    return data ? selectCpi(data.cpi, s.cpiIndex, s.cpiPeriod) : null;
  });

  constructor() {
    void this.dataService.load();

    // Keep the URL canonical: every key present, invalid values replaced.
    effect(() => {
      const canonical = serializeSettings(this.settings());
      const current = paramsOf(this.queryParams());
      // Replace, don't push: canonicalizing isn't a user action, so Back skips it.
      if (!sameParams(canonical, current)) untracked(() => this.navigate(canonical, { replace: true }));
    });
  }

  /** User change: pushes a history entry, so Back/Forward restore earlier views. */
  update(patch: Partial<TransformSettings>): void {
    const merged = { ...this.settings(), ...patch };
    const next = normalizeSettings(merged, this.yearsFor(merged.flow), this.defaultsFor(merged.flow));
    const params = serializeSettings(next);
    if (!sameParams(params, serializeSettings(this.settings()))) this.navigate(params, { replace: false });
  }

  /** Resets every setting to the data-derived defaults for the current flow. */
  reset(): void {
    this.navigate(serializeSettings(this.defaultsFor(this.settings().flow)), { replace: false });
  }

  private defaultsFor(flow: Flow): TransformSettings {
    const data = this.data();
    return data ? defaultSettingsFor(data, flow) : { ...DEFAULT_SETTINGS, flow, range: [...DEFAULT_SETTINGS.range] };
  }

  retry(): void {
    void this.dataService.load();
  }

  private yearsFor(flow: Flow): number[] {
    const data = this.data();
    return data ? availableYears(data, flow) : [];
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
