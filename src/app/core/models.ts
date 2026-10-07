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
