import { CategoryPoint, CategorySeries, SeriesPoint, settingsWithDefaults } from '../core/transform';
import {
  CATEGORY_SYMBOLS,
  CategoryChartInput,
  TOTAL_ID,
  categoryAt,
  categoryFromSeriesId,
  categorySeriesId,
  categorySeriesOptions,
  categoryTooltipHtml,
  formatShare,
  LEGEND,
  legendHeight,
} from './category-chart';

const s = settingsWithDefaults('hillsborough');

const point = (fiscalYear: number, value: number | null): SeriesPoint => ({
  fiscalYear,
  label: `FY ${fiscalYear - 1}-${String(fiscalYear % 100).padStart(2, '0')}`,
  value,
  nominal: value ?? 0,
  custodialNominal: 0,
  transfersNominal: 0,
  sourceIds: [],
  notes: [],
});
const cat = (category: string, values: (number | null)[], totals: number[]): CategorySeries => ({
  category,
  points: values.map((v, i): CategoryPoint => ({ ...point(2020 + i, v), share: v === null ? null : (v / totals[i]) * 100 })),
});

const totals = [100, 200];
const input = (type: CategoryChartInput['type']): CategoryChartInput => ({
  type,
  total: totals.map((t, i) => point(2020 + i, t)),
  categories: [cat('ad_valorem', [60, 50], totals), cat('other_taxes', [40, 150], totals)],
  labels: { ad_valorem: 'Ad Valorem Taxes', other_taxes: 'Other <Taxes>' },
  totalColor: '#000',
  totalLabel: 'Total',
  s,
  c: { categories: ['#c1', '#c2', '#c3'], textMuted: '#999', surface: '#fff' },
  m: { symbolSize: 6, lineWidth: 2 },
});

describe('category chart options (D-20)', () => {
  it('series ids round-trip to categories; the total has none', () => {
    expect(categoryFromSeriesId(categorySeriesId('ad_valorem'))).toBe('ad_valorem');
    expect(categoryFromSeriesId(TOTAL_ID)).toBeNull();
    expect(categoryFromSeriesId(undefined)).toBeNull();
  });

  it('stacked area: the total check line first, then stacked areas with distinct colours', () => {
    const series = categorySeriesOptions(input('stacked'));
    expect(series.map((x) => x['id'])).toEqual(['total', 'cat:ad_valorem', 'cat:other_taxes']);
    expect(series.slice(1).every((x) => x['stack'] === 'categories' && x['areaStyle'])).toBe(true);
    const colours = series.slice(1).map((x) => (x['itemStyle'] as { color: string }).color);
    expect(new Set(colours).size).toBe(colours.length);
    expect(series[1]['data']).toEqual([60, 50]);
  });

  it('100% share plots shares and has no total line', () => {
    const series = categorySeriesOptions(input('share'));
    expect(series.map((x) => x['id'])).toEqual(['cat:ad_valorem', 'cat:other_taxes']);
    expect(series[0]['data']).toEqual([60, 25]);
  });

  it('bars stack per year; lines by category use a distinct marker per category', () => {
    expect(categorySeriesOptions(input('bars')).slice(1).every((x) => x['type'] === 'bar' && x['stack'] === 'categories')).toBe(true);
    const lines = categorySeriesOptions(input('lines'));
    expect(lines.slice(1).map((x) => x['symbol'])).toEqual(CATEGORY_SYMBOLS.slice(0, 2));
    expect(lines.slice(1).every((x) => x['stack'] === undefined)).toBe(true);
  });

  it('missing values are gaps, not zeros', () => {
    const inp = input('stacked');
    const series = categorySeriesOptions({ ...inp, categories: [cat('ad_valorem', [null, 50], totals)] });
    expect(series[1]['data']).toEqual(['-', 50]);
  });

  it('tooltip lists every category with value and share, then the total, escaped', () => {
    const html = categoryTooltipHtml(1, input('stacked'));
    expect(html).toContain('FY 2020-21');
    expect(html).toContain('Ad Valorem Taxes');
    expect(html).toContain('Other &#60;Taxes&#62;');
    expect(html).toContain('25.0%');
    expect(html).toContain('75.0%');
    expect(html.indexOf('Ad Valorem')).toBeLessThan(html.indexOf('Total'));
    expect(categoryTooltipHtml(9, input('stacked'))).toBe('');
  });

  it('formatShare: one decimal, dash when missing', () => {
    expect(formatShare(12.345)).toBe('12.3%');
    expect(formatShare(null)).toBe('—');
    expect(formatShare(Number.NaN)).toBe('—');
  });

  describe('categoryAt (tap on a stacked chart)', () => {
    const cats = input('stacked').categories;

    it('finds the band under the tap, bottom up in series order', () => {
      expect(categoryAt('stacked', cats, 0, 10)).toBe('ad_valorem');
      expect(categoryAt('stacked', cats, 0, 60)).toBe('ad_valorem');
      expect(categoryAt('stacked', cats, 0, 61)).toBe('other_taxes');
      expect(categoryAt('bars', cats, 1, 120)).toBe('other_taxes');
      expect(categoryAt('share', cats, 1, 20)).toBe('ad_valorem');
      expect(categoryAt('share', cats, 1, 30)).toBe('other_taxes');
    });

    it('null above the stack, below zero, and on the lines chart', () => {
      expect(categoryAt('stacked', cats, 0, 101)).toBeNull();
      expect(categoryAt('stacked', cats, 0, -1)).toBeNull();
      expect(categoryAt('lines', cats, 0, 10)).toBeNull();
    });
  });
});

describe('legendHeight (QA-45: wrapped legend, no paging)', () => {
  const w = (t: string) => t.length * 6;
  it('one row when everything fits; more rows as the width shrinks', () => {
    const labels = ['Total', 'Ad Valorem Taxes', 'Other Taxes'];
    const one = legendHeight(labels, 2000, w, 16);
    expect(one).toBe(16 + 2 * LEGEND.padding);
    const narrow = legendHeight(labels, 120, w, 16);
    expect(narrow).toBe(3 * 16 + 2 * LEGEND.itemGap + 2 * LEGEND.padding);
    expect(legendHeight([], 400, w, 16)).toBe(0);
  });

  it('eleven long labels at phone width need several rows, all reserved', () => {
    const labels = Array.from({ length: 11 }, (_, i) => `Category name number ${i}`);
    const h = legendHeight(labels, 358, w, 15);
    const rows = (h - 2 * LEGEND.padding + LEGEND.itemGap) / (15 + LEGEND.itemGap);
    expect(Number.isInteger(rows)).toBe(true);
    expect(rows).toBeGreaterThanOrEqual(6);
  });
});
