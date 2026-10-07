import { coverageFor, crossCheckByYear, crossCheckStatus } from './cross-check';
import { CrossCheckRange, SourceRecord } from './models';

// Revenue example from the pipeline: FY 2005-06..FY 2011-12 not checked, FY 2012-13..FY 2024-25 full.
const coverage: CrossCheckRange[] = [
  { fromFiscalYear: 2006, toFiscalYear: 2012, status: 'not-checked' },
  { fromFiscalYear: 2013, toFiscalYear: 2022, status: 'full' },
  { fromFiscalYear: 2023, toFiscalYear: 2023, status: 'mismatch' },
  { fromFiscalYear: 2024, toFiscalYear: 2025, status: 'full' },
];

describe('crossCheckStatus', () => {
  it('reads each fiscal year from its range, edges inclusive', () => {
    expect(crossCheckStatus(2006, coverage)).toBe('not-checked'); // first year
    expect(crossCheckStatus(2012, coverage)).toBe('not-checked'); // last year of the range
    expect(crossCheckStatus(2013, coverage)).toBe('full'); // first year of the next range
    expect(crossCheckStatus(2023, coverage)).toBe('mismatch'); // single-year range
    expect(crossCheckStatus(2025, coverage)).toBe('full'); // last workbook year
  });

  it('returns null outside every range (nothing is guessed)', () => {
    expect(crossCheckStatus(2005, coverage)).toBeNull();
    expect(crossCheckStatus(2026, coverage)).toBeNull();
    expect(crossCheckStatus(2010, [])).toBeNull();
  });
});

describe('coverageFor / crossCheckByYear', () => {
  const src = (id: string, cov?: CrossCheckRange[]): SourceRecord =>
    ({ id, publisher: 'EDR', title: id, url: 'u', retrieved: 'r', sha256: 'x', caveats: [], crossCheckCoverage: cov }) as SourceRecord;
  const sources = [
    src('edr-afr-revenues-pinellas', coverage),
    src('edr-afr-expenditures-pinellas', [{ fromFiscalYear: 2005, toFiscalYear: 2025, status: 'not-checked' }]),
    src('edr-afr-revenues-hillsborough'), // no coverage
  ];
  const observations = [
    { flow: 'revenue' as const, jurisdiction: 'pinellas', sourceId: 'edr-afr-revenues-pinellas' },
    { flow: 'expenditure' as const, jurisdiction: 'pinellas', sourceId: 'edr-afr-expenditures-pinellas' },
    { flow: 'revenue' as const, jurisdiction: 'hillsborough', sourceId: 'edr-afr-revenues-hillsborough' },
  ];

  it('uses the coverage of the source behind that county and flow', () => {
    expect(coverageFor(sources, observations, 'pinellas', 'revenue')).toBe(coverage);
    expect(coverageFor(sources, observations, 'pinellas', 'expenditure')?.[0].status).toBe('not-checked');
  });

  it('returns null when the source has no coverage, so nothing is marked', () => {
    const cov = coverageFor(sources, observations, 'hillsborough', 'revenue');
    expect(cov).toBeNull();
    expect(crossCheckByYear([2020, 2021], cov)).toBeNull();
  });

  it('maps every year in view to its status', () => {
    const map = crossCheckByYear([2011, 2012, 2013, 2023], coverage)!;
    expect([...map]).toEqual([
      [2011, 'not-checked'],
      [2012, 'not-checked'],
      [2013, 'full'],
      [2023, 'mismatch'],
    ]);
  });
});
