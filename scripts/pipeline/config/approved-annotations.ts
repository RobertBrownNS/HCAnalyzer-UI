import type { ApprovedTransferImbalance, ResearchNote } from '../src/edr/anomalies.js';

/**
 * Transfer-imbalance annotations that have been reviewed and approved. A year is flagged when
 * |581 transfers out - 381 transfers in|, summed over all funds except custodial, exceeds
 * TRANSFER_IMBALANCE_THRESHOLD ($1,000,000). The build fails if a flagged year is not listed here,
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
