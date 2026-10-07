/**
 * EDR AFR workbook fund-column headers -> Observation.fundType.
 * Headers are matched exactly (after whitespace normalization); an unknown header is an error,
 * so a layout change in a future EDR release fails the build instead of being silently dropped.
 */
export const FUND_HEADERS: Record<string, string> = {
  'General': 'general',
  'Special Revenue': 'special_revenue',
  'Debt Service': 'debt_service',
  'Capital Projects': 'capital',
  'Permanent': 'permanent',
  'Enterprise': 'enterprise',
  'Internal Service': 'internal_service',
  'Custodial': 'custodial',
  'Pension': 'pension',
  'Trust': 'trust',
  'Private Purpose': 'private_purpose',
  'Component Units': 'component_unit',
};

/** Header text of the workbook's row-total column ("Account Total" before FY 2020-21). */
export const TOTAL_HEADERS = new Set(['Total Account', 'Account Total']);
export const PER_CAPITA_HEADERS = new Set(['Per Capita Account', 'Per Capita Account Total']);

/** Stable ordering of fund types for output. */
export const FUND_ORDER = Object.values(FUND_HEADERS);

/** Fund groupings as reported in the workbook's two-level header (row 3). */
export const GOVERNMENTAL_FUNDS = new Set(['general', 'special_revenue', 'debt_service', 'capital', 'permanent']);
export const PROPRIETARY_FUNDS = new Set(['enterprise', 'internal_service']);
export const FIDUCIARY_FUNDS = new Set(['custodial', 'pension', 'trust', 'private_purpose']);
