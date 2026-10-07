import { describe, expect, it } from 'vitest';
import { crossCheckSourceProblems, flowCrossCheck, preCoverageTransferNotes, type FlowCrossCheck } from '../src/logerx/crosscheck.js';
import { aggregateExtract, extractEntityCsv, logerxAccountCode, parseCsv, reconcile, type StatewideReport } from '../src/logerx/logerx.js';
import type { Observation } from '../src/edr/observations.js';

const header = ['Code', 'Name', 'Account', 'Dwelling Type', 'Fee Type', 'General', 'Special Revenue', 'Custodial', 'Component Units'];
const report = (asOf: string, rows: string[][]): StatewideReport => ({ title: `Revenue Details for Fiscal Year 2024, as of ${asOf}`, asOf, header, rows });
const rows = [
  ['100052', 'Pinellas', '324.310 - Impact Fees - Residential - Transportation', '02 Residential Buildings', '01 Flat Fees', '', '14129', '', ''],
  ['100029', 'Hillsborough', '311.000 - Ad Valorem Taxes', ' ', ' ', '1336984429', '86252796', '', ''],
  ['100052', 'Pinellas', '311.000 - Ad Valorem Taxes', '', '', '500', '', '5000', ''],
  ['100052', 'Pinellas', '324.310 - Impact Fees - Residential - Transportation', '01 Non-Residential', '01 Flat Fees', '', '1000', '', ''],
  ['200304', 'Pinellas Park', '311.000 - Ad Valorem Taxes', '', '', '7', '', '', ''],
];

describe('LOGERX extract', () => {
  it('keeps only the entity, all columns, sorted, independent of row order and the "as of" stamp', () => {
    const a = extractEntityCsv(report('Monday', rows), '100052');
    const b = extractEntityCsv(report('Tuesday', [...rows].reverse()), '100052');
    expect(a.rows).toBe(3);
    expect(a.csv).toBe(b.csv);
    expect(a.csv.split('\n')[0]).toBe(header.join(','));
    expect(a.csv).not.toContain('Pinellas Park');
    expect(a.csv.endsWith('\n')).toBe(true);
    expect(a.csv).not.toContain('\r');
  });

  it('quotes fields with commas and parses them back', () => {
    const r = report('x', [['100052', 'Pinellas', '341.900 - Other, Charges "Misc"', '', '', '1', '', '', '']]);
    const { csv } = extractEntityCsv(r, '100052');
    expect(parseCsv(csv)[1][2]).toBe('341.900 - Other, Charges "Misc"');
  });

  it('sums dwelling and fee type rows to the account and normalizes the code', () => {
    const agg = aggregateExtract(extractEntityCsv(report('x', rows), '100052').csv);
    expect(Object.fromEntries(agg)).toEqual({ '311|general': 500, '311|custodial': 5000, '324.31|special_revenue': 15129 });
  });
});

describe('LOGERX reconciliation', () => {
  const obs = (account: string, fundType: string, amount: number, ref: string): Observation => ({
    jurisdiction: 'test', fiscalYear: 2024, flow: 'revenue', account, category: 'x', section: 'x', fundType, amount, sourceId: 's', ref,
  });
  it('counts matches, mismatches and one-sided cells, with EDR refs', () => {
    const logerx = new Map([['311|general', 500], ['311|custodial', 5000], ['324.31|special_revenue', 15129]]);
    const r = reconcile('test', 2024, 'revenue', logerx, [
      obs('311', 'general', 500, '2024!D6'),
      obs('311', 'custodial', 4999, '2024!K6'),
      obs('361.1', 'general', 9, '2024!D90'),
    ]);
    expect([r.cells, r.match, r.mismatches.length, r.onlyLogerx.length, r.onlyEdr.length]).toEqual([4, 1, 1, 1, 1]);
    expect(r.mismatches[0]).toEqual({ account: '311', fundType: 'custodial', logerx: 5000, edr: 4999, ref: 'revenues:2024!K6' });
    expect(r.onlyEdr[0].ref).toBe('revenues:2024!D90');
  });
});

describe('pre-coverage notes', () => {
  it('names approved transfer years before LOGERX coverage only', () => {
    expect(preCoverageTransferNotes([2006, 2022], 2013)).toEqual([
      'The FY 2005-06 transfer imbalance is before LOGERX coverage and is not cross-checked against the county-filed Annual Financial Report.',
    ]);
    expect(preCoverageTransferNotes([2006], null)).toEqual([]);
  });
});

describe('cross-check status and published fields', () => {
  const CAVEAT = 'Not cross-checked against the county.';
  const recon = (fiscalYear: number, diff: boolean) => ({
    jurisdiction: 't', fiscalYear, flow: 'revenue' as const, cells: 10, match: diff ? 9 : 10,
    mismatches: diff ? [{ account: '311', fundType: 'general', logerx: 1, edr: 2, ref: 'revenues:2014!D6' }] : [], onlyLogerx: [], onlyEdr: [], logerxTotal: 0, edrTotal: 0,
  });
  const derived = (status: FlowCrossCheck['status'], diff = false): FlowCrossCheck => ({
    flow: 'revenue', status, coverage: [], summary: '', caveats: [], reconciliations: [recon(2013, false), recon(2014, diff)],
  });

  it('fails a source marked "full" while a year range is not fully reconciled', () => {
    const problems = crossCheckSourceProblems(
      {
        id: 's', caveats: [], countyAfrCrossCheck: 'full',
        crossCheckSummary: 'Cross-checked ... for FY 2012-13 to FY 2013-14: all 20 revenue values match.',
        crossCheckCoverage: [{ fromFiscalYear: 2012, toFiscalYear: 2012, status: 'not-checked' }, { fromFiscalYear: 2013, toFiscalYear: 2014, status: 'full' }],
      },
      derived('full'), [2012, 2013, 2014], CAVEAT,
    );
    expect(problems.some((p) => p.includes('"full" but some years are not fully reconciled'))).toBe(true);
  });

  it('fails a summary that says "all ... match" while differences exist', () => {
    const problems = crossCheckSourceProblems(
      {
        id: 's', caveats: [], countyAfrCrossCheck: 'partial',
        crossCheckSummary: 'Cross-checked ... for FY 2012-13 to FY 2013-14: all 20 revenue values match.',
        crossCheckCoverage: [{ fromFiscalYear: 2013, toFiscalYear: 2013, status: 'full' }, { fromFiscalYear: 2014, toFiscalYear: 2014, status: 'mismatch' }],
      },
      derived('partial', true), [2013, 2014], CAVEAT,
    );
    expect(problems.some((p) => p.includes('summary claims all values match'))).toBe(true);
    expect(problems.some((p) => p.includes('summary counts (20 of 20) differ from the reconciliation (19 of 20)'))).toBe(true);
  });

  it('accepts consistent fields', () => {
    expect(
      crossCheckSourceProblems(
        {
          id: 's', caveats: [], countyAfrCrossCheck: 'partial',
          crossCheckSummary: 'Cross-checked ... for FY 2012-13 to FY 2013-14: 19 of 20 revenue values match; 1 differ ...',
          crossCheckCoverage: [{ fromFiscalYear: 2013, toFiscalYear: 2013, status: 'full' }, { fromFiscalYear: 2014, toFiscalYear: 2014, status: 'mismatch' }],
        },
        derived('partial', true), [2013, 2014], CAVEAT,
      ),
    ).toEqual([]);
  });

  it('derives partial, full and mismatch ranges from the data', () => {
    const sheets = [2012, 2013].map((fiscalYear) => ({ fiscalYear }) as never);
    const csv = 'Code,Name,Account,Dwelling Type,Fee Type,General\n1,X,311.000 - Ad Valorem Taxes,,,100\n';
    const obs = (fy: number, amount: number) => ({ jurisdiction: 't', fiscalYear: fy, flow: 'revenue', account: '311', category: 'x', section: 'x', fundType: 'general', amount, sourceId: 's', ref: `${fy}!D6` }) as never;
    const partial = flowCrossCheck('t', 'revenue', sheets, [obs(2013, 100)], [{ fiscalYear: 2013, flow: 'revenue', csv }], []);
    expect(partial.status).toBe('partial');
    expect(partial.coverage).toEqual([{ fromFiscalYear: 2012, toFiscalYear: 2012, status: 'not-checked' }, { fromFiscalYear: 2013, toFiscalYear: 2013, status: 'full' }]);
    expect(partial.summary).toContain('all 1 revenue values match.');
    expect(partial.summary).toContain('FY 2011-12 not cross-checked');
    const full = flowCrossCheck('t', 'revenue', [sheets[1]], [obs(2013, 100)], [{ fiscalYear: 2013, flow: 'revenue', csv }], []);
    expect(full.status).toBe('full');
    const mismatch = flowCrossCheck('t', 'revenue', [sheets[1]], [obs(2013, 99)], [{ fiscalYear: 2013, flow: 'revenue', csv }], []);
    expect([mismatch.status, mismatch.coverage[0].status]).toEqual(['partial', 'mismatch']);
    expect(mismatch.summary).toContain('0 of 1 revenue values match; 1 differ');
  });
});

describe('LOGERX account codes and expenditure object codes', () => {
  it('normalizes codes, maps NNN.xxx to NNN, and rejects anything else', () => {
    expect(logerxAccountCode('312.410 - Local Option Fuel Tax')).toBe('312.41');
    expect(logerxAccountCode('511.00 - Legislative')).toBe('511');
    expect(logerxAccountCode('329.xxx - Other Permits, Fees And Special Assessments')).toBe('329');
    expect(() => logerxAccountCode('abc - Nonsense')).toThrow(/unrecognized account code/);
  });

  it('sums expenditure object-code rows to the account', () => {
    const csv = [
      'Code,Name,Account,Object Code,General,Special Revenue',
      '100052,Pinellas,511.00 - Legislative,10 - Personnel Services,2131028,',
      '100052,Pinellas,511.00 - Legislative,30 - Operating Expenditures/Expenses,60983,5',
      '',
    ].join('\n');
    expect(Object.fromEntries(aggregateExtract(csv))).toEqual({ '511|general': 2192011, '511|special_revenue': 5 });
  });
});
