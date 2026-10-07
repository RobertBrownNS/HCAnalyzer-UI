import type { Flow } from '../edr/accounts.js';
import type { AfrSheet } from '../edr/afr.js';
import { COUNTY_AFR_CHECKS } from '../edr/county-afr-checks.js';
import type { Observation } from '../edr/observations.js';
import { fiscalYearLabel } from '../lib/fiscal.js';
import { aggregateExtract, reconcile, type Reconciliation } from './logerx.js';

/**
 * Source-level status (DR-45). "full" only when every workbook year is reconciled and matches;
 * "partial" when some years are reconciled and others are not checked (or differ).
 */
export type CrossCheckStatus = 'not-checked' | 'spot-check' | 'partial' | 'full';

/** Status of one fiscal-year range. "mismatch": reconciled, with unresolved differences. */
export type CoverageStatus = 'not-checked' | 'spot-check' | 'full' | 'mismatch';

export interface CoverageRange {
  fromFiscalYear: number;
  toFiscalYear: number;
  status: CoverageStatus;
}

export interface FlowCrossCheck {
  flow: Flow;
  status: CrossCheckStatus;
  coverage: CoverageRange[];
  summary: string;
  caveats: string[];
  reconciliations: Reconciliation[];
}

/** Year ranges [from, to] from a sorted list of years. */
function ranges(years: number[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const y of [...new Set(years)].sort((a, b) => a - b)) {
    const last = out.at(-1);
    if (last && y === last[1] + 1) last[1] = y;
    else out.push([y, y]);
  }
  return out;
}

const span = ([a, b]: [number, number]) => (a === b ? fiscalYearLabel(a) : `${fiscalYearLabel(a)} to ${fiscalYearLabel(b)}`);

/**
 * Cross-check status, coverage and wording for one county and flow, derived only from the data:
 * LOGERX extracts present -> "full" for those years (with exact match counts); otherwise county AFR
 * spot checks -> "spot-check"; otherwise "not-checked". Never claims more than was compared.
 */
export function flowCrossCheck(
  jurisdiction: string,
  flow: Flow,
  sheets: AfrSheet[],
  observations: Observation[],
  extracts: Array<{ fiscalYear: number; flow: Flow; csv: string }>,
  preCoverageNotes: string[],
): FlowCrossCheck {
  const edrYears = sheets.map((s) => s.fiscalYear).sort((a, b) => a - b);
  const mine = extracts.filter((e) => e.flow === flow).sort((a, b) => a.fiscalYear - b.fiscalYear);
  const reconciliations = mine.map((e) => reconcile(jurisdiction, e.fiscalYear, flow, aggregateExtract(e.csv), observations));
  const checkedYears = reconciliations.map((r) => r.fiscalYear).filter((y) => edrYears.includes(y));
  const uncheckedYears = edrYears.filter((y) => !checkedYears.includes(y));
  const spot = COUNTY_AFR_CHECKS.filter((c) => c.jurisdiction === jurisdiction);
  const spotYears = [...new Set(spot.map((c) => c.fiscalYear))].sort((a, b) => a - b);
  const flowWord = flow === 'revenue' ? 'revenue' : 'expenditure';

  const diffYears = reconciliations.filter((r) => r.mismatches.length + r.onlyLogerx.length + r.onlyEdr.length).map((r) => r.fiscalYear);
  const cleanYears = checkedYears.filter((y) => !diffYears.includes(y));
  const coverage: CoverageRange[] = [
    ...ranges(cleanYears).map(([a, b]) => ({ fromFiscalYear: a, toFiscalYear: b, status: 'full' as const })),
    ...ranges(diffYears).map(([a, b]) => ({ fromFiscalYear: a, toFiscalYear: b, status: 'mismatch' as const })),
    ...ranges(uncheckedYears).map(([a, b]) => ({ fromFiscalYear: a, toFiscalYear: b, status: 'not-checked' as const })),
  ].sort((a, b) => a.fromFiscalYear - b.fromFiscalYear);

  const parts: string[] = [];
  let status: CrossCheckStatus;
  if (reconciliations.length) {
    status = uncheckedYears.length || diffYears.length ? 'partial' : 'full';
    const cells = reconciliations.reduce((s, r) => s + r.cells, 0);
    const match = reconciliations.reduce((s, r) => s + r.match, 0);
    parts.push(
      `Cross-checked cell by cell against the Annual Financial Report data filed with the Florida Department of Financial Services (LOGERX) for ${ranges(checkedYears).map(span).join(', ')}: ` +
        (diffYears.length
          ? `${match.toLocaleString('en-US')} of ${cells.toLocaleString('en-US')} ${flowWord} values match; ${(cells - match).toLocaleString('en-US')} cell differences (${ranges(diffYears).map(span).join(', ')}), ` +
            `${reconciliations.every((r) => Math.abs(r.logerxTotal - r.edrTotal) < 0.5) ? 'yearly totals match' : 'yearly totals differ'}; listed in the project validation report.`
          : `all ${cells.toLocaleString('en-US')} ${flowWord} values match.`),
    );
  } else if (spot.length) {
    status = 'spot-check';
  } else {
    status = 'not-checked';
  }
  if (spot.length) {
    parts.push(
      `Spot check: ${spot.length} values in the county-filed Annual Financial Reports for ${span([spotYears[0], spotYears.at(-1)!])} (the Florida Department of Financial Services form, as published by the county Clerk) match the EDR workbook.`,
    );
  }
  if (uncheckedYears.length && reconciliations.length) {
    parts.splice(1, 0, `${ranges(uncheckedYears).map(span).join(', ')} not cross-checked (before LOGERX coverage); values for those years are reconciled to the EDR workbook totals.`);
  }
  parts.push(...preCoverageNotes);
  const summary = parts.length ? parts.join(' ') : 'Not cross-checked against the county-filed Annual Financial Report.';
  return { flow, status, coverage, summary, caveats: reconciliations.length ? [summary] : [], reconciliations };
}

/** Sentences for approved transfer-imbalance years that fall before LOGERX coverage. */
export function preCoverageTransferNotes(approvedYears: number[], firstCheckedYear: number | null): string[] {
  if (firstCheckedYear === null) return [];
  return approvedYears
    .filter((y) => y < firstCheckedYear)
    .sort((a, b) => a - b)
    .map((y) => `The ${fiscalYearLabel(y)} transfer imbalance is before LOGERX coverage and is not cross-checked against the county-filed Annual Financial Report.`);
}

/** The cross-check fields as published on an EDR AFR source in sources.json. */
export interface PublishedCrossCheck {
  id: string;
  caveats: string[];
  countyAfrCrossCheck?: string;
  crossCheckSummary?: string;
  crossCheckCoverage?: Array<{ fromFiscalYear: number; toFiscalYear: number; status: string }>;
}

/**
 * Problems with a published source's cross-check fields, compared with what the data supports.
 * Empty when consistent. Used by validation; pure so it can be unit-tested.
 */
export function crossCheckSourceProblems(
  src: PublishedCrossCheck,
  derived: FlowCrossCheck,
  workbookYears: number[],
  notCheckedCaveat: string,
): string[] {
  const problems: string[] = [];
  if (src.countyAfrCrossCheck !== derived.status) problems.push(`${src.id}: countyAfrCrossCheck ${src.countyAfrCrossCheck}, data says ${derived.status}`);
  if (src.countyAfrCrossCheck === 'full' && (src.crossCheckCoverage ?? []).some((r) => r.status !== 'full')) {
    problems.push(`${src.id}: "full" but some years are not fully reconciled`);
  }
  if (!src.crossCheckSummary) problems.push(`${src.id}: no crossCheckSummary`);
  const covered = (src.crossCheckCoverage ?? [])
    .flatMap((r) => Array.from({ length: r.toFiscalYear - r.fromFiscalYear + 1 }, (_, i) => r.fromFiscalYear + i))
    .sort((a, b) => a - b);
  if (covered.join(',') !== [...workbookYears].sort((a, b) => a - b).join(',')) problems.push(`${src.id}: crossCheckCoverage does not cover each workbook year once`);
  const hasCaveat = src.caveats.includes(notCheckedCaveat);
  if ((derived.status === 'not-checked') !== hasCaveat) problems.push(`${src.id}: DR-42 caveat ${hasCaveat ? 'present' : 'missing'}`);
  if (src.caveats.some((c) => c.startsWith('Not cross-checked') && c !== notCheckedCaveat)) problems.push(`${src.id}: caveat differs from DR-42 text`);
  const cells = derived.reconciliations.reduce((n, r) => n + r.cells, 0);
  const match = derived.reconciliations.reduce((n, r) => n + r.match, 0);
  const summary = src.crossCheckSummary ?? '';
  if (cells !== match && /all [\d,]+ \w+ values match/.test(summary)) problems.push(`${src.id}: summary claims all values match but differences exist`);
  if (derived.reconciliations.length) {
    // The counts in the summary must be the reconciliation counts reported in data/validation.md.
    const m = /: (?:all ([\d,]+)|([\d,]+) of ([\d,]+)) \w+ values match/.exec(summary);
    const toN = (x?: string) => (x ? Number(x.replace(/,/g, '')) : NaN);
    const [sMatch, sCells] = m ? (m[1] ? [toN(m[1]), toN(m[1])] : [toN(m[2]), toN(m[3])]) : [NaN, NaN];
    if (sMatch !== match || sCells !== cells) problems.push(`${src.id}: summary counts (${sMatch} of ${sCells}) differ from the reconciliation (${match} of ${cells})`);
  }
  return problems;
}
