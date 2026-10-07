import type { Flow } from './accounts.js';

/**
 * Values read by hand from the county-filed Annual Financial Report PDFs in
 * data/raw/county-afr/<county>/ (text extracted with `pdftotext -raw`). Validation checks that the
 * listed lines add up to the matching EDR workbook cell, which shows whether EDR's figure is a
 * faithful transcription of what the county filed. These numbers are not emitted as data.
 */
export interface CountyAfrCheck {
  jurisdiction: string;
  fiscalYear: number;
  flow: Flow;
  account: string;
  fundType: string;
  /** Page of the PDF ("Page N of M" footer) where the lines appear. */
  page: number;
  /** Lines as printed in the PDF for this account and fund. */
  lines: Array<{ label: string; amount: number }>;
}

export const COUNTY_AFR_CHECKS: CountyAfrCheck[] = [
  // FY 2021-22 (filed 9/6/2023): normal-looking year before the break.
  { jurisdiction: 'hillsborough', fiscalYear: 2022, flow: 'expenditure', account: '581', fundType: 'general', page: 18,
    lines: [{ label: '581.00 Interfund Group Transfers Out, 90 - Other Uses, General', amount: 121_329_000 }] },
  // FY 2022-23 (filed 6/28/2024)
  { jurisdiction: 'hillsborough', fiscalYear: 2023, flow: 'expenditure', account: '521', fundType: 'general', page: 18,
    lines: [
      { label: '521.00 Law Enforcement, 10 - Personnel Services, General', amount: 200_800 },
      { label: '521.00 Law Enforcement, 30 - Operating, General', amount: 3_049 },
    ] },
  { jurisdiction: 'hillsborough', fiscalYear: 2023, flow: 'expenditure', account: '581', fundType: 'general', page: 22,
    lines: [{ label: '581.00 Interfund Group Transfers Out, 90 - Other Uses, General', amount: 787_390_037 }] },
  { jurisdiction: 'hillsborough', fiscalYear: 2023, flow: 'revenue', account: '381', fundType: 'general', page: 16,
    lines: [{ label: '381.000 Inter-Fund Group Transfers In, General', amount: 168_326_824 }] },
  // FY 2023-24 (filed 6/30/2025)
  { jurisdiction: 'hillsborough', fiscalYear: 2024, flow: 'expenditure', account: '521', fundType: 'general', page: 8,
    lines: [
      { label: 'Law Enforcement, Personnel Services, General', amount: 149_313 },
      { label: 'Law Enforcement, Operating Expenditures/Expenses, General', amount: 1_433 },
    ] },
  { jurisdiction: 'hillsborough', fiscalYear: 2024, flow: 'expenditure', account: '581', fundType: 'general', page: 11,
    lines: [{ label: 'Interfund Group Transfers Out, Other Uses, General', amount: 912_284_168 }] },
  { jurisdiction: 'hillsborough', fiscalYear: 2024, flow: 'revenue', account: '381', fundType: 'general', page: 7,
    lines: [{ label: 'Inter-Fund Group Transfers In, General', amount: 186_897_223 }] },
  // FY 2024-25 (filed 6/30/2026): year after the break.
  { jurisdiction: 'hillsborough', fiscalYear: 2025, flow: 'expenditure', account: '521', fundType: 'general', page: 11,
    lines: [
      { label: '521.00 Law Enforcement, 10 - Personnel Services, General', amount: 476_153_406 },
      { label: '521.00 Law Enforcement, 30 - Operating Expenditures/Expenses, General', amount: 130_441_971 },
      { label: '521.00 Law Enforcement, 60 - Capital Outlay, General', amount: 74_082_530 },
    ] },
  { jurisdiction: 'hillsborough', fiscalYear: 2025, flow: 'expenditure', account: '581', fundType: 'general', page: 14,
    lines: [{ label: '581.00 Interfund Group Transfers Out, 90 - Other Uses, General', amount: 341_118_887 }] },
];

/** One sentence per fiscal year for annotations, stating what the county-filed AFR shows. */
export function countyAfrNotes(jurisdiction: string, fileFor: (fy: number) => string | undefined): Map<number, string> {
  const notes = new Map<number, string>();
  const years = [...new Set(COUNTY_AFR_CHECKS.filter((c) => c.jurisdiction === jurisdiction).map((c) => c.fiscalYear))];
  for (const fy of years) {
    const file = fileFor(fy);
    if (!file) continue;
    const checks = COUNTY_AFR_CHECKS.filter((c) => c.jurisdiction === jurisdiction && c.fiscalYear === fy);
    const parts = checks.map((c) => `${c.flow} ${c.account} ${c.fundType} $${c.lines.reduce((s, l) => s + l.amount, 0).toLocaleString('en-US')} (page ${c.page})`);
    notes.set(fy, `The county's own Annual Financial Report filed with the Florida CFO (${file}) shows the same values: ${parts.join('; ')}.`);
  }
  return notes;
}
