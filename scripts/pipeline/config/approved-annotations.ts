import type { ApprovedTransferImbalance, ResearchNote } from '../src/edr/anomalies.js';
import type { ApprovedReclassification } from '../src/logerx/crosscheck.js';

/**
 * Transfer-imbalance annotations that have been reviewed and approved. A year is flagged when
 * |581 transfers out - 381 transfers in|, summed over all funds except custodial, is greater than
 * TRANSFER_IMBALANCE_THRESHOLD ($1,000,000) (DR-40: strictly greater). The build fails if a flagged year is not listed here,
 * or if a listed year is no longer flagged.
 */
export const APPROVED_TRANSFER_IMBALANCES: ApprovedTransferImbalance[] = [
  // QA-01: FY 2022-23 and FY 2023-24 classification break (as filed by the county).
  { jurisdiction: 'hillsborough', fiscalYear: 2023 },
  { jurisdiction: 'hillsborough', fiscalYear: 2024 },
  // User decision (county switch): same treatment as Hillsborough.
  { jurisdiction: 'pinellas', fiscalYear: 2006 },
  { jurisdiction: 'pinellas', fiscalYear: 2022 },
];

/**
 * Research notes requested for one jurisdiction where no other county has a comparable issue.
 * The text is generated from the data; the build fails if the data no longer shows the pattern.
 */
export const RESEARCH_NOTES: ResearchNote[] = [
  // Custodial column present from FY 2020-21 but $0 until FY 2022-23.
  { jurisdiction: 'pinellas', topic: 'custodial-start' },
];

/**
 * DR-47: amounts the county's LOGERX filing and the EDR workbook place under a different fund or
 * account (yearly totals match). Each must be annotated in views where the difference matters; the
 * build fails if a listed difference is not found, and validation fails if a difference is not listed.
 */
export const APPROVED_RECLASSIFICATIONS: ApprovedReclassification[] = [
  // Fund difference: matters when exactly one of the two funds is in the selected fund scope.
  { jurisdiction: 'hillsborough', flow: 'expenditure', fiscalYear: 2015, amount: 1_164_281, funds: ['component_unit', 'internal_service'] },
  // Account difference within one category (335.8 vs 335.9, both intergovernmental): category views.
  { jurisdiction: 'pinellas', flow: 'revenue', fiscalYear: 2014, amount: 2_309_587, categories: ['intergovernmental'] },
];
