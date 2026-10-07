import { describe, expect, it } from 'vitest';
import type { Flow } from '../src/edr/accounts.js';
import type { AfrSheet } from '../src/edr/afr.js';
import { findGaps, generateAnomalies, transferBalances, yearOverYearSwings } from '../src/edr/anomalies.js';
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

function input(revenues: AfrSheet[], expenditures: AfrSheet[], population: PopulationValue[] = [], approvedTransferYears: number[] = []) {
  return {
    approvedTransferImbalances: approvedTransferYears.map((fiscalYear) => ({ jurisdiction: 'test', fiscalYear })),
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
    const { annotations, caveats } = generateAnomalies(input(rev, exp, [], [2024]));
    const a = annotations.find((x) => x.fiscalYear === 2024 && x.flow === 'expenditure' && x.label.startsWith('Transfers'));
    expect(a?.label).toContain('$600.0M');
    expect(a?.topic).toBe('transfer-imbalance');
    expect(a?.refs).toContain('expenditures:2024!K6'); // custodial 581 cell cited because it is excluded
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
    const odd = annotations.find((a) => a.refs?.includes('expenditures:2022!K' + exp.accounts.find((r) => r.account === '513')!.row));
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
    expect(popNotes.every((x) => x.topic === 'population-source')).toBe(true);
    expect(popNotes[0].detail).toContain('2.7%');
  });

  it('files population caveats under the jurisdiction, not as prefixed shared caveats (QA-33)', () => {
    const years = [2009, 2010].map((y) => sheet('revenue', y, { '311': [1_234_567, 0] }, false));
    const g = generateAnomalies(input(years, [], [pop(2009, 1000, 'bebr_estimate'), pop(2010, 1027, 'census_count')]));
    expect(g.caveats.has('pop')).toBe(false);
    expect(g.sharedSourceCaveats.get('pop')?.[0]).toMatch(/^Per-resident figures for FY 2009-10/);
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

describe('drop-and-recover gaps', () => {
  const years = (vals: Array<[number, number]>) => vals.map(([fy, v]) => sheet('expenditure', fy, { '536': [v, 0] }));

  it('finds a one-year gap that recovers', () => {
    const g = findGaps(years([[2022, 200e6], [2023, 10e6], [2024, 190e6]])).filter((x) => x.scope === 'fund:general');
    expect(g.map((x) => [x.years, x.before.value, x.after.value])).toEqual([[[2023], 200e6, 190e6]]);
  });

  it('finds a two-year gap but not a three-year one or a permanent drop', () => {
    expect(findGaps(years([[2021, 100e6], [2022, 1e6], [2023, 2e6], [2024, 90e6]])).find((x) => x.scope === 'fund:general')?.years).toEqual([2022, 2023]);
    expect(findGaps(years([[2020, 100e6], [2021, 1e6], [2022, 1e6], [2023, 1e6], [2024, 90e6]])).filter((x) => x.scope === 'fund:general')).toEqual([]);
    expect(findGaps(years([[2022, 100e6], [2023, 10e6], [2024, 10e6]])).filter((x) => x.scope === 'fund:general')).toEqual([]);
  });

  it('ignores small baselines and moderate dips', () => {
    expect(findGaps(years([[2022, 900_000], [2023, 0], [2024, 900_000]]))).toEqual([]);
    expect(findGaps(years([[2022, 100e6], [2023, 60e6], [2024, 100e6]]))).toEqual([]);
  });

  it('annotates an approved gap and rejects an approval the scan no longer finds', () => {
    const exp = years([[2023, 200e6], [2024, 0], [2025, 210e6]]);
    const ok = generateAnomalies({ ...input([], exp), approvedGaps: [{ jurisdiction: 'test', flow: 'expenditure', fiscalYear: 2024, scopes: ['fund:general'] }] });
    const a = ok.annotations.find((x) => x.label.startsWith('General funds'));
    expect(a?.label).toBe('General funds $0');
    expect(a?.topic).toBe('fund-gap');
    expect(a?.detail).toContain('account 536');
    expect(a?.refs).toEqual(['expenditures:2024!D6']);
    expect(() =>
      generateAnomalies({ ...input([], exp), approvedGaps: [{ jurisdiction: 'test', flow: 'expenditure', fiscalYear: 2023, scopes: ['fund:general'] }] }),
    ).toThrow(/not found/);
  });

  it('adds no separate annotation for a gap covered by another annotation, but still checks it exists', () => {
    const exp = years([[2023, 200e6], [2024, 0], [2025, 210e6]]);
    const covered = generateAnomalies({ ...input([], exp), approvedGaps: [{ jurisdiction: 'test', flow: 'expenditure', fiscalYear: 2024, scopes: ['fund:general'], coveredBy: 'transfer-imbalance' }] });
    expect(covered.annotations.some((x) => x.label.startsWith('General funds'))).toBe(false);
    expect(() =>
      generateAnomalies({ ...input([], exp), approvedGaps: [{ jurisdiction: 'test', flow: 'expenditure', fiscalYear: 2023, scopes: ['fund:general'], coveredBy: 'transfer-imbalance' }] }),
    ).toThrow(/not found/);
  });
});

describe('transfer-imbalance threshold (DR-40: strictly greater than $1,000,000)', () => {
  const at = (gap: number) =>
    transferBalances([sheet('revenue', 2024, { '381': [100_000_000, 0] })], [sheet('expenditure', 2024, { '581': [100_000_000 + gap, 0] })])[0];
  it('does not flag exactly $1,000,000', () => expect(at(1_000_000).flagged).toBe(false));
  it('flags $1,000,001', () => expect(at(1_000_001).flagged).toBe(true));
  it('flags -$1,000,001 (in exceeds out)', () => expect(at(-1_000_001).flagged).toBe(true));
});

describe('transfer-imbalance approvals', () => {
  const rev = [sheet('revenue', 2023, { '381': [100_000_000, 0] }), sheet('revenue', 2024, { '381': [100_000_000, 0] })];
  const exp = [sheet('expenditure', 2023, { '581': [100_369_300, 0] }), sheet('expenditure', 2024, { '581': [700_000_000, 0] })];

  it('fails when a flagged year is not approved', () => {
    expect(() => generateAnomalies(input(rev, exp))).toThrow(/Flagged but not approved: FY 2024/);
  });

  it('fails when an approved year is no longer flagged', () => {
    expect(() => generateAnomalies(input(rev, exp, [], [2023, 2024]))).toThrow(/Approved but no longer flagged: FY 2023/);
  });

  it('annotates only approved, flagged years; a $369,300 gap gets nothing', () => {
    const { annotations } = generateAnomalies(input(rev, exp, [], [2024]));
    expect(annotations.filter((a) => a.topic === 'transfer-imbalance').map((a) => a.fiscalYear)).toEqual([2024]);
  });
});

describe('custodial-start research note', () => {
  const years = (flow: 'revenue' | 'expenditure', custodial: number[]) =>
    [2020, 2021, 2022, 2023].map((fy, i) => sheet(flow, fy, { [flow === 'revenue' ? '311' : '513']: [1_234_567, i === 0 ? 0 : custodial[i - 1]] }, fy >= 2021));

  it('states the zero years and the first year with amounts, with cell refs', () => {
    const { annotations } = generateAnomalies({
      ...input(years('revenue', [0, 0, 5_000_000_000]), years('expenditure', [0, 0, 4_000_000_000])),
      researchNotes: [{ jurisdiction: 'test', topic: 'custodial-start' }],
    });
    const notes = annotations.filter((a) => a.topic === 'custodial-start');
    expect(notes.map((a) => [a.fiscalYear, a.flow, a.custodial])).toEqual([
      [2023, 'revenue', 'included'],
      [2023, 'expenditure', 'included'],
    ]);
    expect(notes[0].detail).toBe(
      'The Custodial column is present from FY 2020-21. Custodial revenues are $0 in FY 2020-21 (revenues:2021!K7) and FY 2021-22 (revenues:2022!K7), and first reported in FY 2022-23: $5,000,000,000 (revenues:2023!K7).',
    );
    expect(notes[0].refs).toEqual(['revenues:2021!K7', 'revenues:2022!K7', 'revenues:2023!K7']);
  });

  it('fails when requested but the data shows no delay', () => {
    expect(() =>
      generateAnomalies({
        ...input(years('revenue', [1, 1, 1]), []),
        researchNotes: [{ jurisdiction: 'test', topic: 'custodial-start' }],
      }),
    ).toThrow(/custodial-start/);
  });
});
