import { categoriesFor } from './categories.js';

export type Flow = 'revenue' | 'expenditure';

/**
 * Canonical string for an account code stored as a number in the workbook.
 * EDR stores codes as numbers (e.g. 312.3 displayed with format 0.000), so trailing zeros of the
 * Uniform Accounting System code are not recoverable: 312.30 and 312.3 are the same cell value.
 */
export function formatAccountCode(code: number): string {
  if (!Number.isFinite(code) || code <= 0) throw new Error(`Invalid account code ${code}`);
  return code.toFixed(3).replace(/\.?0+$/, '');
}

export interface AccountClass {
  /** UAS major account class (src/edr/categories.ts), e.g. "taxes", "public_safety". */
  section: string;
  /** Category used for breakdowns: the UAS class, with ad valorem (311) split out of taxes. */
  category: string;
}

/**
 * Classify an account code by the UAS chart of accounts in force for that fiscal year (year-ranged
 * rows, src/edr/categories.ts). Throws unless exactly one category matches.
 */
export function classifyAccount(flow: Flow, code: string, fiscalYear: number): AccountClass {
  const matches = categoriesFor(flow, code, fiscalYear);
  if (matches.length !== 1) {
    throw new Error(`${flow} account ${code} (FY ending ${fiscalYear}): ${matches.length ? `matches ${matches.length} UAS categories` : 'not in any UAS category'}`);
  }
  return { section: matches[0].section, category: matches[0].id };
}

/**
 * Section headings as printed in the EDR workbooks -> the UAS classes EDR prints under them. Used by
 * validation to confirm that the code classification agrees with where EDR placed each row. EDR prints
 * two UAS classes under one heading in two places: 38x and 39x under "Other Sources", and 58x and 59x
 * under "Other Uses (and Non-Operating)".
 */
export const SECTION_HEADINGS: Record<string, string[]> = {
  'general government taxes': ['taxes'],
  'taxes': ['taxes'],
  'permits and franchise fees': ['permits_fees_special_assessments'],
  'franchise fees, licenses, and permits': ['permits_fees_special_assessments'],
  'permits, fees, and licenses': ['permits_fees_special_assessments'],
  'permits, fees, and special assessments': ['permits_fees_special_assessments'],
  'intergovernmental revenue': ['intergovernmental'],
  'intergovernmental revenues': ['intergovernmental'],
  'charges for services': ['charges_for_services'],
  'judgments, fines, and forfeits': ['judgments_fines_forfeits'],
  'miscellaneous revenues': ['miscellaneous'],
  'other sources': ['other_sources', 'proprietary_nonoperating_sources'],
  'general government services (not court-related)': ['general_government'],
  'public safety': ['public_safety'],
  'physical environment': ['physical_environment'],
  'transportation': ['transportation'],
  'economic environment': ['economic_environment'],
  'human services': ['human_services'],
  'culture / recreation': ['culture_recreation'],
  'other uses': ['other_uses', 'other_nonoperating'],
  'other uses and non-operating': ['other_uses', 'other_nonoperating'],
  'court-related expenditures': ['court_related'],
};

export function normalizeHeading(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}
