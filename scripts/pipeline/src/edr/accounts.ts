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
  /** Major Uniform Accounting System group, matching the workbook's section headings. */
  section: string;
  /** Finer category used for breakdowns (equal to section except ad valorem taxes). */
  category: string;
}

const REVENUE_GROUPS: Record<number, string> = {
  31: 'taxes',
  32: 'permits_fees_special_assessments',
  33: 'intergovernmental',
  34: 'charges_for_services',
  35: 'judgments_fines_forfeits',
  36: 'miscellaneous',
  38: 'other_sources',
};

const EXPENDITURE_GROUPS: Record<number, string> = {
  51: 'general_government',
  52: 'public_safety',
  53: 'physical_environment',
  54: 'transportation',
  55: 'economic_environment',
  56: 'human_services',
  57: 'culture_recreation',
  58: 'other_uses',
  59: 'other_uses',
};

/** Classify an account code by its Uniform Accounting System prefix. Throws on unknown prefixes. */
export function classifyAccount(flow: Flow, code: string): AccountClass {
  const major = Math.floor(Number(code));
  const group = Math.floor(major / 10);
  if (flow === 'revenue') {
    const section = REVENUE_GROUPS[group];
    if (!section) throw new Error(`Unknown revenue account prefix: ${code}`);
    if (section === 'taxes') return { section, category: major === 311 ? 'ad_valorem' : 'other_taxes' };
    return { section, category: section };
  }
  if (major >= 600 && major <= 799) return { section: 'court_related', category: 'court_related' };
  const section = EXPENDITURE_GROUPS[group];
  if (!section) throw new Error(`Unknown expenditure account prefix: ${code}`);
  return { section, category: section };
}

/**
 * Section headings as printed in the EDR workbooks -> section slug. Used by validation to confirm
 * that the code-prefix classification agrees with where EDR placed each row.
 */
export const SECTION_HEADINGS: Record<string, string> = {
  'general government taxes': 'taxes',
  'taxes': 'taxes',
  'permits and franchise fees': 'permits_fees_special_assessments',
  'franchise fees, licenses, and permits': 'permits_fees_special_assessments',
  'permits, fees, and licenses': 'permits_fees_special_assessments',
  'permits, fees, and special assessments': 'permits_fees_special_assessments',
  'intergovernmental revenue': 'intergovernmental',
  'intergovernmental revenues': 'intergovernmental',
  'charges for services': 'charges_for_services',
  'judgments, fines, and forfeits': 'judgments_fines_forfeits',
  'miscellaneous revenues': 'miscellaneous',
  'other sources': 'other_sources',
  'general government services (not court-related)': 'general_government',
  'public safety': 'public_safety',
  'physical environment': 'physical_environment',
  'transportation': 'transportation',
  'economic environment': 'economic_environment',
  'human services': 'human_services',
  'culture / recreation': 'culture_recreation',
  'other uses': 'other_uses',
  'other uses and non-operating': 'other_uses',
  'court-related expenditures': 'court_related',
};

export function normalizeHeading(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}
