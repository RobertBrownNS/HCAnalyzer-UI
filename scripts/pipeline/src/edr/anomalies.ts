import { fiscalYearLabel } from '../lib/fiscal.js';
import { classifyAccount, type Flow } from './accounts.js';
import { colLetter, type AfrSheet } from './afr.js';
import type { PopulationValue } from './population.js';

/**
 * Data-derived annotations and caveats for known reporting irregularities. Every number in the
 * generated text is computed from the parsed workbooks, so the wording stays factual and the
 * figures can't drift from the data. Nothing here changes a published value.
 */

export const ANNOTATION_TOPICS = [
  'gasb84',
  'transfer-imbalance',
  'proprietary-fund-gap',
  'fund-gap',
  'rounding',
  'source-anomaly',
  'custodial-accounts',
  'custodial-zero',
  'custodial-start',
  'population-source',
] as const;
export type AnnotationTopic = (typeof ANNOTATION_TOPICS)[number];

/** Measure names as used by the app (src/app/core/models.ts `Measure`). */
export type Measure = 'nominal' | 'per_capita' | 'real' | 'real_per_capita';

export interface Annotation {
  fiscalYear: number;
  label: string;
  kind: 'methodology' | 'policy' | 'event';
  sourceId: string;
  /** Machine-readable category, so the UI can match annotations without parsing labels. */
  topic?: AnnotationTopic;
  /** Present when the annotation is specific to one jurisdiction. */
  jurisdiction?: string;
  /** Present when the annotation applies to revenues or expenditures only. */
  flow?: Flow;
  /** Show only when the custodial toggle matches. */
  custodial?: 'included' | 'excluded';
  /** Show only for these measures. */
  measures?: Measure[];
  /** Longer factual text for the source drawer. */
  detail?: string;
  /** Workbook cells ("2023!D16") the annotation's figures come from. */
  refs?: string[];
}

/** |transfers out - transfers in| strictly above this is reported (DR-40: one rule for pipeline and transform). */
export const TRANSFER_IMBALANCE_THRESHOLD = 1_000_000;
/** A fiscal year/flow counts as "reported rounded" when more than this share of amounts are whole thousands. */
export const ROUNDED_SHARE = 0.9;
/** Year-over-year change (non-custodial) reported in the validation NOTE section. */
export const SWING_THRESHOLD = 0.25;

export const TRANSFERS_IN = '381';
export const TRANSFERS_OUT = '581';

export function money(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  return `${sign}$${Math.round(abs).toLocaleString('en-US')}`;
}

const exact = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US')}`;

/** Workbook names used in refs: "revenues:2023!P124", "expenditures:2023!D16", "population:2010 Census!B31". */
export type RefWorkbook = 'revenues' | 'expenditures' | 'population';

/** Qualified cell reference into one of the EDR AFR workbooks. */
export function qref(sheet: AfrSheet, address: string): string {
  return `${sheet.flow === 'revenue' ? 'revenues' : 'expenditures'}:${sheet.sheetName}!${address}`;
}

/** FLcopops.xlsx keeps countywide population in column B. */
export function populationRef(v: PopulationValue): string {
  return `population:${v.sheet}!B${v.row}`;
}

function rowTotalRef(sheet: AfrSheet, account: string): string | null {
  const row = sheet.accounts.find((a) => a.account === account);
  return row ? qref(sheet, `${colLetter(sheet.totalCol)}${row.row}`) : null;
}

function accountTotal(sheet: AfrSheet | undefined, account: string, excludeCustodial = false): number {
  const row = sheet?.accounts.find((a) => a.account === account);
  if (!row) return 0;
  return row.values.filter((v) => !excludeCustodial || v.fundType !== 'custodial').reduce((s, v) => s + v.amount, 0);
}

export function sectionTotal(sheet: AfrSheet, section: string, excludeCustodial: boolean): number {
  let sum = 0;
  for (const a of sheet.accounts) {
    if (classifyAccount(sheet.flow, a.account).section !== section) continue;
    for (const v of a.values) if (!excludeCustodial || v.fundType !== 'custodial') sum += v.amount;
  }
  return sum;
}

export function totalExclCustodial(sheet: AfrSheet): number {
  return sheet.accounts.reduce((s, a) => s + a.values.reduce((t, v) => t + (v.fundType === 'custodial' ? 0 : v.amount), 0), 0);
}

export interface TransferBalance {
  fiscalYear: number;
  transfersIn: number;
  transfersOut: number;
  /** out - in */
  difference: number;
  flagged: boolean;
}

export function transferBalances(revenues: AfrSheet[], expenditures: AfrSheet[]): TransferBalance[] {
  const rev = new Map(revenues.map((s) => [s.fiscalYear, s]));
  return expenditures
    .filter((s) => rev.has(s.fiscalYear))
    .map((exp) => {
      // Custodial amounts are excluded: they are not transfers between the county's own funds.
      const transfersIn = accountTotal(rev.get(exp.fiscalYear), TRANSFERS_IN, true);
      const transfersOut = accountTotal(exp, TRANSFERS_OUT, true);
      const difference = transfersOut - transfersIn;
      return { fiscalYear: exp.fiscalYear, transfersIn, transfersOut, difference, flagged: Math.abs(difference) > TRANSFER_IMBALANCE_THRESHOLD };
    })
    .sort((a, b) => a.fiscalYear - b.fiscalYear);
}

export interface Generated {
  annotations: Annotation[];
  /** Extra caveats per source id (sources that belong to this jurisdiction). */
  caveats: Map<string, string[]>;
  /** Extra caveats for sources shared by every jurisdiction (e.g. population), to be filed under this jurisdiction. */
  sharedSourceCaveats: Map<string, string[]>;
}

function pushCaveat(caveats: Map<string, string[]>, id: string, text: string) {
  caveats.set(id, [...(caveats.get(id) ?? []), text]);
}

export interface AnomalyInput {
  jurisdiction: string;
  revenues: AfrSheet[];
  expenditures: AfrSheet[];
  revenueSourceId: string;
  expenditureSourceId: string;
  populationSourceId: string;
  population: { selected: Map<number, PopulationValue>; alternates: Map<number, PopulationValue[]> };
  /** Optional: sentence describing the cross-check against the county-filed AFR for a year and topic. */
  countyAfrNote?: (fiscalYear: number, topic: 'transfers' | 'proprietary') => string | undefined;
  /** Gaps (see findGaps) that have been approved for annotation. */
  approvedGaps?: ApprovedGap[];
  /** Transfer-imbalance years approved for annotation. Every flagged year must be listed, and every listed year flagged. */
  approvedTransferImbalances: ApprovedTransferImbalance[];
  /** Research notes requested for specific jurisdictions. */
  researchNotes?: ResearchNote[];
}

export function generateAnomalies(input: AnomalyInput): Generated {
  const annotations: Annotation[] = [];
  const caveats = new Map<string, string[]>();
  const sharedSourceCaveats = new Map<string, string[]>();
  const { jurisdiction } = input;
  const flows: Array<[Flow, AfrSheet[], string]> = [
    ['revenue', input.revenues, input.revenueSourceId],
    ['expenditure', input.expenditures, input.expenditureSourceId],
  ];
  const byYear = (sheets: AfrSheet[]) => new Map(sheets.map((s) => [s.fiscalYear, s]));
  const exp = byYear(input.expenditures);
  const rev = byYear(input.revenues);

  // --- 1. Transfer imbalance and the expenditure classification break (QA-01) -------------------
  const balances = transferBalances(input.revenues, input.expenditures);
  const flaggedYears = new Set(balances.filter((b) => b.flagged).map((b) => b.fiscalYear));
  const approvedYears = new Set(input.approvedTransferImbalances.filter((a) => a.jurisdiction === jurisdiction).map((a) => a.fiscalYear));
  const unapproved = [...flaggedYears].filter((y) => !approvedYears.has(y));
  const stale = [...approvedYears].filter((y) => !flaggedYears.has(y));
  if (unapproved.length || stale.length) {
    throw new Error(
      `${jurisdiction}: transfer-imbalance approvals out of date.` +
        (unapproved.length ? ` Flagged but not approved: FY ${unapproved.join(', ')}.` : '') +
        (stale.length ? ` Approved but no longer flagged: FY ${stale.join(', ')}.` : '') +
        ' Review config/approved-annotations.ts.',
    );
  }
  const nearestUnflagged = (fy: number, step: -1 | 1) => {
    for (let y = fy + step; exp.has(y); y += step) if (!flaggedYears.has(y)) return y;
    return null;
  };
  for (const b of balances.filter((x) => x.flagged)) {
    const sheet = exp.get(b.fiscalYear)!;
    const neighbours = [nearestUnflagged(b.fiscalYear, -1), nearestUnflagged(b.fiscalYear, 1)].filter((y): y is number => y !== null);
    const side = (fy: number) => {
      const s = exp.get(fy)!;
      return `${fiscalYearLabel(fy)}: account 521 ${money(accountTotal(s, '521', true))}, public safety section ${money(sectionTotal(s, 'public_safety', true))}, court-related section ${money(sectionTotal(s, 'court_related', true))}, General Fund 581 ${money(generalFund(s, TRANSFERS_OUT))}`;
    };
    const refs = [
      rowTotalRef(rev.get(b.fiscalYear)!, TRANSFERS_IN),
      rowTotalRef(sheet, TRANSFERS_OUT),
      rowTotalRef(sheet, '521'),
      cellRef(sheet, '521', 'general'),
      cellRef(sheet, TRANSFERS_OUT, 'general'),
      // Row totals include custodial; cite the custodial cells so the excluded amounts can be checked.
      accountTotal(rev.get(b.fiscalYear), TRANSFERS_IN) !== b.transfersIn ? cellRef(rev.get(b.fiscalYear)!, TRANSFERS_IN, 'custodial') : null,
      accountTotal(sheet, TRANSFERS_OUT) !== b.transfersOut ? cellRef(sheet, TRANSFERS_OUT, 'custodial') : null,
    ].filter((r): r is string => r !== null);
    const direction = b.difference > 0 ? 'exceed' : 'are below';
    const verb = b.difference > 0 ? 'exceeds' : 'is below';
    const facts =
      `${fiscalYearLabel(b.fiscalYear)}, excluding custodial amounts: expenditure account 581 (inter-fund transfers out, ${exact(b.transfersOut)}) ${verb} revenue account 381 (transfers in, ${exact(b.transfersIn)}) by ${exact(Math.abs(b.difference))}. ` +
      `Non-custodial figures, ${side(b.fiscalYear)}` +
      (neighbours.length ? `; compared with ${neighbours.map(side).join('; ')}.` : '.') +
      (input.countyAfrNote?.(b.fiscalYear, 'transfers') ? ` ${input.countyAfrNote(b.fiscalYear, 'transfers')}` : '');
    annotations.push({
      fiscalYear: b.fiscalYear,
      label: `Transfers out (581) ${direction} transfers in (381) by ${money(Math.abs(b.difference))}; account 521 Law Enforcement ${money(accountTotal(sheet, '521', true))}`,
      kind: 'methodology',
      topic: 'transfer-imbalance',
      sourceId: input.expenditureSourceId,
      jurisdiction,
      flow: 'expenditure',
      detail: facts,
      refs,
    });
    pushCaveat(caveats, input.expenditureSourceId, `${facts} Cells: ${refs.join(', ')}.`);
  }

  // --- 2. Amounts reported rounded to $1,000, and exceptions (QA-03 a, b) ----------------------
  for (const [flow, sheets, sourceId] of flows) {
    for (const s of sheets) {
      const cells = s.accounts.flatMap((a) => a.values.filter((v) => v.amount !== 0).map((v) => ({ a, v })));
      const round = cells.filter(({ v }) => v.amount % 1000 === 0);
      if (!cells.length || round.length / cells.length <= ROUNDED_SHARE) continue;
      const text = `${fiscalYearLabel(s.fiscalYear)} ${flow}s: ${round.length} of ${cells.length} non-zero amounts are whole multiples of $1,000.`;
      annotations.push({ fiscalYear: s.fiscalYear, label: 'Amounts reported rounded to $1,000', kind: 'methodology', topic: 'rounding', sourceId, jurisdiction, flow, detail: text });
      pushCaveat(caveats, sourceId, text);
      for (const { a, v } of cells.filter(({ v }) => v.amount % 1000 !== 0)) {
        const ref = qref(s, v.address);
        let detail = `${fiscalYearLabel(s.fiscalYear)}: account ${a.account} (${a.name}), ${v.fundType} fund, is ${exact(v.amount)} (${ref}), the only ${flow} amount that year that is not a whole multiple of $1,000.`;
        if (v.fundType === 'custodial') {
          const other = flow === 'expenditure' ? rev.get(s.fiscalYear) : exp.get(s.fiscalYear);
          const otherCustodial = other ? (other.grandTotal.cached['custodial'] ?? 0) : null;
          if (otherCustodial !== null) detail += ` Custodial ${flow === 'expenditure' ? 'revenue' : 'expenditure'} that year is ${exact(otherCustodial)}.`;
        }
        annotations.push({
          fiscalYear: s.fiscalYear,
          label: `Account ${a.account} ${v.fundType} amount ${exact(v.amount)} is not rounded like the rest of the year`,
          kind: 'methodology',
          topic: 'source-anomaly',
          sourceId,
          jurisdiction,
          flow,
          ...(v.fundType === 'custodial' ? { custodial: 'included' as const } : {}),
          detail,
          refs: [ref],
        });
        pushCaveat(caveats, sourceId, detail);
      }
    }
  }

  // --- 3. Custodial column: all zeros, and which accounts custodial amounts use (QA-03 c, d) ----
  for (const [flow, sheets, sourceId] of flows) {
    for (const s of [...sheets].sort((x, y) => x.fiscalYear - y.fiscalYear)) {
      const col = s.fundColumns.find((f) => f.fundType === 'custodial');
      if (!col) continue;
      const ref = qref(s, `${colLetter(col.col)}${s.grandTotal.row}`);
      const total = s.grandTotal.cached['custodial'] ?? 0;
      if (total === 0) {
        const detail = `${fiscalYearLabel(s.fiscalYear)}: the Custodial column is present and every custodial ${flow} amount is $0 (${ref}).`;
        annotations.push({ fiscalYear: s.fiscalYear, label: `Custodial column present; all custodial ${flow}s are $0`, kind: 'methodology', topic: 'custodial-zero', sourceId, jurisdiction, flow, custodial: 'included', detail, refs: [ref] });
        pushCaveat(caveats, sourceId, detail);
        continue;
      }
      const parts = s.accounts
        .map((a) => ({ a, v: a.values.find((v) => v.fundType === 'custodial')! }))
        .filter(({ v }) => v.amount !== 0)
        .sort((x, y) => Math.abs(y.v.amount) - Math.abs(x.v.amount));
      const listed = parts.filter(({ v }) => Math.abs(v.amount) >= 1_000_000);
      const rest = parts.length - listed.length;
      const detail =
        `${fiscalYearLabel(s.fiscalYear)}: custodial ${flow}s total ${exact(total)} (${ref}), reported under ` +
        listed.map(({ a, v }) => `account ${a.account} ${a.name} ${exact(v.amount)} (${qref(s, v.address)})`).join('; ') +
        (rest ? `; and ${rest} other account${rest > 1 ? 's' : ''} (each under $1M)` : '') +
        '.';
      annotations.push({
        fiscalYear: s.fiscalYear,
        label: `Custodial ${flow}s: ${listed.map(({ a, v }) => `${a.account} ${money(v.amount)}`).join(', ')}`,
        kind: 'methodology',
        topic: 'custodial-accounts',
        sourceId,
        jurisdiction,
        flow,
        custodial: 'included',
        detail,
        refs: [ref, ...listed.map(({ v }) => qref(s, v.address))],
      });
      pushCaveat(caveats, sourceId, detail);
    }
  }

  // --- 3b. Research note: custodial amounts begin later than the column ----------------------
  if ((input.researchNotes ?? []).some((n) => n.jurisdiction === jurisdiction && n.topic === 'custodial-start')) {
    for (const [flow, sheets, sourceId] of flows) {
      const withCol = [...sheets]
        .filter((s) => s.fundColumns.some((f) => f.fundType === 'custodial'))
        .sort((a, b) => a.fiscalYear - b.fiscalYear);
      const custodialRef = (s: AfrSheet) => qref(s, `${colLetter(s.fundColumns.find((f) => f.fundType === 'custodial')!.col)}${s.grandTotal.row}`);
      const firstNonZero = withCol.find((s) => (s.grandTotal.cached['custodial'] ?? 0) !== 0);
      const zeros = withCol.filter((s) => !firstNonZero || s.fiscalYear < firstNonZero.fiscalYear);
      if (!firstNonZero || !zeros.length) {
        throw new Error(`${jurisdiction} ${flow}: custodial-start research note requested, but custodial amounts do not start after the column appears. Review config/approved-annotations.ts.`);
      }
      const total = firstNonZero.grandTotal.cached['custodial'] ?? 0;
      const refs = [...zeros.map(custodialRef), custodialRef(firstNonZero)];
      const detail =
        `The Custodial column is present from ${fiscalYearLabel(withCol[0].fiscalYear)}. Custodial ${flow}s are $0 in ` +
        zeros.map((s) => `${fiscalYearLabel(s.fiscalYear)} (${custodialRef(s)})`).join(' and ') +
        `, and first reported in ${fiscalYearLabel(firstNonZero.fiscalYear)}: ${exact(total)} (${custodialRef(firstNonZero)}).`;
      annotations.push({
        fiscalYear: firstNonZero.fiscalYear,
        label: `Custodial ${flow}s first reported this year (column present since ${fiscalYearLabel(withCol[0].fiscalYear)})`,
        kind: 'methodology',
        topic: 'custodial-start',
        sourceId,
        jurisdiction,
        flow,
        custodial: 'included',
        detail,
        refs,
      });
      pushCaveat(caveats, sourceId, detail);
    }
  }

  // --- 4. Approved drop-and-recover gaps (QA-09) ----------------------------------------------
  const gapsByFlow = new Map<Flow, Gap[]>([
    ['revenue', findGaps(input.revenues)],
    ['expenditure', findGaps(input.expenditures)],
  ]);
  for (const approved of (input.approvedGaps ?? []).filter((g) => g.jurisdiction === jurisdiction)) {
    if (approved.coveredBy) {
      // Described inside another annotation; only check that the scan still finds it.
      for (const scope of approved.scopes) {
        const found = gapsByFlow.get(approved.flow)!.some((g) => g.scope === scope && g.years.includes(approved.fiscalYear));
        if (!found) throw new Error(`Approved gap ${approved.flow} ${scope} FY ${approved.fiscalYear} is not found by findGaps; review the approval`);
      }
      continue;
    }
    const sheets = byYear(approved.flow === 'revenue' ? input.revenues : input.expenditures);
    const [, , sourceId] = flows.find(([f]) => f === approved.flow)!;
    const parts: string[] = [];
    const refs: string[] = [];
    const labels: string[] = [];
    for (const scope of approved.scopes) {
      const gap = gapsByFlow.get(approved.flow)!.find((g) => g.scope === scope && g.years.includes(approved.fiscalYear));
      if (!gap) throw new Error(`Approved gap ${approved.flow} ${scope} FY ${approved.fiscalYear} is not found by findGaps; review the approval`);
      const during = gap.values.find((v) => v.fiscalYear === approved.fiscalYear)!.value;
      parts.push(`${scopeLabel(scope)} ${money(during)} (${fiscalYearLabel(gap.before.fiscalYear)}: ${money(gap.before.value)}; ${fiscalYearLabel(gap.after.fiscalYear)}: ${money(gap.after.value)})`);
      labels.push(`${scopeLabel(scope)} ${money(during)}`);
      if (!scope.startsWith('fund:')) continue;
      // Accounts that carried the fund the year before and fell by more than half.
      const fund = scope.slice(5);
      const [prev, cur, next] = [gap.before.fiscalYear, approved.fiscalYear, gap.after.fiscalYear].map((y) => sheets.get(y)!);
      for (const a of prev.accounts) {
        const pv = fundValue(prev, a.account, fund);
        if (pv < gap.before.value * 0.1) continue;
        const cv = fundValue(cur, a.account, fund);
        if (cv >= pv * (1 - GAP_DROP)) continue;
        const ref = cellRef(cur, a.account, fund);
        parts.push(`account ${a.account} ${a.name}, ${fund.replace(/_/g, ' ')}: ${money(cv)}${ref ? ` (${ref})` : ' (no row)'} vs ${money(pv)} and ${money(fundValue(next, a.account, fund))}`);
        if (ref) refs.push(ref);
      }
    }
    const afr = input.countyAfrNote?.(approved.fiscalYear, 'proprietary');
    const detail = `${fiscalYearLabel(approved.fiscalYear)} ${approved.flow}s, excluding custodial amounts: ${parts.join('; ')}.${afr ? ` ${afr}` : ''}`;
    annotations.push({
      fiscalYear: approved.fiscalYear,
      label: labels.join('; '),
      kind: 'methodology',
      topic: approved.topic ?? 'fund-gap',
      sourceId,
      jurisdiction,
      flow: approved.flow,
      detail,
      refs,
    });
    pushCaveat(caveats, sourceId, `${detail}${refs.length ? ` Cells: ${refs.join(', ')}.` : ''}`);
  }

  // --- 5. Population basis changes (QA-05) ------------------------------------------------------
  const pop = input.population.selected;
  const finYears = [...new Set([...input.revenues, ...input.expenditures].map((s) => s.fiscalYear))].sort((a, b) => a - b);
  const basisText = (v: PopulationValue) =>
    v.basis === 'census_count' ? `April 1, ${v.year} census count` : v.basis === 'bebr_revised_estimate' ? `revised April 1, ${v.year} BEBR estimate` : `April 1, ${v.year} BEBR estimate`;
  for (const fy of finYears) {
    const cur = pop.get(fy);
    const prev = pop.get(fy - 1);
    if (!cur || !prev) continue;
    if (!(cur.basis === 'census_count' && prev.basis !== 'census_count') && prev.basis !== 'bebr_revised_estimate') continue;
    const change = cur.value / prev.value - 1;
    const alt = input.population.alternates.get(fy - 1)?.find((a) => a.basis === 'census_count');
    const detail =
      `Per-resident figures for ${fiscalYearLabel(fy)} divide by the ${basisText(cur)} (${cur.value.toLocaleString('en-US')}); ${fiscalYearLabel(fy - 1)} used the ${basisText(prev)} (${prev.value.toLocaleString('en-US')}), a change of ${(change * 100).toFixed(1)}%.` +
      (alt ? ` The April 1, ${alt.year} census count was ${alt.value.toLocaleString('en-US')}.` : '') +
      ' These are point-in-time figures from different sources, not a revised continuous series.';
    annotations.push({
      fiscalYear: fy,
      label: `Population source changes: ${basisText(prev)} to ${basisText(cur)}`,
      kind: 'methodology',
      topic: 'population-source',
      sourceId: input.populationSourceId,
      jurisdiction,
      measures: ['per_capita', 'real_per_capita'],
      detail,
      refs: [populationRef(cur), populationRef(prev)],
    });
    // The population source is shared by every county; these caveats are filed under this county (QA-33).
    pushCaveat(sharedSourceCaveats, input.populationSourceId, detail);
  }

  return { annotations, caveats, sharedSourceCaveats };
}

function generalFund(sheet: AfrSheet, account: string): number {
  return sheet.accounts.find((a) => a.account === account)?.values.find((v) => v.fundType === 'general')?.amount ?? 0;
}

function cellRef(sheet: AfrSheet, account: string, fundType: string): string | null {
  const v = sheet.accounts.find((a) => a.account === account)?.values.find((x) => x.fundType === fundType);
  return v ? qref(sheet, v.address) : null;
}

export interface Swing {
  flow: Flow;
  scope: string;
  fiscalYear: number;
  from: number;
  to: number;
  change: number;
}

/** Year-over-year changes in non-custodial totals and sections larger than SWING_THRESHOLD. */
export function yearOverYearSwings(sheets: AfrSheet[]): Swing[] {
  const sorted = [...sheets].sort((a, b) => a.fiscalYear - b.fiscalYear);
  const out: Swing[] = [];
  const sections = [...new Set(sorted.flatMap((s) => s.accounts.map((a) => classifyAccount(s.flow, a.account).section)))].sort();
  for (let i = 1; i < sorted.length; i++) {
    const [p, c] = [sorted[i - 1], sorted[i]];
    const scopes: Array<[string, number, number]> = [
      ['total (excl. custodial)', totalExclCustodial(p), totalExclCustodial(c)],
      ...sections.map((sec): [string, number, number] => [sec, sectionTotal(p, sec, true), sectionTotal(c, sec, true)]),
    ];
    for (const [scope, from, to] of scopes) {
      if (from === 0) continue;
      const change = to / from - 1;
      if (Math.abs(change) > SWING_THRESHOLD) out.push({ flow: c.flow, scope, fiscalYear: c.fiscalYear, from, to, change });
    }
  }
  return out;
}

/** A drop of more than this share from the prior year opens a gap. */
export const GAP_DROP = 0.5;
/** The value must recover (back to at least (1 - GAP_DROP) of the pre-drop value) within this many years. */
export const GAP_MAX_YEARS = 2;
/** Scopes whose pre-drop value is below this are ignored. */
export const GAP_MIN_BASELINE = 1_000_000;

export interface Gap {
  flow: Flow;
  /** "fund:<fundType>" or "section:<section>" */
  scope: string;
  before: { fiscalYear: number; value: number };
  /** Fiscal years inside the gap (1 or 2). */
  years: number[];
  values: Array<{ fiscalYear: number; value: number }>;
  after: { fiscalYear: number; value: number };
}

export interface ApprovedTransferImbalance {
  jurisdiction: string;
  fiscalYear: number;
}

export interface ResearchNote {
  jurisdiction: string;
  topic: 'custodial-start';
}

export interface ApprovedGap {
  jurisdiction: string;
  flow: Flow;
  fiscalYear: number;
  scopes: string[];
  /** Annotation topic; defaults to 'fund-gap'. */
  topic?: AnnotationTopic;
  /** Set when the gap is described in another generated annotation instead of its own. */
  coveredBy?: AnnotationTopic;
}

export function scopeLabel(scope: string): string {
  const [kind, name] = scope.split(':');
  const words = name.replace(/_/g, ' ');
  if (kind === 'fund') return name === 'component_unit' ? 'Component Units' : `${words.replace(/\b\w/g, (c) => c.toUpperCase())} funds`;
  return `${words} section`;
}

function fundValue(sheet: AfrSheet, account: string, fundType: string): number {
  return sheet.accounts.find((a) => a.account === account)?.values.find((v) => v.fundType === fundType)?.amount ?? 0;
}

/**
 * Non-custodial fund-type totals and sections that drop by more than GAP_DROP from one year to the
 * next and come back within GAP_MAX_YEARS. Pure scan; reports, doesn't judge.
 */
export function findGaps(sheets: AfrSheet[]): Gap[] {
  const sorted = [...sheets].sort((a, b) => a.fiscalYear - b.fiscalYear);
  if (!sorted.length) return [];
  const flow = sorted[0].flow;
  const funds = [...new Set(sorted.flatMap((s) => s.fundColumns.map((f) => f.fundType)))].filter((f) => f !== 'custodial');
  const sections = [...new Set(sorted.flatMap((s) => s.accounts.map((a) => classifyAccount(s.flow, a.account).section)))].sort();
  const scopes: Array<[string, (s: AfrSheet) => number]> = [
    ...funds.map((f): [string, (s: AfrSheet) => number] => [`fund:${f}`, (s) => s.accounts.reduce((t, a) => t + (a.values.find((v) => v.fundType === f)?.amount ?? 0), 0)]),
    ...sections.map((sec): [string, (s: AfrSheet) => number] => [`section:${sec}`, (s) => sectionTotal(s, sec, true)]),
  ];
  const out: Gap[] = [];
  for (const [scope, value] of scopes) {
    const series = sorted.map((s) => ({ fiscalYear: s.fiscalYear, value: value(s) }));
    for (let i = 1; i < series.length; i++) {
      const base = series[i - 1];
      if (base.value < GAP_MIN_BASELINE) continue;
      const floor = base.value * (1 - GAP_DROP);
      if (series[i].value >= floor) continue;
      let k = i;
      while (k < series.length && k - i < GAP_MAX_YEARS && series[k].value < floor) k++;
      if (k < series.length && series[k].value >= floor) {
        const inside = series.slice(i, k);
        out.push({ flow, scope, before: base, years: inside.map((v) => v.fiscalYear), values: inside, after: series[k] });
        i = k - 1;
      }
    }
  }
  return out.sort((a, b) => a.years[0] - b.years[0] || a.scope.localeCompare(b.scope));
}
