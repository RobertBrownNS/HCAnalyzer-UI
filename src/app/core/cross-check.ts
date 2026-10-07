// Per-year cross-check status of a county's EDR figures against the county-filed Annual
// Financial Report, from the source's `crossCheckCoverage` ranges (pipeline, DR-45). Pure.
import { CrossCheckRange, CrossCheckStatus, Flow, SourceRecord } from './models';

/** Neutral display text per status (tooltip line, table column, legend). */
export const CROSS_CHECK_LABELS: Record<CrossCheckStatus, string> = {
  full: 'Cross-checked: matches the county-filed AFR',
  'spot-check': 'Spot-checked against the county-filed AFR',
  'not-checked': 'Not cross-checked against the county-filed AFR',
  mismatch: 'Cross-checked: differences with the county-filed AFR not resolved',
};

/** Short form for the table column. */
export const CROSS_CHECK_SHORT: Record<CrossCheckStatus, string> = {
  full: 'Matches',
  'spot-check': 'Spot-checked',
  'not-checked': 'Not cross-checked',
  mismatch: 'Differences not resolved',
};

/** Status of one fiscal year (inclusive ranges); null when no range covers it. */
export function crossCheckStatus(fiscalYear: number, coverage: readonly CrossCheckRange[]): CrossCheckStatus | null {
  const r = coverage.find((c) => fiscalYear >= c.fromFiscalYear && fiscalYear <= c.toFiscalYear);
  return r ? r.status : null;
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

/** Status for each fiscal year, or null when there is no coverage. */
export function crossCheckByYear(
  years: readonly number[],
  coverage: readonly CrossCheckRange[] | null,
): Map<number, CrossCheckStatus | null> | null {
  if (!coverage) return null;
  return new Map(years.map((fy) => [fy, crossCheckStatus(fy, coverage)]));
}
