import type { Workbook, Worksheet } from 'exceljs';
import { parseFiscalYearTitle } from '../lib/fiscal.js';
import { cellNumber, cellText, isFormula } from '../lib/xlsx.js';
import { formatAccountCode, type Flow } from './accounts.js';
import { FUND_HEADERS, PER_CAPITA_HEADERS, TOTAL_HEADERS } from './funds.js';

/**
 * Parser for EDR "County Government Revenues/Expenditures Reported by Account" workbooks
 * (one sheet per fiscal year). Layout is documented in docs/data-layout.md. The parser locates
 * columns by header text, never by position, because the fund columns changed in FY 2020-21.
 */

export interface FundColumn {
  col: number;
  header: string;
  fundType: string;
}

export interface FundValue {
  fundType: string;
  col: number;
  /** Cell address on the sheet, e.g. "D6". */
  address: string;
  amount: number;
  /** True when the cell was empty (counted as 0). */
  blank: boolean;
  /** True when the cell held a formula rather than a constant (cached result used). */
  formula: boolean;
}

export interface AccountRow {
  row: number;
  account: string;
  name: string;
  /** Heading of the section the row sits under, exactly as printed. */
  sectionHeading: string;
  values: FundValue[];
  /** Cached value of the workbook's row-total column. */
  cachedTotal: number | null;
}

export interface TotalsRow {
  row: number;
  label: string;
  /** Cached per-fund values keyed by fundType (null when the cell is empty). */
  cached: Record<string, number | null>;
  cachedTotal: number | null;
  cachedPerCapita: number | null;
}

export interface AfrSheet {
  flow: Flow;
  sheetName: string;
  fiscalYear: number;
  title: string;
  headerRow: number;
  fundColumns: FundColumn[];
  totalCol: number;
  perCapitaCol: number;
  accounts: AccountRow[];
  sections: TotalsRow[];
  grandTotal: TotalsRow;
  population: { row: number; label: string; value: number };
  footnotes: string[];
}

const GRAND_TOTAL_LABEL = /^Total - All Account Codes/i;
const POPULATION_LABEL = /Countywide.*Population/i;
const FOOTNOTE_LABEL = /^Compiled from data/i;

export function colLetter(col: number): string {
  let s = '';
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export function parseAfrWorkbook(wb: Workbook, flow: Flow): AfrSheet[] {
  return wb.worksheets.map((ws) => parseAfrSheet(ws, flow));
}

export function parseAfrSheet(ws: Worksheet, flow: Flow): AfrSheet {
  const where = `${flow} sheet "${ws.name}"`;

  let fiscalYear: number | null = null;
  let title = '';
  for (let r = 1; r <= 5 && fiscalYear === null; r++) {
    title = cellText(ws.getRow(r).getCell(1));
    fiscalYear = parseFiscalYearTitle(title);
  }
  if (fiscalYear === null) throw new Error(`${where}: no "Fiscal Year Ended September 30, YYYY" title`);
  if (String(fiscalYear) !== ws.name.trim()) throw new Error(`${where}: title year ${fiscalYear} != sheet name`);

  let headerRow = 0;
  for (let r = 1; r <= 10 && !headerRow; r++) {
    if (cellText(ws.getRow(r).getCell(4)) === 'General') headerRow = r;
  }
  if (!headerRow) throw new Error(`${where}: header row with "General" in column D not found`);

  const fundColumns: FundColumn[] = [];
  let totalCol = 0;
  let perCapitaCol = 0;
  const hdr = ws.getRow(headerRow);
  for (let c = 4; c <= ws.columnCount; c++) {
    const text = cellText(hdr.getCell(c)).replace(/\s+/g, ' ');
    if (!text) continue;
    if (FUND_HEADERS[text]) fundColumns.push({ col: c, header: text, fundType: FUND_HEADERS[text] });
    else if (TOTAL_HEADERS.has(text)) totalCol = c;
    else if (PER_CAPITA_HEADERS.has(text)) perCapitaCol = c;
    else throw new Error(`${where}: unrecognized column header "${text}" in ${colLetter(c)}${headerRow}`);
  }
  if (!totalCol || !perCapitaCol) throw new Error(`${where}: total or per-capita column missing`);
  const lastFund = Math.max(...fundColumns.map((f) => f.col));
  if (lastFund > totalCol) throw new Error(`${where}: fund column to the right of the total column`);

  const accounts: AccountRow[] = [];
  const sections: TotalsRow[] = [];
  const footnotes: string[] = [];
  let grandTotal: TotalsRow | null = null;
  let population: AfrSheet['population'] | null = null;
  let currentSection = '';

  const totalsRow = (r: number, label: string): TotalsRow => {
    const row = ws.getRow(r);
    const cached: Record<string, number | null> = {};
    for (const f of fundColumns) cached[f.fundType] = cellNumber(row.getCell(f.col));
    return {
      row: r,
      label,
      cached,
      cachedTotal: cellNumber(row.getCell(totalCol)),
      cachedPerCapita: cellNumber(row.getCell(perCapitaCol)),
    };
  };

  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const codeCell = row.getCell(2);
    if (typeof codeCell.value === 'number') {
      if (!currentSection) throw new Error(`${where}: account row ${r} before any section heading`);
      if (grandTotal) throw new Error(`${where}: account row ${r} after the grand total`);
      const values: FundValue[] = fundColumns.map((f) => {
        const cell = row.getCell(f.col);
        const n = cellNumber(cell);
        return {
          fundType: f.fundType,
          col: f.col,
          address: cell.address,
          amount: n ?? 0,
          blank: n === null,
          formula: isFormula(cell),
        };
      });
      accounts.push({
        row: r,
        account: formatAccountCode(codeCell.value),
        name: cellText(row.getCell(3)).replace(/\s+/g, ' '),
        sectionHeading: currentSection,
        values,
        cachedTotal: cellNumber(row.getCell(totalCol)),
      });
      continue;
    }

    const colA = cellText(row.getCell(1));
    const popLabel = cellText(row.getCell(perCapitaCol - 1));
    if (POPULATION_LABEL.test(popLabel)) {
      const value = cellNumber(row.getCell(perCapitaCol));
      if (value === null) throw new Error(`${where}: population row ${r} has no value`);
      population = { row: r, label: popLabel, value };
    } else if (!colA) {
      if (row.cellCount > 0 && row.values && (row.values as unknown[]).some((v) => v !== null && v !== undefined && v !== '')) {
        // Row with stray content but no label in column A: fail rather than guess.
        const hasNumbers = fundColumns.some((f) => cellNumber(row.getCell(f.col)) !== null);
        if (hasNumbers) throw new Error(`${where}: unlabeled row ${r} holds numbers`);
      }
    } else if (FOOTNOTE_LABEL.test(colA)) {
      footnotes.push(colA);
    } else if (GRAND_TOTAL_LABEL.test(colA)) {
      grandTotal = totalsRow(r, colA);
    } else if (!grandTotal) {
      currentSection = colA.replace(/\s+/g, ' ');
      sections.push(totalsRow(r, currentSection));
    } else {
      throw new Error(`${where}: unrecognized row ${r}: "${colA}"`);
    }
  }

  if (!grandTotal) throw new Error(`${where}: "Total - All Account Codes" row not found`);
  if (!population) throw new Error(`${where}: countywide population row not found`);

  return {
    flow,
    sheetName: ws.name,
    fiscalYear,
    title,
    headerRow,
    fundColumns,
    totalCol,
    perCapitaCol,
    accounts,
    sections,
    grandTotal,
    population,
    footnotes,
  };
}
