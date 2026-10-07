import { settingsWithDefaults } from '../core/transform';
import { DEFAULT_OPEN, SECTIONS_KEY, paneFits, readOpenSections, sectionSummaries, writeOpenSections } from './pane-sections';

describe('pane accordion state (P3-14)', () => {
  beforeEach(() => localStorage.removeItem(SECTIONS_KEY));
  afterEach(() => localStorage.removeItem(SECTIONS_KEY));

  it('defaults to View open only', () => {
    expect([...readOpenSections()]).toEqual([...DEFAULT_OPEN]);
    expect([...DEFAULT_OPEN]).toEqual(['view']);
  });

  it('round-trips through localStorage, in section order, ignoring unknown ids', () => {
    writeOpenSections(new Set(['funds', 'view']));
    expect(localStorage.getItem(SECTIONS_KEY)).toBe('["view","funds"]');
    expect([...readOpenSections()].sort()).toEqual(['funds', 'view']);
    localStorage.setItem(SECTIONS_KEY, '["inflation","bogus"]');
    expect([...readOpenSections()]).toEqual(['inflation']);
    // All closed is a valid stored state.
    localStorage.setItem(SECTIONS_KEY, '[]');
    expect(readOpenSections().size).toBe(0);
  });

  it('falls back to the default when storage is invalid or blocked, and writing never throws', () => {
    localStorage.setItem(SECTIONS_KEY, '{not json');
    expect([...readOpenSections()]).toEqual(['view']);
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      expect([...readOpenSections()]).toEqual(['view']);
      expect(() => writeOpenSections(new Set(['funds']))).not.toThrow();
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });
});

describe('section summaries', () => {
  const s = settingsWithDefaults('pinellas', { baseYear: 2025 });
  const base = { countyName: 'Pinellas', funds: 'All funds as reported by EDR', categoryLabels: { ad_valorem: 'Ad Valorem Taxes', other_taxes: 'Other Taxes' } };

  it('defaults', () => {
    const sum = sectionSummaries({ ...base, s });
    expect(sum.view).toBe('Pinellas · Revenues · Nominal dollars · Base year FY 2024-25 · Index to 100: off');
    expect(sum.inflation).toBe('Not used');
    expect(sum.funds).toBe('All funds as reported by EDR · Custodial excluded · Transfers: as reported (gross)');
    expect(sum.categories).toBe('All categories');
  });

  it('non-default settings show in the collapsed headers', () => {
    const sum = sectionSummaries({
      ...base,
      funds: 'Custom: 2 funds',
      s: {
        ...s,
        flow: 'expenditure',
        measure: 'real_per_capita',
        indexTo100: true,
        cpiIndex: 'cpi-u-tampa',
        cpiPeriod: 'calendar',
        includeCustodial: true,
        transfers: 'net',
        categories: ['ad_valorem', 'other_taxes'],
      },
    });
    expect(sum.view).toBe('Pinellas · Expenditures · Per resident, inflation-adjusted · Base year FY 2024-25 · FY 2024-25 = 100');
    expect(sum.inflation).toBe('CPI-U Tampa · Calendar-year average');
    expect(sum.funds).toBe('Custom: 2 funds · Custodial included · Transfers: excluded (net)');
    expect(sum.categories).toBe('Ad Valorem Taxes, Other Taxes');
  });

  it('many categories, or labels not loaded yet: a count', () => {
    expect(sectionSummaries({ ...base, s: { ...s, categories: ['a', 'b', 'c', 'd'] } }).categories).toBe('4 categories');
    expect(sectionSummaries({ ...base, categoryLabels: {}, s: { ...s, categories: ['ad_valorem'] } }).categories).toBe('1 category');
  });
});

describe('pane stickiness (one scrollbar)', () => {
  it('sticky only while the pane fits under the header', () => {
    expect(paneFits(720, 768, 48)).toBe(true);
    expect(paneFits(721, 768, 48)).toBe(true); // rounding tolerance
    expect(paneFits(760, 768, 48)).toBe(false);
    expect(paneFits(1400, 1080, 48)).toBe(false);
  });

  it('the pane stylesheet has no scroll container or max-height of its own', async () => {
    const fs: { readFileSync(p: string, e: string): string } = await import(/* @vite-ignore */ ['node', 'fs'].join(':'));
    const scss = fs.readFileSync('src/app/explorer/explorer.component.scss', 'utf-8');
    const start = scss.indexOf('  .filters {');
    const rule = scss.slice(start, scss.indexOf('\n  }\n', start));
    expect(start).toBeGreaterThan(0);
    expect(rule).not.toMatch(/overflow(-y)?\s*:/);
    expect(rule).not.toMatch(/max-height\s*:/);
    expect(rule).toMatch(/&\.sticky\s*\{\s*position: sticky;/);
  });
});
