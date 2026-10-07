import type { Flow } from './accounts.js';

/**
 * Values read by hand from the county-filed Annual Financial Report PDFs in
 * data/raw/county-afr/<county>/ (text extracted with `pdftotext -raw`). Validation checks that the
 * listed lines add up to the matching EDR workbook value, which shows whether EDR's figure is a
 * faithful transcription of what the county filed. These numbers are not emitted as data.
 */
export interface CountyAfrCheck {
  jurisdiction: string;
  fiscalYear: number;
  flow: Flow;
  /** Account code, or '*' for the total of every account in the fund. */
  account: string;
  fundType: string;
  /** Page of the PDF ("Page N of M" footer) where the lines appear. */
  page: number;
  /** Lines as printed in the PDF. Empty means the PDF has no line for this account and fund. */
  lines: Array<{ label: string; amount: number }>;
  /** Which annotation the check supports. */
  topic: 'transfers' | 'proprietary';
}

export const COUNTY_AFR_CHECKS: CountyAfrCheck[] = [
  // FY 2021-22 (filed 9/6/2023): year before the break.
  { jurisdiction: 'hillsborough', fiscalYear: 2022, flow: 'expenditure', account: '581', fundType: 'general', page: 18, topic: 'transfers',
    lines: [{ label: '581.00 Interfund Group Transfers Out, 90 - Other Uses, General', amount: 121_329_000 }] },
  // FY 2022-23 (filed 6/28/2024)
  { jurisdiction: 'hillsborough', fiscalYear: 2023, flow: 'expenditure', account: '521', fundType: 'general', page: 18, topic: 'transfers',
    lines: [
      { label: '521.00 Law Enforcement, 10 - Personnel Services, General', amount: 200_800 },
      { label: '521.00 Law Enforcement, 30 - Operating, General', amount: 3_049 },
    ] },
  { jurisdiction: 'hillsborough', fiscalYear: 2023, flow: 'expenditure', account: '581', fundType: 'general', page: 22, topic: 'transfers',
    lines: [{ label: '581.00 Interfund Group Transfers Out, 90 - Other Uses, General', amount: 787_390_037 }] },
  { jurisdiction: 'hillsborough', fiscalYear: 2023, flow: 'revenue', account: '381', fundType: 'general', page: 16, topic: 'transfers',
    lines: [{ label: '381.000 Inter-Fund Group Transfers In, General', amount: 168_326_824 }] },
  // FY 2023-24 (filed 6/30/2025)
  { jurisdiction: 'hillsborough', fiscalYear: 2024, flow: 'expenditure', account: '521', fundType: 'general', page: 8, topic: 'transfers',
    lines: [
      { label: 'Law Enforcement, Personnel Services, General', amount: 149_313 },
      { label: 'Law Enforcement, Operating Expenditures/Expenses, General', amount: 1_433 },
    ] },
  { jurisdiction: 'hillsborough', fiscalYear: 2024, flow: 'expenditure', account: '581', fundType: 'general', page: 11, topic: 'transfers',
    lines: [{ label: 'Interfund Group Transfers Out, Other Uses, General', amount: 912_284_168 }] },
  { jurisdiction: 'hillsborough', fiscalYear: 2024, flow: 'revenue', account: '381', fundType: 'general', page: 7, topic: 'transfers',
    lines: [{ label: 'Inter-Fund Group Transfers In, General', amount: 186_897_223 }] },
  // FY 2023-24 proprietary funds, "Proprietary Funds - Expenditures" pages 15-16.
  { jurisdiction: 'hillsborough', fiscalYear: 2024, flow: 'expenditure', account: '*', fundType: 'enterprise', page: 16, topic: 'proprietary',
    lines: [{ label: 'Proprietary Funds Expenditures, Total, Enterprise', amount: 126_477_435 }] },
  { jurisdiction: 'hillsborough', fiscalYear: 2024, flow: 'expenditure', account: '*', fundType: 'internal_service', page: 16, topic: 'proprietary',
    lines: [{ label: 'Proprietary Funds Expenditures, Total, Internal Service', amount: 18_872_025 }] },
  { jurisdiction: 'hillsborough', fiscalYear: 2024, flow: 'expenditure', account: '519', fundType: 'internal_service', page: 15, topic: 'proprietary',
    lines: [{ label: 'Other General Governmental Services, Capital Outlay, Internal Service', amount: 18_872_025 }] },
  { jurisdiction: 'hillsborough', fiscalYear: 2024, flow: 'expenditure', account: '533', fundType: 'enterprise', page: 15, topic: 'proprietary',
    lines: [
      { label: 'Water Utility Services, Operating Expenditures/Expenses, Enterprise', amount: 94_926_041 },
      { label: 'Water Utility Services, Debt Service, Enterprise', amount: -2_245_626 },
    ] },
  { jurisdiction: 'hillsborough', fiscalYear: 2024, flow: 'expenditure', account: '536', fundType: 'enterprise', page: 15, topic: 'proprietary',
    lines: [] },
  // FY 2024-25 (filed 6/30/2026): year after the break.
  { jurisdiction: 'hillsborough', fiscalYear: 2025, flow: 'expenditure', account: '521', fundType: 'general', page: 11, topic: 'transfers',
    lines: [
      { label: '521.00 Law Enforcement, 10 - Personnel Services, General', amount: 476_153_406 },
      { label: '521.00 Law Enforcement, 30 - Operating Expenditures/Expenses, General', amount: 130_441_971 },
      { label: '521.00 Law Enforcement, 60 - Capital Outlay, General', amount: 74_082_530 },
    ] },
  { jurisdiction: 'hillsborough', fiscalYear: 2025, flow: 'expenditure', account: '581', fundType: 'general', page: 14, topic: 'transfers',
    lines: [{ label: '581.00 Interfund Group Transfers Out, 90 - Other Uses, General', amount: 341_118_887 }] },
];

const fundLabel = (f: string) => f.replace(/_/g, ' ');

/**
 * Sentence stating what the county-filed AFR shows for one fiscal year and topic, or undefined
 * when there are no checks for it.
 */
export function countyAfrNote(
  jurisdiction: string,
  fiscalYear: number,
  topic: CountyAfrCheck['topic'],
  /** Plain-language name of the filing, e.g. "Hillsborough County Annual Financial Report for FY 2023-24". */
  filingName: string,
): string | undefined {
  const checks = COUNTY_AFR_CHECKS.filter((c) => c.jurisdiction === jurisdiction && c.fiscalYear === fiscalYear && c.topic === topic);
  if (!checks.length) return undefined;
  const parts = checks.map((c) => {
    const what = `${c.flow} ${c.account === '*' ? 'total' : `account ${c.account}`}, ${fundLabel(c.fundType)}`;
    return c.lines.length
      ? `${what} $${c.lines.reduce((s, l) => s + l.amount, 0).toLocaleString('en-US')} (page ${c.page})`
      : `${what}: no line (page ${c.page})`;
  });
  return `The ${filingName}, as filed with the Florida Chief Financial Officer, shows the same values: ${parts.join('; ')}.`;
}
