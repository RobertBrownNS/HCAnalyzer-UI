// Pairs chart annotations with the "Notes for this view" list. Pure; exported for tests.
import { AnnotationRecord, AnnotationTopic, SourceRecord } from '../core/models';
import { SeriesPoint, fiscalYearLabel, isTransferImbalanceNote } from '../core/transform';

/** Workbooks a ref can name: "revenues:2024!P121", "population:2010 Census!B31". */
export type Workbook = 'revenues' | 'expenditures' | 'population';
const REF_PATTERN = /^(revenues|expenditures|population):([^!]+)!([A-Z]+\d+)$/;

export interface CellRef {
  workbook: Workbook;
  /** "2024!P121" */
  cell: string;
}

/** Parses "workbook:sheet!cell"; null when it doesn't match the pipeline's format. */
export function parseRef(ref: string): CellRef | null {
  const m = REF_PATTERN.exec(ref);
  return m ? { workbook: m[1] as Workbook, cell: `${m[2]}!${m[3]}` } : null;
}

/** Cells grouped by the source they come from. */
export interface Citation {
  source?: SourceRecord;
  cells: string[];
}

/**
 * Chart labels: an annotation that applies to every view (no flow, custodial or measure
 * condition, e.g. the GASB 84 line) is labelled in full when it fits; all others appear as
 * their note number, spelled out in "Notes for this view".
 */
export const MAX_CHART_LABEL = 48;

export interface AnnotationNote {
  n: number;
  fiscalYear: number;
  yearLabel: string;
  kind: AnnotationRecord['kind'];
  topic?: AnnotationTopic;
  label: string;
  /** True when the annotation has no flow, custodial or measure condition. */
  universal: boolean;
  /** The annotation's detail, or the caveats of its source when it has none. */
  text: string[];
  /** Cited workbook cells, grouped by the workbook's source (refs may cite both AFR workbooks). */
  citations: Citation[];
  /** The annotation's own source. */
  source?: SourceRecord;
}

export interface MarkLineGroup {
  fiscalYear: number;
  kind: AnnotationRecord['kind'];
  label: string;
}

export interface PointNote {
  note: string;
  years: string;
}

/**
 * @param workbookSources source id for each workbook a ref can name (from the loaded data).
 */
export function annotationNotes(
  annotations: readonly AnnotationRecord[],
  sources: readonly SourceRecord[],
  workbookSources: Partial<Record<Workbook, string>> = {},
): AnnotationNote[] {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const cite = (refs: readonly string[]): Citation[] => {
    const groups = new Map<string, Citation>();
    for (const ref of refs) {
      const parsed = parseRef(ref);
      const id = parsed ? workbookSources[parsed.workbook] : undefined;
      const key = id ?? '';
      const group = groups.get(key) ?? { source: id ? byId.get(id) : undefined, cells: [] };
      group.cells.push(parsed?.cell ?? ref);
      groups.set(key, group);
    }
    return [...groups.values()];
  };
  const isUniversal = (a: AnnotationRecord) => a.flow === undefined && a.custodial === undefined && a.measures === undefined;
  return [...annotations]
    // By year; within a year, view-independent annotations (e.g. GASB 84) first.
    .sort((a, b) => a.fiscalYear - b.fiscalYear || Number(isUniversal(b)) - Number(isUniversal(a)))
    .map((a, i) => {
      const source = byId.get(a.sourceId);
      return {
        n: i + 1,
        fiscalYear: a.fiscalYear,
        yearLabel: fiscalYearLabel(a.fiscalYear),
        kind: a.kind,
        topic: a.topic,
        label: a.label,
        universal: isUniversal(a),
        text: a.detail ? [a.detail] : (source?.caveats ?? []),
        citations: cite(a.refs ?? []),
        source,
      };
    });
}

function spelledOut(note: AnnotationNote): boolean {
  return note.universal && note.label.length <= MAX_CHART_LABEL;
}

/**
 * One markLine per fiscal year: full labels first, then "Note 2" / "Notes 2, 3".
 * Compact (narrow screens): note numbers only ("1, 2"); the caption under the chart spells out
 * the view-independent ones.
 */
export function markLineGroups(notes: readonly AnnotationNote[], compact = false): MarkLineGroup[] {
  const groups = new Map<number, AnnotationNote[]>();
  for (const n of notes) groups.set(n.fiscalYear, [...(groups.get(n.fiscalYear) ?? []), n]);
  return [...groups].map(([fiscalYear, list]) => {
    if (compact) {
      return { fiscalYear, kind: (list.find(spelledOut) ?? list[0]).kind, label: list.map((n) => n.n).join(', ') };
    }
    const full = list.filter(spelledOut).map((n) => n.label);
    const numbered = list.filter((n) => !spelledOut(n)).map((n) => n.n);
    if (numbered.length) full.push(`${numbered.length === 1 ? 'Note' : 'Notes'} ${numbered.join(', ')}`);
    return { fiscalYear, kind: (list.find(spelledOut) ?? list[0]).kind, label: full.join(' · ') };
  });
}

// The 581/381 transfer imbalance reaches the UI twice: as a data annotation (expenditure only,
// topic 'transfer-imbalance') and as a per-point note from the transform (both flows). Each
// surface shows it once: chart lines and "Notes for this view" use the annotation; tooltip and
// table use the note.
export function isTransferImbalanceAnnotation(a: Pick<AnnotationNote, 'topic'>): boolean {
  return a.topic === 'transfer-imbalance';
}

function hasImbalanceAnnotation(annotations: readonly AnnotationNote[], fiscalYear: number): boolean {
  return annotations.some((a) => a.fiscalYear === fiscalYear && isTransferImbalanceAnnotation(a));
}

/** Per-point notes for "Notes for this view": drops notes an in-view annotation already covers. */
export function notesForView(p: SeriesPoint, annotations: readonly AnnotationNote[]): string[] {
  if (!hasImbalanceAnnotation(annotations, p.fiscalYear)) return p.notes;
  return p.notes.filter((n) => !isTransferImbalanceNote(n));
}

/** Annotations for the tooltip of one point: drops those its own notes already cover. */
export function annotationsForTooltip(p: SeriesPoint, annotations: readonly AnnotationNote[]): AnnotationNote[] {
  const covered = p.notes.some(isTransferImbalanceNote);
  return annotations.filter((a) => a.fiscalYear === p.fiscalYear && !(covered && isTransferImbalanceAnnotation(a)));
}

/** Years that share a note, as ranges of consecutive fiscal years: "FY 2005-06 – FY 2016-17, FY 2019-20". */
export function yearRanges(fiscalYears: readonly number[]): string {
  const ys = [...new Set(fiscalYears)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < ys.length; ) {
    let j = i;
    while (j + 1 < ys.length && ys[j + 1] === ys[j] + 1) j++;
    parts.push(j === i ? fiscalYearLabel(ys[i]) : `${fiscalYearLabel(ys[i])} – ${fiscalYearLabel(ys[j])}`);
    i = j + 1;
  }
  return parts.join(', ');
}

/** A per-year sentence groups with others when it differs only by its own year or dollar amounts. */
export const MIN_YEARS_TO_GENERALIZE = 3;
const FY_SLOT = '\u0000FY\u0000';
const USD_SLOT = '\u0000USD\u0000';
const USD_PATTERN = /-?\$[\d,]+(?:\.\d+)?/g;

function template(note: string, ownLabel: string): string {
  return note.split(ownLabel).join(FY_SLOT).replace(USD_PATTERN, USD_SLOT);
}

function renderTemplate(t: string): string {
  return t.split(FY_SLOT).join('each of these years').split(USD_SLOT).join('amount by year in the table');
}

/**
 * Per-point notes for "By year". Identical notes list their years as ranges. Notes that repeat
 * the same sentence with only their own year or dollar amount changed (e.g. one per year in
 * net-transfer or Tampa views) are shown once when at least MIN_YEARS_TO_GENERALIZE years share
 * them; the per-year figures stay in the table and tooltip.
 */
export function groupPointNotes(points: readonly SeriesPoint[], annotations: readonly AnnotationNote[] = []): PointNote[] {
  // A sentence repeated verbatim in several years groups as itself; only sentences unique to
  // one year are matched by template (so the base-year note isn't split off at the base year).
  const yearsByNote = new Map<string, number>();
  for (const p of points) for (const n of notesForView(p, annotations)) yearsByNote.set(n, (yearsByNote.get(n) ?? 0) + 1);

  const groups = new Map<string, { notes: Set<string>; years: number[] }>();
  for (const p of points) {
    for (const n of notesForView(p, annotations)) {
      const key = (yearsByNote.get(n) ?? 0) > 1 ? `=${n}` : template(n, p.label);
      const g = groups.get(key) ?? { notes: new Set<string>(), years: [] };
      g.notes.add(n);
      g.years.push(p.fiscalYear);
      groups.set(key, g);
    }
  }
  const out: PointNote[] = [];
  for (const [key, g] of groups) {
    if (g.notes.size === 1) {
      out.push({ note: [...g.notes][0], years: yearRanges(g.years) });
    } else if (g.years.length >= MIN_YEARS_TO_GENERALIZE) {
      out.push({ note: renderTemplate(key.startsWith('=') ? key.slice(1) : key), years: yearRanges(g.years) });
    } else {
      // Too few to generalize: keep each sentence with its own year.
      const byNote = new Map<string, number[]>();
      for (const p of points) for (const n of notesForView(p, annotations)) if (g.notes.has(n)) byNote.set(n, [...(byNote.get(n) ?? []), p.fiscalYear]);
      for (const [note, ys] of byNote) out.push({ note, years: yearRanges(ys) });
    }
  }
  return out;
}

/**
 * Labels a CPI gap note about the base year as such: "... for base year FY 2009-10 ...". The
 * transform's sentence names the year but not its role, which reads as a gap in every row.
 */
export function labelBaseYearNotes(
  points: readonly SeriesPoint[],
  baseReason: string | null,
  baseYearText: string,
): SeriesPoint[] {
  if (!baseReason) return [...points];
  const relabelled = baseReason.replace(`for ${baseYearText}`, `for base year ${baseYearText}`);
  if (relabelled === baseReason) return [...points];
  return points.map((p) =>
    p.notes.includes(baseReason) ? { ...p, notes: p.notes.map((n) => (n === baseReason ? relabelled : n)) } : p,
  );
}
