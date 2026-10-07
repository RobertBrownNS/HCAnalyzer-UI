import type {
  AfrObservation,
  Annotation,
  AnnotationRecord,
  CpiFile,
  CpiSeriesFile,
  PopulationFile,
  WorkbookTotal,
} from './models';
import {
  annotationsInRange,
  availableYears,
  buildSeries,
  DEFAULT_SETTINGS,
  defaultSettingsFor,
  fiscalYearLabel,
  formatUsd,
  isTransferAccount,
  TRANSFER_ACCOUNTS,
  TRANSFER_IMBALANCE_NOTE_SHARE,
  selectCpi,
  type SeriesPoint,
  type TransformData,
  type TransformSettings,
} from './transform';

import observationsJson from '../../assets/data/hillsborough.observations.json';
import populationJson from '../../assets/data/population.json';
import cpiJson from '../../assets/data/cpi.json';
import annotationsJson from '../../assets/data/annotations.json';
import sourcesJson from '../../assets/data/sources.json';
import workbookTotalsJson from '../../assets/data/hillsborough.workbook-totals.json';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const REV = 'afr-rev';
const EXP = 'afr-exp';
const POP = 'pop';

function obs(
  fiscalYear: number,
  fundType: string,
  amount: number,
  flow: 'revenue' | 'expenditure' = 'revenue',
  jurisdiction = 'hillsborough',
): AfrObservation {
  return {
    jurisdiction,
    fiscalYear,
    flow,
    account: flow === 'revenue' ? '311' : '513',
    category: flow === 'revenue' ? 'ad_valorem' : 'general_government',
    section: flow === 'revenue' ? 'taxes' : 'general_government',
    fundType,
    amount,
    sourceId: flow === 'revenue' ? REV : EXP,
    ref: `${fiscalYear}!D6`,
  };
}

function cpiSeries(
  sourceId: string,
  fiscalYear: Record<string, number>,
  calendarYear: Record<string, number>,
  fiscalYearUnavailable: Record<string, string> = {},
  calendarYearUnavailable: Record<string, string> = {},
): CpiSeriesFile {
  return {
    area: 'x',
    basePeriod: 'x',
    seriesId: sourceId,
    sourceId,
    title: 'x',
    frequency: 'x',
    fiscalYear,
    fiscalYearBasis: 'x',
    fiscalYearUnavailable,
    calendarYear,
    calendarYearBasis: 'x',
    calendarYearUnavailable,
    monthly: {},
    semiannual: {},
    missingMonths: {},
  };
}

function fixture(): TransformData {
  const observations: AfrObservation[] = [
    obs(2019, 'general', 100),
    obs(2019, 'enterprise', 50),
    obs(2020, 'general', 120),
    obs(2021, 'general', 150),
    obs(2022, 'general', 200),
    obs(2022, 'custodial', 1000),
    obs(2022, 'component_unit', 10),
    obs(2018, 'general', 80, 'expenditure'),
    obs(2019, 'general', 90, 'expenditure'),
    obs(2019, 'general', 999, 'revenue', 'pasco'),
  ];
  const population: PopulationFile = {
    hillsborough: {
      sourceId: POP,
      byYear: {
        '2018': { value: 8, basis: 'b', sheet: 's' },
        '2019': { value: 10, basis: 'b', sheet: 's' },
        '2020': { value: 12, basis: 'b', sheet: 's' },
        '2021': { value: 15, basis: 'b', sheet: 's' },
        // 2022 intentionally missing
      },
    },
  };
  const cpi: CpiFile = {
    national: cpiSeries(
      'cpi-us',
      { '2019': 100, '2020': 110, '2021': 120, '2022': 200 },
      { '2018': 99, '2019': 101, '2020': 111, '2021': 125, '2022': 202 },
      { '2018': 'missing 2017-10 (not in source)' },
    ),
    tampa: cpiSeries('cpi-tampa', { '2021': 50, '2022': 60 }, { '2021': 51, '2022': 61 }),
    tampa_semiannual: cpiSeries(
      'cpi-tampa-semi',
      {},
      { '2018': 39, '2019': 40, '2020': 44, '2021': 48, '2022': 52 },
      {},
      { '2023': 'BLS annual average not published' },
    ),
  };
  const annotations: Annotation[] = [
    { fiscalYear: 2021, label: 'Custodial fund reporting begins (GASB 84)', kind: 'methodology', sourceId: 'edr' },
    { fiscalYear: 2019, label: 'B event', kind: 'event', sourceId: 'x' },
    { fiscalYear: 2019, label: 'A event', kind: 'event', sourceId: 'x' },
    { fiscalYear: 2030, label: 'Out of range', kind: 'policy', sourceId: 'x' },
  ];
  return { observations, population, cpi, annotations, sources: [] };
}

function settings(over: Partial<TransformSettings> = {}): TransformSettings {
  return {
    flow: 'revenue',
    measure: 'nominal',
    baseYear: 2022,
    indexTo100: false,
    range: [2000, 2030],
    includeCustodial: false,
    cpiIndex: 'cpi-u-us',
    cpiPeriod: 'fiscal',
    ...over,
  };
}

function values(points: SeriesPoint[]): (number | null)[] {
  return points.map((p) => p.value);
}

function byYear(points: SeriesPoint[], fy: number): SeriesPoint {
  const p = points.find((x) => x.fiscalYear === fy);
  if (!p) throw new Error(`no point for ${fy}`);
  return p;
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
}

// ---------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------

describe('fiscalYearLabel (re-export)', () => {
  it('formats the stored ending year', () => {
    expect(fiscalYearLabel(2021)).toBe('FY 2020-21');
    expect(fiscalYearLabel(2000)).toBe('FY 1999-00');
    expect(fiscalYearLabel(2010)).toBe('FY 2009-10');
  });
});

describe('DEFAULT_SETTINGS', () => {
  it('matches the documented defaults', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      flow: 'revenue',
      measure: 'nominal',
      baseYear: 2025,
      indexTo100: false,
      range: [2005, 2025],
      includeCustodial: false,
      cpiIndex: 'cpi-u-us',
      cpiPeriod: 'fiscal',
      transfers: 'gross',
    });
  });

  it('is frozen, including the range tuple', () => {
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SETTINGS.range)).toBe(true);
  });
});

describe('defaultSettingsFor', () => {
  it('uses the full available range and the latest year as base', () => {
    const d = fixture();
    expect(defaultSettingsFor(d)).toEqual({ ...DEFAULT_SETTINGS, range: [2019, 2022], baseYear: 2022 });
    expect(defaultSettingsFor(d, 'expenditure')).toMatchObject({ flow: 'expenditure', range: [2018, 2019], baseYear: 2019 });
    expect(defaultSettingsFor(d, 'revenue', 'pasco')).toMatchObject({ range: [2019, 2019], baseYear: 2019 });
  });

  it('falls back to DEFAULT_SETTINGS when there is no data, with a mutable copy of the range', () => {
    const s = defaultSettingsFor({ ...fixture(), observations: [] }, 'expenditure');
    expect(s).toEqual({ ...DEFAULT_SETTINGS, flow: 'expenditure' });
    expect(Object.isFrozen(s.range)).toBe(false);
    expect(s.range).not.toBe(DEFAULT_SETTINGS.range);
  });
});

describe('availableYears', () => {
  it('returns sorted unique years per flow and jurisdiction', () => {
    const d = fixture();
    expect(availableYears(d, 'revenue')).toEqual([2019, 2020, 2021, 2022]);
    expect(availableYears(d, 'expenditure')).toEqual([2018, 2019]);
    expect(availableYears(d, 'revenue', 'pasco')).toEqual([2019]);
    expect(availableYears(d, 'revenue', 'nowhere')).toEqual([]);
  });

  it('sorts numerically regardless of input order', () => {
    const d = { ...fixture(), observations: [obs(2010, 'general', 1), obs(2009, 'general', 1), obs(2100, 'general', 1)] };
    expect(availableYears(d, 'revenue')).toEqual([2009, 2010, 2100]);
  });
});

describe('annotationsInRange', () => {
  it('keeps annotations inside the inclusive range, sorted by year then label', () => {
    const got = annotationsInRange(fixture(), settings({ range: [2019, 2021] }));
    expect(got.map((a) => a.label)).toEqual(['A event', 'B event', 'Custodial fund reporting begins (GASB 84)']);
  });

  it('includes both bounds and handles a reversed range', () => {
    expect(annotationsInRange(fixture(), settings({ range: [2021, 2021] })).map((a) => a.fiscalYear)).toEqual([2021]);
    expect(annotationsInRange(fixture(), settings({ range: [2030, 2021] })).map((a) => a.fiscalYear)).toEqual([2021, 2030]);
  });

  it('returns [] when nothing is in range', () => {
    expect(annotationsInRange(fixture(), settings({ range: [1990, 2000] }))).toEqual([]);
  });

  it('does not reorder the input array', () => {
    const d = fixture();
    const before = d.annotations.map((a) => a.label);
    annotationsInRange(d, settings());
    expect(d.annotations.map((a) => a.label)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// CPI selection
// ---------------------------------------------------------------------------

describe('selectCpi', () => {
  const { cpi } = fixture();

  it('U.S. fiscal uses national.fiscalYear', () => {
    const c = selectCpi(cpi, 'cpi-u-us', 'fiscal');
    expect(c.sourceId).toBe('cpi-us');
    expect(c.valueFor(2020)).toBe(110);
    expect(c.label).toBe('CPI-U, U.S. city average, fiscal-year (Oct-Sep) average');
  });

  it('U.S. calendar uses national.calendarYear, FY N -> calendar N', () => {
    const c = selectCpi(cpi, 'cpi-u-us', 'calendar');
    expect(c.sourceId).toBe('cpi-us');
    expect(c.valueFor(2020)).toBe(111);
    expect(c.label).toBe('CPI-U, U.S. city average, calendar-year annual average');
  });

  it('Tampa fiscal uses the bimonthly series only', () => {
    const c = selectCpi(cpi, 'cpi-u-tampa', 'fiscal');
    expect(c.sourceId).toBe('cpi-tampa');
    expect(c.valueFor(2021)).toBe(50);
    expect(c.valueFor(2019)).toBeUndefined();
    expect(c.label).toBe('CPI-U, Tampa-St. Petersburg-Clearwater, fiscal-year (Oct-Sep) average');
  });

  it('Tampa calendar uses the semiannual series calendar-year averages', () => {
    const c = selectCpi(cpi, 'cpi-u-tampa', 'calendar');
    expect(c.sourceId).toBe('cpi-tampa-semi');
    expect(c.valueFor(2019)).toBe(40);
    expect(c.valueFor(2021)).toBe(48);
  });

  it('explains missing values, including the published reason when present', () => {
    expect(selectCpi(cpi, 'cpi-u-us', 'fiscal').unavailableReason(2018)).toBe(
      'No CPI-U, U.S. city average, fiscal-year (Oct-Sep) average for FY 2017-18 (missing 2017-10 (not in source)).',
    );
    expect(selectCpi(cpi, 'cpi-u-tampa', 'fiscal').unavailableReason(2019)).toBe(
      'No CPI-U, Tampa-St. Petersburg-Clearwater, fiscal-year (Oct-Sep) average for FY 2018-19.',
    );
    expect(selectCpi(cpi, 'cpi-u-tampa', 'calendar').unavailableReason(2023)).toBe(
      'No CPI-U, Tampa-St. Petersburg-Clearwater, calendar-year annual average for calendar year 2023 (BLS annual average not published).',
    );
  });

  it('treats an explicit null (current cpi.json format) as missing and reports its reason', () => {
    const d = fixture();
    d.cpi.national.fiscalYear['2017'] = null;
    d.cpi.national.fiscalYearUnavailable['2017'] = 'incomplete fiscal year, not averaged: missing 2016-10';
    const c = selectCpi(d.cpi, 'cpi-u-us', 'fiscal');
    expect(c.valueFor(2017)).toBeUndefined();
    expect(c.unavailableReason(2017)).toBe(
      'No CPI-U, U.S. city average, fiscal-year (Oct-Sep) average for FY 2016-17 (incomplete fiscal year, not averaged: missing 2016-10).',
    );
  });

  it('treats zero, negative and non-numeric levels as missing', () => {
    const bad = fixture().cpi;
    (bad.national.fiscalYear as Record<string, unknown>)['2019'] = 0;
    (bad.national.fiscalYear as Record<string, unknown>)['2020'] = -5;
    (bad.national.fiscalYear as Record<string, unknown>)['2021'] = 'n/a';
    (bad.national.fiscalYear as Record<string, unknown>)['2022'] = NaN;
    const c = selectCpi(bad, 'cpi-u-us', 'fiscal');
    for (const fy of [2019, 2020, 2021, 2022]) expect(c.valueFor(fy)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildSeries
// ---------------------------------------------------------------------------

describe('buildSeries: nominal', () => {
  it('sums all non-custodial funds per year, labels and sources each point', () => {
    const pts = buildSeries(fixture(), settings());
    expect(pts.map((p) => p.fiscalYear)).toEqual([2019, 2020, 2021, 2022]);
    expect(pts.map((p) => p.label)).toEqual(['FY 2018-19', 'FY 2019-20', 'FY 2020-21', 'FY 2021-22']);
    expect(values(pts)).toEqual([150, 120, 150, 210]);
    expect(pts.map((p) => p.nominal)).toEqual([150, 120, 150, 210]);
    for (const p of pts) {
      expect(p.sourceIds).toEqual([REV]);
      expect(p.population).toBeUndefined();
      expect(p.cpi).toBeUndefined();
      expect(p.cpiBase).toBeUndefined();
    }
  });

  it('ignores other jurisdictions by default and selects one when asked', () => {
    expect(values(buildSeries(fixture(), settings({ range: [2019, 2019] })))).toEqual([150]);
    expect(values(buildSeries(fixture(), settings({ range: [2019, 2019], jurisdiction: 'pasco' })))).toEqual([999]);
  });

  it('selects the flow', () => {
    const pts = buildSeries(fixture(), settings({ flow: 'expenditure' }));
    expect(pts.map((p) => [p.fiscalYear, p.value])).toEqual([
      [2018, 80],
      [2019, 90],
    ]);
    expect(pts[0].sourceIds).toEqual([EXP]);
  });

  it('a year whose only rows are excluded sums to 0 (zero cells are omitted)', () => {
    const d = { ...fixture(), observations: [obs(2023, 'custodial', 5)] };
    const [p] = buildSeries(d, settings());
    expect(p).toMatchObject({ fiscalYear: 2023, value: 0, nominal: 0, custodialNominal: 5, sourceIds: [REV] });
  });

  it('returns [] when there is no data', () => {
    expect(buildSeries({ ...fixture(), observations: [] }, settings())).toEqual([]);
  });

  it('collects every AFR source id that contributes, sorted', () => {
    const d = fixture();
    const extra: AfrObservation = { ...obs(2019, 'general', 1), sourceId: 'a-other' };
    const pts = buildSeries({ ...d, observations: [...d.observations, extra] }, settings({ range: [2019, 2019] }));
    expect(pts[0].sourceIds).toEqual(['a-other', REV]);
    expect(pts[0].value).toBe(151);
  });
});

describe('buildSeries: custodial', () => {
  it('excludes custodial by default and notes it', () => {
    const p = byYear(buildSeries(fixture(), settings()), 2022);
    expect(p.value).toBe(210);
    expect(p.custodialNominal).toBe(1000);
    expect(p.notes).toContain('Custodial fund amounts (GASB 84) are excluded.');
  });

  it('includes custodial when asked and notes it', () => {
    const p = byYear(buildSeries(fixture(), settings({ includeCustodial: true })), 2022);
    expect(p.value).toBe(1210);
    expect(p.nominal).toBe(1210);
    expect(p.custodialNominal).toBe(1000);
    expect(p.notes).toContain(
      'Includes custodial fund amounts (GASB 84): money the county holds or collects for others.',
    );
  });

  it('years without custodial amounts are identical either way and carry no custodial note', () => {
    const a = buildSeries(fixture(), settings({ includeCustodial: false }));
    const b = buildSeries(fixture(), settings({ includeCustodial: true }));
    for (const fy of [2019, 2020, 2021]) {
      expect(byYear(a, fy)).toEqual(byYear(b, fy));
      expect(byYear(a, fy).notes).toEqual([]);
      expect(byYear(a, fy).custodialNominal).toBe(0);
    }
  });

  it('only fundType "custodial" is dropped (pension, trust, component units stay)', () => {
    const d = {
      ...fixture(),
      observations: ['pension', 'trust', 'private_purpose', 'component_unit', 'custodial', 'Custodial'].map((f) =>
        obs(2030, f, 1),
      ),
    };
    expect(values(buildSeries(d, settings()))).toEqual([5]);
    expect(values(buildSeries(d, settings({ includeCustodial: true })))).toEqual([6]);
  });
});

describe('buildSeries: range', () => {
  it('clips to the inclusive range', () => {
    expect(buildSeries(fixture(), settings({ range: [2020, 2021] })).map((p) => p.fiscalYear)).toEqual([2020, 2021]);
  });

  it('a single-year range yields one point', () => {
    expect(buildSeries(fixture(), settings({ range: [2022, 2022] })).map((p) => p.fiscalYear)).toEqual([2022]);
  });

  it('a reversed range is treated as [min, max]', () => {
    expect(buildSeries(fixture(), settings({ range: [2021, 2020] })).map((p) => p.fiscalYear)).toEqual([2020, 2021]);
  });

  it('a range wider than the data yields only years with data; outside yields []', () => {
    expect(buildSeries(fixture(), settings({ range: [1900, 2100] }))).toHaveLength(4);
    expect(buildSeries(fixture(), settings({ range: [1990, 2000] }))).toEqual([]);
  });

  it('points are in ascending year order even if observations are not', () => {
    const d = fixture();
    const shuffled = { ...d, observations: [...d.observations].reverse() };
    expect(buildSeries(shuffled, settings()).map((p) => p.fiscalYear)).toEqual([2019, 2020, 2021, 2022]);
  });
});

describe('buildSeries: per_capita', () => {
  it('divides by the population for the same fiscal year', () => {
    const pts = buildSeries(fixture(), settings({ measure: 'per_capita', range: [2019, 2021] }));
    expect(values(pts)).toEqual([15, 10, 10]);
    expect(pts.map((p) => p.population)).toEqual([10, 12, 15]);
    expect(pts.map((p) => p.nominal)).toEqual([150, 120, 150]);
    for (const p of pts) expect(p.sourceIds).toEqual([REV, POP]);
  });

  it('missing population -> null with a note, never NaN', () => {
    const p = byYear(buildSeries(fixture(), settings({ measure: 'per_capita' })), 2022);
    expect(p.value).toBeNull();
    expect(p.population).toBeUndefined();
    expect(p.nominal).toBe(210);
    expect(p.sourceIds).toEqual([REV]);
    expect(p.notes).toContain('No population estimate for hillsborough, FY 2021-22 (April 1, 2022).');
  });

  it('zero or non-numeric population is treated as missing', () => {
    const d = fixture();
    const population: PopulationFile = {
      hillsborough: {
        sourceId: POP,
        byYear: {
          '2019': { value: 0, basis: 'b', sheet: 's' },
          '2020': { value: NaN, basis: 'b', sheet: 's' },
        },
      },
    };
    const pts = buildSeries({ ...d, population }, settings({ measure: 'per_capita', range: [2019, 2020] }));
    expect(values(pts)).toEqual([null, null]);
  });

  it('jurisdiction without any population entry -> null with a note', () => {
    const pts = buildSeries(fixture(), settings({ measure: 'per_capita', jurisdiction: 'pasco' }));
    expect(pts).toHaveLength(1);
    expect(pts[0].value).toBeNull();
    expect(pts[0].notes).toEqual(['No population estimate for pasco, FY 2018-19 (April 1, 2019).']);
  });
});

describe('buildSeries: real', () => {
  it('expresses each year in base-year dollars: nominal * CPI[base] / CPI[year]', () => {
    const pts = buildSeries(fixture(), settings({ measure: 'real', baseYear: 2022 }));
    expect(values(pts)).toEqual([(150 * 200) / 100, (120 * 200) / 110, (150 * 200) / 120, 210]);
    expect(pts.map((p) => p.cpi)).toEqual([100, 110, 120, 200]);
    for (const p of pts) {
      expect(p.cpiBase).toBe(200);
      expect(p.sourceIds).toEqual([REV, 'cpi-us']);
    }
  });

  it('base year at the first year of the range', () => {
    const pts = buildSeries(fixture(), settings({ measure: 'real', baseYear: 2019 }));
    expect(byYear(pts, 2019).value).toBe(150);
    expect(byYear(pts, 2022).value).toBeCloseTo((210 * 100) / 200, 12);
  });

  it('base year outside the selected range is allowed', () => {
    const pts = buildSeries(fixture(), settings({ measure: 'real', baseYear: 2022, range: [2019, 2020] }));
    expect(values(pts)).toEqual([300, (120 * 200) / 110]);
  });

  it('base-year value equals nominal', () => {
    for (const baseYear of [2019, 2020, 2021, 2022]) {
      const p = byYear(buildSeries(fixture(), settings({ measure: 'real', baseYear })), baseYear);
      expect(p.value).toBe(p.nominal);
    }
  });

  it('calendar period uses calendar-year CPI', () => {
    const pts = buildSeries(fixture(), settings({ measure: 'real', baseYear: 2022, cpiPeriod: 'calendar' }));
    expect(byYear(pts, 2019).value).toBeCloseTo((150 * 202) / 101, 12);
    expect(byYear(pts, 2019).cpi).toBe(101);
    expect(byYear(pts, 2019).cpiBase).toBe(202);
  });

  it('missing CPI for the year -> null with a note; base CPI still reported', () => {
    const d = fixture();
    const p = buildSeries(d, settings({ flow: 'expenditure', measure: 'real', baseYear: 2019 }))[0];
    expect(p.fiscalYear).toBe(2018);
    expect(p.value).toBeNull();
    expect(p.cpi).toBeUndefined();
    expect(p.cpiBase).toBe(100);
    expect(p.sourceIds).toEqual([EXP, 'cpi-us']);
    expect(p.notes).toEqual([
      'No CPI-U, U.S. city average, fiscal-year (Oct-Sep) average for FY 2017-18 (missing 2017-10 (not in source)).',
    ]);
  });

  it('missing CPI for the base year -> every value null, each with a note', () => {
    const pts = buildSeries(fixture(), settings({ measure: 'real', baseYear: 2018 }));
    expect(values(pts)).toEqual([null, null, null, null]);
    for (const p of pts) {
      expect(p.cpiBase).toBeUndefined();
      expect(p.cpi).toBeDefined();
      expect(p.notes).toContain(
        'No CPI-U, U.S. city average, fiscal-year (Oct-Sep) average for FY 2017-18 (missing 2017-10 (not in source)).',
      );
    }
  });

  it('CPI missing for both year and base -> null, no CPI source claimed', () => {
    const d = fixture();
    const p = buildSeries(d, settings({ measure: 'real', baseYear: 1990, range: [2019, 2019], cpiIndex: 'cpi-u-tampa' }))[0];
    expect(p.value).toBeNull();
    expect(p.sourceIds).toEqual([REV]);
    expect(p.notes).toHaveLength(2);
  });

  it('a base year with the same missing CPI is noted once', () => {
    const p = buildSeries(fixture(), settings({ flow: 'expenditure', measure: 'real', baseYear: 2018, range: [2018, 2018] }))[0];
    expect(p.value).toBeNull();
    expect(p.notes).toHaveLength(1);
  });
});

describe('buildSeries: Tampa CPI coverage', () => {
  it('fiscal period: years before Tampa coverage are null, never spliced with national', () => {
    const pts = buildSeries(fixture(), settings({ measure: 'real', cpiIndex: 'cpi-u-tampa', baseYear: 2022 }));
    expect(values(pts)).toEqual([null, null, (150 * 60) / 50, 210]);
    expect(byYear(pts, 2019).cpi).toBeUndefined();
    expect(byYear(pts, 2019).notes).toEqual([
      'No CPI-U, Tampa-St. Petersburg-Clearwater, fiscal-year (Oct-Sep) average for FY 2018-19.',
    ]);
    for (const p of pts) expect(p.sourceIds).not.toContain('cpi-us');
    expect(byYear(pts, 2021).sourceIds).toEqual([REV, 'cpi-tampa']);
  });

  it('fiscal period with base year before coverage: everything null', () => {
    const pts = buildSeries(fixture(), settings({ measure: 'real', cpiIndex: 'cpi-u-tampa', baseYear: 2019 }));
    expect(values(pts)).toEqual([null, null, null, null]);
  });

  it('calendar period covers the earlier years from the semiannual series', () => {
    const pts = buildSeries(fixture(), settings({ measure: 'real', cpiIndex: 'cpi-u-tampa', cpiPeriod: 'calendar', baseYear: 2022 }));
    expect(values(pts)).toEqual([(150 * 52) / 40, (120 * 52) / 44, (150 * 52) / 48, 210]);
    for (const p of pts) expect(p.sourceIds).toEqual([REV, 'cpi-tampa-semi']);
  });
});

describe('buildSeries: real_per_capita', () => {
  it('applies both population and CPI', () => {
    const pts = buildSeries(fixture(), settings({ measure: 'real_per_capita', baseYear: 2021 }));
    expect(byYear(pts, 2019).value).toBeCloseTo((150 / 10) * (120 / 100), 12);
    expect(byYear(pts, 2020).value).toBeCloseTo((120 / 12) * (120 / 110), 12);
    expect(byYear(pts, 2021).value).toBe(10);
    expect(byYear(pts, 2019).sourceIds).toEqual([REV, POP, 'cpi-us']);
  });

  it('missing population -> null even when CPI exists', () => {
    const p = byYear(buildSeries(fixture(), settings({ measure: 'real_per_capita', baseYear: 2021 })), 2022);
    expect(p.value).toBeNull();
    expect(p.cpi).toBe(200);
    expect(p.notes).toEqual([
      'Custodial fund amounts (GASB 84) are excluded.',
      'No population estimate for hillsborough, FY 2021-22 (April 1, 2022).',
    ]);
  });

  it('missing CPI -> null even when population exists', () => {
    const p = buildSeries(fixture(), settings({ flow: 'expenditure', measure: 'real_per_capita', baseYear: 2019 }))[0];
    expect(p.fiscalYear).toBe(2018);
    expect(p.population).toBe(8);
    expect(p.value).toBeNull();
  });
});

describe('buildSeries: indexTo100', () => {
  it('nominal: base year = 100', () => {
    const pts = buildSeries(fixture(), settings({ indexTo100: true, baseYear: 2019 }));
    expect(values(pts)).toEqual([100, 80, 100, 140]);
    expect(pts.map((p) => p.nominal)).toEqual([150, 120, 150, 210]);
  });

  it('base year at the last year', () => {
    const pts = buildSeries(fixture(), settings({ indexTo100: true, baseYear: 2022 }));
    expect(byYear(pts, 2022).value).toBe(100);
    expect(byYear(pts, 2019).value).toBeCloseTo((150 / 210) * 100, 12);
  });

  it('base year outside the range still indexes', () => {
    const pts = buildSeries(fixture(), settings({ indexTo100: true, baseYear: 2019, range: [2022, 2022] }));
    expect(values(pts)).toEqual([140]);
  });

  it('rebases the measured series (per capita)', () => {
    const pts = buildSeries(fixture(), settings({ indexTo100: true, baseYear: 2019, measure: 'per_capita', range: [2019, 2021] }));
    expect(values(pts)).toEqual([100, (10 / 15) * 100, (10 / 15) * 100]);
  });

  it('rebases the measured series (real) and merges base-year sources', () => {
    const pts = buildSeries(fixture(), settings({ indexTo100: true, baseYear: 2020, measure: 'real' }));
    expect(byYear(pts, 2020).value).toBe(100);
    // real(2019) = 150*110/100 = 165; real(2020) = 120 -> 137.5
    expect(byYear(pts, 2019).value).toBeCloseTo(137.5, 12);
    expect(byYear(pts, 2019).sourceIds).toEqual([REV, 'cpi-us']);
  });

  it('adds base-year sources not already on the point', () => {
    const d = fixture();
    const other: AfrObservation = { ...obs(2020, 'general', 0.5), sourceId: 'z-other' };
    const pts = buildSeries({ ...d, observations: [...d.observations, other] }, settings({ indexTo100: true, baseYear: 2020 }));
    expect(byYear(pts, 2019).sourceIds).toEqual([REV, 'z-other']);
  });

  it('base year with no data -> all null with a note', () => {
    const pts = buildSeries(fixture(), settings({ indexTo100: true, baseYear: 2010 }));
    expect(values(pts)).toEqual([null, null, null, null]);
    expect(pts[0].notes).toEqual(['Index base FY 2009-10 has no revenue data.']);
  });

  it('base value null (no population) -> all null, carrying the base reason', () => {
    const pts = buildSeries(fixture(), settings({ indexTo100: true, baseYear: 2022, measure: 'per_capita' }));
    expect(values(pts)).toEqual([null, null, null, null]);
    expect(byYear(pts, 2019).notes).toEqual([
      'Index base FY 2021-22 has no value.',
      'Custodial fund amounts (GASB 84) are excluded.',
      'No population estimate for hillsborough, FY 2021-22 (April 1, 2022).',
    ]);
    // The base year's own point: its notes are not duplicated.
    expect(byYear(pts, 2022).notes).toEqual([
      'Custodial fund amounts (GASB 84) are excluded.',
      'No population estimate for hillsborough, FY 2021-22 (April 1, 2022).',
      'Index base FY 2021-22 has no value.',
    ]);
  });

  it('base value zero -> all null with a note', () => {
    const d = { ...fixture(), observations: [obs(2019, 'general', 0), obs(2020, 'general', 5)] };
    const pts = buildSeries(d, settings({ indexTo100: true, baseYear: 2019 }));
    expect(values(pts)).toEqual([null, null]);
    expect(pts[1].notes).toEqual(["Index base FY 2018-19 is zero; an index can't be computed."]);
  });

  it('point null but base fine -> stays null', () => {
    const pts = buildSeries(fixture(), settings({ indexTo100: true, baseYear: 2021, measure: 'per_capita' }));
    expect(byYear(pts, 2021).value).toBe(100);
    expect(byYear(pts, 2022).value).toBeNull();
    expect(byYear(pts, 2019).value).toBe(150);
  });

  it('indexTo100=false leaves values unscaled', () => {
    expect(values(buildSeries(fixture(), settings({ indexTo100: false, baseYear: 2019 })))).toEqual([150, 120, 150, 210]);
  });
});

describe('buildSeries: never NaN or Infinity', () => {
  const measures = ['nominal', 'per_capita', 'real', 'real_per_capita'] as const;
  const indexes = ['cpi-u-us', 'cpi-u-tampa'] as const;
  const periods = ['fiscal', 'calendar'] as const;
  it('every combination yields finite numbers or null, each null with a note', () => {
    for (const measure of measures)
      for (const cpiIndex of indexes)
        for (const cpiPeriod of periods)
          for (const indexTo100 of [false, true])
            for (const includeCustodial of [false, true])
              for (const baseYear of [2010, 2018, 2019, 2022])
                for (const flow of ['revenue', 'expenditure'] as const) {
                  const s = settings({ measure, cpiIndex, cpiPeriod, indexTo100, includeCustodial, baseYear, flow });
                  for (const p of buildSeries(fixture(), s)) {
                    if (p.value === null) expect(p.notes.length).toBeGreaterThan(0);
                    else expect(Number.isFinite(p.value)).toBe(true);
                  }
                }
  });
});

describe('buildSeries: purity', () => {
  it('does not mutate its inputs (deep-frozen data and settings)', () => {
    const d = deepFreeze(fixture());
    const s = deepFreeze(settings({ measure: 'real_per_capita', indexTo100: true, baseYear: 2021, includeCustodial: true }));
    expect(() => buildSeries(d, s)).not.toThrow();
    expect(() => annotationsInRange(d, s)).not.toThrow();
    expect(() => availableYears(d, 'revenue')).not.toThrow();
    expect(() => defaultSettingsFor(d)).not.toThrow();
  });

  it('leaves inputs structurally unchanged', () => {
    const d = fixture();
    const s = settings({ measure: 'real', indexTo100: true, range: [2022, 2019] });
    const before = JSON.stringify([d, s]);
    buildSeries(d, s);
    annotationsInRange(d, s);
    expect(JSON.stringify([d, s])).toBe(before);
  });

  it('is deterministic and returns fresh objects each call', () => {
    const d = fixture();
    const s = settings({ measure: 'real_per_capita', indexTo100: true, baseYear: 2020 });
    const a = buildSeries(d, s);
    const b = buildSeries(d, s);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]);
    a[0].sourceIds.push('mutated');
    a[0].notes.push('mutated');
    expect(buildSeries(d, s)).toEqual(b);
  });

  it('works with DEFAULT_SETTINGS directly (frozen)', () => {
    expect(() => buildSeries(fixture(), DEFAULT_SETTINGS)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Interfund transfers
// ---------------------------------------------------------------------------

function tobs(
  fiscalYear: number,
  flow: 'revenue' | 'expenditure',
  account: string,
  fundType: string,
  amount: number,
): AfrObservation {
  return { ...obs(fiscalYear, fundType, amount, flow), account };
}

/** 2019: balanced transfers. 2020: 581 > 381. 2021: revenue only. 2018: expenditure only. */
function transferFixture(): TransformData {
  return {
    ...fixture(),
    observations: [
      obs(2018, 'general', 70, 'expenditure'),
      tobs(2018, 'expenditure', '581', 'general', 30),
      obs(2019, 'general', 1000),
      tobs(2019, 'revenue', '381', 'general', 200),
      tobs(2019, 'revenue', '381', 'special_revenue', 50),
      obs(2019, 'general', 900, 'expenditure'),
      tobs(2019, 'expenditure', '581', 'general', 250),
      obs(2020, 'general', 1000),
      tobs(2020, 'revenue', '381', 'general', 100),
      tobs(2020, 'revenue', '381.1', 'enterprise', 20),
      obs(2020, 'general', 800, 'expenditure'),
      tobs(2020, 'expenditure', '581', 'general', 600),
      tobs(2020, 'expenditure', '581', 'custodial', 7),
      tobs(2020, 'revenue', '381', 'custodial', 3),
      obs(2021, 'general', 500),
      tobs(2021, 'revenue', '381', 'general', 40),
      // An unknown flow is ignored, not counted anywhere.
      { ...obs(2021, 'general', 5), sourceId: 'ignored', flow: 'bogus' as AfrObservation['flow'] },
    ],
  };
}

describe('isTransferAccount / TRANSFER_ACCOUNTS', () => {
  it('matches 381 for revenue and 581 for expenditure, including sub-accounts', () => {
    expect(TRANSFER_ACCOUNTS).toEqual({ revenue: 381, expenditure: 581 });
    expect(isTransferAccount('381', 'revenue')).toBe(true);
    expect(isTransferAccount('381.1', 'revenue')).toBe(true);
    expect(isTransferAccount('581', 'expenditure')).toBe(true);
    expect(isTransferAccount('581', 'revenue')).toBe(false);
    expect(isTransferAccount('381', 'expenditure')).toBe(false);
    expect(isTransferAccount('382', 'revenue')).toBe(false);
    expect(isTransferAccount('38.1', 'revenue')).toBe(false);
    expect(isTransferAccount('', 'revenue')).toBe(false);
    expect(isTransferAccount('abc', 'revenue')).toBe(false);
  });
});

describe('formatUsd', () => {
  it.each([
    [0, '$0'],
    [999, '$999'],
    [1000, '$1,000'],
    [624603841, '$624,603,841'],
    [-790, '-$790'],
    [-1234567, '-$1,234,567'],
    [5.5, '$5.50'],
    [1234.567, '$1,234.57'],
  ])('%s -> %s', (n, text) => {
    expect(formatUsd(n)).toBe(text);
  });
});

describe('buildSeries: transfers', () => {
  it('gross (default and explicit) keeps 381 in revenue and reports the amount', () => {
    const d = transferFixture();
    const implicit = buildSeries(d, settings());
    const explicit = buildSeries(d, settings({ transfers: 'gross' }));
    expect(implicit).toEqual(explicit);
    expect(values(implicit)).toEqual([1250, 1120, 540]);
    expect(implicit.map((p) => p.transfersNominal)).toEqual([250, 120, 40]);
  });

  it('net drops 381 (and sub-accounts) from revenue; transfersNominal is unchanged', () => {
    const pts = buildSeries(transferFixture(), settings({ transfers: 'net' }));
    expect(values(pts)).toEqual([1000, 1000, 500]);
    expect(pts.map((p) => p.nominal)).toEqual([1000, 1000, 500]);
    expect(pts.map((p) => p.transfersNominal)).toEqual([250, 120, 40]);
    expect(byYear(pts, 2019).notes).toEqual(['Interfund transfers (account 381, $250) are excluded.']);
  });

  it('net drops 581 from expenditure', () => {
    const d = transferFixture();
    expect(values(buildSeries(d, settings({ flow: 'expenditure' })))).toEqual([100, 1150, 1400]);
    const pts = buildSeries(d, settings({ flow: 'expenditure', transfers: 'net' }));
    expect(values(pts)).toEqual([70, 900, 800]);
    expect(pts.map((p) => p.transfersNominal)).toEqual([30, 250, 600]);
    expect(byYear(pts, 2018).notes).toEqual(['Interfund transfers (account 581, $30) are excluded.']);
  });

  it('gross and net reconcile: gross nominal = net nominal + transfersNominal', () => {
    const d = transferFixture();
    for (const flow of ['revenue', 'expenditure'] as const)
      for (const includeCustodial of [false, true]) {
        const g = buildSeries(d, settings({ flow, includeCustodial }));
        const n = buildSeries(d, settings({ flow, includeCustodial, transfers: 'net' }));
        expect(g.map((p) => p.fiscalYear)).toEqual(n.map((p) => p.fiscalYear));
        g.forEach((p, i) => expect(p.nominal).toBe(n[i].nominal + n[i].transfersNominal));
      }
  });

  it('transfers in excluded custodial funds are not counted; included ones are', () => {
    const d = transferFixture();
    const excl = byYear(buildSeries(d, settings({ transfers: 'net' })), 2020);
    const incl = byYear(buildSeries(d, settings({ transfers: 'net', includeCustodial: true })), 2020);
    expect(excl.transfersNominal).toBe(120);
    expect(incl.transfersNominal).toBe(123);
    expect(excl.value).toBe(1000);
    expect(incl.value).toBe(1000);
    expect(incl.custodialNominal).toBe(3);
  });

  it('no transfers-excluded note in gross mode or when the year has no transfers', () => {
    for (const p of buildSeries(transferFixture(), settings())) {
      expect(p.notes.some((t) => t.startsWith('Interfund transfers'))).toBe(false);
    }
    const plain = byYear(buildSeries(fixture(), settings({ transfers: 'net' })), 2019);
    expect(plain.notes).toEqual([]);
    expect(plain.transfersNominal).toBe(0);
  });

  it('transferImbalance = 581 - 381, only for years with both flows', () => {
    const d = transferFixture();
    const rev = buildSeries(d, settings());
    expect(byYear(rev, 2019).transferImbalance).toBe(0);
    expect(byYear(rev, 2020).transferImbalance).toBe(480);
    expect(byYear(rev, 2021).transferImbalance).toBeUndefined();
    const exp = buildSeries(d, settings({ flow: 'expenditure' }));
    expect(byYear(exp, 2018).transferImbalance).toBeUndefined();
    expect(byYear(exp, 2020).transferImbalance).toBe(480);
    // Custodial included: (600 + 7) - (120 + 3).
    expect(byYear(buildSeries(d, settings({ includeCustodial: true })), 2020).transferImbalance).toBe(484);
  });

  it("a material imbalance is noted on both flows in both modes, citing the other flow's source", () => {
    const d = transferFixture();
    const gross = 'Transfers out (581) and transfers in (381) differ in FY 2019-20: $600 out, $120 in (difference $480).';
    const net = gross + ' Removing transfers reduces revenue and expenditure by different amounts.';
    const rg = byYear(buildSeries(d, settings()), 2020);
    const cust = 'Custodial fund amounts (GASB 84) are excluded.';
    expect(rg.notes).toEqual([cust, gross]);
    expect(rg.sourceIds).toEqual([REV, EXP]);
    const rn = byYear(buildSeries(d, settings({ transfers: 'net' })), 2020);
    expect(rn.notes).toEqual([cust, 'Interfund transfers (account 381, $120) are excluded.', net]);
    const en = byYear(buildSeries(d, settings({ flow: 'expenditure', transfers: 'net' })), 2020);
    expect(en.notes).toEqual([cust, 'Interfund transfers (account 581, $600) are excluded.', net]);
    expect(en.sourceIds).toEqual([EXP, REV]);
  });

  it('a balanced year has no imbalance note and no extra source', () => {
    const p = byYear(buildSeries(transferFixture(), settings()), 2019);
    expect(p.notes).toEqual([]);
    expect(p.sourceIds).toEqual([REV]);
  });

  it('an imbalance at or below the threshold share is not noted; above it is', () => {
    const at = 1000 * TRANSFER_IMBALANCE_NOTE_SHARE;
    const mk = (out: number): TransformData => ({
      ...fixture(),
      observations: [tobs(2019, 'revenue', '381', 'general', 1000), tobs(2019, 'expenditure', '581', 'general', out)],
    });
    expect(buildSeries(mk(1000 - at), settings())[0].notes).toEqual([]);
    expect(buildSeries(mk(1000 - at), settings())[0].transferImbalance).toBe(-at);
    expect(buildSeries(mk(1000 - 2 * at), settings())[0].notes).toHaveLength(1);
    expect(buildSeries(mk(1000 + 2 * at), settings())[0].notes).toHaveLength(1);
  });

  it('a negative imbalance (381 > 581) is noted too', () => {
    const d: TransformData = {
      ...fixture(),
      observations: [tobs(2019, 'revenue', '381', 'general', 500), tobs(2019, 'expenditure', '581', 'general', 100)],
    };
    expect(buildSeries(d, settings())[0].notes).toEqual([
      'Transfers out (581) and transfers in (381) differ in FY 2018-19: $100 out, $500 in (difference -$400).',
    ]);
  });

  it('ignores observations with an unknown flow', () => {
    const pts = buildSeries(transferFixture(), settings());
    expect(pts.flatMap((p) => p.sourceIds)).not.toContain('ignored');
    expect(byYear(pts, 2021).value).toBe(540);
  });

  it('net composes with per capita, real and indexTo100', () => {
    const d = transferFixture();
    expect(values(buildSeries(d, settings({ transfers: 'net', measure: 'per_capita' })))).toEqual([100, 1000 / 12, 500 / 15]);
    expect(values(buildSeries(d, settings({ transfers: 'net', measure: 'real', baseYear: 2020 })))).toEqual([
      (1000 * 110) / 100,
      1000,
      (500 * 110) / 120,
    ]);
    expect(values(buildSeries(d, settings({ transfers: 'net', indexTo100: true, baseYear: 2019 })))).toEqual([100, 100, 50]);
  });
});

// ---------------------------------------------------------------------------
// Annotation conditions
// ---------------------------------------------------------------------------

describe('annotationsInRange: conditions', () => {
  const ann = (label: string, extra: Partial<AnnotationRecord> = {}): AnnotationRecord => ({
    fiscalYear: 2022,
    label,
    kind: 'methodology',
    sourceId: 's',
    ...extra,
  });
  const data = (): TransformData => ({
    ...fixture(),
    annotations: [
      ann('always'),
      ann('rev', { flow: 'revenue' }),
      ann('exp', { flow: 'expenditure' }),
      ann('cust-in', { custodial: 'included' }),
      ann('cust-out', { custodial: 'excluded' }),
      ann('per-res', { measures: ['per_capita', 'real_per_capita'] }),
      ann('never', { measures: [] }),
      ann('exp+cust-in', { flow: 'expenditure', custodial: 'included' }),
    ],
  });
  const labels = (s: Partial<TransformSettings>) => annotationsInRange(data(), settings(s)).map((a) => a.label);

  it('defaults: revenue, custodial excluded, nominal', () => {
    expect(labels({})).toEqual(['always', 'cust-out', 'rev']);
  });

  it('filters on flow', () => {
    expect(labels({ flow: 'expenditure' })).toEqual(['always', 'cust-out', 'exp']);
  });

  it('filters on the custodial toggle', () => {
    expect(labels({ includeCustodial: true })).toEqual(['always', 'cust-in', 'rev']);
    expect(labels({ includeCustodial: true, flow: 'expenditure' })).toEqual(['always', 'cust-in', 'exp', 'exp+cust-in']);
  });

  it('filters on measure', () => {
    expect(labels({ measure: 'per_capita' })).toEqual(['always', 'cust-out', 'per-res', 'rev']);
    expect(labels({ measure: 'real_per_capita' })).toEqual(['always', 'cust-out', 'per-res', 'rev']);
    expect(labels({ measure: 'real' })).toEqual(['always', 'cust-out', 'rev']);
  });

  it('plain CLAUDE.md Annotations (no conditions) always apply', () => {
    const plain: Annotation = { fiscalYear: 2022, label: 'plain', kind: 'event', sourceId: 's' };
    for (const s of [settings(), settings({ flow: 'expenditure', includeCustodial: true, measure: 'real' })]) {
      expect(annotationsInRange({ ...fixture(), annotations: [plain] }, s)).toEqual([plain]);
    }
  });
});

// ---------------------------------------------------------------------------
// Golden tests against the real pipeline output
// ---------------------------------------------------------------------------

describe('golden: src/assets/data', () => {
  const data: TransformData = {
    observations: observationsJson as AfrObservation[],
    population: populationJson as PopulationFile,
    cpi: cpiJson as unknown as CpiFile,
    annotations: annotationsJson as Annotation[],
    sources: sourcesJson,
  };
  const totals = workbookTotalsJson as WorkbookTotal[];
  const full = (over: Partial<TransformSettings> = {}) => settings({ range: [1900, 2100], baseYear: 2025, ...over });

  it('pinned values: FY 2024-25 revenue incl./excl. custodial, FY 2021-22 revenue excl.', () => {
    const incl = buildSeries(data, full({ includeCustodial: true }));
    const excl = buildSeries(data, full());
    expect(byYear(incl, 2025).value).toBe(9_597_307_134);
    expect(byYear(excl, 2025).value).toBe(5_468_332_134);
    expect(byYear(excl, 2022).value).toBe(3_583_795_000);
  });

  it('transfers: FY 2021-22 revenue excl. custodial, gross -22.9% vs net -6.4% (QA-02)', () => {
    const g = buildSeries(data, full());
    const n = buildSeries(data, full({ transfers: 'net' }));
    expect(byYear(n, 2022).value).toBe(3_583_795_000 - 381_557_000);
    expect(byYear(n, 2021).value).toBe(4_646_108_000 - 1_223_354_000);
    const change = (p: SeriesPoint[]) => byYear(p, 2022).value! / byYear(p, 2021).value! - 1;
    expect(change(g)).toBeCloseTo(-0.229, 3);
    expect(change(n)).toBeCloseTo(-0.064, 3);
  });

  it('transfers: net mode keeps the FY 2022-23 / FY 2023-24 381-vs-581 imbalance visible (QA-01)', () => {
    for (const flow of ['revenue', 'expenditure'] as const)
      for (const transfers of ['gross', 'net'] as const) {
        const pts = buildSeries(data, full({ flow, transfers }));
        expect(byYear(pts, 2023).transferImbalance).toBe(624_603_841);
        expect(byYear(pts, 2024).transferImbalance).toBe(535_878_141);
        expect(byYear(pts, 2023).notes.some((t) => t.includes('difference $624,603,841'))).toBe(true);
        expect(byYear(pts, 2024).notes.some((t) => t.includes('difference $535,878,141'))).toBe(true);
        // Years where 381 and 581 agree within a few hundred dollars carry no imbalance note.
        for (const fy of [2021, 2022, 2025]) {
          expect(Math.abs(byYear(pts, fy).transferImbalance!)).toBeLessThanOrEqual(2000);
          expect(byYear(pts, fy).notes.some((t) => t.startsWith('Transfers out'))).toBe(false);
        }
      }
    // Including custodial adds FY 2023-24 custodial 581 transfers ($1,722,657).
    expect(byYear(buildSeries(data, full({ includeCustodial: true })), 2024).transferImbalance).toBe(537_600_798);
  });

  it('transfers: only FY 2022-23 and FY 2023-24 carry an imbalance note', () => {
    const noted = buildSeries(data, full({ flow: 'expenditure' }))
      .filter((p) => p.notes.some((t) => t.startsWith('Transfers out')))
      .map((p) => p.fiscalYear);
    expect(noted).toEqual([2023, 2024]);
  });

  it('available years: revenue FY 2005-06..2024-25, expenditure FY 2004-05..2024-25, no gaps', () => {
    const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
    expect(availableYears(data, 'revenue')).toEqual(range(2006, 2025));
    expect(availableYears(data, 'expenditure')).toEqual(range(2005, 2025));
  });

  for (const flow of ['revenue', 'expenditure'] as const) {
    it(`${flow}: every year matches the workbook Total row (incl.) and Total minus Custodial (excl.)`, () => {
      const incl = buildSeries(data, full({ flow, includeCustodial: true }));
      const excl = buildSeries(data, full({ flow }));
      const rows = totals.filter((t) => t.flow === flow);
      expect(incl.map((p) => p.fiscalYear)).toEqual(rows.map((r) => r.fiscalYear).sort((a, b) => a - b));
      for (const r of rows) {
        const custodial = r.byFund['custodial'] ?? 0;
        expect(byYear(incl, r.fiscalYear).value).toBe(r.total);
        expect(byYear(excl, r.fiscalYear).value).toBe(r.total - custodial);
        expect(byYear(excl, r.fiscalYear).custodialNominal).toBe(custodial);
      }
    });

    it(`${flow}: per capita (incl. custodial) matches EDR's Per Capita column and population`, () => {
      const pts = buildSeries(data, full({ flow, includeCustodial: true, measure: 'per_capita' }));
      for (const r of totals.filter((t) => t.flow === flow)) {
        const p = byYear(pts, r.fiscalYear);
        expect(p.population).toBe(r.population);
        expect(p.value).toBeCloseTo(r.perCapita, 6);
      }
    });
  }

  it('real (CPI-U U.S., fiscal) is fully populated for both flows', () => {
    for (const flow of ['revenue', 'expenditure'] as const) {
      const pts = buildSeries(data, full({ flow, measure: 'real_per_capita' }));
      for (const p of pts) expect(Number.isFinite(p.value)).toBe(true);
    }
  });

  it('Tampa fiscal: null before FY 2017-18 with the published reason, values from FY 2017-18', () => {
    const pts = buildSeries(data, full({ measure: 'real', cpiIndex: 'cpi-u-tampa' }));
    for (const p of pts) {
      if (p.fiscalYear < 2018) {
        expect(p.value).toBeNull();
        const reason = data.cpi.tampa.fiscalYearUnavailable[String(p.fiscalYear)];
        expect(reason).toBeTruthy();
        expect(p.notes.some((n) => n.includes(reason))).toBe(true);
      } else expect(Number.isFinite(p.value)).toBe(true);
    }
  });

  it('Tampa calendar: values for every revenue year', () => {
    const pts = buildSeries(data, full({ measure: 'real', cpiIndex: 'cpi-u-tampa', cpiPeriod: 'calendar' }));
    expect(pts).toHaveLength(20);
    for (const p of pts) expect(Number.isFinite(p.value)).toBe(true);
  });

  it('every source id on a point resolves to sources.json', () => {
    const ids = new Set(data.sources.map((s) => s.id));
    for (const measure of ['real_per_capita'] as const)
      for (const cpiIndex of ['cpi-u-us', 'cpi-u-tampa'] as const)
        for (const cpiPeriod of ['fiscal', 'calendar'] as const)
          for (const p of buildSeries(data, full({ measure, cpiIndex, cpiPeriod, indexTo100: true })))
            for (const id of p.sourceIds) expect(ids.has(id)).toBe(true);
    for (const a of data.annotations) expect(ids.has(a.sourceId)).toBe(true);
  });

  it('GASB 84 annotation is at FY 2020-21', () => {
    const a = annotationsInRange(data, full());
    expect(a).toContainEqual(
      expect.objectContaining({
        fiscalYear: 2021,
        label: expect.stringMatching(/^Custodial fund reporting begins \(GASB 84\)/),
        kind: 'methodology',
      }),
    );
  });
});
