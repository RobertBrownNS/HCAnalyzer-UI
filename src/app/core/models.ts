export interface Observation {
  jurisdiction: string;   // county slug, as listed in manifest.jurisdictions
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
  jurisdiction: string;   // county slug, or "florida" for statewide
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
  /** Absent = applies to every jurisdiction (e.g. the GASB 84 marker). */
  jurisdiction?: string;
  flow?: Flow;
  /** Show only when the custodial toggle matches. */
  custodial?: 'included' | 'excluded';
  /** Show only for these measures. */
  measures?: readonly Measure[];
  /** Longer factual text for the source drawer. */
  detail?: string;
  /** Workbook-qualified cells, "workbook:sheet!cell", e.g. "expenditures:2023!D16". */
  refs?: readonly string[];
  /** Machine-readable kind (pipeline: ANNOTATION_TOPICS in scripts/pipeline/src/edr/anomalies.ts). */
  topic?: AnnotationTopic;
  /** Fund types the row is about (DR-47). Shown when the fund selection includes some but not all of them. */
  funds?: readonly string[];
  /** Categories the row is about (DR-47). Shown only in a category view that includes one. */
  categories?: readonly string[];
  /**
   * EDR cells the row is about (DR-50), as account + fund. For the source
   * drawer: the row applies to a point whose observations include one of these
   * cells. Doesn't affect chart markers.
   */
  cells?: readonly { account: string; fundType: string }[];
  /** Never a chart marker; shown only in the source drawer via `cells`. */
  drawerOnly?: boolean;
  /** Reconciliation rows (QA-40): the amount involved, whole USD. Informational; not a filter. */
  amount?: number;
}

export type AnnotationTopic =
  | 'gasb84'
  | 'transfer-imbalance'
  | 'proprietary-fund-gap'
  | 'fund-gap'
  | 'rounding'
  | 'source-anomaly'
  | 'custodial-accounts'
  | 'custodial-zero'
  | 'custodial-start'
  | 'population-source'
  | 'reconciliation-difference';

/** categories.json rows (D-19), in display order. */
export interface CategoryDef {
  id: string;
  flow: Flow;
  label: string;
  section?: string;
  accountRanges?: readonly {
    from: string;
    to: string;
    /** First and last fiscal year the range applies to (DR-48); absent = open-ended. */
    fromFiscalYear?: number;
    toFiscalYear?: number;
    uasReference?: string;
    sourceIds?: readonly string[];
  }[];
  uasReference?: string;
  sourceId?: string;
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
  /** Shared sources: caveats that apply to one county only, by county slug (shown with `caveats`). */
  caveatsByJurisdiction?: Readonly<Record<string, readonly string[]>>;
  /** EDR AFR sources: how far the county's figures were checked against its own filed AFR. */
  countyAfrCrossCheck?: 'not-checked' | 'spot-check' | 'partial' | 'full';
  /** Plain-language statement of that check, for display. */
  crossCheckSummary?: string;
  /** Per fiscal-year range status; together the ranges cover every workbook year once. */
  crossCheckCoverage?: readonly CrossCheckRange[];
}

/** <county>.accounts.json row: an account's names over the years. */
export interface AccountRecord {
  account: string;
  flow: Flow;
  category: string;
  section: string;
  /** Latest printed name. */
  name: string;
  names: readonly { fiscalYears: readonly number[]; name: string }[];
}

/** funds.json (P3-02, DR-49): every EDR fund column, its GASB group, and the presets. Array order is display order. */
export interface FundsFile {
  sourceId?: string;
  groups: readonly { id: string; label: string }[];
  funds: readonly {
    id: string;
    /** EDR column header. */
    label: string;
    group: string;
    description?: string;
    /** Set on a fund with its own control (custodial): never in the fund checkboxes. */
    handledByToggle?: string;
  }[];
  presets: readonly { id: string; label: string; funds: readonly string[] }[];
  note?: string;
}

/** categories.json (P3-01, DR-49): one row per category, in UAS order. */
export type CategoriesFile = readonly CategoryDef[];

/** Cross-check status of a range of fiscal years (pipeline, DR-45). */
export type CrossCheckStatus = 'full' | 'spot-check' | 'not-checked' | 'mismatch';

/** Inclusive fiscal-year range (year ending: 2013 = FY 2012-13) with one status. */
export interface CrossCheckRange {
  fromFiscalYear: number;
  toFiscalYear: number;
  status: CrossCheckStatus;
  /** Mismatch ranges: amounts present in both sources under a different account or fund. */
  classificationDifferences?: number;
  /** Mismatch ranges: same account and fund, different amount. */
  valueDifferences?: number;
  /** Mismatch ranges: amounts in only one source, with no equal counterpart. */
  unmatchedAmounts?: number;
  /** Mismatch ranges: yearly totals equal in every year of the range. */
  totalsMatch?: boolean;
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

/** population.json: keyed by jurisdiction slug. */
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
  /** Caveats on values that are present, keyed by year. */
  calendarYearNotes?: Record<string, string>;
  fiscalYearNotes?: Record<string, string>;
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

/** One row of <jurisdiction>.workbook-totals.json (reference values for QA). */
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
