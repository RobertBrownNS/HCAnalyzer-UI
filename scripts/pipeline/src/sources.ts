import path from 'node:path';
import type { CountyConfig } from '../config/counties.js';
import type { CpiSeriesConfig } from './bls/cpi.js';
import { RAW_DIR } from './lib/paths.js';

export const EDR_AFR_BASE = 'https://edr.state.fl.us/Content/local-government/data/revenues-expenditures/cntyfiscal/';
export const EDR_COUNTY_FISCAL_PAGE = 'https://edr.state.fl.us/Content/local-government/data/revenues-expenditures/cntyfiscal.cfm';
export const EDR_COUNTY_FISCAL_PAGE_FILE = path.join(RAW_DIR, 'edr', 'cntyfiscal.html');
export const EDR_POPULATION_URL = 'https://edr.state.fl.us/Content/population-demographics/data/FLcopops.xlsx';
export const EDR_POPULATION_PAGE = 'https://edr.state.fl.us/Content/population-demographics/data/index-floridaproducts.cfm';

/** One entry of data/raw/manifest.json. */
export interface RetrievalRecord {
  url: string;
  publisher: string;
  bytes: number;
  method: string;
  /** ISO date the current bytes were first downloaded. */
  retrieved: string;
  /** ISO date the bytes were last re-downloaded and found identical. */
  lastVerified: string;
  sha256: string;
}

export interface RetrievalLog {
  files: Record<string, RetrievalRecord>;
}

/** Matches the Source interface in CLAUDE.md, plus the raw file path it was built from. */
export interface Source {
  id: string;
  publisher: string;
  title: string;
  url: string;
  retrieved: string;
  sha256: string;
  caveats: string[];
  /** Repo-relative path of the raw file (data/raw/...). */
  rawFile: string;
  /** Endpoint actually downloaded, when it differs from `url` (a human-readable page). */
  accessUrl?: string;
}

export const EDR = 'Florida Legislature, Office of Economic and Demographic Research (EDR)';

/** EDR's data-use notice, quoted verbatim from the county fiscal page. */
export const EDR_CUSTODIAL_NOTICE =
  'In preparation for the implementation of GASB Statement No. 84, the Department of Financial Services added the Custodial Fund column to the Annual Financial Report in FY 2020-21. Custodial Fund reporting is used to account for assets held by a government in a purely custodial capacity. For example, a county or municipal government might collect taxes or other revenues on behalf of other agencies or local governments, and these transactions would be recorded in the Custodial Fund. Since fiscal years prior to FY 2020-21 did not include Custodial Fund reporting, the account totals for FY 2020-21 and subsequent fiscal years may not be directly comparable.';

export const AFR_FOOTNOTE =
  'Compiled from data obtained from the Florida Department of Financial Services, Division of Accounting and Auditing, Bureau of Local Government.';

export const sourceIds = {
  afr: (county: CountyConfig, flow: 'revenue' | 'expenditure') => `edr-afr-${flow}s-${county.slug}`,
  population: 'edr-population-flcopops',
  countyFiscalPage: 'edr-cntyfiscal-page',
  countyAfr: (county: CountyConfig, fiscalYear: number) => `county-afr-${county.slug}-fy${fiscalYear}`,
  cpi: (series: CpiSeriesConfig) => `bls-cpi-${series.id}`,
};

export function afrSource(county: CountyConfig, flow: 'revenue' | 'expenditure', rawFile: string, r: RetrievalRecord): Source {
  const years = flow === 'revenue' ? 'revenues' : 'expenditures';
  return {
    id: sourceIds.afr(county, flow),
    publisher: EDR,
    title: `${county.name} Government ${flow === 'revenue' ? 'Revenues' : 'Expenditures'} Reported by Account (from county Annual Financial Reports)`,
    url: r.url,
    retrieved: r.retrieved,
    sha256: r.sha256,
    rawFile,
    caveats: [
      AFR_FOOTNOTE,
      EDR_CUSTODIAL_NOTICE,
      'The workbook "Total Account" column sums every fund column, including fiduciary funds (custodial, pension, trust, private purpose) and Component Units, which are legally separate entities.',
      `Amounts are as reported by the county in its Annual Financial Report; ${years} include inter-fund transfers (${flow === 'revenue' ? 'account 381' : 'account 581'}), so summing across funds counts money moved between county funds in both the sending and receiving fund.`,
      'Account codes are stored as numbers in the workbook, so trailing zeros of Uniform Accounting System codes are not preserved (312.30 appears as 312.3, for example).',
      'Per-capita figures in the workbook use the April 1 population estimate for the calendar year in which the fiscal year ends.',
      ...(county.afrCaveats ?? []),
    ],
  };
}

export function countyAfrSource(county: CountyConfig, fiscalYear: number, rawFile: string, r: RetrievalRecord): Source {
  return {
    id: sourceIds.countyAfr(county, fiscalYear),
    publisher: county.countyAfr!.publisher,
    title: `${county.name} Annual Financial Report, fiscal year ${fiscalYear - 1}-${fiscalYear} (Florida Department of Financial Services form, as filed by the county)`,
    url: county.countyAfr!.indexUrl,
    accessUrl: r.url,
    retrieved: r.retrieved,
    sha256: r.sha256,
    rawFile,
    caveats: [
      'Used only to check that EDR transcribed the county filing correctly; the numbers shown in the explorer come from the EDR workbooks.',
      'Values were read from text extracted from the PDF. Each value read is checked against the EDR workbook, and the comparison is published in the project validation report.',
      ...(county.countyAfr!.files.find((f) => f.fiscalYear === fiscalYear)?.caveats ?? []),
    ],
  };
}

export function populationSource(rawFile: string, r: RetrievalRecord): Source {
  return {
    id: sourceIds.population,
    publisher: `${EDR}; estimates by the Bureau of Economic and Business Research (BEBR), University of Florida`,
    title: 'Countywide, Unincorporated and Incorporated Totals - Census Counts and Population Estimates',
    url: EDR_POPULATION_PAGE,
    accessUrl: r.url,
    retrieved: r.retrieved,
    sha256: r.sha256,
    rawFile,
    caveats: [
      'Values are April 1 figures. Most years are BEBR estimates published that year; 2000, 2010 and 2020 also have census counts. These are not intercensal-revised series, so a census year can step up or down relative to the estimates around it.',
      'For 2020 the pipeline uses the revised BEBR estimate (the value EDR used for FY 2019-20 per-capita figures); the 2020 census count is listed as an alternate.',
      'EDR notes that countywide figures do not reflect the population estimates ultimately used for revenue-sharing purposes.',
    ],
  };
}

export function countyFiscalPageSource(rawFile: string, r: RetrievalRecord): Source {
  return {
    id: sourceIds.countyFiscalPage,
    publisher: EDR,
    title: 'County Government Revenues and Expenditures (Annual Financial Report data) - index page and data-use notice',
    url: r.url,
    retrieved: r.retrieved,
    sha256: r.sha256,
    rawFile,
    caveats: [
      EDR_CUSTODIAL_NOTICE,
      'Persons interested in reviewing 2021-2025 revenues or expenditures for an individual county government, minus the impact of any Custodial Fund reporting, can simply open the relevant Excel file and delete the Custodial column. Since the figures in the Total Account and Per Capita Accounts columns are formula-driven, these amounts will automatically recalculate when the Custodial column is deleted.',
    ],
  };
}

export function cpiSource(series: CpiSeriesConfig, rawFile: string, r: RetrievalRecord, extraCaveats: string[]): Source {
  return {
    id: sourceIds.cpi(series),
    publisher: 'U.S. Bureau of Labor Statistics (BLS)',
    title: `Consumer Price Index for All Urban Consumers (CPI-U), series ${series.id}: ${series.title}`,
    url: `https://data.bls.gov/timeseries/${series.id}`,
    accessUrl: r.url,
    retrieved: r.retrieved,
    sha256: r.sha256,
    rawFile,
    caveats: [
      `Base period ${series.basePeriod}. Published ${
        series.frequency === 'monthly'
          ? 'monthly'
          : series.frequency === 'bimonthly'
            ? 'bimonthly (odd months: Jan, Mar, May, Jul, Sep, Nov)'
            : 'as semiannual averages (Jan-Jun, Jul-Dec) plus an annual average'
      }.`,
      `Calendar-year values are the BLS-published annual averages (period ${series.frequency === 'semiannual' ? 'S03' : 'M13'}).`,
      series.frequency === 'monthly'
        ? 'Fiscal-year (Oct-Sep) values are computed by this pipeline as the simple mean of the 12 monthly index values in that fiscal year, rounded to 3 decimals; BLS does not publish fiscal-year averages.'
        : series.frequency === 'bimonthly'
          ? 'Fiscal-year (Oct-Sep) values are computed by this pipeline as the simple mean of the 6 published bimonthly values in that fiscal year, rounded to 3 decimals. BLS does not publish fiscal-year averages, and the same method applied to calendar years does not reproduce the BLS-published annual averages for this area.'
          : 'No fiscal-year values: semiannual periods do not align with the Oct-Sep fiscal year.',
      ...extraCaveats,
    ],
  };
}
