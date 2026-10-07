import {
  CROSS_CHECK_LABELS,
  coverageFor,
  crossCheckByYear,
  crossCheckStatus,
  crossCheckYearText,
  mismatchLegendLabel,
  crossCheckByYearInScope,
  crossCheckInScope,
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

describe('crossCheckInScope (QA-40 and addendum)', () => {
  const mismatch: CrossCheckRange = {
    fromFiscalYear: 2013,
    toFiscalYear: 2025,
    status: 'mismatch',
    totalsMatch: true,
    classificationDifferences: 1,
  };
  const obs = (jurisdiction: string, flow: 'revenue' | 'expenditure', fiscalYear: number, account: string, fundType: string, category: string, amount: number): AfrObservation => ({
    jurisdiction, flow, fiscalYear, account, fundType, category, amount, section: category, ref: 'x', sourceId: 's',
  });
  // Hillsborough FY 2014-15 expenditure: 559 moves between Internal Service (EDR) and Component Units (filing).
  const hb: AnnotationRecord = {
    fiscalYear: 2015, kind: 'methodology', label: 'HB', sourceId: 's', topic: 'reconciliation-difference',
    jurisdiction: 'hillsborough', flow: 'expenditure', funds: ['component_unit', 'internal_service'],
    cells: [{ account: '559', fundType: 'internal_service' }],
  };
  // Pinellas FY 2013-14 revenue: 335.8 vs 335.9, both Special Revenue and Intergovernmental (drawer-only).
  const pn: AnnotationRecord = {
    fiscalYear: 2014, kind: 'methodology', label: 'PN', sourceId: 's', topic: 'reconciliation-difference',
    jurisdiction: 'pinellas', flow: 'revenue', drawerOnly: true,
    cells: [{ account: '335.8', fundType: 'special_revenue' }],
  };
  const observations = [
    obs('hillsborough', 'expenditure', 2015, '559', 'internal_service', 'economic_environment', 1_164_281),
    obs('hillsborough', 'expenditure', 2015, '521', 'general', 'public_safety', 500),
    obs('pinellas', 'revenue', 2014, '335.8', 'special_revenue', 'intergovernmental', 2_309_587),
    obs('pinellas', 'revenue', 2014, '311', 'general', 'ad_valorem', 900),
  ];
  const hbScope = (funds?: string[], category?: string) => ({ jurisdiction: 'hillsborough', flow: 'expenditure' as const, funds, category });
  const pnScope = (funds?: string[], category?: string) => ({ jurisdiction: 'pinellas', flow: 'revenue' as const, funds, category });
  const text = (r: ReturnType<typeof crossCheckInScope>, form: 'long' | 'short' = 'long') => crossCheckYearText(r!, form);
  const notes = [hb, pn];

  describe('Hillsborough FY 2014-15', () => {
    it('reclassified amount not in view (General Fund only, or another category): matches', () => {
      for (const scope of [hbScope(['general']), hbScope(undefined, 'public_safety'), hbScope(['internal_service'], 'public_safety')]) {
        const r = crossCheckInScope(mismatch, 2015, notes, observations, scope)!;
        expect(r.status).toBe('full');
        expect(text(r)).toBe('Cross-checked: matches the county-filed AFR');
        expect(text(r, 'short')).toBe('Matches');
      }
    });

    it('one side of the pair selected: the selection differs by the amount', () => {
      for (const scope of [hbScope(['internal_service']), hbScope(['component_unit']), hbScope(['general', 'internal_service']), hbScope(['internal_service'], 'economic_environment')]) {
        expect(text(crossCheckInScope(mismatch, 2015, notes, observations, scope))).toBe(
          'Total for this fund selection differs from the county filing by $1,164,281 (an amount classified differently)',
        );
      }
      expect(text(crossCheckInScope(mismatch, 2015, notes, observations, hbScope(['internal_service'])), 'short')).toBe(
        'Total for these funds differs by $1,164,281; an amount classified differently',
      );
    });

    it('both sides in view (all funds, or both selected): total matches; 1 amount classified differently', () => {
      for (const scope of [hbScope(), hbScope(['component_unit', 'internal_service']), hbScope(undefined, 'economic_environment')]) {
        expect(text(crossCheckInScope(mismatch, 2015, notes, observations, scope))).toBe('Total matches; 1 amount classified differently');
      }
    });
  });

  describe('Pinellas FY 2013-14', () => {
    it('reclassified cell not in view (General Fund only, or Ad Valorem): matches', () => {
      for (const scope of [pnScope(['general']), pnScope(undefined, 'ad_valorem'), pnScope(['special_revenue'], 'ad_valorem')]) {
        expect(crossCheckInScope(mismatch, 2014, notes, observations, scope)!.status).toBe('full');
      }
    });

    it('no fund pair, so no split: a selection holding the cell keeps the classification note', () => {
      for (const scope of [pnScope(['special_revenue']), pnScope(['general', 'special_revenue'])]) {
        expect(text(crossCheckInScope(mismatch, 2014, notes, observations, scope))).toBe('Total matches; 1 amount classified differently');
      }
    });

    it('cell in view (all funds, Intergovernmental): total matches; 1 amount classified differently', () => {
      for (const scope of [pnScope(), pnScope(undefined, 'intergovernmental')]) {
        expect(text(crossCheckInScope(mismatch, 2014, notes, observations, scope))).toBe('Total matches; 1 amount classified differently');
      }
    });
  });

  it('never claims a match the annotations do not explain', () => {
    const twoDiffs = { ...mismatch, classificationDifferences: 2 };
    expect(crossCheckInScope(twoDiffs, 2015, notes, observations, hbScope(['general']))).toBe(twoDiffs);
    const valueDiff = { ...mismatch, valueDifferences: 1 };
    expect(crossCheckInScope(valueDiff, 2015, notes, observations, hbScope(['general']))).toBe(valueDiff);
  });

  it('non-mismatch years, years without notes and no coverage pass through', () => {
    const full: CrossCheckRange = { fromFiscalYear: 2013, toFiscalYear: 2025, status: 'full' };
    expect(crossCheckInScope(full, 2015, notes, observations, hbScope(['internal_service']))).toBe(full);
    expect(crossCheckInScope(mismatch, 2016, notes, observations, hbScope(['internal_service']))).toBe(mismatch);
    expect(crossCheckInScope(null, 2015, notes, observations, hbScope())).toBeNull();
    expect(crossCheckByYearInScope(null, notes, observations, hbScope())).toBeNull();
    const byYear = crossCheckByYearInScope(new Map([[2015, mismatch], [2016, full]]), notes, observations, hbScope(['general']))!;
    expect(byYear.get(2015)!.status).toBe('full');
    expect(byYear.get(2016)).toBe(full);
  });
});
