import { fiscalYearLabel } from './lib/fiscal.js';

/**
 * "Index comparison (informational)" section of data/validation.md: cumulative change in national
 * CPI-U vs Tampa CPI over fixed periods, using only values in cpi.json, plus a worked deflation
 * example. Pure function of its inputs, so the report stays deterministic.
 */

type YearSeries = Record<string, number | null>;

export interface IndexComparisonInput {
  nationalCalendar: YearSeries;
  tampaCalendar: YearSeries;
  nationalFiscal: YearSeries;
  tampaFiscal: YearSeries;
  /** Revenue excluding custodial for the worked example, keyed by fiscal year. */
  revenueExclCustodial: Record<number, number>;
  jurisdictionName: string;
}

/** [start FY, end FY] pairs, by fiscal-year ending year. */
export const COMPARISON_PERIODS: Array<[number, number]> = [
  [2006, 2025],
  [2020, 2025],
  [2018, 2025],
];
export const EXAMPLE_FROM_FY = 2025;
export const EXAMPLE_BASE_FY = 2020;

export function cumulativeChange(series: YearSeries, from: number, to: number): number | null {
  const a = series[String(from)];
  const b = series[String(to)];
  if (a == null || b == null) return null;
  return b / a - 1;
}

const pct = (x: number | null) => (x === null ? 'n/a' : `${(x * 100).toFixed(2)}%`);
const pp = (x: number | null) => (x === null ? 'n/a' : `${(x * 100).toFixed(2)} pp`);
const idx = (x: number | null | undefined) => (x == null ? 'n/a' : String(x));
const usd = (n: number | null) =>
  n === null ? 'n/a' : (n < 0 ? '-$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US');

/** Index years equal fiscal-year ending years in both alignments (FY 2024-25 -> 2025). */
function periodRows(national: YearSeries, tampa: YearSeries, keyLabel: (y: number) => string): string[] {
  return COMPARISON_PERIODS.map(([from, to]) => {
    const n = cumulativeChange(national, from, to);
    const t = cumulativeChange(tampa, from, to);
    const gap = n === null || t === null ? null : n - t;
    const missing = [from, to].filter((y) => tampa[String(y)] == null).map(keyLabel);
    const note = missing.length ? ` (no Tampa value for ${missing.join(', ')})` : '';
    return `| ${fiscalYearLabel(from)} to ${fiscalYearLabel(to)} | ${keyLabel(from)} to ${keyLabel(to)} | ${idx(national[String(from)])} to ${idx(national[String(to)])} | ${pct(n)} | ${idx(tampa[String(from)])} to ${idx(tampa[String(to)])} | ${pct(t)}${note} | ${pp(gap)} |`;
  });
}

export function indexComparisonSection(input: IndexComparisonInput): string[] {
  const header =
    '| Period | Index values used | National CPI-U values | National change | Tampa CPI values | Tampa change | Gap (national minus Tampa) |\n|---|---|---|---:|---|---:|---:|';

  const amount = input.revenueExclCustodial[EXAMPLE_FROM_FY];
  const exampleRows: string[] = [];
  const results: Record<string, number | null> = {};
  for (const [alignment, nat, tam, label] of [
    ['Calendar-year', input.nationalCalendar, input.tampaCalendar, (y: number) => String(y)],
    ['Fiscal-year', input.nationalFiscal, input.tampaFiscal, (y: number) => fiscalYearLabel(y)],
  ] as const) {
    for (const [name, series] of [['National CPI-U', nat], ['Tampa CPI', tam]] as const) {
      const base = series[String(EXAMPLE_BASE_FY)];
      const cur = series[String(EXAMPLE_FROM_FY)];
      const value = base == null || cur == null || amount === undefined ? null : (amount * base) / cur;
      results[`${alignment}|${name}`] = value;
      exampleRows.push(
        `| ${alignment} | ${name} | ${label(EXAMPLE_BASE_FY)}: ${idx(base)}; ${label(EXAMPLE_FROM_FY)}: ${idx(cur)} | ${usd(value)} | ${usd(value === null || amount === undefined ? null : value - amount)} |`,
      );
    }
  }
  const diffRows = (['Calendar-year', 'Fiscal-year'] as const).map((a) => {
    const n = results[`${a}|National CPI-U`];
    const t = results[`${a}|Tampa CPI`];
    return `| ${a} | ${usd(n === null || t === null ? null : n - t)} |`;
  });

  return [
    '## Index comparison (informational)',
    '',
    'Computed from `src/assets/data/cpi.json` only. Change = end index / start index - 1. Gap = national change minus Tampa change, in percentage points (pp). Percentages are rounded to 2 decimals for display; calculations use the stored index values.',
    '',
    '### Calendar-year alignment',
    '',
    'Each fiscal year is matched to the BLS annual average of the calendar year in which it ends (FY 2024-25 uses 2025). National: CUUR0000SA0 annual average (M13). Tampa: CUUSS35DSA0 annual average (S03).',
    '',
    header,
    ...periodRows(input.nationalCalendar, input.tampaCalendar, (y) => String(y)),
    '',
    '### Fiscal-year alignment',
    '',
    'Oct-Sep fiscal-year averages computed by the pipeline. National: mean of 12 monthly CUUR0000SA0 values. Tampa: mean of 6 bimonthly CUURS35DSA0 values, available FY 2017-18 onward only.',
    '',
    header,
    ...periodRows(input.nationalFiscal, input.tampaFiscal, (y) => fiscalYearLabel(y)),
    '',
    `### Worked example: ${input.jurisdictionName} ${fiscalYearLabel(EXAMPLE_FROM_FY)} revenue excluding custodial, in ${fiscalYearLabel(EXAMPLE_BASE_FY)} dollars`,
    '',
    `Nominal amount: ${usd(amount ?? null)} (workbook Total Account minus Custodial column, revenues sheet ${EXAMPLE_FROM_FY}). Deflated amount = nominal x index(${fiscalYearLabel(EXAMPLE_BASE_FY)}) / index(${fiscalYearLabel(EXAMPLE_FROM_FY)}). Dollars rounded to the nearest dollar for display.`,
    '',
    '| Alignment | Index | Index values | In base-year dollars | Difference from nominal |',
    '|---|---|---|---:|---:|',
    ...exampleRows,
    '',
    '| Alignment | National-deflated minus Tampa-deflated |',
    '|---|---:|',
    ...diffRows,
    '',
  ];
}
