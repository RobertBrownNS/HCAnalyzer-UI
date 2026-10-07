export interface Observation {
  jurisdiction: string;   // "hillsborough"
  fiscalYear: number;     // 2021 = FY 2020-21
  account: string;        // e.g. "311" ad valorem taxes
  category: string;       // "ad_valorem" | "public_safety" | ...
  fundType: 'general' | 'special_revenue' | 'debt_service' | 'capital'
          | 'permanent' | 'enterprise' | 'internal_service' | 'custodial' | string;
  amount: number;         // nominal USD
  sourceId: string;
}

export interface Source {
  id: string; publisher: string; title: string; url: string;
  retrieved: string;      // ISO date
  sha256: string;
  caveats: string[];
}

export interface Annotation {
  fiscalYear: number; label: string;
  kind: 'methodology' | 'policy' | 'event';
  sourceId: string;
}

/** Year-keyed values, e.g. { 2021: 1478759 }. Keys are fiscal or calendar years as the series states. */
export type YearSeries = Record<number, number>;

/** Population estimates for one jurisdiction, keyed by year. */
export interface PopulationSeries {
  jurisdiction: string;   // "hillsborough" | "florida"
  values: YearSeries;
  sourceId: string;
}

export type CpiIndexId = 'cpi-u-us' | 'cpi-u-tampa';

/** CPI index levels keyed by year, joined to observations in the browser. */
export interface CpiSeries {
  id: CpiIndexId;
  values: YearSeries;
  sourceId: string;
}

// ---------------------------------------------------------------------------
// Shapes of the files in src/assets/data/ (see docs/data-layout.md).
// The CLAUDE.md interfaces above are kept as the common core; these add the
// fields the pipeline actually writes.
// ---------------------------------------------------------------------------

export type Flow = 'revenue' | 'expenditure';

export type Measure = 'nominal' | 'per_capita' | 'real' | 'real_per_capita';

/**
 * annotations.json rows: CLAUDE.md Annotation plus optional conditions on
 * when it applies. An absent condition applies to every view.
 */
export interface AnnotationRecord extends Annotation {
  flow?: Flow;
  /** Show only when the custodial toggle matches. */
  custodial?: 'included' | 'excluded';
  /** Show only for these measures. */
  measures?: readonly Measure[];
}

/** One non-zero fund cell of one account row. Zero cells are omitted (= $0). */
export interface AfrObservation extends Observation {
  flow: Flow;
  /** Major UAS group, e.g. "taxes", "public_safety". */
  section: string;
  /** Workbook sheet and cell, e.g. "2025!D6". */
  ref: string;
}

/** sources.json rows: CLAUDE.md Source plus the file actually downloaded. */
export interface SourceRecord extends Source {
  rawFile?: string;
  accessUrl?: string;
}

export interface PopulationValue {
  value: number;
  /** e.g. "bebr_estimate", "bebr_revised_estimate", "census_count". */
  basis: string;
  /** FLcopops.xlsx sheet name, e.g. "2025 BEBR". */
  sheet: string;
}

/** population.json[jurisdiction]. byYear is keyed by April 1 year = fiscalYear. */
export interface PopulationEntry {
  byYear: Record<string, PopulationValue>;
  alternates?: Record<string, PopulationValue[]>;
  fiscalYearAlignment?: string;
  reference?: string;
  sourceId: string;
}

/** population.json: keyed by jurisdiction ("hillsborough"). */
export type PopulationFile = Record<string, PopulationEntry>;

/** One BLS series in cpi.json. Year maps are keyed by year as a string. */
export interface CpiSeriesFile {
  area: string;
  basePeriod: string;
  seriesId: string;
  sourceId: string;
  title: string;
  frequency: string;
  startPeriod?: string;
  endPeriod?: string;
  defaultAlignment?: string;
  alignmentRule?: string;
  /**
   * Oct-Sep mean keyed by fiscalYear (computed by the pipeline). null means no
   * value; the reason is in fiscalYearUnavailable.
   */
  fiscalYear: Record<string, number | null>;
  fiscalYearBasis: string;
  fiscalYearUnavailable: Record<string, string>;
  /** BLS-published annual average keyed by calendar year; null as above. */
  calendarYear: Record<string, number | null>;
  calendarYearBasis: string;
  calendarYearUnavailable: Record<string, string>;
  monthly: Record<string, number>;
  semiannual: Record<string, number>;
  missingMonths: Record<string, string>;
}

/**
 * cpi.json. `tampa` is the bimonthly series (fiscal-year values FY 2017-18+);
 * `tampa_semiannual` carries the Tampa calendar-year averages from 2000.
 */
export interface CpiFile {
  national: CpiSeriesFile;
  tampa: CpiSeriesFile;
  tampa_semiannual: CpiSeriesFile;
}

/** One row of hillsborough.workbook-totals.json (reference values for QA). */
export interface WorkbookTotal {
  fiscalYear: number;
  flow: Flow;
  label: string;
  sheet: string;
  row: number;
  byFund: Record<string, number>;
  total: number;
  perCapita: number;
  population: number;
}
