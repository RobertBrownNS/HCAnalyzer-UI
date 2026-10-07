import { describe, expect, it } from 'vitest';
import { cumulativeChange, indexComparisonSection } from '../src/index-comparison.js';

describe('index comparison', () => {
  it('computes cumulative change and returns null for missing years', () => {
    expect(cumulativeChange({ '2020': 200, '2025': 250 }, 2020, 2025)).toBeCloseTo(0.25, 12);
    expect(cumulativeChange({ '2020': null, '2025': 250 }, 2020, 2025)).toBeNull();
    expect(cumulativeChange({ '2025': 250 }, 2006, 2025)).toBeNull();
  });

  it('deflates the example amount with each index', () => {
    const series = { '2006': 100, '2018': 100, '2020': 100, '2025': 125 };
    const lines = indexComparisonSection({
      nationalCalendar: series,
      tampaCalendar: { ...series, '2025': 150 },
      nationalFiscal: series,
      tampaFiscal: { '2006': null, '2018': 100, '2020': 100, '2025': 150 },
      revenueExclCustodial: { 2025: 1500 },
      jurisdictionName: 'Test County',
    }).join('\n');
    expect(lines).toContain('| Calendar-year | National CPI-U | 2020: 100; 2025: 125 | $1,200 | -$300 |');
    expect(lines).toContain('| Calendar-year | Tampa CPI | 2020: 100; 2025: 150 | $1,000 | -$500 |');
    expect(lines).toContain('| Calendar-year | $200 |');
    expect(lines).toContain('n/a (no Tampa value for FY 2005-06)');
    expect(lines).toContain('-25.00 pp');
  });
});
