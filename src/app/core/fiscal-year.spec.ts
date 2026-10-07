import { fiscalYearEnd, fiscalYearLabel, fiscalYearStart, parseFiscalYearLabel } from './fiscal-year';

describe('fiscalYearLabel', () => {
  it.each([
    [2021, 'FY 2020-21'],
    [2000, 'FY 1999-00'],
    [2010, 'FY 2009-10'],
    [2001, 'FY 2000-01'],
    [2006, 'FY 2005-06'],
    [2025, 'FY 2024-25'],
    [2100, 'FY 2099-00'],
    [1001, 'FY 1000-01'],
    [9999, 'FY 9998-99'],
  ])('%i -> %s', (fy, label) => {
    expect(fiscalYearLabel(fy)).toBe(label);
  });

  it.each([2020.5, NaN, Infinity, -2021, 0, 1000, 10000])('throws RangeError for %s', (fy) => {
    expect(() => fiscalYearLabel(fy)).toThrow(RangeError);
  });
});

describe('parseFiscalYearLabel', () => {
  it.each([
    ['FY 2020-21', 2021],
    ['FY 1999-00', 2000],
    ['fy2009-10', 2010],
    ['  FY 2024 - 25 ', 2025],
  ])('%s -> %i', (label, fy) => {
    expect(parseFiscalYearLabel(label)).toBe(fy);
  });

  it.each(['FY 2020-22', 'FY 2020-2021', '2021', 'FY 20-21', '', 'FY 9999-00'])('rejects %s', (label) => {
    expect(parseFiscalYearLabel(label)).toBeNull();
  });

  it('round-trips every year 1990-2060', () => {
    for (let fy = 1990; fy <= 2060; fy++) expect(parseFiscalYearLabel(fiscalYearLabel(fy))).toBe(fy);
  });
});

describe('fiscalYearStart / fiscalYearEnd', () => {
  it('FY 2020-21 runs 2020-10-01 to 2021-09-30', () => {
    expect(fiscalYearStart(2021)).toBe('2020-10-01');
    expect(fiscalYearEnd(2021)).toBe('2021-09-30');
  });

  it('FY 1999-00 crosses the century', () => {
    expect(fiscalYearStart(2000)).toBe('1999-10-01');
    expect(fiscalYearEnd(2000)).toBe('2000-09-30');
  });

  it('rejects invalid years', () => {
    expect(() => fiscalYearStart(1.5)).toThrow(RangeError);
    expect(() => fiscalYearEnd(1.5)).toThrow(RangeError);
  });
});
