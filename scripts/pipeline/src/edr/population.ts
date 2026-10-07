import type { Workbook } from 'exceljs';
import { cellNumber, cellText } from '../lib/xlsx.js';

/**
 * Parser for EDR's FLcopops.xlsx ("Countywide, Unincorporated and Incorporated Totals - Census
 * Counts and Intercensal Estimates"): one sheet per April 1 reference year, named
 * "YYYY BEBR", "YYYY Revised BEBR" or "YYYY Census".
 */

export type PopulationBasis = 'bebr_estimate' | 'bebr_revised_estimate' | 'census_count';

export interface PopulationValue {
  year: number;
  value: number;
  basis: PopulationBasis;
  sheet: string;
  /** Sheet row where the county was found. */
  row: number;
}

const SHEET_NAME = /^(\d{4}) (BEBR|Revised BEBR|Census)$/;
const BASIS: Record<string, PopulationBasis> = {
  'BEBR': 'bebr_estimate',
  'Revised BEBR': 'bebr_revised_estimate',
  'Census': 'census_count',
};

/**
 * Which value to use when a year has more than one sheet. This reproduces the denominators
 * EDR used in its AFR per-capita columns (verified by validation): a revised estimate beats the
 * original estimate, and an estimate beats a census count (2020 uses the revised BEBR estimate,
 * not the census count; 2010 has only the census sheet).
 */
const PREFERENCE: PopulationBasis[] = ['bebr_revised_estimate', 'bebr_estimate', 'census_count'];

/** County name cell with footnote markers removed ("Hillsborough *" -> "Hillsborough"). */
export function cleanCountyName(s: string): string {
  return s.replace(/[*†\d]+$/u, '').replace(/\s+/g, ' ').trim();
}

export function parseCountyPopulation(wb: Workbook, countyName: string): PopulationValue[] {
  const out: PopulationValue[] = [];
  for (const ws of wb.worksheets) {
    const m = SHEET_NAME.exec(ws.name.trim());
    if (!m) throw new Error(`FLcopops: unexpected sheet name "${ws.name}"`);
    if (cellText(ws.getRow(2).getCell(2)) !== 'Countywide' || cellText(ws.getRow(3).getCell(2)) !== 'Population') {
      throw new Error(`FLcopops "${ws.name}": column B is not "Countywide Population"`);
    }
    let found: PopulationValue | null = null;
    for (let r = 4; r <= ws.rowCount; r++) {
      if (cleanCountyName(cellText(ws.getRow(r).getCell(1))) !== countyName) continue;
      if (found) throw new Error(`FLcopops "${ws.name}": "${countyName}" appears twice`);
      const value = cellNumber(ws.getRow(r).getCell(2));
      if (value === null || !Number.isInteger(value) || value <= 0) {
        throw new Error(`FLcopops "${ws.name}" row ${r}: invalid population ${value}`);
      }
      found = { year: Number(m[1]), value, basis: BASIS[m[2]], sheet: ws.name, row: r };
    }
    if (!found) throw new Error(`FLcopops "${ws.name}": county "${countyName}" not found`);
    out.push(found);
  }
  return out.sort((a, b) => a.year - b.year || PREFERENCE.indexOf(a.basis) - PREFERENCE.indexOf(b.basis));
}

/** Split into the preferred value per year and any alternates. */
export function selectPopulation(values: PopulationValue[]): {
  selected: Map<number, PopulationValue>;
  alternates: Map<number, PopulationValue[]>;
} {
  const selected = new Map<number, PopulationValue>();
  const alternates = new Map<number, PopulationValue[]>();
  const byYear = new Map<number, PopulationValue[]>();
  for (const v of values) byYear.set(v.year, [...(byYear.get(v.year) ?? []), v]);
  for (const [year, list] of byYear) {
    const sorted = [...list].sort((a, b) => PREFERENCE.indexOf(a.basis) - PREFERENCE.indexOf(b.basis));
    selected.set(year, sorted[0]);
    if (sorted.length > 1) alternates.set(year, sorted.slice(1));
  }
  return { selected, alternates };
}
