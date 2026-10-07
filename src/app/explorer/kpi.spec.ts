import { AfrObservation, CpiFile, PopulationFile } from '../core/models';
import { DEFAULT_SETTINGS, SeriesPoint, TransformData, TransformSettings, buildSeries } from '../core/transform';
import { kpiCards, measureCaption } from './kpi';

const pt = (fiscalYear: number, value: number | null, custodialNominal = 0): SeriesPoint => ({
  fiscalYear,
  label: `FY ${fiscalYear - 1}-${String(fiscalYear % 100).padStart(2, '0')}`,
  value,
  nominal: value ?? 0,
  custodialNominal,
  transfersNominal: 0,
  sourceIds: [],
  notes: [],
});

const s = (patch: Partial<TransformSettings> = {}): TransformSettings => ({
  ...DEFAULT_SETTINGS,
  range: [2020, 2025],
  ...patch,
});

const byId = (cards: ReturnType<typeof kpiCards>) => Object.fromEntries(cards.map((c) => [c.id, c]));

describe('kpiCards (neutral summary of the selected range)', () => {
  it('shows the end and start values of the selected range and the change between them', () => {
    const cards = byId(
      kpiCards([pt(2020, 3_862_000_000), pt(2022, 4_000_000_000), pt(2025, 5_470_000_000, 4_130_000_000)], s()),
    );
    expect(cards['end']).toMatchObject({ label: 'Revenues · FY 2024-25', value: '$5.47B', sub: 'Nominal dollars' });
    expect(cards['start']).toMatchObject({ label: 'Revenues · FY 2019-20', value: '$3.86B' });
    expect(cards['change']).toMatchObject({ value: '+41.6%', sub: 'FY 2019-20 → FY 2024-25 · +$1.61B' });
    expect(cards['custodial']).toMatchObject({ value: '$4.13B', sub: 'Nominal; excluded from totals', accent: 'neutral' });
  });

  it('uses only the years the user selected (no other comparison year)', () => {
    const cards = byId(kpiCards([pt(2022, 100), pt(2023, 50), pt(2024, 110)], s({ range: [2022, 2024] })));
    expect(cards['change'].sub.startsWith('FY 2021-22 → FY 2023-24')).toBe(true);
    expect(cards['change'].value).toBe('+10.0%');
  });

  it('uses neutral wording: signed numbers, no good/bad words or up/down arrows', () => {
    const cards = kpiCards([pt(2020, 200), pt(2025, 150)], s());
    const text = cards.map((c) => `${c.label} ${c.value} ${c.sub}`).join(' ');
    expect(byId(cards)['change'].value).toBe('-25.0%');
    expect(text).not.toMatch(/[↑↓▲▼]|increase|decrease|growth|decline|better|worse|\bup\b|\bdown\b/i);
  });

  it('does not compute a change across a gap or a zero start', () => {
    expect(byId(kpiCards([pt(2020, null), pt(2025, 5)], s()))['change']).toMatchObject({ value: '—' });
    expect(byId(kpiCards([pt(2020, 0), pt(2025, 5)], s()))['change'].sub).toContain('not computable');
    expect(byId(kpiCards([pt(2025, 5)], s()))['change'].sub).toBe('Select more than one year');
  });

  it('shows compact totals with two decimals, even when round', () => {
    expect(byId(kpiCards([pt(2020, 1), pt(2025, 3_000_000_000)], s()))['end'].value).toBe('$3.00B');
  });

  it('formats per-resident and index values in their own units', () => {
    const per = byId(kpiCards([pt(2020, 3000), pt(2025, 3470.55)], s({ measure: 'real_per_capita' })));
    expect(per['end'].value).toBe('$3,470.55');
    expect(per['end'].sub).toBe('Per resident, FY 2024-25 dollars');
    expect(per['change'].sub).toContain('+$470.55');
    const idx = byId(kpiCards([pt(2020, 100), pt(2025, 141.6)], s({ indexTo100: true, baseYear: 2020 })));
    expect(idx['end'].value).toBe('141.6');
    expect(idx['end'].sub).toBe('Index, FY 2019-20 = 100 · Nominal dollars');
  });

  it('labels custodial as not reported before FY 2020-21, and as included when included', () => {
    expect(byId(kpiCards([pt(2010, 1), pt(2019, 2)], s()))['custodial'].sub).toBe('Not reported before FY 2020-21');
    expect(byId(kpiCards([pt(2020, 1), pt(2025, 2, 9)], s({ includeCustodial: true })))['custodial'].sub).toBe(
      'Nominal; included in totals',
    );
  });

  it('KPI values equal transform.ts outputs for the current settings', () => {
    // Revenue 1,000 (FY 2020-21) and 1,500 (FY 2024-25); population 10 and 12; CPI 200 and 250.
    const obs = (fiscalYear: number, amount: number, fundType = 'general'): AfrObservation => ({
      account: '311', amount, category: 'ad_valorem', fiscalYear, flow: 'revenue', fundType,
      jurisdiction: 'hillsborough', ref: `${fiscalYear}!D6`, section: 'taxes', sourceId: 'afr-rev',
    });
    const series = (fy: Record<string, number>) => ({
      sourceId: 'cpi', fiscalYear: fy, calendarYear: fy, fiscalYearUnavailable: {}, calendarYearUnavailable: {},
    });
    const data: TransformData = {
      observations: [obs(2021, 1000), obs(2025, 1500), obs(2025, 400, 'custodial')],
      population: {
        hillsborough: { byYear: { 2021: { value: 10, basis: 'x', sheet: 'x' }, 2025: { value: 12, basis: 'x', sheet: 'x' } }, sourceId: 'pop' },
      } as unknown as PopulationFile,
      cpi: { national: series({ 2021: 200, 2025: 250 }), tampa: series({}), tampa_semiannual: series({}) } as unknown as CpiFile,
      annotations: [],
      sources: [],
    };

    for (const settings of [
      s({ range: [2021, 2025], baseYear: 2025 }),
      s({ range: [2021, 2025], baseYear: 2025, measure: 'real_per_capita' }),
      s({ range: [2021, 2025], baseYear: 2021, measure: 'per_capita', indexTo100: true }),
    ]) {
      const points = buildSeries(data, settings);
      const cards = byId(kpiCards(points, settings));
      const first = points[0].value!;
      const last = points[points.length - 1].value!;
      expect(cards['end'].raw).toBe(last);
      expect(cards['start'].raw).toBe(first);
      expect(cards['change'].raw).toBeCloseTo((last - first) / Math.abs(first), 12);
      expect(cards['custodial'].raw).toBe(points[points.length - 1].custodialNominal);
    }

    // Hand-computed, real per resident in FY 2024-25 dollars: 1000/10 * 250/200 = 125; 1500/12 = 125.
    const real = byId(kpiCards(buildSeries(data, s({ range: [2021, 2025], measure: 'real_per_capita' })), s()));
    expect(real['start'].raw).toBeCloseTo(125, 10);
    expect(real['end'].raw).toBeCloseTo(125, 10);
    expect(real['change'].raw).toBeCloseTo(0, 10);
    expect(real['custodial'].raw).toBe(400);
  });

  it('describes each measure', () => {
    expect(measureCaption(s({ measure: 'per_capita' }))).toBe('Per resident, nominal dollars');
    expect(measureCaption(s({ measure: 'real' }))).toBe('FY 2024-25 dollars');
  });
});
