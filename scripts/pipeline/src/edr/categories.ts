import type { Flow } from './accounts.js';

/**
 * Category groupings from the DFS Uniform Accounting System (UAS) Manual, 2025 edition (effective
 * beginning FY 2024-25; data/raw/dfs/uas-manual-2025.pdf). Each category is a UAS major account class
 * ("31x", "52x", ...), named as the manual names it, except that ad valorem taxes (311) are split out
 * of General Government Taxes (D-19). Ranges are half-open numeric intervals on the account code.
 */
export interface CategoryDef {
  id: string;
  flow: Flow;
  /** Label as the UAS manual names the class (ad valorem split noted). */
  label: string;
  /** Major class slug used as Observation.section. */
  section: string;
  /** UAS class marker as printed in the manual, e.g. "31x.xxx". */
  uasClass: string;
  /** Page of the manual where the class begins ("Revised 11/2025 NN" footer). */
  uasPage: number;
  /** Half-open numeric ranges [from, to) of account codes. */
  ranges: Array<[number, number]>;
}

export const CATEGORIES: CategoryDef[] = [
  { id: 'ad_valorem', flow: 'revenue', label: 'Ad Valorem Taxes', section: 'taxes', uasClass: '311.000', uasPage: 38, ranges: [[311, 312]] },
  { id: 'other_taxes', flow: 'revenue', label: 'General Government Taxes (excluding Ad Valorem Taxes)', section: 'taxes', uasClass: '31x.xxx', uasPage: 38, ranges: [[310, 311], [312, 320]] },
  { id: 'permits_fees_special_assessments', flow: 'revenue', label: 'Permits, Fees, and Special Assessments', section: 'permits_fees_special_assessments', uasClass: '32x.xxx', uasPage: 56, ranges: [[320, 330]] },
  { id: 'intergovernmental', flow: 'revenue', label: 'Intergovernmental Revenues', section: 'intergovernmental', uasClass: '33x.xxx', uasPage: 67, ranges: [[330, 340]] },
  { id: 'charges_for_services', flow: 'revenue', label: 'Charges for Services', section: 'charges_for_services', uasClass: '34x.xxx', uasPage: 86, ranges: [[340, 350]] },
  { id: 'judgments_fines_forfeits', flow: 'revenue', label: 'Judgments, Fines, and Forfeits', section: 'judgments_fines_forfeits', uasClass: '35x.xxx', uasPage: 104, ranges: [[350, 360]] },
  { id: 'miscellaneous', flow: 'revenue', label: 'Miscellaneous Revenues', section: 'miscellaneous', uasClass: '36x.xxx', uasPage: 106, ranges: [[360, 370]] },
  { id: 'other_sources', flow: 'revenue', label: 'Other Sources', section: 'other_sources', uasClass: '38x.xxx', uasPage: 109, ranges: [[380, 390]] },
  { id: 'proprietary_nonoperating_sources', flow: 'revenue', label: 'Proprietary Non-Operating Sources', section: 'proprietary_nonoperating_sources', uasClass: '39x.xxx', uasPage: 114, ranges: [[390, 400]] },
  { id: 'general_government', flow: 'expenditure', label: 'General Government Services (Not-Court Related)', section: 'general_government', uasClass: '51x.xx', uasPage: 118, ranges: [[510, 520]] },
  { id: 'public_safety', flow: 'expenditure', label: 'Public Safety', section: 'public_safety', uasClass: '52x.xx', uasPage: 119, ranges: [[520, 530]] },
  { id: 'physical_environment', flow: 'expenditure', label: 'Physical Environment', section: 'physical_environment', uasClass: '53x.xx', uasPage: 121, ranges: [[530, 540]] },
  { id: 'transportation', flow: 'expenditure', label: 'Transportation', section: 'transportation', uasClass: '54x.xx', uasPage: 122, ranges: [[540, 550]] },
  { id: 'economic_environment', flow: 'expenditure', label: 'Economic Environment', section: 'economic_environment', uasClass: '55x.xx', uasPage: 123, ranges: [[550, 560]] },
  { id: 'human_services', flow: 'expenditure', label: 'Human Services', section: 'human_services', uasClass: '56x.xx', uasPage: 124, ranges: [[560, 570]] },
  { id: 'culture_recreation', flow: 'expenditure', label: 'Culture/Recreation', section: 'culture_recreation', uasClass: '57x.xx', uasPage: 125, ranges: [[570, 580]] },
  { id: 'other_uses', flow: 'expenditure', label: 'Other Uses', section: 'other_uses', uasClass: '58x.xx', uasPage: 126, ranges: [[580, 590]] },
  { id: 'other_nonoperating', flow: 'expenditure', label: 'Other Nonoperating', section: 'other_nonoperating', uasClass: '59x.xx', uasPage: 129, ranges: [[590, 600]] },
  { id: 'court_related', flow: 'expenditure', label: 'Court-Related Expenditures', section: 'court_related', uasClass: '60x.xx to 76x.xx', uasPage: 130, ranges: [[600, 770]] },
];

/** Every category whose ranges contain the code. Exactly one is expected; callers check. */
export function categoriesFor(flow: Flow, code: string): CategoryDef[] {
  const n = Number(code);
  return CATEGORIES.filter((c) => c.flow === flow && c.ranges.some(([a, b]) => n >= a && n < b));
}

/** "311" .. "311.999" style bounds for publishing a half-open range. */
export function rangeLabel([a, b]: [number, number]): { from: string; to: string } {
  return { from: String(a), to: (b - 0.001).toFixed(3) };
}
