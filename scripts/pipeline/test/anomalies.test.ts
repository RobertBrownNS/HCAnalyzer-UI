import { describe, expect, it } from 'vitest';
import type { Flow } from '../src/edr/accounts.js';
import type { AfrSheet } from '../src/edr/afr.js';
import { generateAnomalies, transferBalances, yearOverYearSwings } from '../src/edr/anomalies.js';
import type { PopulationValue } from '../src/edr/population.js';

const FUNDS = ['general', 'custodial'];

/** Minimal sheet: accounts as { code: [general, custodial] }. Column D = general, K = custodial. */
function sheet(flow: Flow, fiscalYear: number, accounts: Record<string, [number, number]>, withCustodial = true): AfrSheet {
  const cols = withCustodial ? [{ col: 4, fundType: 'general' }, { col: 11, fundType: 'custodial' }] : [{ col: 4, fundType: 'general' }];
  const rows = Object.entries(accounts).map(([account, amounts], i) => ({
    row: 6 + i,
    account,
    name: `Account ${account}`,
    sectionHeading: 'x',
    values: cols.map((c, j) => ({ fundType: c.fundType, col: c.col, address: `${c.col === 4 ? 'D' : 'K'}${6 + i}`, amount: amounts[j], blank: false, formula: false })),
    cachedTotal: null,
  }));
  const totalRow = 6 + rows.length;
  const cached = Object.fromEntries(cols.map((c, j) => [c.fundType, rows.reduce((s, r) => s + r.values[j].amount, 0)]));
  return {
    flow,
    sheetName: String(fiscalYear),
    fiscalYear,
    title: '',
    headerRow: 4,
    fundColumns: cols.map((c) => ({ ...c, header: c.fundType })),
    totalCol: 16,
    perCapitaCol: 17,
    accounts: rows,
    sections: [],
    grandTotal: { row: totalRow, label: 'Total - All Account Codes', cached, cachedTotal: Object.values(cached).reduce((a, b) => a + b, 0), cachedPerCapita: null },
    population: { row: totalRow + 2, label: '', value: 1000 },
    footnotes: [],
  };
}

const pop = (year: number, value: number, basis: PopulationValue['basis']): PopulationValue => ({ year, value, basis, sheet: `${year} x`, row: 31 });

function input(revenues: AfrSheet[], expenditures: AfrSheet[], population: PopulationValue[] = []) {
  return {
    jurisdiction: 'test',
    revenues,
    expenditures,
    revenueSourceId: 'rev',
    expenditureSourceId: 'exp',
    populationSourceId: 'pop',
    population: { selected: new Map(population.map((p) => [p.year, p])), alternates: new Map<number, PopulationValue[]>() },
  };
}

describe('transfer balance', () => {
  it('compares 581 and 381 excluding custodial and flags large gaps', () => {
    const rev = [sheet('revenue', 2023, { '381': [100_000_000, 0] }), sheet('revenue', 2024, { '381': [100_000_000, 0] })];
    const exp = [sheet('expenditure', 2023, { '581': [100_000_500, 0] }), sheet('expenditure', 2024, { '581': [700_000_000, 9_000_000] })];
    const b = transferBalances(rev, exp);
    expect(b.map((x) => [x.fiscalYear, x.difference, x.flagged])).toEqual([
      [2023, 500, false],
      [2024, 600_000_000, true],
    ]);
    const { annotations, caveats } = generateAnomalies(input(rev, exp));
    const a = annotations.find((x) => x.fiscalYear === 2024 && x.flow === 'expenditure' && x.label.startsWith('Transfers'));
    expect(a?.label).toContain('$600.0M');
    expect(a?.refs).toContain('2024!K6'); // custodial 581 cell cited because it is excluded
    expect(caveats.get('exp')?.some((c) => c.includes('$600,000,000'))).toBe(true);
  });
});

describe('rounding and custodial annotations', () => {
  it('reports rounded years and the one unrounded custodial cell', () => {
    const accounts: Record<string, [number, number]> = {};
    for (let i = 0; i < 20; i++) accounts[String(511 + (i % 9)) + (i >= 9 ? `.${i}` : '')] = [1000 * (i + 1), 0];
    accounts['513'] = [5000, 6_802_121];
    const exp = sheet('expenditure', 2022, accounts);
    const rev = sheet('revenue', 2022, { '311': [1_000_000_000, 6_000_000_000] });
    const { annotations } = generateAnomalies(input([rev], [exp]));
    const odd = annotations.find((a) => a.refs?.includes('2022!K' + exp.accounts.find((r) => r.account === '513')!.row));
    expect(odd?.custodial).toBe('included');
    expect(odd?.detail).toContain('$6,802,121');
    expect(odd?.detail).toContain('Custodial revenue that year is $6,000,000,000');
    expect(annotations.some((a) => a.label === 'Amounts reported rounded to $1,000' && a.flow === 'expenditure')).toBe(true);
    const custodialRev = annotations.find((a) => a.flow === 'revenue' && a.label.startsWith('Custodial revenues'));
    expect(custodialRev?.label).toBe('Custodial revenues: 311 $6.00B');
  });

  it('notes a custodial column that is all zeros', () => {
    const { annotations } = generateAnomalies(input([sheet('revenue', 2021, { '311': [1_234_567, 0] })], []));
    expect(annotations.map((a) => a.label)).toContain('Custodial column present; all custodial revenues are $0');
  });

  it('says nothing about custodial before the column exists', () => {
    const { annotations } = generateAnomalies(input([sheet('revenue', 2020, { '311': [1_234_567, 0] }, false)], []));
    expect(annotations).toEqual([]);
  });
});

describe('population basis changes', () => {
  it('annotates the census year and the year after a revised estimate, for per-resident measures only', () => {
    const years = [2009, 2010, 2011, 2020, 2021].map((y) => sheet('revenue', y, { '311': [1_234_567, 0] }, false));
    const { annotations } = generateAnomalies(
      input(years, [], [
        pop(2008, 900, 'bebr_estimate'),
        pop(2009, 1000, 'bebr_estimate'),
        pop(2010, 1027, 'census_count'),
        pop(2011, 1030, 'bebr_estimate'),
        pop(2019, 1100, 'bebr_estimate'),
        pop(2020, 1110, 'bebr_revised_estimate'),
        pop(2021, 1120, 'bebr_estimate'),
      ]),
    );
    const popNotes = annotations.filter((a) => a.sourceId === 'pop');
    expect(popNotes.map((a) => a.fiscalYear)).toEqual([2010, 2021]);
    expect(popNotes[0].measures).toEqual(['per_capita', 'real_per_capita']);
    expect(popNotes[0].detail).toContain('2.7%');
  });
});

describe('year-over-year swings', () => {
  it('lists non-custodial changes above the threshold', () => {
    const s = yearOverYearSwings([
      sheet('expenditure', 2022, { '521': [100, 0], '541': [100, 0] }),
      sheet('expenditure', 2023, { '521': [10, 5000], '541': [110, 0] }),
    ]);
    expect(s.map((w) => [w.scope, Number(w.change.toFixed(2))])).toEqual([
      ['total (excl. custodial)', -0.4],
      ['public_safety', -0.9],
    ]);
  });
});
