// Content of the source drawer: everything needed to trace one plotted value back to its sources.
// Built by a pure function so it can be tested without the UI.
import { AnnotationRecord, SourceRecord } from '../core/models';

export interface DrawerAccountRow {
  account: string;
  name: string;
  fund: string;
  amount: number;
  /** Workbook cell, e.g. "2025!D6". */
  ref: string;
}

export interface DrawerSource {
  id: string;
  publisher: string;
  title: string;
  url: string;
  retrieved: string;
  caveats: readonly string[];
}

export interface DrawerContent {
  /** "FY 2023-24" */
  fiscalYearLabel: string;
  /** County, flow and fund scope, e.g. "Pinellas County · Revenues · General Fund, excluding custodial". */
  context: string;
  /** What the value is: "Revenues, nominal dollars", or "Ad valorem taxes · Revenues, nominal dollars". */
  seriesLabel: string;
  /** Formatted value in the current measure. */
  valueText: string;
  /** Nominal total of the rows below (the value before per-resident / inflation / index). */
  nominalText: string;
  rows: readonly DrawerAccountRow[];
  sources: readonly DrawerSource[];
  /** Cross-check status for this year, as display text; null when the source has no coverage. */
  crossCheck: string | null;
  /** Per-year notes from the transform for this point. */
  notes: readonly string[];
  /** Annotations for this year in the current view, plus those about this point's accounts (DR-50). */
  annotations: readonly DrawerAnnotation[];
}

export interface DrawerAnnotation {
  label: string;
  /** Longer factual text, when the annotation has one. */
  detail?: string;
}

/**
 * The drawer's annotations: the chart's annotations for this year, then those about the point's
 * cells (annotationsForPoint), each once, in that order. A row scoped to cells (DR-50) appears only
 * through `forPoint`, so it isn't shown for points that don't contain one of its cells.
 */
export function drawerAnnotations(
  inView: readonly AnnotationRecord[],
  forPoint: readonly AnnotationRecord[],
): AnnotationRecord[] {
  const seen = new Set<string>();
  return [...inView.filter((a) => !a.cells), ...forPoint].filter((a) => !seen.has(a.label) && !!seen.add(a.label));
}

/** An account's printed name in one fiscal year (names change over the years). */
export function accountName(
  account: string,
  flow: string,
  fiscalYear: number,
  accounts: readonly { account: string; flow: string; name: string; names: readonly { fiscalYears: readonly number[]; name: string }[] }[],
): string {
  const rec = accounts.find((a) => a.account === account && a.flow === flow);
  if (!rec) return '';
  return rec.names.find((n) => n.fiscalYears.includes(fiscalYear))?.name ?? rec.name;
}

/** Sources for the drawer: the ones the point cites, with the caveats that apply to this county. */
export function drawerSources(
  sourceIds: readonly string[],
  sources: readonly SourceRecord[],
  county: string,
): DrawerSource[] {
  return [...new Set(sourceIds)]
    .map((id) => sources.find((s) => s.id === id))
    .filter((s): s is SourceRecord => !!s)
    .map((s) => ({
      id: s.id,
      publisher: s.publisher,
      title: s.title,
      url: s.url,
      retrieved: s.retrieved,
      caveats: [...s.caveats, ...(s.caveatsByJurisdiction?.[county] ?? [])],
    }));
}

/** Rows sorted for reading: by account code (numeric), then fund label. */
export function sortRows(rows: readonly DrawerAccountRow[]): DrawerAccountRow[] {
  return [...rows].sort((a, b) => Number(a.account) - Number(b.account) || a.fund.localeCompare(b.fund));
}

