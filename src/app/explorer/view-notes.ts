// Pairs chart annotations with the "Notes for this view" list. Pure; exported for tests.
import { AnnotationRecord, SourceRecord } from '../core/models';
import { SeriesPoint, fiscalYearLabel } from '../core/transform';

/** Fields the pipeline may add to annotations (detail text and workbook cells). */
type AnnotationWithDetail = AnnotationRecord & { detail?: string; refs?: readonly string[] };

/** Labels longer than this are shown on the chart as "Note N" and spelled out in the list. */
export const MAX_CHART_LABEL = 48;

export interface AnnotationNote {
  n: number;
  fiscalYear: number;
  yearLabel: string;
  kind: AnnotationRecord['kind'];
  label: string;
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
  return [...annotations]
    .sort((a, b) => a.fiscalYear - b.fiscalYear)
    .map((raw, i) => {
      const a = raw as AnnotationWithDetail;
      const source = byId.get(a.sourceId);
      return {
        n: i + 1,
        fiscalYear: a.fiscalYear,
        yearLabel: fiscalYearLabel(a.fiscalYear),
        kind: a.kind,
        label: a.label,
        text: a.detail ? [a.detail] : (source?.caveats ?? []),
        refs: a.refs ?? [],
        source,
      };
    });
}

export function chartLabel(note: AnnotationNote): string {
  return note.label.length <= MAX_CHART_LABEL ? note.label : `Note ${note.n}`;
}

/** One markLine per fiscal year; labels of annotations in the same year are joined. */
export function markLineGroups(notes: readonly AnnotationNote[]): MarkLineGroup[] {
  const groups = new Map<number, AnnotationNote[]>();
  for (const n of notes) groups.set(n.fiscalYear, [...(groups.get(n.fiscalYear) ?? []), n]);
  return [...groups].map(([fiscalYear, list]) => ({
    fiscalYear,
    kind: list[0].kind,
    label: list.map(chartLabel).join(' · '),
  }));
}

/** Groups identical per-point notes and lists the fiscal years each applies to. */
export function groupPointNotes(points: readonly SeriesPoint[]): PointNote[] {
  const byNote = new Map<string, string[]>();
  for (const p of points) {
    for (const n of p.notes) byNote.set(n, [...(byNote.get(n) ?? []), p.label]);
  }
  return [...byNote].map(([note, labels]) => ({ note, years: labels.join(', ') }));
}
