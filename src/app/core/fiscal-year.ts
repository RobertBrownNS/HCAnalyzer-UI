/**
 * Florida county fiscal years run Oct 1 - Sep 30 and are stored as the year
 * they END: fiscalYear 2021 = FY 2020-21 = Oct 1, 2020 - Sep 30, 2021.
 * This file is the single place that converts between the stored number and
 * what people read (risk R-11).
 */

const MIN_FY = 1001;
const MAX_FY = 9999;

function assertFiscalYear(fy: number): void {
  if (!Number.isInteger(fy) || fy < MIN_FY || fy > MAX_FY) {
    throw new RangeError(`Invalid fiscal year: ${fy}. Expected an integer from ${MIN_FY} to ${MAX_FY}.`);
  }
}

/** 2021 -> "FY 2020-21"; 2000 -> "FY 1999-00". */
export function fiscalYearLabel(fy: number): string {
  assertFiscalYear(fy);
  const end = String(fy % 100).padStart(2, '0');
  return `FY ${fy - 1}-${end}`;
}

/**
 * Inverse of fiscalYearLabel. Accepts "FY 2020-21" (case and spacing
 * tolerant). Returns null when the text is not a valid label, including
 * when the two years are not consecutive.
 */
export function parseFiscalYearLabel(label: string): number | null {
  const m = /^\s*FY\s*(\d{4})\s*-\s*(\d{2})\s*$/i.exec(label);
  if (!m) return null;
  const fy = Number(m[1]) + 1;
  if (fy < MIN_FY || fy > MAX_FY) return null;
  return String(fy % 100).padStart(2, '0') === m[2] ? fy : null;
}

/** First day of the fiscal year, ISO date: 2021 -> "2020-10-01". */
export function fiscalYearStart(fy: number): string {
  assertFiscalYear(fy);
  return `${fy - 1}-10-01`;
}

/** Last day of the fiscal year, ISO date: 2021 -> "2021-09-30". */
export function fiscalYearEnd(fy: number): string {
  assertFiscalYear(fy);
  return `${fy}-09-30`;
}
