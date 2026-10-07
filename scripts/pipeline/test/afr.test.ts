import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseAfrSheet } from '../src/edr/afr.js';
import { toAccounts, toObservations } from '../src/edr/observations.js';

type Cell = string | number | { formula: string; result: number } | null;

/** Builds a sheet shaped like EDR's AFR workbooks (title rows, two header rows, sections, totals). */
async function makeSheet(fiscalYear: number, withCustodial: boolean, body: Cell[][]): Promise<ExcelJS.Worksheet> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(String(fiscalYear));
  const funds = withCustodial
    ? ['General', 'Special Revenue', 'Debt Service', 'Capital Projects', 'Permanent', 'Enterprise', 'Internal Service', 'Custodial', 'Pension', 'Trust', 'Private Purpose', 'Component Units', 'Total Account', 'Per Capita Account']
    : ['General', 'Special Revenue', 'Debt Service', 'Capital Projects', 'Permanent', 'Enterprise', 'Internal Service', 'Pension', 'Trust', 'Component Units', 'Account Total', 'Per Capita Account Total'];
  ws.addRow(['Test County Government Revenues Reported by Account Code and Fund Type']);
  ws.addRow([`Local Fiscal Year Ended September 30, ${fiscalYear}`]);
  ws.addRow(['Account Code and Name', 'Account Code and Name', 'Account Code and Name', 'Governmental Funds']);
  ws.addRow(['Account Code and Name', 'Account Code and Name', 'Account Code and Name', ...funds]);
  for (const r of body) ws.addRow(r);
  // Round-trip through a buffer so cells look like they do when read from a file.
  const buf = await wb.xlsx.writeBuffer();
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(buf);
  return back.worksheets[0];
}

const f = (result: number) => ({ formula: 'SUM(A1:A2)', result });

describe('parseAfrSheet (FY 2020-21+ layout with Custodial)', async () => {
  const nFunds = 12;
  const zeros = (n: number) => Array<number>(n).fill(0);
  // General=100, Special Revenue=20, Custodial=5 for account 311; 0-valued formula cells in the totals row.
  const row311 = [null, 311, 'Ad Valorem Taxes', 100, 20, ...zeros(5), 5, ...zeros(4), f(125), f(0.125)];
  const row3121 = [null, 312.1, 'Local Option Taxes', 0, 7, ...zeros(10), f(7), f(0.007)];
  const section = ['General Government Taxes', null, null, f(100), f(27), ...Array(5).fill(f(0)), f(5), ...Array(4).fill(f(0)), f(132), f(0.132)];
  const total = ['Total - All Account Codes', null, null, f(100), f(27), ...Array(5).fill(f(0)), f(5), ...Array(4).fill(f(0)), f(132), f(0.132)];
  const pop = [null, null, null, ...Array(nFunds - 1).fill(null), '2021 Countywide Population:', '2021 Countywide Population:', 1000];
  const sheet = parseAfrSheet(
    await makeSheet(2021, true, [section, row311, row3121, total, [], pop, ['Compiled from data obtained from the Florida Department of Financial Services']]),
    'revenue',
  );

  it('reads header-based fund columns including custodial', () => {
    expect(sheet.fiscalYear).toBe(2021);
    expect(sheet.fundColumns.map((c) => c.fundType)).toContain('custodial');
    expect(sheet.fundColumns).toHaveLength(12);
  });

  it('parses account rows, codes and section', () => {
    expect(sheet.accounts.map((a) => a.account)).toEqual(['311', '312.1']);
    expect(sheet.accounts[0].sectionHeading).toBe('General Government Taxes');
    expect(sheet.accounts[0].cachedTotal).toBe(125);
  });

  it('reads cached formula results of 0 as 0, not empty', () => {
    expect(sheet.grandTotal.cached['debt_service']).toBe(0);
    expect(sheet.grandTotal.cached['custodial']).toBe(5);
    expect(sheet.grandTotal.cachedTotal).toBe(132);
  });

  it('keeps section subtotals and the grand total out of the account rows (no double counting)', () => {
    expect(sheet.sections.map((x) => x.label)).toEqual(['General Government Taxes']);
    expect(sheet.accounts.every((a) => /^\d/.test(a.account))).toBe(true);
    const obs = toObservations('test', [sheet], 'src');
    expect(obs.some((o) => o.ref.endsWith('5') || o.ref.endsWith('8'))).toBe(false); // section row 5, total row 8
  });

  it('finds population and footnote', () => {
    expect(sheet.population.value).toBe(1000);
    expect(sheet.footnotes).toHaveLength(1);
  });

  it('emits one observation per non-zero cell with a cell reference', () => {
    const obs = toObservations('test', [sheet], 'src');
    expect(obs.map((o) => [o.account, o.fundType, o.amount, o.ref])).toEqual([
      ['311', 'general', 100, '2021!D6'],
      ['311', 'special_revenue', 20, '2021!E6'],
      ['311', 'custodial', 5, '2021!K6'],
      ['312.1', 'special_revenue', 7, '2021!E7'],
    ]);
    expect(obs[0].category).toBe('ad_valorem');
    expect(obs.reduce((a, o) => a + o.amount, 0)).toBe(sheet.grandTotal.cachedTotal);
  });

  it('collects account names', () => {
    expect(toAccounts([sheet]).map((a) => [a.account, a.name])).toEqual([
      ['311', 'Ad Valorem Taxes'],
      ['312.1', 'Local Option Taxes'],
    ]);
  });
});

describe('parseAfrSheet (pre-FY 2020-21 layout)', async () => {
  const row = [null, 521, 'Law Enforcement', 50, 0, 0, 0, 0, 0, 0, 0, 0, 3, f(53), f(0.053)];
  const section = ['Public Safety', null, null, f(50), ...Array(8).fill(f(0)), f(3), f(53), f(0.053)];
  const total = ['Total - All Account Codes', null, null, f(50), ...Array(8).fill(f(0)), f(3), f(53), f(0.053)];
  const pop = [null, null, null, ...Array(9).fill(null), '2019 Countywide Population:', '2019 Countywide Population:', 1000];
  const sheet = parseAfrSheet(await makeSheet(2019, false, [section, row, total, pop]), 'expenditure');

  it('has no custodial column and maps Component Units', () => {
    expect(sheet.fundColumns.map((c) => c.fundType)).not.toContain('custodial');
    const obs = toObservations('test', [sheet], 'src');
    expect(obs.map((o) => [o.fundType, o.amount, o.category])).toEqual([
      ['general', 50, 'public_safety'],
      ['component_unit', 3, 'public_safety'],
    ]);
  });
});

describe('parseAfrSheet errors', () => {
  it('rejects an unknown fund header', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('2021');
    ws.addRow(['title']);
    ws.addRow(['Local Fiscal Year Ended September 30, 2021']);
    ws.addRow([]);
    ws.addRow(['', '', '', 'General', 'Mystery Fund', 'Total Account', 'Per Capita Account']);
    expect(() => parseAfrSheet(ws, 'revenue')).toThrow(/Mystery Fund/);
  });

  it('rejects a sheet whose name does not match its title year', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('2020');
    ws.addRow(['Local Fiscal Year Ended September 30, 2021']);
    expect(() => parseAfrSheet(ws, 'revenue')).toThrow(/title year/);
  });
});
