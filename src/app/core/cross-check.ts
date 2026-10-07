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

/** What is in view: county, flow, fund selection (none = all), custodial, and a category (drawer). */
export interface CrossCheckScope {
  jurisdiction: string;
  flow: Flow;
  funds?: readonly string[];
  includeCustodial?: boolean;
  category?: string | null;
}

/**
 * One year's cross-check for what is in view (QA-40 and its addendum). A mismatch year's
 * difference is a reclassification recorded as a `reconciliation-difference` annotation: `cells`
 * (account + fund) name the EDR amount, `funds` (optional) the pair of funds it moves between.
 * - The fund selection holds one side of `funds`, and the amount's category is in view: the
 *   selection's total differs from the county filing by the amount (`selectionDifference`).
 * - Otherwise, when no reclassified cell is in view (another fund or category), every difference
 *   the source counted is outside the view, so the view matches the filing: status `full`.
 * - Otherwise (the amount is in view with both sides selected) the year is unchanged: "Total
 *   matches; 1 amount classified differently".
 * The view only counts as matching when the annotations account for every counted difference
 * (classification differences only, one annotation each); anything else is left as the source says.
 */
export function crossCheckInScope(
  range: CrossCheckRange | null,
  fiscalYear: number,
  annotations: readonly AnnotationRecord[],
  observations: readonly AfrObservation[],
  scope: CrossCheckScope,
): YearCrossCheck | null {
  if (!range || range.status !== 'mismatch') return range;
  const notes = annotations.filter(
    (a) =>
      a.topic === 'reconciliation-difference' &&
      a.cells?.length &&
      a.fiscalYear === fiscalYear &&
      (a.jurisdiction === undefined || a.jurisdiction === scope.jurisdiction) &&
      (a.flow === undefined || a.flow === scope.flow),
  );
  if (!notes.length) return range;
  const selected = scope.funds && scope.funds.length ? scope.funds : null;
  const fundInView = (fund: string) =>
    fund === 'custodial' ? !!scope.includeCustodial : selected === null || selected.includes(fund);

  let difference = 0;
  let inView = 0;
  for (const a of notes) {
    const cells = a.cells!;
    const amounts = observations.filter(
      (o) =>
        o.jurisdiction === scope.jurisdiction &&
        o.flow === scope.flow &&
        o.fiscalYear === fiscalYear &&
        cells.some((c) => c.fundType === o.fundType && Number(c.account) === Number(o.account)),
    );
    // A category view only sees amounts in that category (both sides of a pair share it).
    if (scope.category && !amounts.some((o) => o.category === scope.category)) continue;
    const sides = a.funds ? a.funds.filter(fundInView).length : 0;
    if (a.funds && sides > 0 && sides < a.funds.length) {
      difference += Math.abs(amounts.reduce((sum, o) => sum + o.amount, 0));
    } else if (amounts.some((o) => fundInView(o.fundType))) {
      inView++;
    }
  }
  if (difference) return { ...range, totalsMatch: false, selectionDifference: difference };
  const explained =
    !range.valueDifferences && !range.unmatchedAmounts && notes.length >= (range.classificationDifferences ?? 1);
  if (inView === 0 && explained) {
    const { classificationDifferences: _c, totalsMatch: _t, ...rest } = range;
    return { ...rest, status: 'full' };
  }
  return range;
}

/** crossCheckInScope for every year of a view (the total line: no category). */
export function crossCheckByYearInScope(
  byYear: ReadonlyMap<number, CrossCheckRange | null> | null,
  annotations: readonly AnnotationRecord[],
  observations: readonly AfrObservation[],
  scope: CrossCheckScope,
): Map<number, YearCrossCheck | null> | null {
  if (!byYear) return null;
  return new Map(
    [...byYear].map(([fy, range]) => [fy, crossCheckInScope(range, fy, annotations, observations, { ...scope, category: null })]),
  );
}
