/// <reference types="node" />
import { readFileSync } from 'node:fs';
import type {
  AfrObservation,
  Annotation,
  AnnotationRecord,
  CategoryDef,
  CpiFile,
  CpiSeriesFile,
  PopulationFile,
  SourceRecord,
  WorkbookTotal,
} from './models';
import {
  annotationsInRange,
  availableCategories,
  availableFunds,
  availableJurisdictions,
  buildCategorySeries,
  type ChartView,
  FUND_ORDER,
  NET_TRANSFERS_REJECTED_NOTE,
  pointBreakdown,
  netTransfersAllowed,
  availableYears,
  buildSeries,
  DEFAULT_SETTINGS,
  settingsWithDefaults,
  type SettingsDefaults,
  defaultSettingsFor,
  fiscalYearLabel,
  formatUsd,
  isTransferAccount,
  isTransferImbalanceNote,
  TRANSFER_IMBALANCE_NOTE_PREFIX,
  TRANSFER_ACCOUNTS,
  TRANSFER_IMBALANCE_THRESHOLD,
  selectCpi,
  type SeriesPoint,
  type TransformData,
  type TransformSettings,
} from './transform';


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
  calendarYearNotes?: Record<string, string>,
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
    ...(calendarYearNotes ? { calendarYearNotes } : {}),
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
      {},
      { '2021': 'published as is' },
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
    jurisdiction: 'hillsborough',
    ...over,
  };
}

function values(points: SeriesPoint[]): (number | null)[] {
  return points.map((p) => p.value);
}

function byYear<P extends SeriesPoint>(points: P[], fy: number): P {
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
    expect('jurisdiction' in DEFAULT_SETTINGS).toBe(false);
  });

  it('is frozen, including the range tuple', () => {
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SETTINGS.range)).toBe(true);
  });
});

describe('settingsWithDefaults', () => {
  it('adds the jurisdiction and applies overrides to a fresh copy', () => {
    const s = settingsWithDefaults('pasco', { measure: 'real', range: [2010, 2012] });
    expect(s).toEqual({ ...DEFAULT_SETTINGS, measure: 'real', range: [2010, 2012], jurisdiction: 'pasco' });
    const t = settingsWithDefaults('pasco');
    expect(t).toEqual({ ...DEFAULT_SETTINGS, jurisdiction: 'pasco' });
    expect(t.range).not.toBe(DEFAULT_SETTINGS.range);
    t.range[0] = 1;
    expect(DEFAULT_SETTINGS.range[0]).toBe(2005);
  });

  it('the jurisdiction argument wins over an override', () => {
    const over = { jurisdiction: 'other' } as Partial<SettingsDefaults>;
    expect(settingsWithDefaults('pasco', over).jurisdiction).toBe('pasco');
  });
});

describe('defaultSettingsFor', () => {
  it("uses the jurisdiction's full available range and latest year as base", () => {
    const d = fixture();
    expect(defaultSettingsFor(d, 'revenue', 'hillsborough')).toEqual({
      ...DEFAULT_SETTINGS,
      range: [2019, 2022],
      baseYear: 2022,
      jurisdiction: 'hillsborough',
    });
    expect(defaultSettingsFor(d, 'expenditure', 'hillsborough')).toMatchObject({
      flow: 'expenditure',
      range: [2018, 2019],
      baseYear: 2019,
    });
    expect(defaultSettingsFor(d, 'revenue', 'pasco')).toMatchObject({ range: [2019, 2019], baseYear: 2019, jurisdiction: 'pasco' });
  });

  it('falls back to DEFAULT_SETTINGS when there is no data, with a mutable copy of the range', () => {
    const s = defaultSettingsFor({ ...fixture(), observations: [] }, 'expenditure', 'pasco');
    expect(s).toEqual({ ...DEFAULT_SETTINGS, flow: 'expenditure', jurisdiction: 'pasco' });
    expect(Object.isFrozen(s.range)).toBe(false);
    expect(s.range).not.toBe(DEFAULT_SETTINGS.range);
  });
});

describe('availableYears', () => {
  it('returns sorted unique years per flow and jurisdiction', () => {
    const d = fixture();
    expect(availableYears(d, 'revenue', 'hillsborough')).toEqual([2019, 2020, 2021, 2022]);
    expect(availableYears(d, 'expenditure', 'hillsborough')).toEqual([2018, 2019]);
    expect(availableYears(d, 'revenue', 'pasco')).toEqual([2019]);
    expect(availableYears(d, 'revenue', 'nowhere')).toEqual([]);
  });

  it('sorts numerically regardless of input order', () => {
    const d = { ...fixture(), observations: [obs(2010, 'general', 1), obs(2009, 'general', 1), obs(2100, 'general', 1)] };
    expect(availableYears(d, 'revenue', 'hillsborough')).toEqual([2009, 2010, 2100]);
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

  it('noteFor returns the year note as a sentence, or undefined', () => {
    const d = fixture();
    expect(selectCpi(d.cpi, 'cpi-u-us', 'calendar').noteFor(2021)).toBe(
      'CPI-U, U.S. city average, calendar-year annual average for calendar year 2021: published as is.',
    );
    expect(selectCpi(d.cpi, 'cpi-u-us', 'calendar').noteFor(2020)).toBeUndefined();
    expect(selectCpi(d.cpi, 'cpi-u-us', 'fiscal').noteFor(2021)).toBeUndefined();
    d.cpi.tampa.fiscalYearNotes = { '2021': 'x' };
    expect(selectCpi(d.cpi, 'cpi-u-tampa', 'fiscal').noteFor(2021)).toBe(
      'CPI-U, Tampa-St. Petersburg-Clearwater, fiscal-year (Oct-Sep) average for FY 2020-21: x.',
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

  it('sums only the selected jurisdiction', () => {
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

  it('a CPI year note is added for the year and for the base year, once', () => {
    const note = 'CPI-U, U.S. city average, calendar-year annual average for calendar year 2021: published as is.';
    const pts = buildSeries(fixture(), settings({ measure: 'real', baseYear: 2021, cpiPeriod: 'calendar' }));
    expect(byYear(pts, 2019).notes).toEqual([note]);
    expect(byYear(pts, 2021).notes).toEqual([note]);
    const other = buildSeries(fixture(), settings({ measure: 'real', baseYear: 2022, cpiPeriod: 'calendar' }));
    expect(byYear(other, 2019).notes).toEqual([]);
    expect(byYear(other, 2021).notes).toEqual([note]);
    // Fiscal period has no notes in the fixture; nominal never shows CPI notes.
    expect(byYear(buildSeries(fixture(), settings({ measure: 'real', baseYear: 2021 })), 2019).notes).toEqual([]);
    expect(byYear(buildSeries(fixture(), settings({ cpiPeriod: 'calendar' })), 2021).notes).toEqual([]);
  });

  it('no CPI year note for a missing value (the unavailable reason is used instead)', () => {
    const d = fixture();
    d.cpi.national.calendarYearNotes = { '2017': 'should not appear' };
    const pts = buildSeries(d, settings({ measure: 'real', baseYear: 2017, cpiPeriod: 'calendar' }));
    for (const p of pts) expect(p.notes.join(' ')).not.toContain('should not appear');
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
    expect(() => availableYears(d, 'revenue', 'hillsborough')).not.toThrow();
    expect(() => defaultSettingsFor(d, 'revenue', 'hillsborough')).not.toThrow();
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

  it('works with frozen DEFAULT_SETTINGS spread in', () => {
    expect(() => buildSeries(fixture(), { ...DEFAULT_SETTINGS, jurisdiction: 'hillsborough' })).not.toThrow();
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

  it('transferImbalance = 581 - 381 in non-custodial funds, only for years with both flows', () => {
    const d = transferFixture();
    const rev = buildSeries(d, settings());
    expect(byYear(rev, 2019).transferImbalance).toBe(0);
    expect(byYear(rev, 2020).transferImbalance).toBe(480);
    expect(byYear(rev, 2021).transferImbalance).toBeUndefined();
    const exp = buildSeries(d, settings({ flow: 'expenditure' }));
    expect(byYear(exp, 2018).transferImbalance).toBeUndefined();
    expect(byYear(exp, 2020).transferImbalance).toBe(480);
    // Custodial transfers (7 out, 3 in) never count, whatever the toggle.
    expect(byYear(buildSeries(d, settings({ includeCustodial: true })), 2020).transferImbalance).toBe(480);
  });

  const M = 1_000_000;
  /** 2019: imbalance $0.5M (under threshold). 2020: $480M out > in. 2021: revenue only. */
  function imbalanceFixture(): TransformData {
    return {
      ...fixture(),
      observations: [
        tobs(2019, 'revenue', '381', 'general', 10 * M),
        tobs(2019, 'expenditure', '581', 'general', 10.5 * M),
        obs(2020, 'general', 1000 * M),
        tobs(2020, 'revenue', '381', 'general', 100 * M),
        tobs(2020, 'revenue', '381.1', 'enterprise', 20 * M),
        tobs(2020, 'revenue', '381', 'custodial', 3 * M),
        obs(2020, 'general', 800 * M, 'expenditure'),
        tobs(2020, 'expenditure', '581', 'general', 600 * M),
        tobs(2020, 'expenditure', '581', 'custodial', 7 * M),
        tobs(2021, 'revenue', '381', 'general', 40 * M),
      ],
    };
  }

  it("an imbalance over the threshold is noted on both flows in both modes, citing the other flow's source", () => {
    const d = imbalanceFixture();
    const gross =
      'Transfers out (581) and transfers in (381) differ in FY 2019-20: $600,000,000 out, $120,000,000 in (difference $480,000,000).';
    const net = gross + ' Removing transfers reduces revenue and expenditure by different amounts.';
    const cust = 'Custodial fund amounts (GASB 84) are excluded.';
    const rg = byYear(buildSeries(d, settings()), 2020);
    expect(rg.notes).toEqual([cust, gross]);
    expect(rg.sourceIds).toEqual([REV, EXP]);
    const rn = byYear(buildSeries(d, settings({ transfers: 'net' })), 2020);
    expect(rn.notes).toEqual([cust, 'Interfund transfers (account 381, $120,000,000) are excluded.', net]);
    const en = byYear(buildSeries(d, settings({ flow: 'expenditure', transfers: 'net' })), 2020);
    expect(en.notes).toEqual([cust, 'Interfund transfers (account 581, $600,000,000) are excluded.', net]);
    expect(en.sourceIds).toEqual([EXP, REV]);
  });

  it('with custodial included, the note keeps the non-custodial figures and says so', () => {
    const p = byYear(buildSeries(imbalanceFixture(), settings({ includeCustodial: true })), 2020);
    expect(p.transfersNominal).toBe(123 * M);
    expect(p.notes.filter(isTransferImbalanceNote)).toEqual([
      'Transfers out (581) and transfers in (381) differ in FY 2019-20: $600,000,000 out, $120,000,000 in (difference $480,000,000, custodial funds excluded).',
    ]);
  });

  it('isTransferImbalanceNote recognises exactly the imbalance note', () => {
    const d = imbalanceFixture();
    for (const transfers of ['gross', 'net'] as const) {
      const notes = byYear(buildSeries(d, settings({ transfers, includeCustodial: true })), 2020).notes;
      expect(notes.filter(isTransferImbalanceNote)).toHaveLength(1);
      expect(notes.filter((n) => !isTransferImbalanceNote(n)).length).toBeGreaterThan(0);
    }
    expect(TRANSFER_IMBALANCE_NOTE_PREFIX).toBe('Transfers out (581) and transfers in (381) differ in ');
    expect(isTransferImbalanceNote('Interfund transfers (account 381, $1) are excluded.')).toBe(false);
  });

  it('a balanced year, or one under the threshold, has no imbalance note and no extra source', () => {
    const p = byYear(buildSeries(transferFixture(), settings()), 2019);
    expect(p.notes).toEqual([]);
    expect(p.sourceIds).toEqual([REV]);
    const q = byYear(buildSeries(imbalanceFixture(), settings()), 2019);
    expect(q.transferImbalance).toBe(0.5 * M);
    expect(q.notes).toEqual([]);
    expect(q.sourceIds).toEqual([REV]);
  });

  it('threshold is the pipeline rule: |581 - 381| > $1,000,000 (strictly greater)', () => {
    expect(TRANSFER_IMBALANCE_THRESHOLD).toBe(1_000_000);
    const mk = (out: number): TransformData => ({
      ...fixture(),
      observations: [tobs(2019, 'revenue', '381', 'general', 5 * M), tobs(2019, 'expenditure', '581', 'general', out)],
    });
    const notes = (out: number) => buildSeries(mk(out), settings())[0].notes;
    expect(notes(5 * M + TRANSFER_IMBALANCE_THRESHOLD)).toEqual([]);
    expect(notes(5 * M - TRANSFER_IMBALANCE_THRESHOLD)).toEqual([]);
    expect(notes(5 * M + TRANSFER_IMBALANCE_THRESHOLD + 1)).toHaveLength(1);
    expect(notes(5 * M - TRANSFER_IMBALANCE_THRESHOLD - 1)).toHaveLength(1);
    // Pinellas FY 2022-23: $369,300 is not noted.
    expect(notes(5 * M + 369_300)).toEqual([]);
  });

  it('a negative imbalance (381 > 581) is noted too', () => {
    const d: TransformData = {
      ...fixture(),
      observations: [tobs(2019, 'revenue', '381', 'general', 5 * M), tobs(2019, 'expenditure', '581', 'general', 1 * M)],
    };
    expect(buildSeries(d, settings())[0].notes).toEqual([
      'Transfers out (581) and transfers in (381) differ in FY 2018-19: $1,000,000 out, $5,000,000 in (difference -$4,000,000).',
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

  it('filters on jurisdiction; absent jurisdiction applies everywhere', () => {
    const d: TransformData = {
      ...fixture(),
      annotations: [ann('everywhere'), ann('hills', { jurisdiction: 'hillsborough' }), ann('pasco', { jurisdiction: 'pasco' })],
    };
    expect(annotationsInRange(d, settings()).map((a) => a.label)).toEqual(['everywhere', 'hills']);
    expect(annotationsInRange(d, settings({ jurisdiction: 'pasco' })).map((a) => a.label)).toEqual(['everywhere', 'pasco']);
  });

  it('passes detail and refs through unchanged', () => {
    const a = ann('x', { detail: 'longer text', refs: ['2023!D16'] });
    expect(annotationsInRange({ ...fixture(), annotations: [a] }, settings())).toEqual([a]);
  });

  it('plain CLAUDE.md Annotations (no conditions) always apply', () => {
    const plain: Annotation = { fiscalYear: 2022, label: 'plain', kind: 'event', sourceId: 's' };
    for (const s of [settings(), settings({ flow: 'expenditure', includeCustodial: true, measure: 'real' })]) {
      expect(annotationsInRange({ ...fixture(), annotations: [plain] }, s)).toEqual([plain]);
    }
  });
});

// ---------------------------------------------------------------------------
// Golden tests against the real pipeline output (src/assets/data), for every
// jurisdiction listed in manifest.json. Files are read from disk so a newly
// added county is covered without editing this spec.
// ---------------------------------------------------------------------------

const DATA_DIR = 'src/assets/data';
const readJson = <T>(file: string): T => JSON.parse(readFileSync(`${DATA_DIR}/${file}`, 'utf8')) as T;
const JURISDICTIONS = readJson<{ jurisdictions: string[] }>('manifest.json').jurisdictions;
const realData: TransformData = {
  observations: JURISDICTIONS.flatMap((j) => readJson<AfrObservation[]>(`${j}.observations.json`)),
  population: readJson<PopulationFile>('population.json'),
  cpi: readJson<CpiFile>('cpi.json'),
  annotations: readJson<AnnotationRecord[]>('annotations.json'),
  sources: readJson<SourceRecord[]>('sources.json'),
};
const goldenFull = (over: Partial<TransformSettings> = {}) => settings({ range: [1900, 2100], baseYear: 2025, ...over });

describe('golden: manifest', () => {
  it('lists at least one jurisdiction, each with observations', () => {
    expect(JURISDICTIONS.length).toBeGreaterThan(0);
    expect(availableJurisdictions(realData)).toEqual([...JURISDICTIONS].sort());
  });

  it('defaultJurisdiction is one of the listed jurisdictions', () => {
    const { defaultJurisdiction } = readJson<{ defaultJurisdiction: string }>('manifest.json');
    expect(JURISDICTIONS).toContain(defaultJurisdiction);
  });
});

describe.each(JURISDICTIONS)('golden: %s', (jurisdiction) => {
  const data = realData;
  const totals = readJson<WorkbookTotal[]>(`${jurisdiction}.workbook-totals.json`);
  const full = (over: Partial<TransformSettings> = {}) => goldenFull({ jurisdiction, ...over });
  const flows = ['revenue', 'expenditure'] as const;
  const ownOrStatewide = (a: AnnotationRecord) => a.jurisdiction === undefined || a.jurisdiction === jurisdiction;

  it('available years are exactly the workbook sheets, with no gaps', () => {
    for (const flow of flows) {
      const years = totals.filter((t) => t.flow === flow).map((t) => t.fiscalYear).sort((a, b) => a - b);
      expect(years.length).toBeGreaterThan(0);
      expect(availableYears(data, flow, jurisdiction)).toEqual(years);
      expect(years[years.length - 1] - years[0] + 1).toBe(years.length);
    }
  });

  it("defaultSettingsFor spans the jurisdiction's years", () => {
    for (const flow of flows) {
      const years = availableYears(data, flow, jurisdiction);
      expect(defaultSettingsFor(data, flow, jurisdiction)).toMatchObject({
        flow,
        jurisdiction,
        range: [years[0], years[years.length - 1]],
        baseYear: years[years.length - 1],
      });
    }
  });

  for (const flow of flows) {
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

    it(`${flow}: per capita matches EDR's Per Capita column and population`, () => {
      const pts = buildSeries(data, full({ flow, includeCustodial: true, measure: 'per_capita' }));
      for (const r of totals.filter((t) => t.flow === flow)) {
        const p = byYear(pts, r.fiscalYear);
        expect(p.population).toBe(r.population);
        expect(p.value).toBeCloseTo(r.perCapita, 6);
        expect(p.sourceIds).toContain(data.population[jurisdiction].sourceId);
      }
    });

    it(`${flow}: gross = net + transfers for every year`, () => {
      const g = buildSeries(data, full({ flow }));
      const n = buildSeries(data, full({ flow, transfers: 'net' }));
      g.forEach((p, i) => expect(p.nominal).toBe(n[i].nominal + n[i].transfersNominal));
    });
  }

  it('real per capita (CPI-U U.S., fiscal) is fully populated for both flows', () => {
    for (const flow of flows) {
      for (const p of buildSeries(data, full({ flow, measure: 'real_per_capita' }))) {
        expect(Number.isFinite(p.value)).toBe(true);
      }
    }
  });

  it('Tampa: fiscal is null before FY 2017-18 with the published reason; calendar covers every year', () => {
    for (const p of buildSeries(data, full({ measure: 'real', cpiIndex: 'cpi-u-tampa' }))) {
      if (p.fiscalYear < 2018) {
        expect(p.value).toBeNull();
        const reason = data.cpi.tampa.fiscalYearUnavailable[String(p.fiscalYear)];
        expect(reason).toBeTruthy();
        expect(p.notes.some((n) => n.includes(reason))).toBe(true);
      } else expect(Number.isFinite(p.value)).toBe(true);
    }
    const cal = buildSeries(data, full({ measure: 'real', cpiIndex: 'cpi-u-tampa', cpiPeriod: 'calendar' }));
    expect(cal).toHaveLength(availableYears(data, 'revenue', jurisdiction).length);
    for (const p of cal) expect(Number.isFinite(p.value)).toBe(true);
  });

  it("every source id on a point resolves to sources.json, and no other county's AFR source appears", () => {
    const ids = new Set(data.sources.map((s) => s.id));
    const ownAfr = new Set(data.observations.filter((o) => o.jurisdiction === jurisdiction).map((o) => o.sourceId));
    const otherAfr = new Set(
      data.observations.filter((o) => o.jurisdiction !== jurisdiction && !ownAfr.has(o.sourceId)).map((o) => o.sourceId),
    );
    for (const flow of flows)
      for (const cpiIndex of ['cpi-u-us', 'cpi-u-tampa'] as const)
        for (const cpiPeriod of ['fiscal', 'calendar'] as const)
          for (const p of buildSeries(data, full({ flow, measure: 'real_per_capita', cpiIndex, cpiPeriod, indexTo100: true }))) {
            for (const id of p.sourceIds) {
              expect(ids.has(id)).toBe(true);
              expect(otherAfr.has(id)).toBe(false);
            }
          }
    for (const a of data.annotations) expect(ids.has(a.sourceId)).toBe(true);
  });

  it("transfer-imbalance notes fall in exactly the years of the pipeline's transfer-imbalance annotations", () => {
    const annotated = data.annotations
      .filter((a) => a.jurisdiction === jurisdiction && a.label.startsWith('Transfers out (581)'))
      .map((a) => a.fiscalYear)
      .sort((a, b) => a - b);
    for (const flow of flows)
      for (const transfers of ['gross', 'net'] as const)
        for (const includeCustodial of [false, true]) {
          const noted = buildSeries(data, full({ flow, transfers, includeCustodial }))
            .filter((p) => p.notes.some(isTransferImbalanceNote))
            .map((p) => p.fiscalYear);
          expect(noted).toEqual(annotated);
        }
  });

  it('annotations: rows for other jurisdictions never appear; every own or statewide row is reachable', () => {
    const seen = new Set<AnnotationRecord>();
    for (const flow of flows)
      for (const includeCustodial of [false, true])
        for (const measure of ['nominal', 'per_capita', 'real', 'real_per_capita'] as const)
          for (const view of ['total', 'categories'] as const)
            for (const funds of [undefined, ...availableFunds(data, jurisdiction).map((f) => [f])])
              for (const a of annotationsInRange(data, full({ flow, includeCustodial, measure, funds }), view)) {
                expect(ownOrStatewide(a)).toBe(true);
                seen.add(a);
              }
    expect(seen.size).toBe(data.annotations.filter(ownOrStatewide).length);
  });

  it('annotations: default view has no custodial-only, per-resident or expenditure rows', () => {
    const def = annotationsInRange(data, full());
    expect(def.every((a) => a.custodial !== 'included' && a.measures === undefined && a.flow !== 'expenditure')).toBe(true);
    const perResident = data.annotations.filter((a) => ownOrStatewide(a) && a.measures?.includes('per_capita')).length;
    expect(annotationsInRange(data, full({ measure: 'per_capita' })).filter((a) => a.measures !== undefined)).toHaveLength(
      perResident,
    );
  });

  it('GASB 84 annotation shows at FY 2020-21 for both flows', () => {
    for (const flow of flows) {
      expect(annotationsInRange(data, full({ flow }))).toContainEqual(
        expect.objectContaining({
          fiscalYear: 2021,
          label: expect.stringMatching(/^Custodial fund reporting begins \(GASB 84\)/),
          kind: 'methodology',
        }),
      );
    }
  });
});

describe('golden: hillsborough pinned values', () => {
  const data = realData;
  const full = (over: Partial<TransformSettings> = {}) => goldenFull({ jurisdiction: 'hillsborough', ...over });

  it('FY 2024-25 revenue incl./excl. custodial, FY 2021-22 revenue excl.', () => {
    const incl = buildSeries(data, full({ includeCustodial: true }));
    const excl = buildSeries(data, full());
    expect(byYear(incl, 2025).value).toBe(9_597_307_134);
    expect(byYear(excl, 2025).value).toBe(5_468_332_134);
    expect(byYear(excl, 2022).value).toBe(3_583_795_000);
  });

  it('available years: revenue FY 2005-06..2024-25, expenditure FY 2004-05..2024-25', () => {
    const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
    expect(availableYears(data, 'revenue', 'hillsborough')).toEqual(range(2006, 2025));
    expect(availableYears(data, 'expenditure', 'hillsborough')).toEqual(range(2005, 2025));
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

  it('transfers: the FY 2022-23 / FY 2023-24 381-vs-581 imbalance is noted in every mode (QA-01)', () => {
    for (const flow of ['revenue', 'expenditure'] as const)
      for (const transfers of ['gross', 'net'] as const)
        for (const includeCustodial of [false, true]) {
          const pts = buildSeries(data, full({ flow, transfers, includeCustodial }));
          expect(byYear(pts, 2023).transferImbalance).toBe(624_603_841);
          expect(byYear(pts, 2024).transferImbalance).toBe(535_878_141);
          expect(byYear(pts, 2023).notes.some((t) => t.includes('difference $624,603,841'))).toBe(true);
          expect(byYear(pts, 2024).notes.some((t) => t.includes('difference $535,878,141'))).toBe(true);
          for (const fy of [2021, 2022, 2025]) {
            expect(Math.abs(byYear(pts, fy).transferImbalance!)).toBeLessThanOrEqual(2000);
            expect(byYear(pts, fy).notes.some(isTransferImbalanceNote)).toBe(false);
          }
        }
    // Default-view note text is unchanged from Phase 2.
    expect(byYear(buildSeries(data, full()), 2023).notes.filter(isTransferImbalanceNote)).toEqual([
      'Transfers out (581) and transfers in (381) differ in FY 2022-23: $1,160,934,246 out, $536,330,405 in (difference $624,603,841).',
    ]);
  });

  it('national calendar CPI for 2025 carries the published-as-is caveat', () => {
    const pts = buildSeries(data, full({ measure: 'real', cpiPeriod: 'calendar', baseYear: 2025 }));
    expect(Number.isFinite(byYear(pts, 2025).value)).toBe(true);
    expect(
      byYear(pts, 2025).notes.some((n) =>
        n.startsWith('CPI-U, U.S. city average, calendar-year annual average for calendar year 2025: '),
      ),
    ).toBe(true);
    expect(byYear(pts, 2010).notes.some((n) => n.includes('calendar year 2025'))).toBe(true);
  });
});

describe('golden: transfer-imbalance note years (pipeline rule, |581 - 381| > $1,000,000 non-custodial)', () => {
  const noted = (jurisdiction: string, over: Partial<TransformSettings> = {}) =>
    buildSeries(realData, goldenFull({ jurisdiction, flow: 'expenditure', ...over }));
  const modes = [
    {},
    { flow: 'revenue' as const },
    { transfers: 'net' as const },
    { includeCustodial: true },
  ];

  it('hillsborough: FY 2022-23 and FY 2023-24 only', () => {
    for (const m of modes) {
      const pts = noted('hillsborough', m);
      expect(pts.filter((p) => p.notes.some(isTransferImbalanceNote)).map((p) => p.fiscalYear)).toEqual([2023, 2024]);
    }
  });

  it.runIf(JURISDICTIONS.includes('pinellas'))('pinellas: FY 2005-06 and FY 2021-22; not FY 2022-23 ($369,300)', () => {
    for (const m of modes) {
      const pts = noted('pinellas', m);
      expect(pts.filter((p) => p.notes.some(isTransferImbalanceNote)).map((p) => p.fiscalYear)).toEqual([2006, 2022]);
      expect(byYear(pts, 2006).transferImbalance).toBe(283_213_259);
      expect(byYear(pts, 2022).transferImbalance).toBe(13_778_002);
      expect(byYear(pts, 2023).transferImbalance).toBe(369_300);
      for (const p of pts) {
        if (![2006, 2022, 2023].includes(p.fiscalYear) && p.transferImbalance !== undefined) {
          expect(p.transferImbalance).toBe(0);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 3: funds (D-18), categories (D-19), net-transfer guard (R-19 / O-11)
// ---------------------------------------------------------------------------

function cobs(
  fiscalYear: number,
  flow: 'revenue' | 'expenditure',
  account: string,
  category: string,
  fundType: string,
  amount: number,
): AfrObservation {
  return { ...obs(fiscalYear, fundType, amount, flow), account, category, section: category };
}

/**
 * Revenue: 2019 normal; 2020 a negative category; 2021 total 0; 2022 total < 0.
 * Expenditure: 2019 and 2020. One custodial row. Transfers (381/581) in other_sources/other_uses.
 */
function p3Fixture(): TransformData {
  return {
    ...fixture(),
    observations: [
      cobs(2019, 'revenue', '311', 'ad_valorem', 'general', 100),
      cobs(2019, 'revenue', '311', 'ad_valorem', 'special_revenue', 20),
      cobs(2019, 'revenue', '341', 'charges_for_services', 'enterprise', 50),
      cobs(2019, 'revenue', '381', 'other_sources', 'general', 30),
      cobs(2019, 'revenue', '311', 'ad_valorem', 'custodial', 1000),
      cobs(2020, 'revenue', '311', 'ad_valorem', 'general', 120),
      cobs(2020, 'revenue', '341', 'charges_for_services', 'enterprise', -10),
      cobs(2020, 'revenue', '381', 'other_sources', 'enterprise', 40),
      cobs(2021, 'revenue', '311', 'ad_valorem', 'general', 50),
      cobs(2021, 'revenue', '341', 'charges_for_services', 'enterprise', -50),
      cobs(2022, 'revenue', '311', 'ad_valorem', 'general', 10),
      cobs(2022, 'revenue', '341', 'charges_for_services', 'enterprise', -30),
      cobs(2019, 'expenditure', '513', 'general_government', 'general', 100),
      cobs(2019, 'expenditure', '581', 'other_uses', 'general', 30),
      cobs(2020, 'expenditure', '513', 'general_government', 'general', 90),
      cobs(2020, 'expenditure', '581', 'other_uses', 'enterprise', 40),
    ],
  };
}

const BIG = 1_000_000;

/** 2020: 581 out $600M vs 381 in $120M (imbalance $480M), transfers in other_sources / other_uses. */
function p3Imbalance(): TransformData {
  return {
    ...fixture(),
    observations: [
      cobs(2020, 'revenue', '311', 'ad_valorem', 'general', 1000 * BIG),
      cobs(2020, 'revenue', '381', 'other_sources', 'general', 100 * BIG),
      cobs(2020, 'revenue', '381', 'other_sources', 'enterprise', 20 * BIG),
      cobs(2020, 'expenditure', '513', 'general_government', 'general', 800 * BIG),
      cobs(2020, 'expenditure', '581', 'other_uses', 'general', 600 * BIG),
    ],
  };
}

const p3 = (over: Partial<TransformSettings> = {}) => settings({ range: [2019, 2022], baseYear: 2019, ...over });

describe('availableFunds / FUND_ORDER', () => {
  it('lists non-custodial funds with data, in AFR column order', () => {
    expect(availableFunds(p3Fixture(), 'hillsborough')).toEqual(['general', 'special_revenue', 'enterprise']);
    expect(availableFunds(p3Fixture(), 'nowhere')).toEqual([]);
  });

  it('puts unknown fund types after the known ones, by name', () => {
    const d = { ...p3Fixture(), observations: ['zeta', 'trust', 'alpha', 'general'].map((f) => obs(2019, f, 1)) };
    expect(availableFunds(d, 'hillsborough')).toEqual(['general', 'trust', 'alpha', 'zeta']);
    expect(FUND_ORDER).toContain('component_unit');
    expect(Object.isFrozen(FUND_ORDER)).toBe(true);
  });
});

describe('availableCategories', () => {
  it('orders categories by their lowest account code, per flow and jurisdiction', () => {
    const d = p3Fixture();
    expect(availableCategories(d, 'revenue', 'hillsborough')).toEqual(['ad_valorem', 'charges_for_services', 'other_sources']);
    expect(availableCategories(d, 'expenditure', 'hillsborough')).toEqual(['general_government', 'other_uses']);
    expect(availableCategories(d, 'revenue', 'nowhere')).toEqual([]);
  });

  it('follows data.categories order for listed ids; unlisted ones follow by account; other flows ignored', () => {
    const d: TransformData = {
      ...p3Fixture(),
      categories: [
        { id: 'other_sources', flow: 'revenue', label: 'Other sources' },
        { id: 'ad_valorem', flow: 'revenue', label: 'Ad valorem' },
        { id: 'charges_for_services', flow: 'expenditure', label: 'wrong flow' },
        { id: 'not_in_data', flow: 'revenue', label: 'x' },
      ],
    };
    expect(availableCategories(d, 'revenue', 'hillsborough')).toEqual(['other_sources', 'ad_valorem', 'charges_for_services']);
  });

  it('uses the minimum account per category, and names to break ties', () => {
    const d = {
      ...p3Fixture(),
      observations: [
        cobs(2019, 'revenue', '369.9', 'miscellaneous', 'general', 1),
        cobs(2019, 'revenue', '361.1', 'miscellaneous', 'general', 1),
        cobs(2019, 'revenue', '362', 'b_cat', 'general', 1),
        cobs(2019, 'revenue', '362', 'a_cat', 'general', 1),
      ],
    };
    expect(availableCategories(d, 'revenue', 'hillsborough')).toEqual(['miscellaneous', 'a_cat', 'b_cat']);
  });
});

describe('buildSeries: fund selection', () => {
  it('missing or empty selection = all non-custodial funds', () => {
    const all = [200, 150, 0, -20];
    expect(values(buildSeries(p3Fixture(), p3()))).toEqual(all);
    expect(values(buildSeries(p3Fixture(), p3({ funds: [] })))).toEqual(all);
  });

  it('sums only the selected funds; years without them are 0', () => {
    expect(values(buildSeries(p3Fixture(), p3({ funds: ['general'] })))).toEqual([130, 120, 50, 10]);
    expect(values(buildSeries(p3Fixture(), p3({ funds: ['enterprise'] })))).toEqual([50, 30, -50, -30]);
    expect(values(buildSeries(p3Fixture(), p3({ funds: ['special_revenue'] })))).toEqual([20, 0, 0, 0]);
    expect(values(buildSeries(p3Fixture(), p3({ funds: ['general', 'special_revenue'] })))).toEqual([150, 120, 50, 10]);
  });

  it('custodial follows includeCustodial only, whatever the fund list says', () => {
    expect(byYear(buildSeries(p3Fixture(), p3({ funds: ['enterprise'], includeCustodial: true })), 2019).value).toBe(1050);
    expect(byYear(buildSeries(p3Fixture(), p3({ funds: ['enterprise', 'custodial'] })), 2019).value).toBe(50);
    expect(byYear(buildSeries(p3Fixture(), p3({ funds: ['enterprise'] })), 2019).custodialNominal).toBe(1000);
  });

  it('the sum over single-fund series equals the all-funds series', () => {
    const d = p3Fixture();
    for (const flow of ['revenue', 'expenditure'] as const) {
      const all = buildSeries(d, p3({ flow }));
      const parts = availableFunds(d, 'hillsborough').map((f) => buildSeries(d, p3({ flow, funds: [f] })));
      all.forEach((p, i) => expect(parts.reduce((t, s) => t + s[i].nominal, 0)).toBe(p.nominal));
    }
  });
});

describe('netTransfersAllowed (R-19 / O-11)', () => {
  it('allows net with no fund filter, or a filter that covers every reported fund', () => {
    const d = p3Fixture();
    expect(netTransfersAllowed(d, p3())).toBe(true);
    expect(netTransfersAllowed(d, p3({ funds: [] }))).toBe(true);
    expect(netTransfersAllowed(d, p3({ funds: ['enterprise', 'special_revenue', 'general'] }))).toBe(true);
    expect(netTransfersAllowed(d, p3({ funds: ['general', 'special_revenue', 'enterprise', 'trust'] }))).toBe(true);
  });

  it('rejects net for a fund subset', () => {
    expect(netTransfersAllowed(p3Fixture(), p3({ funds: ['general'] }))).toBe(false);
    expect(netTransfersAllowed(p3Fixture(), p3({ funds: ['general', 'special_revenue', 'custodial'] }))).toBe(false);
  });

  it('a rejected net is computed as gross, with a note on every point', () => {
    const d = p3Fixture();
    const gross = buildSeries(d, p3({ funds: ['general'] }));
    const rejected = buildSeries(d, p3({ funds: ['general'], transfers: 'net' }));
    expect(values(rejected)).toEqual(values(gross));
    for (const p of rejected) {
      expect(p.notes).toContain(NET_TRANSFERS_REJECTED_NOTE);
      expect(p.notes.some((n) => n.startsWith('Interfund transfers'))).toBe(false);
    }
    expect(gross.every((p) => !p.notes.includes(NET_TRANSFERS_REJECTED_NOTE))).toBe(true);
  });

  it('an allowed net with an explicit full fund list equals net with no filter', () => {
    const d = p3Fixture();
    const a = buildSeries(d, p3({ transfers: 'net' }));
    const b = buildSeries(d, p3({ transfers: 'net', funds: availableFunds(d, 'hillsborough') }));
    expect(b).toEqual(a);
    expect(values(a)).toEqual([170, 110, 0, -20]);
  });
});

describe('buildCategorySeries', () => {
  const cats = (s: Partial<TransformSettings> = {}) => buildCategorySeries(p3Fixture(), p3(s));

  it('returns one series per category, in availableCategories order, over the same years', () => {
    const series = cats();
    expect(series.map((c) => c.category)).toEqual(['ad_valorem', 'charges_for_services', 'other_sources']);
    for (const c of series) expect(c.points.map((p) => p.fiscalYear)).toEqual([2019, 2020, 2021, 2022]);
    expect(series[0].points.map((p) => p.nominal)).toEqual([120, 120, 50, 10]);
    expect(series[1].points.map((p) => p.nominal)).toEqual([50, -10, -50, -30]);
    expect(series[2].points.map((p) => p.nominal)).toEqual([30, 40, 0, 0]);
  });

  it('limits to the category selection, keeping canonical order; empty = all; unknown ids ignored', () => {
    expect(cats({ categories: ['other_sources', 'ad_valorem', 'nope'] }).map((c) => c.category)).toEqual([
      'ad_valorem',
      'other_sources',
    ]);
    expect(cats({ categories: [] })).toHaveLength(3);
    expect(cats({ categories: ['nope'] })).toEqual([]);
  });

  it('shares are percent of the year total and sum to 100 when the total is positive', () => {
    const series = cats();
    const share = (i: number, fy: number) => byYear(series[i].points, fy).share;
    expect(share(0, 2019)).toBeCloseTo((120 / 200) * 100, 12);
    expect(share(1, 2020)).toBeCloseTo((-10 / 150) * 100, 12);
    for (const fy of [2019, 2020]) {
      expect(series.reduce((t, c) => t + byYear(c.points, fy).share!, 0)).toBeCloseTo(100, 9);
    }
  });

  it('share is null with a note when the total is zero or negative, never NaN', () => {
    for (const c of cats()) {
      for (const fy of [2021, 2022]) {
        const p = byYear(c.points, fy);
        expect(p.share).toBeNull();
      }
      expect(byYear(c.points, 2021).notes).toContain("Share can't be computed: the FY 2020-21 total is $0.");
      expect(byYear(c.points, 2022).notes).toContain("Share can't be computed: the FY 2021-22 total is -$20.");
    }
  });

  it('share is the same for every measure (nominal based); values follow the measure', () => {
    const nominal = cats();
    for (const measure of ['per_capita', 'real', 'real_per_capita'] as const) {
      const m = cats({ measure, baseYear: 2021 });
      m.forEach((c, i) => c.points.forEach((p, j) => expect(p.share).toBe(nominal[i].points[j].share)));
    }
    const pc = cats({ measure: 'per_capita' });
    expect(byYear(pc[0].points, 2019).value).toBe(12);
    expect(byYear(pc[0].points, 2019).population).toBe(10);
    expect(byYear(pc[0].points, 2022).value).toBeNull();
    const real = cats({ measure: 'real', baseYear: 2022 });
    expect(byYear(real[0].points, 2019).value).toBe((120 * 200) / 100);
  });

  it('indexTo100 indexes each category to its own base-year value', () => {
    const series = cats({ indexTo100: true, baseYear: 2019 });
    expect(series[0].points.map((p) => p.value)).toEqual([100, 100, (50 / 120) * 100, (10 / 120) * 100]);
    expect(series[1].points.map((p) => p.value)).toEqual([100, -20, -100, -60]);
    expect(series[2].points.map((p) => p.value)).toEqual([100, (40 / 30) * 100, 0, 0]);
    // A category whose base value is 0 can't be indexed.
    const zeroBase = cats({ indexTo100: true, baseYear: 2021 });
    expect(zeroBase[2].points.every((p) => p.value === null)).toBe(true);
    expect(zeroBase[2].points[0].notes).toContain("Index base FY 2020-21 is zero; an index can't be computed.");
  });

  it('respects funds, custodial and net transfers like buildSeries', () => {
    expect(cats({ funds: ['enterprise'] }).map((c) => byYear(c.points, 2019).nominal)).toEqual([0, 50, 0]);
    const incl = cats({ includeCustodial: true });
    expect(byYear(incl[0].points, 2019).nominal).toBe(1120);
    expect(byYear(incl[0].points, 2019).custodialNominal).toBe(1000);
    expect(byYear(incl[1].points, 2019).custodialNominal).toBe(0);
    const net = cats({ transfers: 'net' });
    expect(net[2].points.map((p) => p.nominal)).toEqual([0, 0, 0, 0]);
    expect(net[2].points.map((p) => p.transfersNominal)).toEqual([30, 40, 0, 0]);
    expect(byYear(net[2].points, 2019).notes).toContain('Interfund transfers (account 381, $30) are excluded.');
    const rejected = cats({ transfers: 'net', funds: ['general'] });
    expect(rejected[2].points.map((p) => p.nominal)).toEqual([30, 0, 0, 0]);
    expect(rejected.every((c) => c.points.every((p) => p.notes.includes(NET_TRANSFERS_REJECTED_NOTE)))).toBe(true);
  });

  it('invariant: category nominal sums to the total for every year, flow and fund selection', () => {
    const d = p3Fixture();
    const selections: (readonly string[] | undefined)[] = [undefined, [], ['general'], ['enterprise'], ['general', 'special_revenue']];
    for (const flow of ['revenue', 'expenditure'] as const)
      for (const funds of selections)
        for (const includeCustodial of [false, true])
          for (const transfers of ['gross', 'net'] as const) {
            const s = p3({ flow, funds, includeCustodial, transfers });
            const total = buildSeries(d, s);
            const series = buildCategorySeries(d, s);
            total.forEach((p, i) => expect(series.reduce((t, c) => t + c.points[i].nominal, 0)).toBe(p.nominal));
          }
  });

  it('the imbalance note goes on the total and on category points that carry transfers', () => {
    const d = p3Imbalance();
    const s = settings({ range: [2019, 2021] });
    const byCat = Object.fromEntries(buildCategorySeries(d, s).map((c) => [c.category, byYear(c.points, 2020)]));
    expect(byCat['other_sources'].notes.some(isTransferImbalanceNote)).toBe(true);
    expect(byCat['ad_valorem'].notes.some(isTransferImbalanceNote)).toBe(false);
    expect(byCat['ad_valorem'].transferImbalance).toBe(480 * BIG);
    expect(byCat['other_sources'].sourceIds).toEqual([REV, EXP]);
    expect(byYear(buildSeries(d, s), 2020).notes.some(isTransferImbalanceNote)).toBe(true);
  });

  it('the imbalance ignores the fund selection (pipeline rule: all non-custodial funds)', () => {
    const d = p3Imbalance();
    const p = byYear(buildSeries(d, settings({ funds: ['enterprise'] })), 2020);
    expect(p.transferImbalance).toBe(480 * BIG);
    expect(p.notes.some(isTransferImbalanceNote)).toBe(true);
  });

  it('does not mutate inputs and is deterministic', () => {
    const d = deepFreeze(p3Fixture());
    const s = deepFreeze(p3({ funds: ['general'], categories: ['ad_valorem'], transfers: 'net', measure: 'real', indexTo100: true }));
    expect(buildCategorySeries(d, s)).toEqual(buildCategorySeries(d, s));
    expect(() => netTransfersAllowed(d, s)).not.toThrow();
  });
});

describe('annotationsInRange: funds and categories (DR-47)', () => {
  const ann = (label: string, extra: Partial<AnnotationRecord> = {}): AnnotationRecord => ({
    fiscalYear: 2020,
    label,
    kind: 'methodology',
    sourceId: 's',
    ...extra,
  });
  const d = (): TransformData => ({
    ...p3Fixture(),
    annotations: [
      ann('plain'),
      ann('ci+is', { funds: ['component_unit', 'internal_service'] }),
      ann('gen+sr', { funds: ['general', 'special_revenue'] }),
      ann('single', { funds: ['enterprise'] }),
      ann('no-funds', { funds: [] }),
      ann('ad-valorem', { categories: ['ad_valorem'] }),
      ann('both', { funds: ['general', 'enterprise'], categories: ['charges_for_services'] }),
    ],
  });
  const labels = (s: Partial<TransformSettings>, view?: ChartView) =>
    annotationsInRange(d(), p3(s), view).map((a) => a.label);

  it('funds: shown only when the selection includes some but not all of the listed funds', () => {
    expect(labels({})).toEqual(['plain']);
    expect(labels({ funds: [] })).toEqual(['plain']);
    expect(labels({ funds: ['general'] })).toEqual(['gen+sr', 'plain']);
    expect(labels({ funds: ['general', 'special_revenue'] })).toEqual(['plain']);
    expect(labels({ funds: ['internal_service', 'capital'] })).toEqual(['ci+is', 'plain']);
    expect(labels({ funds: ['capital'] })).toEqual(['plain']);
    // A single listed fund can never be split; an empty list never applies.
    expect(labels({ funds: ['enterprise'] })).toEqual(['plain']);
  });

  it('categories: hidden in the total view; shown in a category view that shows one of them', () => {
    expect(labels({}, 'total')).toEqual(['plain']);
    expect(labels({}, 'categories')).toEqual(['ad-valorem', 'plain']);
    expect(labels({ categories: ['ad_valorem'] }, 'categories')).toEqual(['ad-valorem', 'plain']);
    expect(labels({ categories: ['charges_for_services'] }, 'categories')).toEqual(['plain']);
    expect(labels({ categories: ['charges_for_services'], funds: ['general'] }, 'categories')).toEqual(['both', 'gen+sr', 'plain']);
    expect(labels({ categories: ['charges_for_services'], funds: ['general', 'enterprise'] }, 'categories')).toEqual([
      'gen+sr',
      'plain',
    ]);
  });
});

describe('golden: funds and categories', () => {
  describe.each(JURISDICTIONS)('%s', (jurisdiction) => {
    const data = realData;
    const totals = readJson<WorkbookTotal[]>(`${jurisdiction}.workbook-totals.json`);
    const full = (over: Partial<TransformSettings> = {}) => goldenFull({ jurisdiction, ...over });
    const funds = availableFunds(data, jurisdiction);

    it('categories with data are all listed in categories.json, in its order', () => {
      const defs = readJson<CategoryDef[]>('categories.json');
      for (const flow of ['revenue', 'expenditure'] as const) {
        const listed = defs.filter((c) => c.flow === flow).map((c) => c.id);
        const got = availableCategories({ ...data, categories: defs }, flow, jurisdiction);
        expect(got.length).toBeGreaterThan(0);
        expect(got).toEqual(listed.filter((id) => got.includes(id)));
        // Without categories.json, the account-order fallback gives the same order.
        expect(availableCategories(data, flow, jurisdiction)).toEqual(got);
      }
    });

    it('FUND_ORDER matches funds.json order', () => {
      expect([...FUND_ORDER]).toEqual(readJson<{ funds: { id: string }[] }>('funds.json').funds.map((f) => f.id));
    });

    it('every non-custodial fund with data is a workbook fund column', () => {
      expect(funds.length).toBeGreaterThan(0);
      const columns = new Set(totals.flatMap((t) => Object.keys(t.byFund)));
      for (const f of funds) expect(columns.has(f)).toBe(true);
    });

    for (const flow of ['revenue', 'expenditure'] as const) {
      it(`${flow}: each single-fund series equals the workbook's per-fund total, every year`, () => {
        const rows = totals.filter((t) => t.flow === flow);
        const allFundTypes = [...new Set(rows.flatMap((r) => Object.keys(r.byFund)))].filter((f) => f !== 'custodial');
        for (const f of allFundTypes) {
          const pts = buildSeries(data, full({ flow, funds: [f] }));
          for (const r of rows) expect(byYear(pts, r.fiscalYear).value).toBe(r.byFund[f] ?? 0);
        }
      });

      it(`${flow}: the sum over funds equals Total minus Custodial`, () => {
        const parts = funds.map((f) => buildSeries(data, full({ flow, funds: [f] })));
        for (const r of totals.filter((t) => t.flow === flow)) {
          const sum = parts.reduce((t, s) => t + byYear(s, r.fiscalYear).nominal, 0);
          expect(sum).toBe(r.total - (r.byFund['custodial'] ?? 0));
        }
      });

      it(`${flow}: categories match an independent recomputation from observations`, () => {
        for (const includeCustodial of [false, true]) {
          const expected = new Map<string, number>();
          for (const o of data.observations) {
            if (o.jurisdiction !== jurisdiction || o.flow !== flow) continue;
            if (o.fundType === 'custodial' && !includeCustodial) continue;
            const k = `${o.category}|${o.fiscalYear}`;
            expected.set(k, (expected.get(k) ?? 0) + o.amount);
          }
          const series = buildCategorySeries(data, full({ flow, includeCustodial }));
          let checked = 0;
          for (const c of series)
            for (const p of c.points) {
              expect(p.nominal).toBe(expected.get(`${c.category}|${p.fiscalYear}`) ?? 0);
              checked++;
            }
          expect(checked).toBeGreaterThan(0);
          expect(new Set(series.map((c) => c.category))).toEqual(new Set([...expected.keys()].map((k) => k.split('|')[0])));
        }
      });

      it(`${flow}: category sums equal the total and shares sum to 100, for several fund selections`, () => {
        const selections: (readonly string[] | undefined)[] = [undefined, ...funds.map((f) => [f]), funds.slice(0, 2)];
        for (const sel of selections)
          for (const transfers of ['gross', 'net'] as const) {
            const s = full({ flow, funds: sel, transfers });
            const total = buildSeries(data, s);
            const series = buildCategorySeries(data, s);
            total.forEach((p, i) => {
              const sum = series.reduce((t, c) => t + c.points[i].nominal, 0);
              expect(Math.abs(sum - p.nominal)).toBeLessThan(1e-3);
              const shares = series.map((c) => c.points[i].share);
              if (p.nominal > 0) {
                expect(shares.reduce((t, x) => t! + x!, 0)!).toBeCloseTo(100, 6);
              } else {
                expect(shares.every((x) => x === null)).toBe(true);
              }
              for (const c of series) {
                const v = c.points[i].value;
                expect(v === null || Number.isFinite(v)).toBe(true);
              }
            });
          }
      });
    }
  });
});

describe('pointBreakdown', () => {
  const sum = (rows: AfrObservation[]) => rows.reduce((t, o) => t + o.amount, 0);

  it('returns the observations that sum to the point nominal, for any selection', () => {
    const d = p3Fixture();
    const selections: Partial<TransformSettings>[] = [
      {},
      { funds: ['general'] },
      { includeCustodial: true },
      { transfers: 'net' },
      { transfers: 'net', funds: ['general'] },
      { flow: 'expenditure', funds: ['enterprise'] },
    ];
    for (const over of selections) {
      const s = p3(over);
      for (const p of buildSeries(d, s)) expect(sum(pointBreakdown(d, s, p.fiscalYear))).toBe(p.nominal);
      for (const c of buildCategorySeries(d, s))
        for (const p of c.points) expect(sum(pointBreakdown(d, s, p.fiscalYear, c.category))).toBe(p.nominal);
    }
  });

  it('keeps input order and returns the original observation objects', () => {
    const d = p3Fixture();
    const rows = pointBreakdown(d, p3({ includeCustodial: true }), 2019);
    expect(rows.map((o) => `${o.account}/${o.fundType}`)).toEqual([
      '311/general',
      '311/special_revenue',
      '341/enterprise',
      '381/general',
      '311/custodial',
    ]);
    expect(rows[0]).toBe(d.observations[0]);
  });

  it('drops transfers only when net is allowed; empty for a year or category without rows', () => {
    const d = p3Fixture();
    expect(pointBreakdown(d, p3({ transfers: 'net' }), 2019).some((o) => o.account === '381')).toBe(false);
    expect(pointBreakdown(d, p3({ transfers: 'net', funds: ['general'] }), 2019).some((o) => o.account === '381')).toBe(true);
    expect(pointBreakdown(d, p3(), 1990)).toEqual([]);
    expect(pointBreakdown(d, p3(), 2019, 'nope')).toEqual([]);
  });
});

describe('golden: pointBreakdown', () => {
  it.each(JURISDICTIONS)('%s: sums to every point of the total, both flows', (jurisdiction) => {
    for (const flow of ['revenue', 'expenditure'] as const) {
      const s = goldenFull({ jurisdiction, flow });
      for (const p of buildSeries(realData, s)) {
        expect(pointBreakdown(realData, s, p.fiscalYear).reduce((t, o) => t + o.amount, 0)).toBe(p.nominal);
      }
    }
  });
});
