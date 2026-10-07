import { describe, expect, it } from 'vitest';
import { classifyAccount, formatAccountCode, normalizeHeading, SECTION_HEADINGS } from '../src/edr/accounts.js';
import { cleanCountyName, selectPopulation, type PopulationValue } from '../src/edr/population.js';
import { fiscalYearLabel, fiscalYearMonths, parseFiscalYearLabel, parseFiscalYearTitle } from '../src/lib/fiscal.js';
import { stableStringify } from '../src/lib/hash.js';
import { defaultJurisdiction } from '../src/build.js';
import { COUNTIES } from '../config/counties.js';

describe('fiscal year helpers', () => {
  it('labels FY by ending year', () => {
    expect(fiscalYearLabel(2021)).toBe('FY 2020-21');
    expect(fiscalYearLabel(2000)).toBe('FY 1999-00');
  });

  it('parses FY labels to the ending year', () => {
    expect(parseFiscalYearLabel('2020-21')).toBe(2021);
    expect(parseFiscalYearLabel('FY 1999-00')).toBe(2000);
    expect(parseFiscalYearLabel(fiscalYearLabel(2025))).toBe(2025);
    expect(() => parseFiscalYearLabel('2020-22')).toThrow();
    expect(() => parseFiscalYearLabel('2021')).toThrow();
  });

  it('lists Oct-Sep months', () => {
    const m = fiscalYearMonths(2025);
    expect(m).toHaveLength(12);
    expect(m[0]).toBe('2024-10');
    expect(m[2]).toBe('2024-12');
    expect(m[3]).toBe('2025-01');
    expect(m[11]).toBe('2025-09');
  });

  it('parses the workbook title', () => {
    expect(parseFiscalYearTitle('Local Fiscal Year Ended September 30, 2025')).toBe(2025);
    expect(parseFiscalYearTitle('Hillsborough County Government Revenues')).toBeNull();
  });
});

describe('account codes', () => {
  it('formats numeric codes without float noise or trailing zeros', () => {
    expect(formatAccountCode(311)).toBe('311');
    expect(formatAccountCode(312.3)).toBe('312.3');
    expect(formatAccountCode(348.921)).toBe('348.921');
    expect(formatAccountCode(341.16)).toBe('341.16');
    expect(formatAccountCode(0.1 + 0.2 + 335)).toBe('335.3');
  });

  it('rejects invalid codes', () => {
    expect(() => formatAccountCode(NaN)).toThrow();
    expect(() => formatAccountCode(0)).toThrow();
  });

  it('classifies revenues by UAS prefix, splitting out ad valorem', () => {
    expect(classifyAccount('revenue', '311')).toEqual({ section: 'taxes', category: 'ad_valorem' });
    expect(classifyAccount('revenue', '312.13')).toEqual({ section: 'taxes', category: 'other_taxes' });
    expect(classifyAccount('revenue', '324.11').section).toBe('permits_fees_special_assessments');
    expect(classifyAccount('revenue', '331.51').section).toBe('intergovernmental');
    expect(classifyAccount('revenue', '367').section).toBe('miscellaneous');
    expect(classifyAccount('revenue', '381').section).toBe('other_sources');
    // UAS 2025 p. 114: 39x is its own class, Proprietary Non-Operating Sources.
    expect(classifyAccount('revenue', '392').section).toBe('proprietary_nonoperating_sources');
    expect(classifyAccount('revenue', '393').category).toBe('proprietary_nonoperating_sources');
    expect(classifyAccount('revenue', '389.1').section).toBe('other_sources');
    expect(() => classifyAccount('revenue', '371')).toThrow(/not in any UAS category/);
    expect(() => classifyAccount('revenue', '401')).toThrow();
  });

  it('classifies expenditures by function, court-related 600-799', () => {
    expect(classifyAccount('expenditure', '521').category).toBe('public_safety');
    expect(classifyAccount('expenditure', '541').category).toBe('transportation');
    expect(classifyAccount('expenditure', '581').category).toBe('other_uses');
    // UAS 2025 p. 129: 59x is its own class, Other Nonoperating.
    expect(classifyAccount('expenditure', '591').category).toBe('other_nonoperating');
    expect(classifyAccount('expenditure', '590').category).toBe('other_nonoperating');
    expect(classifyAccount('expenditure', '601').category).toBe('court_related');
    expect(classifyAccount('expenditure', '765').category).toBe('court_related');
    expect(() => classifyAccount('expenditure', '501')).toThrow();
    expect(() => classifyAccount('expenditure', '771')).toThrow(); // UAS court-related classes end at 76x
  });

  it('maps every section heading to a section that classifyAccount can produce', () => {
    const produced = new Set([
      ...['311', '312', '322', '331', '341', '351', '361', '381'].map((c) => classifyAccount('revenue', c).section),
      ...['511', '521', '531', '541', '551', '561', '571', '581', '601'].map((c) => classifyAccount('expenditure', c).section),
    ]);
    for (const sections of Object.values(SECTION_HEADINGS)) for (const section of sections) expect([...produced, 'proprietary_nonoperating_sources', 'other_nonoperating']).toContain(section);
    expect(normalizeHeading('  Culture  /  Recreation ')).toBe('culture / recreation');
  });
});

describe('population helpers', () => {
  it('strips footnote markers from county names', () => {
    expect(cleanCountyName('Hillsborough *')).toBe('Hillsborough');
    expect(cleanCountyName('Miami-Dade')).toBe('Miami-Dade');
    expect(cleanCountyName('St. Lucie  ')).toBe('St. Lucie');
  });

  it('prefers revised estimate > estimate > census count', () => {
    const v = (year: number, basis: PopulationValue['basis'], value: number): PopulationValue => ({ year, basis, value, sheet: '', row: 0 });
    const { selected, alternates } = selectPopulation([
      v(2020, 'census_count', 1459762),
      v(2020, 'bebr_revised_estimate', 1478759),
      v(2010, 'census_count', 1229226),
      v(2019, 'bebr_estimate', 1444870),
    ]);
    expect(selected.get(2020)?.value).toBe(1478759);
    expect(alternates.get(2020)?.map((a) => a.value)).toEqual([1459762]);
    expect(selected.get(2010)?.basis).toBe('census_count');
    expect(alternates.has(2019)).toBe(false);
  });
});

describe('stableStringify', () => {
  it('sorts keys recursively and keeps array order', () => {
    expect(stableStringify({ b: 1, a: { d: [3, 1], c: 2 } })).toBe('{"a":{"c":2,"d":[3,1]},"b":1}\n');
  });
});

describe('default jurisdiction (QA-36)', () => {
  it('is the single county marked default', () => {
    expect(defaultJurisdiction([{ slug: 'a' }, { slug: 'b', default: true }])).toBe('b');
    expect(defaultJurisdiction(COUNTIES)).toBe('hillsborough');
  });
  it('fails with no default or more than one', () => {
    expect(() => defaultJurisdiction([{ slug: 'a' }])).toThrow(/exactly one/);
    expect(() => defaultJurisdiction([{ slug: 'a', default: true }, { slug: 'b', default: true }])).toThrow(/found 2/);
  });
});

describe('UAS categories', () => {
  it('do not overlap, and cover each class once', async () => {
    const { CATEGORIES } = await import('../src/edr/categories.js');
    for (const flow of ['revenue', 'expenditure'] as const) {
      const ranges = CATEGORIES.filter((c) => c.flow === flow).flatMap((c) => c.ranges).sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < ranges.length; i++) expect(ranges[i][0]).toBeGreaterThanOrEqual(ranges[i - 1][1]);
    }
    expect(new Set(CATEGORIES.map((c) => c.id)).size).toBe(CATEGORIES.length);
  });
});
