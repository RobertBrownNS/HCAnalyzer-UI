import type { Flow } from './accounts.js';

/**
 * Category groupings from the DFS Uniform Accounting System (UAS) Manual. Each category is a UAS
 * major account class ("31x", "52x", ...), named as the 2025 edition names it, except that ad
 * valorem taxes (311) are split out of General Government Taxes (D-19).
 *
 * Year-ranged rows (risk R-08, P3-01): editions checked are 2011 (county), 2019-20, 2021-22, 2022-23
 * and 2025. Class boundaries are the same in all of them except 39x: the 2011 and 2019-20 editions
 * print it as "Other Sources, Continued"; from the 2021-22 edition it is a separate class,
 * "Proprietary Non-Operating Sources". Years before the 2011 edition were not checked.
 */
export interface CategoryRange {
  /** Account codes in [from, to). */
  from: number;
  to: number;
  /** Fiscal years (year ending) the row applies to; open-ended when absent. */
  fromFiscalYear?: number;
  toFiscalYear?: number;
  /** Where the manual places the codes, for this year range. */
  uasReference: string;
  /** Manual editions the reference rests on (source ids); defaults to the 2025 edition. */
  sourceIds?: string[];
}

export interface CategoryDef {
  id: string;
  flow: Flow;
  /** Label as the UAS manual (2025 edition) names the class (ad valorem split noted). */
  label: string;
  /** Major class slug used as Observation.section. */
  section: string;
  ranges: CategoryRange[];
}

/** First fiscal year whose UAS edition (2021-22) makes 39x its own class. */
export const UAS_39X_SPLIT_FISCAL_YEAR = 2022;

const ref = (cls: string, page: number) => `UAS Manual, 2025 edition, class ${cls}, p. ${page}`;
const all = (from: number, to: number, uasReference: string): CategoryRange => ({ from, to, uasReference });

export const CATEGORIES: CategoryDef[] = [
  { id: 'ad_valorem', flow: 'revenue', label: 'Ad Valorem Taxes', section: 'taxes', ranges: [all(311, 312, ref('311.000', 38))] },
  { id: 'other_taxes', flow: 'revenue', label: 'General Government Taxes (excluding Ad Valorem Taxes)', section: 'taxes', ranges: [all(310, 311, ref('31x.xxx', 38)), all(312, 320, ref('31x.xxx', 38))] },
  { id: 'permits_fees_special_assessments', flow: 'revenue', label: 'Permits, Fees, and Special Assessments', section: 'permits_fees_special_assessments', ranges: [all(320, 330, ref('32x.xxx', 56))] },
  { id: 'intergovernmental', flow: 'revenue', label: 'Intergovernmental Revenues', section: 'intergovernmental', ranges: [all(330, 340, ref('33x.xxx', 67))] },
  { id: 'charges_for_services', flow: 'revenue', label: 'Charges for Services', section: 'charges_for_services', ranges: [all(340, 350, ref('34x.xxx', 86))] },
  { id: 'judgments_fines_forfeits', flow: 'revenue', label: 'Judgments, Fines, and Forfeits', section: 'judgments_fines_forfeits', ranges: [all(350, 360, ref('35x.xxx', 104))] },
  { id: 'miscellaneous', flow: 'revenue', label: 'Miscellaneous Revenues', section: 'miscellaneous', ranges: [all(360, 370, ref('36x.xxx', 106))] },
  {
    id: 'other_sources', flow: 'revenue', label: 'Other Sources', section: 'other_sources',
    ranges: [
      all(380, 390, ref('38x.xxx', 109)),
      { from: 390, to: 400, toFiscalYear: UAS_39X_SPLIT_FISCAL_YEAR - 1, uasReference: 'UAS Manual, 2019-20 and 2011 editions: class 39x "Other Sources, Continued"', sourceIds: ['dfs-uas-manual-2019-20', 'dfs-uas-manual-2011-county'] },
    ],
  },
  {
    id: 'proprietary_nonoperating_sources', flow: 'revenue', label: 'Proprietary Non-Operating Sources', section: 'proprietary_nonoperating_sources',
    ranges: [{ from: 390, to: 400, fromFiscalYear: UAS_39X_SPLIT_FISCAL_YEAR, uasReference: `${ref('39x.xxx', 114)} (separate class from the 2021-22 edition)`, sourceIds: ['dfs-uas-manual-2025', 'dfs-uas-manual-2021-22'] }],
  },
  { id: 'general_government', flow: 'expenditure', label: 'General Government Services (Not-Court Related)', section: 'general_government', ranges: [all(510, 520, ref('51x.xx', 118))] },
  { id: 'public_safety', flow: 'expenditure', label: 'Public Safety', section: 'public_safety', ranges: [all(520, 530, ref('52x.xx', 119))] },
  { id: 'physical_environment', flow: 'expenditure', label: 'Physical Environment', section: 'physical_environment', ranges: [all(530, 540, ref('53x.xx', 121))] },
  { id: 'transportation', flow: 'expenditure', label: 'Transportation', section: 'transportation', ranges: [all(540, 550, ref('54x.xx', 122))] },
  { id: 'economic_environment', flow: 'expenditure', label: 'Economic Environment', section: 'economic_environment', ranges: [all(550, 560, ref('55x.xx', 123))] },
  { id: 'human_services', flow: 'expenditure', label: 'Human Services', section: 'human_services', ranges: [all(560, 570, ref('56x.xx', 124))] },
  { id: 'culture_recreation', flow: 'expenditure', label: 'Culture/Recreation', section: 'culture_recreation', ranges: [all(570, 580, ref('57x.xx', 125))] },
  { id: 'other_uses', flow: 'expenditure', label: 'Other Uses', section: 'other_uses', ranges: [all(580, 590, ref('58x.xx', 126))] },
  {
    id: 'other_nonoperating', flow: 'expenditure', label: 'Other Nonoperating', section: 'other_nonoperating',
    ranges: [{ ...all(590, 600, `${ref('59x.xx', 129)}; also a separate class in the 2011, 2019-20, 2021-22 and 2022-23 editions`), sourceIds: ['dfs-uas-manual-2025', 'dfs-uas-manual-2022-23', 'dfs-uas-manual-2021-22', 'dfs-uas-manual-2019-20', 'dfs-uas-manual-2011-county'] }],
  },
  { id: 'court_related', flow: 'expenditure', label: 'Court-Related Expenditures', section: 'court_related', ranges: [all(600, 770, ref('60x.xx to 76x.xx', 130))] },
];

const inYears = (r: CategoryRange, fiscalYear: number) =>
  (r.fromFiscalYear === undefined || fiscalYear >= r.fromFiscalYear) && (r.toFiscalYear === undefined || fiscalYear <= r.toFiscalYear);

/** Every category whose ranges contain the code in that fiscal year. Exactly one is expected; callers check. */
export function categoriesFor(flow: Flow, code: string, fiscalYear: number): CategoryDef[] {
  const n = Number(code);
  return CATEGORIES.filter((c) => c.flow === flow && c.ranges.some((r) => n >= r.from && n < r.to && inYears(r, fiscalYear)));
}

/** Published form of a range: "311" .. "311.999" plus the optional year bounds and reference. */
export function rangeLabel(r: CategoryRange): { from: string; to: string; fromFiscalYear?: number; toFiscalYear?: number; uasReference: string; sourceIds: string[] } {
  return {
    from: String(r.from),
    to: (r.to - 0.001).toFixed(3),
    ...(r.fromFiscalYear !== undefined ? { fromFiscalYear: r.fromFiscalYear } : {}),
    ...(r.toFiscalYear !== undefined ? { toFiscalYear: r.toFiscalYear } : {}),
    uasReference: r.uasReference,
    sourceIds: r.sourceIds ?? ['dfs-uas-manual-2025'],
  };
}
