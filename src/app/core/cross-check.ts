// Per-year cross-check status of a county's EDR figures against the county-filed Annual
// Financial Report, from the source's `crossCheckCoverage` ranges (pipeline, DR-45). Pure.
import { CrossCheckRange, CrossCheckStatus, Flow, SourceRecord } from './models';

/** Neutral display text per status (tooltip line, table column, legend). */
export const CROSS_CHECK_LABELS: Record<CrossCheckStatus, string> = {
  full: 'Cross-checked: matches the county-filed AFR',
  'spot-check': 'Spot-checked against the county-filed AFR',
  'not-checked': 'Not cross-checked against the county-filed AFR',
  // Both mismatch years so far are reclassifications with equal yearly totals (DR-47), and every
  // view plots totals: the wording must not suggest the plotted number is disputed (QA-35).
  mismatch: 'Cross-checked: yearly total matches; an amount is classified differently in the county filing',
};

/** Short form for the table column. */
export const CROSS_CHECK_SHORT: Record<CrossCheckStatus, string> = {
  full: 'Matches',
  'spot-check': 'Spot-checked',
  'not-checked': 'Not cross-checked',
  mismatch: 'Total matches; an amount classified differently',
};

/**
 * Text for one year in the tooltip and table. For a mismatch year it says the total matches and
 * how many amounts are classified differently, from the data when it gives a count.
 */
export function crossCheckYearText(range: Pick<CrossCheckRange, 'status' | 'classificationDifferences'>, form: 'long' | 'short' = 'long'): string {
  const status = range.status;
  if (status !== 'mismatch') return form === 'long' ? CROSS_CHECK_LABELS[status] : CROSS_CHECK_SHORT[status];
  const n = range.classificationDifferences;
  return typeof n === 'number' && n > 0
    ? `Total matches; ${n} ${n === 1 ? 'amount' : 'amounts'} classified differently`
    : CROSS_CHECK_SHORT.mismatch;
}

/** The range covering one fiscal year (inclusive); null when none does. */
export function crossCheckRange(fiscalYear: number, coverage: readonly CrossCheckRange[]): CrossCheckRange | null {
  return coverage.find((c) => fiscalYear >= c.fromFiscalYear && fiscalYear <= c.toFiscalYear) ?? null;
}

/** Status of one fiscal year (inclusive ranges); null when no range covers it. */
export function crossCheckStatus(fiscalYear: number, coverage: readonly CrossCheckRange[]): CrossCheckStatus | null {
  return crossCheckRange(fiscalYear, coverage)?.status ?? null;
}

/**
 * Coverage of the EDR AFR source behind one county and flow: the source its observations cite.
 * Null when that source has no coverage (then nothing is shown; nothing is guessed).
 */
export function coverageFor(
  sources: readonly SourceRecord[],
  observations: readonly { flow: Flow; jurisdiction: string; sourceId: string }[],
  county: string,
  flow: Flow,
): readonly CrossCheckRange[] | null {
  const id = observations.find((o) => o.flow === flow && o.jurisdiction === county)?.sourceId;
  const coverage = sources.find((s) => s.id === id)?.crossCheckCoverage;
  return coverage && coverage.length ? coverage : null;
}

/** The covering range (status, optional count) for each fiscal year, or null when there is no coverage. */
export function crossCheckByYear(
  years: readonly number[],
  coverage: readonly CrossCheckRange[] | null,
): Map<number, CrossCheckRange | null> | null {
  if (!coverage) return null;
  return new Map(years.map((fy) => [fy, crossCheckRange(fy, coverage)]));
}
