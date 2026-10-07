import { fiscalYearMonths } from '../lib/fiscal.js';

/** CPI series the pipeline downloads. Metadata verified against https://data.bls.gov/timeseries/<id>. */
export interface CpiSeriesConfig {
  id: string;
  key: 'national' | 'tampa' | 'tampa_semiannual';
  title: string;
  area: string;
  basePeriod: string;
  /** Calendar months (1-12) in which BLS publishes an index value for this series. */
  publishedMonths: number[];
  frequency: 'monthly' | 'bimonthly' | 'semiannual';
}

export const CPI_SERIES: CpiSeriesConfig[] = [
  {
    id: 'CUUR0000SA0',
    key: 'national',
    title: 'All items in U.S. city average, all urban consumers, not seasonally adjusted',
    area: 'U.S. city average',
    basePeriod: '1982-84=100',
    publishedMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    frequency: 'monthly',
  },
  {
    id: 'CUURS35DSA0',
    key: 'tampa',
    title: 'All items in Tampa-St. Petersburg-Clearwater, FL, all urban consumers, not seasonally adjusted',
    area: 'Tampa-St. Petersburg-Clearwater, FL',
    basePeriod: '1987=100',
    publishedMonths: [1, 3, 5, 7, 9, 11],
    frequency: 'bimonthly',
  },
  {
    // Same index as CUURS35DSA0, published as semiannual (S01 Jan-Jun, S02 Jul-Dec) and annual (S03)
    // averages. Unlike the bimonthly series it covers years before 2018.
    id: 'CUUSS35DSA0',
    key: 'tampa_semiannual',
    title: 'All items in Tampa-St. Petersburg-Clearwater, FL, all urban consumers, not seasonally adjusted (semiannual averages)',
    area: 'Tampa-St. Petersburg-Clearwater, FL',
    basePeriod: '1987=100',
    publishedMonths: [],
    frequency: 'semiannual',
  },
];

/** Shape of a BLS Public Data API v2 response (only the fields used here). */
export interface BlsResponse {
  status: string;
  message?: string[];
  Results?: {
    series: Array<{
      seriesID: string;
      data: Array<{ year: string; period: string; value: string; footnotes: Array<{ code?: string; text?: string }> }>;
    }>;
  };
}

export interface ParsedCpi {
  /** "YYYY-MM" -> index value. */
  monthly: Map<string, number>;
  /** "YYYY-MM" -> BLS footnote explaining why the value is missing. */
  missing: Map<string, string>;
  /** Calendar year -> BLS-published annual average (period M13, or S03 for semiannual series). */
  annual: Map<number, number>;
  /** "YYYY-H1" / "YYYY-H2" -> BLS-published semiannual average (periods S01 / S02). */
  semiannual: Map<string, number>;
}

/** Merge one or more raw BLS responses for a single series. Conflicting duplicates are an error. */
export function parseBlsResponses(seriesId: string, responses: BlsResponse[]): ParsedCpi {
  const out: ParsedCpi = { monthly: new Map(), missing: new Map(), annual: new Map(), semiannual: new Map() };
  const put = <K>(map: Map<K, number>, key: K, value: number, label: string) => {
    const prev = map.get(key);
    if (prev !== undefined && prev !== value) throw new Error(`${seriesId} ${label}: conflicting values ${prev} vs ${value}`);
    map.set(key, value);
  };
  for (const resp of responses) {
    if (resp.status !== 'REQUEST_SUCCEEDED') throw new Error(`${seriesId}: BLS status ${resp.status} ${resp.message?.join('; ')}`);
    for (const s of resp.Results?.series ?? []) {
      if (s.seriesID !== seriesId) throw new Error(`Expected series ${seriesId}, response has ${s.seriesID}`);
      for (const d of s.data) {
        const value = Number(d.value);
        const half = /^S0([123])$/.exec(d.period);
        if (half) {
          if (!Number.isFinite(value) || d.value.trim() === '') throw new Error(`${seriesId} ${d.year} ${d.period} is "${d.value}"`);
          if (half[1] === '3') put(out.annual, Number(d.year), value, `${d.year} annual`);
          else put(out.semiannual, `${d.year}-H${half[1]}`, value, `${d.year}-H${half[1]}`);
          continue;
        }
        const m = /^M(\d{2})$/.exec(d.period);
        if (!m) throw new Error(`${seriesId}: unexpected period ${d.period}`);
        const month = Number(m[1]);
        if (month === 13) {
          if (!Number.isFinite(value)) throw new Error(`${seriesId} ${d.year} annual average is "${d.value}"`);
          put(out.annual, Number(d.year), value, `${d.year} annual`);
          continue;
        }
        const key = `${d.year}-${m[1]}`;
        if (Number.isFinite(value) && d.value.trim() !== '') put(out.monthly, key, value, key);
        else out.missing.set(key, d.footnotes.map((f) => f.text).filter(Boolean).join('; ') || `BLS value "${d.value}"`);
      }
    }
  }
  return out;
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export type AverageResult =
  | { ok: true; value: number; months: string[] }
  | { ok: false; reason: string; months: string[] };

/** Mean of the published months in `months`, rounded to 3 decimals (BLS index precision). */
export function averageOf(cpi: ParsedCpi, config: CpiSeriesConfig, months: string[]): AverageResult {
  const expected = months.filter((ym) => config.publishedMonths.includes(Number(ym.slice(5))));
  const missing = expected.filter((ym) => !cpi.monthly.has(ym));
  if (missing.length) {
    const reasons = missing.map((ym) => (cpi.missing.has(ym) ? `${ym} (${cpi.missing.get(ym)})` : `${ym} (not in the downloaded BLS data)`));
    return { ok: false, reason: `missing ${reasons.join(', ')}`, months: expected };
  }
  const sum = expected.reduce((acc, ym) => acc + cpi.monthly.get(ym)!, 0);
  return { ok: true, value: round3(sum / expected.length), months: expected };
}

export function calendarYearMonths(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
}

export function fiscalYearAverage(cpi: ParsedCpi, config: CpiSeriesConfig, fiscalYear: number): AverageResult {
  return averageOf(cpi, config, fiscalYearMonths(fiscalYear));
}
