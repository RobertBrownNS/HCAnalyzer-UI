import { describe, expect, it } from 'vitest';
import { averageOf, CPI_SERIES, fiscalYearAverage, parseBlsResponses, type BlsResponse } from '../src/bls/cpi.js';

const national = CPI_SERIES.find((s) => s.key === 'national')!;
const tampa = CPI_SERIES.find((s) => s.key === 'tampa')!;

function resp(seriesID: string, data: Array<[string, string, string, string?]>): BlsResponse {
  return {
    status: 'REQUEST_SUCCEEDED',
    Results: {
      series: [{ seriesID, data: data.map(([year, period, value, note]) => ({ year, period, value, footnotes: note ? [{ code: 'X', text: note }] : [{}] })) }],
    },
  };
}

describe('parseBlsResponses', () => {
  it('splits monthly, annual, semiannual and missing values', () => {
    const p = parseBlsResponses('X', [
      resp('X', [
        ['2025', 'M13', '321.943'],
        ['2025', 'M10', '-', 'Data unavailable due to the 2025 lapse in appropriations'],
        ['2025', 'M09', '324.800'],
        ['2025', 'S01', '305.734'],
      ]),
    ]);
    expect(p.monthly.get('2025-09')).toBe(324.8);
    expect(p.missing.get('2025-10')).toMatch(/lapse in appropriations/);
    expect(p.annual.get(2025)).toBe(321.943);
    expect(p.semiannual.get('2025-H1')).toBe(305.734);
  });

  it('rejects conflicting duplicates and failed requests', () => {
    expect(() => parseBlsResponses('X', [resp('X', [['2020', 'M01', '1']]), resp('X', [['2020', 'M01', '2']])])).toThrow(/conflicting/);
    expect(() => parseBlsResponses('X', [{ status: 'REQUEST_NOT_PROCESSED', message: ['limit'] }])).toThrow(/REQUEST_NOT_PROCESSED/);
    expect(() => parseBlsResponses('X', [resp('Y', [])])).toThrow(/Expected series X/);
  });
});

describe('fiscal-year averages', () => {
  const months = (fy: number, value: (i: number) => string): Array<[string, string, string]> =>
    Array.from({ length: 12 }, (_, i) => {
      const m = ((9 + i) % 12) + 1;
      return [String(m >= 10 ? fy - 1 : fy), `M${String(m).padStart(2, '0')}`, value(i)];
    });

  it('averages Oct-Sep for a monthly series', () => {
    const p = parseBlsResponses(national.id, [resp(national.id, months(2025, (i) => String(100 + i)))]);
    const r = fiscalYearAverage(p, national, 2025);
    expect(r).toEqual({ ok: true, value: 105.5, months: expect.any(Array) });
  });

  it('reports missing months instead of averaging around them', () => {
    const data = months(2026, () => '300').filter(([, period]) => period !== 'M10');
    data.push(['2025', 'M10', '-', 'Data unavailable due to the 2025 lapse in appropriations'] as never);
    const p = parseBlsResponses(national.id, [resp(national.id, data)]);
    const r = fiscalYearAverage(p, national, 2026);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/2025-10 \(Data unavailable/);
  });

  it('uses only the published odd months for the bimonthly Tampa series', () => {
    const data = months(2025, (i) => String(200 + i)).filter(([, period]) => Number(period.slice(1)) % 2 === 1);
    const p = parseBlsResponses(tampa.id, [resp(tampa.id, data)]);
    const r = fiscalYearAverage(p, tampa, 2025);
    expect(r.ok && r.months).toEqual(['2024-11', '2025-01', '2025-03', '2025-05', '2025-07', '2025-09']);
    // Nov=201, Jan=203, Mar=205, May=207, Jul=209, Sep=211
    expect(r.ok && r.value).toBe(206);
  });

  it('rounds to BLS precision (3 decimals)', () => {
    const p = parseBlsResponses(national.id, [resp(national.id, [['2020', 'M01', '1'], ['2020', 'M02', '1'], ['2020', 'M03', '2']])]);
    expect(averageOf(p, { ...national, publishedMonths: [1, 2, 3] }, ['2020-01', '2020-02', '2020-03'])).toMatchObject({ ok: true, value: 1.333 });
  });
});
