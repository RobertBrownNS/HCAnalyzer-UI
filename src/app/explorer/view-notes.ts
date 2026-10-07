// Pairs chart annotations with the "Notes for this view" list. Pure; exported for tests.
import { AnnotationRecord, SourceRecord } from '../core/models';
import { SeriesPoint, TRANSFER_ACCOUNTS, fiscalYearLabel } from '../core/transform';

/** Fields the pipeline may add to annotations (detail text and workbook cells). */
type AnnotationWithDetail = AnnotationRecord & { detail?: string; refs?: readonly string[] };

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
  label: string;
  /** True when the annotation has no flow, custodial or measure condition. */
  universal: boolean;
  /** The annotation's detail, or the caveats of its source when it has none. */
  text: string[];
  refs: readonly string[];
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

export function annotationNotes(
  annotations: readonly AnnotationRecord[],
  sources: readonly SourceRecord[],
): AnnotationNote[] {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const isUniversal = (a: AnnotationRecord) => a.flow === undefined && a.custodial === undefined && a.measures === undefined;
  return [...annotations]
    // By year; within a year, view-independent annotations (e.g. GASB 84) first.
    .sort((a, b) => a.fiscalYear - b.fiscalYear || Number(isUniversal(b)) - Number(isUniversal(a)))
    .map((raw, i) => {
      const a = raw as AnnotationWithDetail;
      const source = byId.get(a.sourceId);
      return {
        n: i + 1,
        fiscalYear: a.fiscalYear,
        yearLabel: fiscalYearLabel(a.fiscalYear),
        kind: a.kind,
        label: a.label,
        universal: isUniversal(a),
        text: a.detail ? [a.detail] : (source?.caveats ?? []),
        refs: a.refs ?? [],
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

// The 581/381 transfer imbalance reaches the UI twice: as a data annotation (expenditure only)
// and as a per-point note from the transform (both flows). Each surface shows it once:
// chart lines and "Notes for this view" use the annotation; tooltip and table use the note.
// TODO: switch to a transform export once it owns this matcher (requested).
const IMBALANCE_NOTE_START = `Transfers out (${TRANSFER_ACCOUNTS.expenditure}) and transfers in (${TRANSFER_ACCOUNTS.revenue}) differ`;
const IMBALANCE_ANNOTATION_START = `Transfers out (${TRANSFER_ACCOUNTS.expenditure})`;

export function isTransferImbalanceNote(note: string): boolean {
  return note.startsWith(IMBALANCE_NOTE_START);
}

export function isTransferImbalanceAnnotation(a: Pick<AnnotationNote, 'label'>): boolean {
  return a.label.startsWith(IMBALANCE_ANNOTATION_START) && !isTransferImbalanceNote(a.label);
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
