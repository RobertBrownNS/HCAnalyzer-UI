import { fiscalYearLabel } from '../lib/fiscal.js';
import { classifyAccount, type Flow } from './accounts.js';
import { colLetter, type AfrSheet } from './afr.js';
import type { PopulationValue } from './population.js';

/**
 * Data-derived annotations and caveats for known reporting irregularities. Every number in the
 * generated text is computed from the parsed workbooks, so the wording stays factual and the
 * figures can't drift from the data. Nothing here changes a published value.
 */

/** Measure names as used by the app (src/app/core/models.ts `Measure`). */
export type Measure = 'nominal' | 'per_capita' | 'real' | 'real_per_capita';

export interface Annotation {
  fiscalYear: number;
  label: string;
  kind: 'methodology' | 'policy' | 'event';
  sourceId: string;
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

/** |transfers out - transfers in| above this is reported. In other years the gap is at most a few hundred dollars. */
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

function rowTotalRef(sheet: AfrSheet, account: string): string | null {
  const row = sheet.accounts.find((a) => a.account === account);
  return row ? `${sheet.sheetName}!${colLetter(sheet.totalCol)}${row.row}` : null;
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
  /** Extra caveats per source id. */
  caveats: Map<string, string[]>;
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
  /** Optional: sentence describing a cross-check against the county-filed AFR, keyed by fiscal year. */
  countyAfrNotes?: Map<number, string>;
}

export function generateAnomalies(input: AnomalyInput): Generated {
  const annotations: Annotation[] = [];
  const caveats = new Map<string, string[]>();
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
  const nearestUnflagged = (fy: number, step: -1 | 1) => {
    for (let y = fy + step; exp.has(y); y += step) if (!flaggedYears.has(y)) return y;
    return null;
  };
  for (const b of balances.filter((x) => x.flagged)) {
    const sheet = exp.get(b.fiscalYear)!;
    const neighbours = [nearestUnflagged(b.fiscalYear, -1), nearestUnflagged(b.fiscalYear, 1)].filter((y): y is number => y !== null);
    const side = (fy: number) => {
      const s = exp.get(fy)!;
      return `${fiscalYearLabel(fy)}: account 521 ${money(accountTotal(s, '521', true))}, public safety ${money(sectionTotal(s, 'public_safety', true))}, General Fund 581 ${money(generalFund(s, TRANSFERS_OUT))}`;
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
      (input.countyAfrNotes?.get(b.fiscalYear) ? ` ${input.countyAfrNotes.get(b.fiscalYear)}` : '');
    annotations.push({
      fiscalYear: b.fiscalYear,
      label: `Transfers out (581) ${direction} transfers in (381) by ${money(Math.abs(b.difference))}; account 521 Law Enforcement ${money(accountTotal(sheet, '521', true))}`,
      kind: 'methodology',
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
      annotations.push({ fiscalYear: s.fiscalYear, label: 'Amounts reported rounded to $1,000', kind: 'methodology', sourceId, jurisdiction, flow, detail: text });
      pushCaveat(caveats, sourceId, text);
      for (const { a, v } of cells.filter(({ v }) => v.amount % 1000 !== 0)) {
        const ref = `${s.sheetName}!${v.address}`;
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
      const ref = `${s.sheetName}!${colLetter(col.col)}${s.grandTotal.row}`;
      const total = s.grandTotal.cached['custodial'] ?? 0;
      if (total === 0) {
        const detail = `${fiscalYearLabel(s.fiscalYear)}: the Custodial column is present and every custodial ${flow} amount is $0 (${ref}).`;
        annotations.push({ fiscalYear: s.fiscalYear, label: `Custodial column present; all custodial ${flow}s are $0`, kind: 'methodology', sourceId, jurisdiction, flow, custodial: 'included', detail, refs: [ref] });
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
        listed.map(({ a, v }) => `account ${a.account} ${a.name} ${exact(v.amount)} (${s.sheetName}!${v.address})`).join('; ') +
        (rest ? `; and ${rest} other account${rest > 1 ? 's' : ''} (each under $1M)` : '') +
        '.';
      annotations.push({
        fiscalYear: s.fiscalYear,
        label: `Custodial ${flow}s: ${listed.map(({ a, v }) => `${a.account} ${money(v.amount)}`).join(', ')}`,
        kind: 'methodology',
        sourceId,
        jurisdiction,
        flow,
        custodial: 'included',
        detail,
        refs: [ref, ...listed.map(({ v }) => `${s.sheetName}!${v.address}`)],
      });
      pushCaveat(caveats, sourceId, detail);
    }
  }

  // --- 4. Population basis changes (QA-05) ------------------------------------------------------
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
      sourceId: input.populationSourceId,
      jurisdiction,
      measures: ['per_capita', 'real_per_capita'],
      detail,
      refs: [`FLcopops.xlsx "${cur.sheet}" row ${cur.row}`, `FLcopops.xlsx "${prev.sheet}" row ${prev.row}`],
    });
    pushCaveat(caveats, input.populationSourceId, detail);
  }

  return { annotations, caveats };
}

function generalFund(sheet: AfrSheet, account: string): number {
  return sheet.accounts.find((a) => a.account === account)?.values.find((v) => v.fundType === 'general')?.amount ?? 0;
}

function cellRef(sheet: AfrSheet, account: string, fundType: string): string | null {
  const v = sheet.accounts.find((a) => a.account === account)?.values.find((x) => x.fundType === fundType);
  return v ? `${sheet.sheetName}!${v.address}` : null;
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
