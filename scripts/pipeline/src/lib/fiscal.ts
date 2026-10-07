/** Florida county FY runs Oct 1 - Sep 30. fiscalYear 2021 = FY 2020-21. */
export function fiscalYearLabel(fiscalYear: number): string {
  return `FY ${fiscalYear - 1}-${String(fiscalYear % 100).padStart(2, '0')}`;
}

/** Calendar months (YYYY-MM) in a fiscal year, Oct of the prior year through Sep. */
export function fiscalYearMonths(fiscalYear: number): string[] {
  const months: string[] = [];
  for (let i = 0; i < 12; i++) {
    const m = ((9 + i) % 12) + 1;
    const y = m >= 10 ? fiscalYear - 1 : fiscalYear;
    months.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  return months;
}

/** Parse "Local Fiscal Year Ended September 30, 2025" -> 2025. */
export function parseFiscalYearTitle(title: string): number | null {
  const m = /Fiscal Year Ended September 30,\s*(\d{4})/i.exec(title);
  return m ? Number(m[1]) : null;
}
