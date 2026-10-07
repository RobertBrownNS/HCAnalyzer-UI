import { classifyAccount, type Flow } from './accounts.js';
import type { AfrSheet } from './afr.js';
import { FUND_ORDER } from './funds.js';

/** Observation as defined in CLAUDE.md, plus fields needed to trace and group it. */
export interface Observation {
  jurisdiction: string;
  /** 2021 = FY 2020-21 */
  fiscalYear: number;
  flow: Flow;
  account: string;
  category: string;
  /** Major Uniform Accounting System group (revenue source or expenditure function). */
  section: string;
  fundType: string;
  /** Nominal USD as reported. */
  amount: number;
  sourceId: string;
  /** Worksheet and cell in the raw workbook, e.g. "2025!D6". */
  ref: string;
}

export interface AccountInfo {
  flow: Flow;
  account: string;
  section: string;
  category: string;
  /** Name as printed in the most recent fiscal year that reports the account. */
  name: string;
  /** Every distinct printed name, with the fiscal years that used it. */
  names: Array<{ name: string; fiscalYears: number[] }>;
}

const FLOW_ORDER: Flow[] = ['revenue', 'expenditure'];

export function compareObservations(a: Observation, b: Observation): number {
  return (
    a.jurisdiction.localeCompare(b.jurisdiction) ||
    a.fiscalYear - b.fiscalYear ||
    FLOW_ORDER.indexOf(a.flow) - FLOW_ORDER.indexOf(b.flow) ||
    Number(a.account) - Number(b.account) ||
    FUND_ORDER.indexOf(a.fundType) - FUND_ORDER.indexOf(b.fundType)
  );
}

/**
 * One Observation per non-zero fund cell of every account row. Zero cells are omitted
 * (the workbook prints 0 for every fund an account does not use); absence means 0.
 */
export function toObservations(jurisdiction: string, sheets: AfrSheet[], sourceId: string): Observation[] {
  const out: Observation[] = [];
  for (const sheet of sheets) {
    for (const row of sheet.accounts) {
      const { section, category } = classifyAccount(sheet.flow, row.account, sheet.fiscalYear);
      for (const v of row.values) {
        if (v.amount === 0) continue;
        out.push({
          jurisdiction,
          fiscalYear: sheet.fiscalYear,
          flow: sheet.flow,
          account: row.account,
          category,
          section,
          fundType: v.fundType,
          amount: v.amount,
          sourceId,
          ref: `${sheet.sheetName}!${v.address}`,
        });
      }
    }
  }
  return out.sort(compareObservations);
}

export function toAccounts(sheets: AfrSheet[]): AccountInfo[] {
  const map = new Map<string, { flow: Flow; account: string; names: Map<string, number[]> }>();
  for (const sheet of sheets) {
    for (const row of sheet.accounts) {
      const key = `${sheet.flow}|${row.account}`;
      if (!map.has(key)) map.set(key, { flow: sheet.flow, account: row.account, names: new Map() });
      const names = map.get(key)!.names;
      names.set(row.name, [...(names.get(row.name) ?? []), sheet.fiscalYear]);
    }
  }
  return [...map.values()]
    .map(({ flow, account, names }) => {
      const list = [...names].map(([name, years]) => ({ name, fiscalYears: [...years].sort((a, b) => a - b) }));
      list.sort((a, b) => a.fiscalYears[0] - b.fiscalYears[0] || a.name.localeCompare(b.name));
      const latest = list.reduce((best, n) => (n.fiscalYears.at(-1)! > best.fiscalYears.at(-1)! ? n : best));
      // Section and category as classified in the latest year the account appears.
      return { flow, account, ...classifyAccount(flow, account, latest.fiscalYears.at(-1)!), name: latest.name, names: list };
    })
    .sort((a, b) => FLOW_ORDER.indexOf(a.flow) - FLOW_ORDER.indexOf(b.flow) || Number(a.account) - Number(b.account));
}
