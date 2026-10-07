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
  /** "mismatch" ranges only: amounts present in both sources but under a different account or fund. */
  classificationDifferences?: number;
  /** "mismatch" ranges only: same account and fund, different amount. */
  valueDifferences?: number;
  /** "mismatch" ranges only: amounts present in one source with no counterpart of equal value in the other. */
  unmatchedAmounts?: number;
  /** "mismatch" ranges only: LOGERX and EDR yearly totals are equal in every year of the range. */
  totalsMatch?: boolean;
}

/**
 * Differences in one reconciliation, grouped: an amount found only in LOGERX that equals an amount
 * found only in EDR (same fiscal year and flow) is one amount classified differently.
 */
export function classifyDifferences(r: Reconciliation): { classificationDifferences: number; valueDifferences: number; unmatchedAmounts: number } {
  const edrOnly = r.onlyEdr.map((d) => d.edr!);
  let paired = 0;
  for (const d of r.onlyLogerx) {
    const i = edrOnly.findIndex((v) => Math.abs(v - d.logerx!) < 0.5);
    if (i >= 0) { edrOnly.splice(i, 1); paired++; }
  }
  return {
    classificationDifferences: paired,
    valueDifferences: r.mismatches.length,
    unmatchedAmounts: r.onlyLogerx.length - paired + edrOnly.length,
  };
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
    ...ranges(diffYears).map(([a, b]) => {
      const inRange = reconciliations.filter((r) => r.fiscalYear >= a && r.fiscalYear <= b);
      const counts = inRange.map(classifyDifferences);
      return {
        fromFiscalYear: a,
        toFiscalYear: b,
        status: 'mismatch' as const,
        classificationDifferences: counts.reduce((n, c) => n + c.classificationDifferences, 0),
        valueDifferences: counts.reduce((n, c) => n + c.valueDifferences, 0),
        unmatchedAmounts: counts.reduce((n, c) => n + c.unmatchedAmounts, 0),
        totalsMatch: inRange.every((r) => Math.abs(r.logerxTotal - r.edrTotal) < 0.5),
      };
    }),
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
  if (reconciliations.length) {
    // QA-30: the comparison shows EDR transcribes the county's filing; it does not audit the figures.
    parts.push("The comparison checks EDR's transcription of the county's filing; it is not an audit of the county's figures.");
  }
  if (uncheckedYears.length && reconciliations.length) {
    parts.splice(2, 0, `${ranges(uncheckedYears).map(span).join(', ')} not cross-checked (before LOGERX coverage); values for those years are reconciled to the EDR workbook totals.`);
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

/** A LOGERX/EDR classification difference approved for a chart annotation (DR-47). */
export interface ApprovedReclassification {
  jurisdiction: string;
  flow: Flow;
  fiscalYear: number;
  /** The amount that sits under a different account or fund in the two sources. */
  amount: number;
  /** Annotation scope (see Annotation.funds / Annotation.categories). Neither: drawer only. */
  funds?: string[];
  categories?: string[];
}

export interface ReclassificationNote {
  fiscalYear: number;
  flow: Flow;
  amount: number;
  logerx: { account: string; fundType: string };
  edr: { account: string; fundType: string; ref: string };
}

/** Pairs of one-sided cells with equal amounts (one amount classified differently), per reconciliation. */
export function reclassificationPairs(r: Reconciliation): ReclassificationNote[] {
  const edrOnly = [...r.onlyEdr];
  const out: ReclassificationNote[] = [];
  for (const d of r.onlyLogerx) {
    const i = edrOnly.findIndex((e) => Math.abs(e.edr! - d.logerx!) < 0.5);
    if (i < 0) continue;
    const e = edrOnly.splice(i, 1)[0];
    out.push({ fiscalYear: r.fiscalYear, flow: r.flow, amount: d.logerx!, logerx: { account: d.account, fundType: d.fundType }, edr: { account: e.account, fundType: e.fundType, ref: e.ref! } });
  }
  return out;
}
