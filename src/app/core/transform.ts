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
  Annotation,
  CpiFile,
  CpiSeriesFile,
  Flow,
  PopulationEntry,
  PopulationFile,
  SourceRecord,
} from './models';
import { fiscalYearLabel } from './fiscal-year';

export { fiscalYearLabel } from './fiscal-year';

export type Measure = 'nominal' | 'per_capita' | 'real' | 'real_per_capita';
export type CpiIndex = 'cpi-u-us' | 'cpi-u-tampa';
/** 'fiscal' = Oct-Sep mean for the fiscal year; 'calendar' = BLS annual average. */
export type CpiPeriod = 'fiscal' | 'calendar';

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
  /** Key into observations and population.json. Defaults to DEFAULT_JURISDICTION. */
  jurisdiction?: string;
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
  annotations: readonly Annotation[];
  sources: readonly SourceRecord[];
}

export const DEFAULT_JURISDICTION = 'hillsborough';

/**
 * Defaults for Hillsborough as of the 2026-10-06 data build. The range covers
 * both flows (expenditures start FY 2004-05, revenues FY 2005-06); buildSeries
 * clips to the years that exist. Use defaultSettingsFor() to derive the range
 * from the loaded data instead. Frozen: copy before changing.
 */
export const DEFAULT_SETTINGS: TransformSettings = Object.freeze({
  flow: 'revenue',
  measure: 'nominal',
  baseYear: 2025,
  indexTo100: false,
  range: Object.freeze([2005, 2025]) as [number, number],
  includeCustodial: false,
  cpiIndex: 'cpi-u-us',
  cpiPeriod: 'fiscal',
}) as TransformSettings;

/** DEFAULT_SETTINGS with range = full available years and baseYear = latest. */
export function defaultSettingsFor(
  data: TransformData,
  flow: Flow = DEFAULT_SETTINGS.flow,
  jurisdiction: string = DEFAULT_JURISDICTION,
): TransformSettings {
  const years = availableYears(data, flow, jurisdiction);
  if (years.length === 0) {
    return { ...DEFAULT_SETTINGS, flow, range: [...DEFAULT_SETTINGS.range] };
  }
  const first = years[0];
  const last = years[years.length - 1];
  return { ...DEFAULT_SETTINGS, flow, baseYear: last, range: [first, last] };
}

/** Sorted fiscal years that have at least one observation for the flow. */
export function availableYears(
  data: TransformData,
  flow: Flow,
  jurisdiction: string = DEFAULT_JURISDICTION,
): number[] {
  const years = new Set<number>();
  for (const o of data.observations) {
    if (o.flow === flow && o.jurisdiction === jurisdiction) years.add(o.fiscalYear);
  }
  return [...years].sort((a, b) => a - b);
}

/** Annotations whose fiscalYear falls inside the settings range, by year. */
export function annotationsInRange(data: TransformData, s: TransformSettings): Annotation[] {
  const [lo, hi] = normalizeRange(s.range);
  return data.annotations
    .filter((a) => a.fiscalYear >= lo && a.fiscalYear <= hi)
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
      const yearText = period === 'fiscal' ? fiscalYearLabel(fy) : `calendar year ${fy}`;
      const reason = unavailable[String(fy)];
      return `No ${label} for ${yearText}` + (reason ? ` (${reason}).` : '.');
    },
  };
}

// ---------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------

interface YearSum {
  nominal: number;
  custodial: number;
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

export function buildSeries(data: TransformData, s: TransformSettings): SeriesPoint[] {
  const jurisdiction = s.jurisdiction ?? DEFAULT_JURISDICTION;
  const [lo, hi] = normalizeRange(s.range);
  const sums = sumByYear(data.observations, s.flow, jurisdiction, s.includeCustodial);
  const cpi = selectCpi(data.cpi, s.cpiIndex, s.cpiPeriod);
  const population = data.population[jurisdiction];

  const measure = (fy: number): Measured => measureYear(fy, sums.get(fy), s, cpi, population, jurisdiction);

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
      for (const id of base.sourceIds) if (!sourceIds.includes(id)) sourceIds.push(id);
    }

    const point: SeriesPoint = {
      fiscalYear: fy,
      label: fiscalYearLabel(fy),
      value,
      nominal: sum.nominal,
      custodialNominal: sum.custodial,
      sourceIds,
      notes,
    };
    if (m.population !== undefined) point.population = m.population;
    if (m.cpi !== undefined) point.cpi = m.cpi;
    if (m.cpiBase !== undefined) point.cpiBase = m.cpiBase;
    return point;
  });
}

/**
 * Sums observations per fiscal year for one flow and jurisdiction.
 *
 * Fund scope (Phase 2): all funds the workbook reports, except custodial when
 * excluded. That includes pension, trust, private purpose and component units,
 * so with custodial included the sum equals EDR's "Total - All Account Codes"
 * and with it excluded it equals EDR's recalculated total. The fund-scope
 * control is Phase 3; see docs/decisions.md O-07.
 *
 * Zero cells are omitted from observations.json, so a year with no matching
 * rows sums to 0. Every year present for the flow gets an entry.
 */
function sumByYear(
  observations: readonly AfrObservation[],
  flow: Flow,
  jurisdiction: string,
  includeCustodial: boolean,
): Map<number, YearSum> {
  const sums = new Map<number, YearSum>();
  for (const o of observations) {
    if (o.flow !== flow || o.jurisdiction !== jurisdiction) continue;
    let sum = sums.get(o.fiscalYear);
    if (!sum) {
      sum = { nominal: 0, custodial: 0, sourceIds: new Set() };
      sums.set(o.fiscalYear, sum);
    }
    // The AFR is the source of the year's total even when some cells are excluded.
    sum.sourceIds.add(o.sourceId);
    if (o.fundType === 'custodial') {
      sum.custodial += o.amount;
      if (!includeCustodial) continue;
    }
    sum.nominal += o.amount;
  }
  return sums;
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

function normalizeRange([a, b]: readonly [number, number]): [number, number] {
  return a <= b ? [a, b] : [b, a];
}

function isPositiveNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}
