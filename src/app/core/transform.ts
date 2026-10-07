/**
 * Pure transforms from the pipeline's JSON (src/assets/data/) to chart series.
 *
 * This is the file people will audit. Rules:
 * - No Angular, no I/O, no clock, no randomness. Same input -> same output.
 * - Inputs are never mutated.
 * - A value that can't be computed is `null` with a note saying why. Nothing
 *   is estimated, interpolated or spliced from another series.
 * - Full precision throughout. Rounding happens only at display.
 */
import type {
  AfrObservation,
  AnnotationRecord,
  CategoryDef,
  CpiFile,
  CpiSeriesFile,
  Flow,
  Measure,
  PopulationEntry,
  PopulationFile,
  SourceRecord,
} from './models';
import { fiscalYearLabel } from './fiscal-year';

export { fiscalYearLabel } from './fiscal-year';

export type { Measure } from './models';
export type CpiIndex = 'cpi-u-us' | 'cpi-u-tampa';
/** 'fiscal' = Oct-Sep mean for the fiscal year; 'calendar' = BLS annual average. */
export type CpiPeriod = 'fiscal' | 'calendar';
/**
 * 'gross' = as reported (matches EDR totals). 'net' = interfund transfers
 * removed: account 381 (transfers in) from revenue, 581 (transfers out) from
 * expenditure. See docs/plan.md QA-02. The default is an open user decision.
 */
export type TransferMode = 'gross' | 'net';

export interface TransformSettings {
  flow: Flow;
  measure: Measure;
  /** fiscalYear whose dollars 'real' is expressed in; also the indexTo100 base. */
  baseYear: number;
  /** Rebase the final measured series so baseYear = 100. */
  indexTo100: boolean;
  /** Inclusive fiscalYear bounds. Reversed bounds are treated as [min, max]. */
  range: [number, number];
  /** Default false. See CLAUDE.md "Custodial Fund (GASB 84)". */
  includeCustodial: boolean;
  cpiIndex: CpiIndex;
  cpiPeriod: CpiPeriod;
  /**
   * Interfund transfers. Missing = 'gross'. 'net' applies only when every
   * non-custodial fund is selected (R-19 / O-11); otherwise it is treated as
   * 'gross' with a note. See netTransfersAllowed().
   */
  transfers?: TransferMode;
  /**
   * Selected non-custodial fund types (D-18). Missing or empty = all funds.
   * Custodial is controlled by includeCustodial only and ignored here.
   */
  funds?: readonly string[];
  /**
   * Selected categories (D-19) for buildCategorySeries. Missing or empty =
   * all. buildSeries (the total) is not filtered by category.
   */
  categories?: readonly string[];
  /**
   * County slug: key into observations and population.json. Required; the
   * transform has no default county (the app's default is
   * manifest.defaultJurisdiction, from the pipeline county config).
   */
  jurisdiction: string;
}

export interface SeriesPoint {
  fiscalYear: number;
  /** "FY 2020-21" */
  label: string;
  /** null = not computable (gap), never estimated. */
  value: number | null;
  /** Underlying nominal sum (USD) for the selected flow and funds. */
  nominal: number;
  /** Custodial fund amount for this year, whether or not it is included. */
  custodialNominal: number;
  /**
   * Interfund transfers on this flow (381 for revenue, 581 for expenditure) in
   * the included funds, whether transfers are gross or net. Gross nominal =
   * net nominal + transfersNominal.
   */
  transfersNominal: number;
  /**
   * Transfers out (581) minus transfers in (381) for this year, in all funds
   * except custodial (the pipeline's rule: custodial money is not moved between
   * the county's own funds), whatever the custodial toggle. Absent when the
   * year has no data for one of the flows.
   */
  transferImbalance?: number;
  population?: number;
  /** CPI level for this year (selected index and period). */
  cpi?: number;
  /** CPI level for the base year (selected index and period). */
  cpiBase?: number;
  /** Every source contributing: AFR, then population and CPI as applicable. */
  sourceIds: string[];
  notes: string[];
}

export interface TransformData {
  observations: readonly AfrObservation[];
  population: PopulationFile;
  cpi: CpiFile;
  annotations: readonly AnnotationRecord[];
  sources: readonly SourceRecord[];
  /** categories.json, when loaded: gives category display order. */
  categories?: readonly CategoryDef[];
}

/** Every setting except the jurisdiction, which has no default here. */
export type SettingsDefaults = Omit<TransformSettings, 'jurisdiction'>;

/**
 * Static methodology defaults, with no jurisdiction. The years are placeholders
 * that cover the EDR county files as of the 2026-10-06 build; buildSeries clips
 * to the years that exist. Prefer defaultSettingsFor(), which derives range and
 * base year from the loaded data for a jurisdiction. Frozen: copy before
 * changing, or use settingsWithDefaults().
 */
export const DEFAULT_SETTINGS: Readonly<SettingsDefaults> = Object.freeze({
  flow: 'revenue',
  measure: 'nominal',
  baseYear: 2025,
  indexTo100: false,
  range: Object.freeze([2005, 2025]) as [number, number],
  includeCustodial: false,
  cpiIndex: 'cpi-u-us',
  cpiPeriod: 'fiscal',
  transfers: 'gross',
}) as SettingsDefaults;

/** DEFAULT_SETTINGS for a jurisdiction, with `over` applied; a fresh, mutable object. */
export function settingsWithDefaults(jurisdiction: string, over: Partial<SettingsDefaults> = {}): TransformSettings {
  return { ...DEFAULT_SETTINGS, range: [...DEFAULT_SETTINGS.range], ...over, jurisdiction };
}

/**
 * DEFAULT_SETTINGS for one jurisdiction and flow, with range = that
 * jurisdiction's available years and baseYear = its latest year.
 */
export function defaultSettingsFor(data: TransformData, flow: Flow, jurisdiction: string): TransformSettings {
  const years = availableYears(data, flow, jurisdiction);
  if (years.length === 0) return settingsWithDefaults(jurisdiction, { flow });
  const first = years[0];
  const last = years[years.length - 1];
  return settingsWithDefaults(jurisdiction, { flow, baseYear: last, range: [first, last] });
}

/** Sorted jurisdictions that have at least one observation. */
export function availableJurisdictions(data: TransformData): string[] {
  return [...new Set(data.observations.map((o) => o.jurisdiction))].sort();
}

/** Sorted fiscal years that have at least one observation for the flow. */
export function availableYears(data: TransformData, flow: Flow, jurisdiction: string): number[] {
  const years = new Set<number>();
  for (const o of data.observations) {
    if (o.flow === flow && o.jurisdiction === jurisdiction) years.add(o.fiscalYear);
  }
  return [...years].sort((a, b) => a - b);
}

/** 'total' = buildSeries charts; 'categories' = buildCategorySeries charts. */
export type ChartView = 'total' | 'categories';

/**
 * Annotations that apply to the current view, by year: fiscalYear inside the
 * range, and each optional condition satisfied:
 * - jurisdiction, flow, custodial, measures: must match the settings.
 * - funds (DR-47): shown only when the fund selection includes SOME BUT NOT
 *   ALL of them. A row about amounts classified between two funds matters only
 *   when exactly one side is shown; no selection = every fund = hidden.
 * - categories: shown only in the 'categories' view, and only when the
 *   category selection (none = all) includes one of them.
 * A condition that is absent applies to every view.
 */
export function annotationsInRange(
  data: TransformData,
  s: TransformSettings,
  view: ChartView = 'total',
): AnnotationRecord[] {
  const [lo, hi] = normalizeRange(s.range);
  const custodial = s.includeCustodial ? 'included' : 'excluded';
  const { jurisdiction } = s;
  const intersects = (tags: readonly string[], selection: readonly string[] | undefined) =>
    !selection || selection.length === 0 || tags.some((t) => selection.includes(t));
  return data.annotations
    .filter(
      (a) =>
        a.fiscalYear >= lo &&
        a.fiscalYear <= hi &&
        (a.jurisdiction === undefined || a.jurisdiction === jurisdiction) &&
        (a.flow === undefined || a.flow === s.flow) &&
        (a.custodial === undefined || a.custodial === custodial) &&
        (a.measures === undefined || a.measures.includes(s.measure)) &&
        (a.funds === undefined || splitBySelection(a.funds, s.funds)) &&
        (a.categories === undefined || (view === 'categories' && intersects(a.categories, s.categories))),
    )
    .sort((a, b) => a.fiscalYear - b.fiscalYear || a.label.localeCompare(b.label));
}

// ---------------------------------------------------------------------------
// CPI selection
// ---------------------------------------------------------------------------

export interface CpiSelection {
  index: CpiIndex;
  period: CpiPeriod;
  sourceId: string;
  /** e.g. "CPI-U, U.S. city average, fiscal-year (Oct-Sep) average" */
  label: string;
  /** CPI level for a fiscal year, or undefined if there is none. */
  valueFor(fiscalYear: number): number | undefined;
  /** Why there is no value for a fiscal year (always a non-empty string). */
  unavailableReason(fiscalYear: number): string;
  /** Caveat on a value that is present (cpi.json *YearNotes), as a sentence. */
  noteFor(fiscalYear: number): string | undefined;
}

const CPI_AREA_LABEL: Record<CpiIndex, string> = {
  'cpi-u-us': 'CPI-U, U.S. city average',
  'cpi-u-tampa': 'CPI-U, Tampa-St. Petersburg-Clearwater',
};

const CPI_PERIOD_LABEL: Record<CpiPeriod, string> = {
  fiscal: 'fiscal-year (Oct-Sep) average',
  calendar: 'calendar-year annual average',
};

/**
 * Picks the CPI series for an index and period. Never mixes series:
 * - U.S., fiscal:    cpi.national.fiscalYear (Oct-Sep mean of monthly values)
 * - U.S., calendar:  cpi.national.calendarYear (BLS annual average)
 * - Tampa, fiscal:   cpi.tampa.fiscalYear (bimonthly; FY 2017-18 onward only)
 * - Tampa, calendar: cpi.tampa_semiannual.calendarYear (BLS annual average, 2000 onward)
 *
 * Calendar period: fiscal year N uses calendar year N, the calendar year that
 * contains 9 of the fiscal year's 12 months (Jan-Sep N).
 */
export function selectCpi(cpi: CpiFile, index: CpiIndex, period: CpiPeriod): CpiSelection {
  const series: CpiSeriesFile =
    index === 'cpi-u-us' ? cpi.national : period === 'fiscal' ? cpi.tampa : cpi.tampa_semiannual;
  const values = period === 'fiscal' ? series.fiscalYear : series.calendarYear;
  const unavailable = period === 'fiscal' ? series.fiscalYearUnavailable : series.calendarYearUnavailable;
  const yearNotes = (period === 'fiscal' ? series.fiscalYearNotes : series.calendarYearNotes) ?? {};
  const yearText = (fy: number) => (period === 'fiscal' ? fiscalYearLabel(fy) : `calendar year ${fy}`);
  const label = `${CPI_AREA_LABEL[index]}, ${CPI_PERIOD_LABEL[period]}`;
  return {
    index,
    period,
    sourceId: series.sourceId,
    label,
    valueFor(fy) {
      const v = values[String(fy)];
      return isPositiveNumber(v) ? v : undefined;
    },
    unavailableReason(fy) {
      const reason = unavailable[String(fy)];
      return `No ${label} for ${yearText(fy)}` + (reason ? ` (${reason}).` : '.');
    },
    noteFor(fy) {
      const note = yearNotes[String(fy)];
      return note ? `${label} for ${yearText(fy)}: ${note}.` : undefined;
    },
  };
}

// ---------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------

/** UAS interfund transfer accounts: 381 transfers in, 581 transfers out. */
export const TRANSFER_ACCOUNTS: Readonly<Record<Flow, number>> = Object.freeze({ revenue: 381, expenditure: 581 });

/**
 * A transfer imbalance is noted when |581 - 381|, in all funds except
 * custodial, is greater than this. Same rule and value as the pipeline's
 * transfer-imbalance annotations (scripts/pipeline/src/edr/anomalies.ts
 * TRANSFER_IMBALANCE_THRESHOLD), so notes and annotations flag the same years.
 * The exact amount is always in transferImbalance.
 */
export const TRANSFER_IMBALANCE_THRESHOLD = 1_000_000;

/** Every transfer-imbalance note starts with this text. Use isTransferImbalanceNote to match. */
export const TRANSFER_IMBALANCE_NOTE_PREFIX =
  `Transfers out (${TRANSFER_ACCOUNTS.expenditure}) and transfers in (${TRANSFER_ACCOUNTS.revenue}) differ in `;

/** True for the per-point note buildSeries adds when 381 and 581 don't balance. */
export function isTransferImbalanceNote(note: string): boolean {
  return note.startsWith(TRANSFER_IMBALANCE_NOTE_PREFIX);
}

/** True for 381 / 581 and any sub-account (e.g. "381.1"). */
export function isTransferAccount(account: string, flow: Flow): boolean {
  return Math.trunc(Number(account)) === TRANSFER_ACCOUNTS[flow];
}

/**
 * AFR fund columns in workbook order, used only to order fund lists. Not
 * county-specific; a fund type not listed here sorts after these, by name.
 */
export const FUND_ORDER: readonly string[] = Object.freeze([
  'general',
  'special_revenue',
  'debt_service',
  'capital',
  'permanent',
  'enterprise',
  'internal_service',
  'custodial',
  'pension',
  'trust',
  'private_purpose',
  'component_unit',
]);

/** Non-custodial fund types with at least one observation for the jurisdiction (either flow), in FUND_ORDER. */
export function availableFunds(data: TransformData, jurisdiction: string): string[] {
  const funds = new Set<string>();
  for (const o of data.observations) {
    if (o.jurisdiction === jurisdiction && o.fundType !== 'custodial') funds.add(o.fundType);
  }
  return [...funds].sort(compareFunds);
}

function compareFunds(a: string, b: string): number {
  const ia = FUND_ORDER.indexOf(a);
  const ib = FUND_ORDER.indexOf(b);
  if (ia !== ib) return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib);
  return a.localeCompare(b);
}

/**
 * Categories with at least one observation for the flow and jurisdiction (any
 * fund, any year). Ordered as in data.categories (categories.json) when given;
 * categories it doesn't list follow, ordered by their lowest UAS account code
 * (the AFR section order), then by id.
 */
export function availableCategories(data: TransformData, flow: Flow, jurisdiction: string): string[] {
  const minAccount = new Map<string, number>();
  for (const o of data.observations) {
    if (o.flow !== flow || o.jurisdiction !== jurisdiction) continue;
    const code = Number(o.account);
    const prev = minAccount.get(o.category);
    if (prev === undefined || code < prev) minAccount.set(o.category, code);
  }
  const listed = (data.categories ?? []).filter((c) => c.flow === flow).map((c) => c.id);
  const rank = (id: string) => {
    const i = listed.indexOf(id);
    return i < 0 ? listed.length : i;
  };
  return [...minAccount.keys()].sort(
    (a, b) => rank(a) - rank(b) || minAccount.get(a)! - minAccount.get(b)! || a.localeCompare(b),
  );
}

/** True when no fund filter is set, or it covers every non-custodial fund the jurisdiction reports. */
function allFundsSelected(data: TransformData, s: TransformSettings): boolean {
  if (!s.funds || s.funds.length === 0) return true;
  const selected = new Set(s.funds);
  return availableFunds(data, s.jurisdiction).every((f) => selected.has(f));
}

/**
 * R-19 / O-11: removing interfund transfers is only meaningful for the whole
 * entity. With a fund subset, transfers to or from unselected funds are real
 * inflows and outflows of the subset, and the AFR doesn't say which fund is on
 * the other side, so 'net' is allowed only when every non-custodial fund the
 * jurisdiction reports is selected (or no fund filter is set).
 */
export function netTransfersAllowed(data: TransformData, s: TransformSettings): boolean {
  return allFundsSelected(data, s);
}

export const NET_TRANSFERS_REJECTED_NOTE =
  'Net transfers apply only when every fund is selected; transfers are shown as reported (gross).';

interface YearSum {
  /** Selected funds and categories, after transfers are removed when net. */
  nominal: number;
  /** Custodial amount (selected categories), whether or not it is included. */
  custodial: number;
  /** Transfers in the selected funds and categories. */
  transfers: number;
  sourceIds: Set<string>;
}

interface TransferBalance {
  /** 381 or 581 over every fund except custodial: the pipeline's imbalance rule. */
  amount: number;
  sourceIds: Set<string>;
}

interface Measured {
  value: number | null;
  population?: number;
  cpi?: number;
  cpiBase?: number;
  sourceIds: string[];
  notes: string[];
}

/** Total for the settings' flow, jurisdiction and fund selection (all categories). */
export function buildSeries(data: TransformData, s: TransformSettings): SeriesPoint[] {
  return seriesFor(data, s, () => true, 'always');
}

export interface CategoryPoint extends SeriesPoint {
  /**
   * This category's share of the year's total for the same flow, funds,
   * custodial and transfer settings, in percent (0-100; can be negative or
   * above 100 when some categories are negative). Computed on nominal dollars,
   * so it is the same for every measure. null when the total is zero or
   * negative, with a note.
   */
  share: number | null;
}

export interface CategorySeries {
  category: string;
  points: CategoryPoint[];
}

/**
 * One series per category (D-19 / D-20), in availableCategories order,
 * limited to s.categories when set. Each point is measured exactly like
 * buildSeries (per capita, real, indexTo100 against the category's own base
 * year) and adds `share` of the total. Across all categories, nominal sums to
 * buildSeries nominal and share sums to 100 for every year with a positive
 * total.
 */
export function buildCategorySeries(data: TransformData, s: TransformSettings): CategorySeries[] {
  const total = new Map(buildSeries(data, s).map((p) => [p.fiscalYear, p.nominal]));
  const wanted = s.categories && s.categories.length > 0 ? new Set(s.categories) : undefined;
  return availableCategories(data, s.flow, s.jurisdiction)
    .filter((c) => !wanted || wanted.has(c))
    .map((category) => ({
      category,
      points: seriesFor(data, s, (o) => o.category === category, 'if-transfers').map((p): CategoryPoint => {
        const t = total.get(p.fiscalYear)!;
        if (t > 0) return { ...p, share: (p.nominal / t) * 100 };
        return {
          ...p,
          share: null,
          notes: [...p.notes, `Share can't be computed: the ${fiscalYearLabel(p.fiscalYear)} total is ${formatUsd(t)}.`],
        };
      }),
    }));
}

/**
 * The observations behind one point: the jurisdiction, flow and fiscal year of
 * the settings, filtered by fund selection, custodial toggle, transfers (net
 * only when allowed) and, when given, one category. Summing `amount` gives the
 * point's `nominal`. Input order is kept (pipeline order: account, then fund
 * column). Account names are in <jurisdiction>.accounts.json.
 */
export function pointBreakdown(
  data: TransformData,
  s: TransformSettings,
  fiscalYear: number,
  category?: string,
): AfrObservation[] {
  const net = s.transfers === 'net' && netTransfersAllowed(data, s);
  const funds = s.funds && s.funds.length > 0 ? new Set(s.funds) : undefined;
  return data.observations.filter(
    (o) =>
      o.jurisdiction === s.jurisdiction &&
      o.flow === s.flow &&
      o.fiscalYear === fiscalYear &&
      (category === undefined || o.category === category) &&
      (o.fundType === 'custodial' ? s.includeCustodial : !funds || funds.has(o.fundType)) &&
      !(net && isTransferAccount(o.account, o.flow)),
  );
}

/**
 * Annotations for the source drawer of one point (DR-50): rows with `cells`,
 * same jurisdiction, flow and fiscal year, where one of the listed cells
 * (account AND fund) is among the point's observations (pointBreakdown, so
 * the current funds, custodial, transfers and category apply). Account codes
 * are compared as numbers ("335.8" = "335.80").
 */
export function annotationsForPoint(
  data: TransformData,
  s: TransformSettings,
  fiscalYear: number,
  category?: string,
): AnnotationRecord[] {
  const cellKey = (account: string, fundType: string) => `${Number(account)}|${fundType}`;
  const cells = new Set(pointBreakdown(data, s, fiscalYear, category).map((o) => cellKey(o.account, o.fundType)));
  return data.annotations
    .filter(
      (a) =>
        a.cells !== undefined &&
        a.fiscalYear === fiscalYear &&
        (a.jurisdiction === undefined || a.jurisdiction === s.jurisdiction) &&
        (a.flow === undefined || a.flow === s.flow) &&
        a.cells.some((c) => cells.has(cellKey(c.account, c.fundType))),
    )
    .sort((a, b) => a.label.localeCompare(b.label));
}

function seriesFor(
  data: TransformData,
  s: TransformSettings,
  keep: (o: AfrObservation) => boolean,
  imbalanceNote: 'always' | 'if-transfers',
): SeriesPoint[] {
  const { jurisdiction } = s;
  const [lo, hi] = normalizeRange(s.range);
  const netRequested = s.transfers === 'net';
  const netRejected = netRequested && !netTransfersAllowed(data, s);
  const effective: TransformSettings = netRejected ? { ...s, transfers: 'gross' } : s;
  const funds = s.funds && s.funds.length > 0 ? new Set(s.funds) : undefined;
  const sums = sumByYear(data.observations, effective, (o) => (o.fundType === 'custodial' || !funds || funds.has(o.fundType)) && keep(o));
  const balances = transferBalances(data.observations, jurisdiction);
  const cpi = selectCpi(data.cpi, s.cpiIndex, s.cpiPeriod);
  const population = data.population[jurisdiction];

  const measure = (fy: number): Measured => measureYear(fy, sums.get(fy), effective, cpi, population, jurisdiction);

  // indexTo100 base is measured the same way, even when it's outside the range.
  const base = s.indexTo100 ? measure(s.baseYear) : undefined;
  const baseHasData = sums.has(s.baseYear);

  const years = [...sums.keys()].filter((fy) => fy >= lo && fy <= hi).sort((a, b) => a - b);
  return years.map((fy) => {
    const sum = sums.get(fy)!;
    const m = measure(fy);
    const notes = [...m.notes];
    const sourceIds = [...m.sourceIds];
    let value = m.value;

    if (netRejected) notes.push(NET_TRANSFERS_REJECTED_NOTE);

    if (base) {
      if (!baseHasData) {
        value = null;
        notes.push(`Index base ${fiscalYearLabel(s.baseYear)} has no ${s.flow} data.`);
      } else if (base.value === null) {
        value = null;
        notes.push(`Index base ${fiscalYearLabel(s.baseYear)} has no value.`, ...base.notes.filter((n) => !notes.includes(n)));
      } else if (base.value === 0) {
        value = null;
        notes.push(`Index base ${fiscalYearLabel(s.baseYear)} is zero; an index can't be computed.`);
      } else if (value !== null) {
        value = (value / base.value) * 100;
      }
      addUnique(sourceIds, base.sourceIds);
    }

    const tIn = balances.revenue.get(fy);
    const tOut = balances.expenditure.get(fy);
    const imbalance = tIn && tOut ? tOut.amount - tIn.amount : undefined;
    if (
      imbalance !== undefined &&
      Math.abs(imbalance) > TRANSFER_IMBALANCE_THRESHOLD &&
      (imbalanceNote === 'always' || sum.transfers !== 0)
    ) {
      notes.push(
        `${TRANSFER_IMBALANCE_NOTE_PREFIX}${fiscalYearLabel(fy)}: ` +
          `${formatUsd(tOut!.amount)} out, ${formatUsd(tIn!.amount)} in (difference ${formatUsd(imbalance)}` +
          (s.includeCustodial ? ', custodial funds excluded' : '') +
          ').' +
          (effective.transfers === 'net' ? ' Removing transfers reduces revenue and expenditure by different amounts.' : ''),
      );
      addUnique(sourceIds, [...tIn!.sourceIds, ...tOut!.sourceIds].sort());
    }

    const point: SeriesPoint = {
      fiscalYear: fy,
      label: fiscalYearLabel(fy),
      value,
      nominal: sum.nominal,
      custodialNominal: sum.custodial,
      transfersNominal: sum.transfers,
      sourceIds,
      notes,
    };
    if (m.population !== undefined) point.population = m.population;
    if (m.cpi !== undefined) point.cpi = m.cpi;
    if (m.cpiBase !== undefined) point.cpiBase = m.cpiBase;
    if (imbalance !== undefined) point.transferImbalance = imbalance;
    return point;
  });
}

/**
 * Sums observations per fiscal year for the settings' flow and jurisdiction,
 * keeping only rows `keep` accepts (fund and category selection).
 *
 * Fund scope: the selected funds (all when no filter), plus custodial when
 * includeCustodial. With every fund and custodial included the sum equals
 * EDR's "Total - All Account Codes"; with custodial excluded it equals EDR's
 * recalculated total (docs/decisions.md O-07, D-18).
 *
 * Transfers (381 revenue, 581 expenditure) are counted in the kept rows and,
 * when `net`, left out of nominal.
 *
 * Zero cells are omitted from observations.json, so a year with no kept rows
 * sums to 0. Every year present for the flow gets an entry, whatever the
 * selection, so category and fund series share one set of years.
 */
function sumByYear(
  observations: readonly AfrObservation[],
  s: TransformSettings,
  keep: (o: AfrObservation) => boolean,
): Map<number, YearSum> {
  const net = s.transfers === 'net';
  const sums = new Map<number, YearSum>();
  for (const o of observations) {
    if (o.jurisdiction !== s.jurisdiction || o.flow !== s.flow) continue;
    let sum = sums.get(o.fiscalYear);
    if (!sum) {
      sum = { nominal: 0, custodial: 0, transfers: 0, sourceIds: new Set() };
      sums.set(o.fiscalYear, sum);
    }
    // The AFR is the source of the year's total even when some cells are excluded.
    sum.sourceIds.add(o.sourceId);
    if (!keep(o)) continue;
    if (o.fundType === 'custodial') {
      sum.custodial += o.amount;
      if (!s.includeCustodial) continue;
    }
    if (isTransferAccount(o.account, o.flow)) {
      sum.transfers += o.amount;
      if (net) continue;
    }
    sum.nominal += o.amount;
  }
  return sums;
}

/**
 * 381 (revenue) and 581 (expenditure) per fiscal year over every fund except
 * custodial, for the pipeline's transfer-imbalance rule. Independent of the
 * fund, category and custodial settings. A year appears for a flow when the
 * jurisdiction has any observation for that flow and year.
 */
function transferBalances(
  observations: readonly AfrObservation[],
  jurisdiction: string,
): Record<Flow, Map<number, TransferBalance>> {
  const out: Record<Flow, Map<number, TransferBalance>> = { revenue: new Map(), expenditure: new Map() };
  for (const o of observations) {
    if (o.jurisdiction !== jurisdiction) continue;
    const byYear = out[o.flow];
    if (!byYear) continue;
    let b = byYear.get(o.fiscalYear);
    if (!b) {
      b = { amount: 0, sourceIds: new Set() };
      byYear.set(o.fiscalYear, b);
    }
    b.sourceIds.add(o.sourceId);
    if (o.fundType !== 'custodial' && isTransferAccount(o.account, o.flow)) b.amount += o.amount;
  }
  return out;
}

function measureYear(
  fy: number,
  sum: YearSum | undefined,
  s: TransformSettings,
  cpi: CpiSelection,
  population: PopulationEntry | undefined,
  jurisdiction: string,
): Measured {
  const sourceIds = sum ? [...sum.sourceIds].sort() : [];
  const notes: string[] = [];
  const out: Measured = { value: null, sourceIds, notes };
  let value: number | null = sum ? sum.nominal : 0;

  if (sum && sum.custodial !== 0) {
    notes.push(
      s.includeCustodial
        ? 'Includes custodial fund amounts (GASB 84): money the county holds or collects for others.'
        : 'Custodial fund amounts (GASB 84) are excluded.',
    );
  }
  if (sum && sum.transfers !== 0 && s.transfers === 'net') {
    notes.push(
      `Interfund transfers (account ${TRANSFER_ACCOUNTS[s.flow]}, ${formatUsd(sum.transfers)}) are excluded.`,
    );
  }

  const perCapita = s.measure === 'per_capita' || s.measure === 'real_per_capita';
  const real = s.measure === 'real' || s.measure === 'real_per_capita';

  if (perCapita) {
    const pop = population?.byYear[String(fy)]?.value;
    if (isPositiveNumber(pop)) {
      out.population = pop;
      sourceIds.push(population!.sourceId);
      value = value / pop;
    } else {
      value = null;
      notes.push(`No population estimate for ${jurisdiction}, ${fiscalYearLabel(fy)} (April 1, ${fy}).`);
    }
  }

  if (real) {
    const cpiYear = cpi.valueFor(fy);
    const cpiBase = cpi.valueFor(s.baseYear);
    if (cpiYear !== undefined) out.cpi = cpiYear;
    if (cpiBase !== undefined) out.cpiBase = cpiBase;
    if (cpiYear !== undefined || cpiBase !== undefined) sourceIds.push(cpi.sourceId);
    if (cpiYear === undefined) notes.push(cpi.unavailableReason(fy));
    if (cpiBase === undefined && s.baseYear !== fy) notes.push(cpi.unavailableReason(s.baseYear));
    const yearNote = cpiYear !== undefined ? cpi.noteFor(fy) : undefined;
    const baseNote = cpiBase !== undefined && s.baseYear !== fy ? cpi.noteFor(s.baseYear) : undefined;
    if (yearNote) notes.push(yearNote);
    if (baseNote) notes.push(baseNote);
    if (cpiYear === undefined || cpiBase === undefined) {
      value = null;
    } else if (value !== null) {
      // Expressed in base-year dollars.
      value = (value * cpiBase) / cpiYear;
    }
  }

  out.value = value;
  return out;
}

/** Deterministic, locale-independent: 1234567 -> "$1,234,567"; -5.5 -> "-$5.50". */
export function formatUsd(n: number): string {
  const abs = Math.abs(n);
  const [whole, cents] = (Number.isInteger(abs) ? String(abs) : abs.toFixed(2)).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${n < 0 ? '-' : ''}$${grouped}${cents ? '.' + cents : ''}`;
}

/** True when a non-empty fund selection includes some, but not all, of `tags`. */
function splitBySelection(tags: readonly string[], selection: readonly string[] | undefined): boolean {
  if (!selection || selection.length === 0) return false;
  const n = tags.filter((t) => selection.includes(t)).length;
  return n > 0 && n < tags.length;
}

function addUnique(target: string[], items: Iterable<string>): void {
  for (const x of items) if (!target.includes(x)) target.push(x);
}

function normalizeRange([a, b]: readonly [number, number]): [number, number] {
  return a <= b ? [a, b] : [b, a];
}

function isPositiveNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}
