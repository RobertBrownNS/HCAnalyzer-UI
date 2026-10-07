import type { Cell } from 'exceljs';
import ExcelJS from 'exceljs';

/**
 * Numeric value of a cell. Formula cells return the cached result Excel saved in the file.
 * Note: exceljs's `cell.value` drops a cached result of 0 for formula cells, so this reads
 * `cell.result` instead. Returns null for empty cells; throws for anything non-numeric.
 */
export function cellNumber(cell: Cell): number | null {
  if (cell.type === ExcelJS.ValueType.Formula) {
    const r = cell.result;
    if (r === undefined || r === null) return null;
    if (typeof r !== 'number') throw new Error(`${cell.address}: formula result is not a number (${JSON.stringify(r)})`);
    return r;
  }
  const v = cell.value;
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  throw new Error(`${cell.address}: expected a number, found ${JSON.stringify(v)}`);
}

export function isFormula(cell: Cell): boolean {
  return cell.type === ExcelJS.ValueType.Formula;
}

/** Plain text of a cell (rich text flattened, formulas -> cached result). */
export function cellText(cell: Cell): string {
  const v = cell.type === ExcelJS.ValueType.Formula ? cell.result : cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((t) => t.text).join('').trim();
    return '';
  }
  return String(v).trim();
}

export async function readWorkbook(file: string): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  return wb;
}
