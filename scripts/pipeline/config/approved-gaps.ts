import type { ApprovedGap } from '../src/edr/anomalies.js';

/**
 * Drop-and-recover gaps (found by `findGaps`, listed in data/validation.md) that have been reviewed
 * and approved for a chart annotation. Each entry must still be found by the scan, or the build fails.
 * Add entries only after review, to keep charts readable.
 */
export const APPROVED_GAPS: ApprovedGap[] = [
  // QA-09: FY 2023-24 proprietary funds and component units.
  {
    jurisdiction: 'hillsborough',
    flow: 'expenditure',
    fiscalYear: 2024,
    scopes: ['fund:enterprise', 'fund:internal_service', 'fund:component_unit', 'section:physical_environment'],
    topic: 'proprietary-fund-gap',
  },
  // User decision 2026-10-06 (decisions.md): annotate filing breaks only. Court-related and public
  // safety, FY 2022-23 and FY 2023-24, are described in the transfer-imbalance annotations for those years.
  {
    jurisdiction: 'hillsborough',
    flow: 'expenditure',
    fiscalYear: 2023,
    scopes: ['section:court_related', 'section:public_safety'],
    coveredBy: 'transfer-imbalance',
  },
];
