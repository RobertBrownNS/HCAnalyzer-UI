// Per-year cross-check status of a county's EDR figures against the county-filed Annual
// Financial Report, from the source's `crossCheckCoverage` ranges (pipeline, DR-45). Pure.
import { formatUsd } from './format';
import { AfrObservation, AnnotationRecord, CrossCheckRange, CrossCheckStatus, Flow, SourceRecord } from './models';

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

const amounts = (n: number) => `${n} ${n === 1 ? 'amount' : 'amounts'}`;

/**
 * One year's cross-check as the current view shows it. `selectionDifference`: the fund selection
 * holds only part of a reclassified pair, so its total differs from the county filing by this
 * amount, even though the yearly total for all funds matches (QA-40).
 */
export interface YearCrossCheck extends CrossCheckRange {
  selectionDifference?: number;
}

/**
 * Text for one year in the tooltip and table. For a mismatch year it says whether the yearly total
 * matches (only when the data says so: `totalsMatch`) and what differs, from the data's counts.
 * Today's mismatch years read "Total matches; 1 amount classified differently" (QA-35).
 */
export function crossCheckYearText(range: Omit<YearCrossCheck, 'fromFiscalYear' | 'toFiscalYear'>, form: 'long' | 'short' = 'long'): string {
  const status = range.status;
  if (range.selectionDifference) {
    const amount = formatUsd(range.selectionDifference);
    return form === 'long'
      ? `Total for this fund selection differs from the county filing by ${amount} (an amount classified differently)`
      : `Total for these funds differs by ${amount}; an amount classified differently`;
  }
  if (status !== 'mismatch') return form === 'long' ? CROSS_CHECK_LABELS[status] : CROSS_CHECK_SHORT[status];
  const prefix =
    range.totalsMatch === true ? 'Total matches' : range.totalsMatch === false ? 'Total differs from the county filing' : 'Cross-checked';
  const parts: string[] = [];
  if (range.classificationDifferences) parts.push(`${amounts(range.classificationDifferences)} classified differently`);
  if (range.valueDifferences) parts.push(`${amounts(range.valueDifferences)} differ`);
  if (range.unmatchedAmounts) parts.push(`${amounts(range.unmatchedAmounts)} in only one source`);
  // No counts in the data: the decided fallback wording (QA-35).
  if (!parts.length) parts.push('an amount classified differently');
  return [prefix, ...parts].join('; ');
}

/**
 * Legend text for mismatch markers. The decided wording (QA-35) when every mismatch year in view
 * has matching totals; otherwise a general statement that does not claim the totals match.
 */
export function mismatchLegendLabel(ranges: readonly Pick<CrossCheckRange, 'totalsMatch'>[]): string {
  return ranges.length && ranges.every((r) => r.totalsMatch === true)
    ? CROSS_CHECK_LABELS.mismatch
    : 'Cross-checked: some amounts differ from the county filing';
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

/**
 * Applies the fund selection to each year's cross-check (QA-40). A reconciliation difference
 * between funds (annotation topic `reconciliation-difference` with `funds`) moves an amount from
 * one fund to another, so the all-funds total matches the county filing. When the selection holds
 * some but not all of those funds, the selection's total differs by that amount: the sum of the
 * EDR cells the annotation names (`cells`, account + fund, same county, flow and year). No
 * selection (= all funds), or a selection holding none or all of them, leaves the year unchanged.
 */
export function withFundSelection(
  byYear: ReadonlyMap<number, CrossCheckRange | null> | null,
  annotations: readonly AnnotationRecord[],
  observations: readonly AfrObservation[],
  scope: { jurisdiction: string; flow: Flow; funds?: readonly string[] },
): Map<number, YearCrossCheck | null> | null {
  if (!byYear) return null;
  const out = new Map<number, YearCrossCheck | null>(byYear);
  const selected = scope.funds;
  if (!selected || selected.length === 0) return out;
  for (const a of annotations) {
    if (a.topic !== 'reconciliation-difference' || !a.funds || !a.cells) continue;
    if (a.jurisdiction !== undefined && a.jurisdiction !== scope.jurisdiction) continue;
    if (a.flow !== undefined && a.flow !== scope.flow) continue;
    const range = out.get(a.fiscalYear);
    if (!range) continue;
    const inSelection = a.funds.filter((f) => selected.includes(f)).length;
    if (inSelection === 0 || inSelection === a.funds.length) continue;
    const cells = a.cells;
    const amount = observations
      .filter(
        (o) =>
          o.jurisdiction === scope.jurisdiction &&
          o.flow === scope.flow &&
          o.fiscalYear === a.fiscalYear &&
          cells.some((c) => c.fundType === o.fundType && Number(c.account) === Number(o.account)),
      )
      .reduce((sum, o) => sum + o.amount, 0);
    if (!amount) continue;
    out.set(a.fiscalYear, {
      ...range,
      totalsMatch: false,
      selectionDifference: ((range as YearCrossCheck).selectionDifference ?? 0) + Math.abs(amount),
    });
  }
  return out;
}
