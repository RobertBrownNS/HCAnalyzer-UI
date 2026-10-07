import type { Workbook } from 'exceljs';
import { formatAccountCode, type Flow } from '../edr/accounts.js';
import { FUND_HEADERS } from '../edr/funds.js';
import type { Observation } from '../edr/observations.js';
import { cellText } from '../lib/xlsx.js';

/**
 * DFS LOGERX public "Revenue Details" / "Expenditure Details" reports: the account x fund amounts
 * local governments filed in their Annual Financial Reports (the DFS form), statewide, one workbook
 * per fiscal year. Fetched through the same public endpoint the LOGERX "Reports" page uses.
 * Only verified data is public. Used to cross-check EDR; never a data source for the explorer.
 */

export const LOGERX_REPORT_ENDPOINT = 'https://logerx.myfloridacfo.gov/api/document/systemReport';
export const LOGERX_YEARS_ENDPOINT = 'https://logerx.myfloridacfo.gov/api/document/AFR/reportYears';
export const LOGERX_PUBLIC_PAGE = 'https://logerx.myfloridacfo.gov/LogerX/PublicReportsMenu';

export const LOGERX_REPORTS: Array<{ name: string; flow: Flow; label: string }> = [
  { name: 'REVENUEDETAILREPORT', flow: 'revenue', label: 'Revenue Details' },
  { name: 'EXPENDITUREDETAILREPORT', flow: 'expenditure', label: 'Expenditure Details' },
];

/** Leading columns of each report, in order (header row 3). Fund columns follow them. */
export const LEADING: Record<Flow, string[]> = {
  revenue: ['Code', 'Name', 'Account', 'Dwelling Type', 'Fee Type'],
  expenditure: ['Code', 'Name', 'Account', 'Object Code'],
};

export interface StatewideReport {
  /** Title in row 1, e.g. "Revenue Details for Fiscal Year 2024, as of Wednesday, October 7, 2026". */
  title: string;
  /** The "as of" part of the title (changes on every download). */
  asOf: string;
  /** Header cells exactly as printed (some carry trailing spaces). */
  header: string[];
  /** Data rows as strings, one array per row, aligned with `header`. */
  rows: string[][];
}

function cellString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object' && v && 'richText' in v) return (v as { richText: Array<{ text: string }> }).richText.map((t) => t.text).join('');
  if (typeof v === 'object' && v && 'result' in v) return cellString((v as { result: unknown }).result);
  return String(v);
}

export function parseStatewideReport(wb: Workbook, expectedYear: number, flow: Flow): StatewideReport {
  const leading = LEADING[flow];
  const ws = wb.worksheets[0];
  const title = cellText(ws.getRow(1).getCell(1));
  const m = /Fiscal Year (\d{4}), as of (.+)$/.exec(title);
  if (!m || Number(m[1]) !== expectedYear) throw new Error(`LOGERX report title "${title}" does not match fiscal year ${expectedYear}`);
  const header: string[] = [];
  for (let c = 1; c <= ws.columnCount; c++) header.push(cellString(ws.getRow(3).getCell(c).value));
  while (header.length && header.at(-1) === '') header.pop();
  leading.forEach((h, i) => {
    if (header[i]?.trim() !== h) throw new Error(`LOGERX header column ${i + 1} is "${header[i]}", expected "${h}"`);
  });
  for (const h of header.slice(leading.length)) {
    if (!FUND_HEADERS[h.trim()]) throw new Error(`LOGERX header "${h}" is not a known fund column`);
  }
  const rows: string[][] = [];
  for (let r = 4; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells = header.map((_, i) => cellString(row.getCell(i + 1).value));
    if (cells.every((c) => c.trim() === '')) continue;
    rows.push(cells);
  }
  return { title, asOf: m[2].trim(), header, rows };
}

function csvField(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Every row for one entity code, all columns verbatim, as CSV with "\n" line endings.
 * Rows are sorted (account, dwelling type, fee type, then the whole row) so the bytes depend only
 * on the data, not on report order or the "as of" stamp.
 */
export function extractEntityCsv(report: StatewideReport, entityCode: string): { csv: string; rows: number } {
  const mine = report.rows.filter((r) => r[0].trim() === entityCode);
  // Account, then the remaining non-fund columns (dwelling/fee type or object code), then the whole row.
  const fundStart = report.header.findIndex((h) => FUND_HEADERS[h.trim()]);
  const key = (r: string[]) => [r[2], ...r.slice(3, fundStart), r.join('\u0001')];
  mine.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
    return 0;
  });
  const lines = [report.header, ...mine].map((r) => r.map(csvField).join(','));
  return { csv: lines.join('\n') + '\n', rows: mine.length };
}

/**
 * "312.410 - ..." -> "312.41" (EDR's form). LOGERX writes the catch-all "Other Permits, Fees and
 * Special Assessments" as "329.xxx"; EDR prints the same line as account 329, so "NNN.xxx" maps to "NNN".
 */
export function logerxAccountCode(account: string): string {
  const code = account.split(' - ')[0].trim();
  const placeholder = /^(\d{3})\.x+$/i.exec(code);
  if (placeholder) return placeholder[1];
  if (!/^\d{3}(\.\d+)?$/.test(code)) throw new Error(`LOGERX extract: unrecognized account code "${account}"`);
  return formatAccountCode(Number(code));
}

export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); out.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length) { row.push(field); out.push(row); }
  return out;
}

/**
 * Account x fund amounts from an extract. Revenue impact-fee rows (dwelling/fee type) and expenditure
 * object-code rows (personnel, operating, capital, ...) are summed to the account, as EDR reports them.
 */
export function aggregateExtract(csv: string): Map<string, number> {
  const [header, ...rows] = parseCsv(csv);
  const funds = header.map((h, i) => [i, FUND_HEADERS[h.trim()]] as const).filter(([, f]) => f);
  const out = new Map<string, number>();
  for (const r of rows) {
    const account = logerxAccountCode(r[2]);
    for (const [i, fund] of funds) {
      const raw = (r[i] ?? '').trim();
      if (!raw) continue;
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error(`LOGERX extract: non-numeric amount "${raw}"`);
      if (n === 0) continue;
      const k = `${account}|${fund}`;
      out.set(k, (out.get(k) ?? 0) + n);
    }
  }
  return out;
}

export interface CellDiff {
  account: string;
  fundType: string;
  logerx: number | null;
  edr: number | null;
  /** EDR cell, e.g. "revenues:2024!D6", when EDR has the cell. */
  ref: string | null;
}

export interface Reconciliation {
  jurisdiction: string;
  fiscalYear: number;
  flow: Flow;
  cells: number;
  match: number;
  mismatches: CellDiff[];
  /** In LOGERX, not in EDR (EDR shows $0). */
  onlyLogerx: CellDiff[];
  /** In EDR, not in LOGERX. */
  onlyEdr: CellDiff[];
  logerxTotal: number;
  edrTotal: number;
}

/** Amounts are whole dollars in both sources; anything under half a dollar counts as equal. */
const SAME = (a: number, b: number) => Math.abs(a - b) < 0.5;

export function reconcile(jurisdiction: string, fiscalYear: number, flow: Flow, logerx: Map<string, number>, observations: Observation[]): Reconciliation {
  const wb = flow === 'revenue' ? 'revenues' : 'expenditures';
  const edr = new Map<string, Observation>();
  for (const o of observations) if (o.fiscalYear === fiscalYear && o.flow === flow) edr.set(`${o.account}|${o.fundType}`, o);
  const keys = [...new Set([...logerx.keys(), ...edr.keys()])].sort((a, b) => {
    const [aa, af] = a.split('|');
    const [ba, bf] = b.split('|');
    return Number(aa) - Number(ba) || af.localeCompare(bf);
  });
  const r: Reconciliation = { jurisdiction, fiscalYear, flow, cells: keys.length, match: 0, mismatches: [], onlyLogerx: [], onlyEdr: [], logerxTotal: 0, edrTotal: 0 };
  for (const k of keys) {
    const [account, fundType] = k.split('|');
    const l = logerx.get(k);
    const o = edr.get(k);
    const diff: CellDiff = { account, fundType, logerx: l ?? null, edr: o?.amount ?? null, ref: o ? `${wb}:${o.ref}` : null };
    if (l !== undefined) r.logerxTotal += l;
    if (o) r.edrTotal += o.amount;
    if (l !== undefined && o) {
      if (SAME(l, o.amount)) r.match++;
      else r.mismatches.push(diff);
    } else if (l !== undefined) r.onlyLogerx.push(diff);
    else r.onlyEdr.push(diff);
  }
  return r;
}
