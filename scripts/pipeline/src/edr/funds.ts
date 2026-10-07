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

export type FundGroup = 'governmental' | 'proprietary' | 'fiduciary' | 'component_unit';

/**
 * Fund metadata for funds.json. Labels are EDR's column headers; groups and descriptions follow the
 * DFS UAS Manual, 2025 edition, Fund Groups and Fund Types table (p. 6). Component units are not a UAS
 * fund group; EDR reports them in their own column.
 */
export const FUND_METADATA: Array<{ id: string; label: string; group: FundGroup; description: string; ownToggle?: boolean }> = [
  { id: 'general', label: 'General', group: 'governmental', description: 'All financial resources not accounted for and reported in another fund.' },
  { id: 'special_revenue', label: 'Special Revenue', group: 'governmental', description: 'Proceeds of specific revenue sources restricted or committed to specified purposes other than debt service or capital projects.' },
  { id: 'debt_service', label: 'Debt Service', group: 'governmental', description: 'Resources restricted, committed or assigned to principal and interest.' },
  { id: 'capital', label: 'Capital Projects', group: 'governmental', description: 'Resources restricted, committed or assigned to capital outlays.' },
  { id: 'permanent', label: 'Permanent', group: 'governmental', description: 'Resources of which only earnings, not principal, may be used to support the government\'s programs.' },
  { id: 'enterprise', label: 'Enterprise', group: 'proprietary', description: 'Operations financed and run like private businesses, with costs recovered mainly through user charges.' },
  { id: 'internal_service', label: 'Internal Service', group: 'proprietary', description: 'Goods or services provided by one department to other departments or governments on a cost-reimbursement basis.' },
  { id: 'custodial', label: 'Custodial', group: 'fiduciary', description: 'Assets held in a purely custodial capacity, such as taxes collected for other governments. Reported from FY 2020-21 (GASB 84).', ownToggle: true },
  { id: 'pension', label: 'Pension', group: 'fiduciary', description: 'Assets of pension and other employee benefit plans held in a trustee capacity.' },
  { id: 'trust', label: 'Trust', group: 'fiduciary', description: 'Trust funds reported in EDR\'s Trust column (the UAS lists investment trust funds among the fiduciary funds).' },
  { id: 'private_purpose', label: 'Private Purpose', group: 'fiduciary', description: 'Trust arrangements whose principal and income benefit individuals, private organizations or other governments.' },
  { id: 'component_unit', label: 'Component Units', group: 'component_unit', description: 'Legally separate organizations reported alongside the county in their own column.' },
];

export const FUND_PRESETS: Array<{ id: string; label: string; funds: string[] }> = [
  { id: 'general', label: 'General Fund', funds: ['general'] },
  { id: 'governmental', label: 'Governmental funds', funds: FUND_METADATA.filter((f) => f.group === 'governmental').map((f) => f.id) },
  { id: 'all', label: 'All funds', funds: FUND_METADATA.filter((f) => !f.ownToggle).map((f) => f.id) },
];
