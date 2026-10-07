import {
  CROSS_CHECK_LABELS,
  coverageFor,
  crossCheckByYear,
  crossCheckStatus,
  crossCheckYearText,
  mismatchLegendLabel,
  withFundSelection,
} from './cross-check';
import { AfrObservation, AnnotationRecord, CrossCheckRange, SourceRecord } from './models';

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
    expect([...map].map(([fy, r]) => [fy, r?.status])).toEqual([
      [2011, 'not-checked'],
      [2012, 'not-checked'],
      [2013, 'full'],
      [2023, 'mismatch'],
    ]);
  });
});

describe('mismatch wording (QA-35): the yearly total matches; never implies the plotted number is disputed', () => {
  // Today's two mismatch ranges, as the pipeline writes them.
  const mismatch = {
    fromFiscalYear: 2014,
    toFiscalYear: 2014,
    status: 'mismatch' as const,
    totalsMatch: true,
  };

  it('legend states the total matches and an amount is classified differently', () => {
    expect(CROSS_CHECK_LABELS.mismatch).toBe(
      'Cross-checked: yearly total matches; an amount is classified differently in the county filing',
    );
  });

  it('tooltip and table use the count from the data when it is there', () => {
    expect(crossCheckYearText({ ...mismatch, classificationDifferences: 1 })).toBe('Total matches; 1 amount classified differently');
    expect(crossCheckYearText({ ...mismatch, classificationDifferences: 3 }, 'short')).toBe(
      'Total matches; 3 amounts classified differently',
    );
  });

  it('says the total matches only when the data says so', () => {
    const r = { fromFiscalYear: 2014, toFiscalYear: 2014, status: 'mismatch' as const };
    expect(crossCheckYearText({ ...r, totalsMatch: false, valueDifferences: 2 })).toBe(
      'Total differs from the county filing; 2 amounts differ',
    );
    expect(crossCheckYearText({ ...r, classificationDifferences: 1 })).toBe('Cross-checked; 1 amount classified differently');
    expect(crossCheckYearText({ ...r, totalsMatch: true, classificationDifferences: 1, unmatchedAmounts: 2 })).toBe(
      'Total matches; 1 amount classified differently; 2 amounts in only one source',
    );
  });

  it('legend uses the decided wording only when every mismatch year in view has matching totals', () => {
    expect(mismatchLegendLabel([{ totalsMatch: true }, { totalsMatch: true }])).toBe(CROSS_CHECK_LABELS.mismatch);
    expect(mismatchLegendLabel([{ totalsMatch: true }, { totalsMatch: false }])).toBe(
      'Cross-checked: some amounts differ from the county filing',
    );
  });

  it('falls back to "an amount" without a count', () => {
    expect(crossCheckYearText(mismatch)).toBe('Total matches; an amount classified differently');
    expect(crossCheckYearText(mismatch, 'short')).toBe('Total matches; an amount classified differently');
  });

  it('no wording suggests a disputed or wrong value', () => {
    const all = [CROSS_CHECK_LABELS.mismatch, crossCheckYearText(mismatch)].join(' ');
    expect(all).not.toMatch(/dispute|wrong|error|incorrect|not resolved|discrepan/i);
  });
});

describe('withFundSelection (QA-40)', () => {
  const range: CrossCheckRange = {
    fromFiscalYear: 2013,
    toFiscalYear: 2025,
    status: 'mismatch',
    totalsMatch: true,
    classificationDifferences: 1,
  };
  const full: CrossCheckRange = { fromFiscalYear: 2013, toFiscalYear: 2025, status: 'full' };
  const byYear = new Map<number, CrossCheckRange | null>([
    [2015, range],
    [2016, full],
  ]);
  const note: AnnotationRecord = {
    fiscalYear: 2015,
    kind: 'methodology',
    label: 'Reclassified',
    sourceId: 's',
    topic: 'reconciliation-difference',
    jurisdiction: 'hillsborough',
    flow: 'expenditure',
    funds: ['component_unit', 'internal_service'],
    cells: [{ account: '559', fundType: 'internal_service' }],
  };
  const obs = (account: string, fundType: string, amount: number): AfrObservation => ({
    jurisdiction: 'hillsborough',
    flow: 'expenditure',
    fiscalYear: 2015,
    account,
    fundType,
    amount,
    category: 'economic_environment',
    section: 'economic_environment',
    ref: 'x',
    sourceId: 's',
  });
  const observations = [obs('559', 'internal_service', 1_164_281), obs('559', 'general', 99), obs('513', 'internal_service', 7)];
  const scope = (funds?: string[]) => ({ jurisdiction: 'hillsborough', flow: 'expenditure' as const, funds });

  it('a selection holding only one side of the pair: the total differs by the cells amount', () => {
    for (const funds of [['internal_service'], ['component_unit'], ['general', 'internal_service']]) {
      const y = withFundSelection(byYear, [note], observations, scope(funds))!.get(2015)!;
      expect(y.selectionDifference).toBe(1_164_281);
      expect(y.totalsMatch).toBe(false);
      expect(crossCheckYearText(y)).toBe(
        'Total for this fund selection differs from the county filing by $1,164,281 (an amount classified differently)',
      );
      expect(crossCheckYearText(y, 'short')).toBe('Total for these funds differs by $1,164,281; an amount classified differently');
    }
  });

  it('all funds, both sides, or neither side: unchanged ("Total matches")', () => {
    for (const funds of [undefined, [], ['component_unit', 'internal_service'], ['general']]) {
      const y = withFundSelection(byYear, [note], observations, scope(funds))!.get(2015)!;
      expect(y.selectionDifference).toBeUndefined();
      expect(crossCheckYearText(y)).toBe('Total matches; 1 amount classified differently');
    }
  });

  it('other years, counties and flows are untouched; no coverage stays null', () => {
    const out = withFundSelection(byYear, [note], observations, scope(['internal_service']))!;
    expect(out.get(2016)).toEqual(byYear.get(2016));
    expect(withFundSelection(byYear, [note], observations, { ...scope(['internal_service']), jurisdiction: 'pinellas' })!.get(2015)).toBe(range);
    expect(withFundSelection(byYear, [note], observations, { ...scope(['internal_service']), flow: 'revenue' })!.get(2015)).toBe(range);
    expect(withFundSelection(null, [note], observations, scope(['internal_service']))).toBeNull();
  });
});
