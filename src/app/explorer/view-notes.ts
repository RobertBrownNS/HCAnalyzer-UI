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

/** One markLine per fiscal year: full labels first, then "Note 2" / "Notes 2, 3". */
export function markLineGroups(notes: readonly AnnotationNote[]): MarkLineGroup[] {
  const groups = new Map<number, AnnotationNote[]>();
  for (const n of notes) groups.set(n.fiscalYear, [...(groups.get(n.fiscalYear) ?? []), n]);
  return [...groups].map(([fiscalYear, list]) => {
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

/** Groups identical per-point notes and lists the fiscal years each applies to. */
export function groupPointNotes(points: readonly SeriesPoint[], annotations: readonly AnnotationNote[] = []): PointNote[] {
  const byNote = new Map<string, string[]>();
  for (const p of points) {
    for (const n of notesForView(p, annotations)) byNote.set(n, [...(byNote.get(n) ?? []), p.label]);
  }
  return [...byNote].map(([note, labels]) => ({ note, years: labels.join(', ') }));
}
