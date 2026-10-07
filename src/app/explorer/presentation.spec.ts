import { cssLengthToPx } from '../core/chart-palette';
import { formatAxisValue, formatValue } from '../core/format';
import { DEFAULT_SETTINGS, SeriesPoint } from '../core/transform';
import { AnnotationRecord, SourceRecord } from '../core/models';
import {
  annotationNotes,
  annotationsForTooltip,
  groupPointNotes,
  isTransferImbalanceAnnotation,
  isTransferImbalanceNote,
  markLineGroups,
} from './view-notes';
import { tooltipHtml } from './series-chart.component';

const point = (fy: number, notes: string[] = [], extra: Partial<SeriesPoint> = {}): SeriesPoint => ({
  fiscalYear: fy,
  label: `FY ${fy - 1}-${String(fy % 100).padStart(2, '0')}`,
  value: 10,
  nominal: 1_000_000,
  custodialNominal: 0,
  transfersNominal: 0,
  sourceIds: [],
  notes,
  ...extra,
});

describe('formatting', () => {
  it('formats by measure', () => {
    expect(formatValue(1234567.4, DEFAULT_SETTINGS)).toBe('$1,234,567');
    expect(formatValue(1234.567, { measure: 'per_capita', indexTo100: false })).toBe('$1,234.57');
    expect(formatValue(104.26, { measure: 'real', indexTo100: true })).toBe('104.3');
    expect(formatValue(null, DEFAULT_SETTINGS)).toBe('—');
    expect(formatAxisValue(2_500_000_000, DEFAULT_SETTINGS)).toBe('$2.5B');
  });
});

describe('tooltipHtml', () => {
  it('shows FY, value and nominal; adds population and CPI for those measures', () => {
    const p = point(2021, [], { population: 1_500_000, cpi: 266.616, cpiBase: 319.997 });
    const nominal = tooltipHtml(p, DEFAULT_SETTINGS, 'Revenues');
    expect(nominal).toContain('FY 2020-21');
    expect(nominal).toContain('$1,000,000');
    expect(nominal).not.toContain('Population');

    const html = tooltipHtml(p, { ...DEFAULT_SETTINGS, measure: 'real_per_capita' }, 'Revenues');
    expect(html).toContain('Population (April 1)');
    expect(html).toContain('1,500,000');
    expect(html).toContain('266.616');
    expect(html).toContain('CPI FY 2024-25 (base)');
  });

  it('escapes note text', () => {
    expect(tooltipHtml(point(2021, ['<b>x</b>']), DEFAULT_SETTINGS, 'R')).not.toContain('<b>x</b>');
  });
});

describe('groupPointNotes', () => {
  it('groups identical notes with the years they apply to', () => {
    const groups = groupPointNotes([point(2021, ['a']), point(2022, ['a', 'b']), point(2023)]);
    expect(groups).toEqual([
      { note: 'a', years: 'FY 2020-21, FY 2021-22' },
      { note: 'b', years: 'FY 2021-22' },
    ]);
  });
});

describe('annotation notes', () => {
  const sources = [
    { id: 'page', publisher: 'EDR', title: 'Index page', url: 'https://example.test', retrieved: '2026-10-06', sha256: 'x', caveats: ['Page caveat.'] },
    { id: 'exp', publisher: 'EDR', title: 'Expenditures', url: 'https://example.test/e', retrieved: '2026-10-06', sha256: 'y', caveats: ['AFR caveat.'] },
  ] as SourceRecord[];
  const gasb: AnnotationRecord = { fiscalYear: 2021, kind: 'methodology', label: 'Custodial fund reporting begins (GASB 84).', sourceId: 'page' };
  const longA = {
    fiscalYear: 2023,
    kind: 'methodology',
    label: 'Transfers out (581) exceed transfers in (381) by $624.6M; account 521 Law Enforcement $1.2B',
    sourceId: 'exp',
    flow: 'expenditure',
    detail: 'FY 2022-23: expenditure account 581 exceeds revenue account 381.',
    refs: ['2023!N90'],
  } as AnnotationRecord;
  const sameYear: AnnotationRecord = { fiscalYear: 2023, kind: 'methodology', label: 'Amounts reported rounded to $1,000', sourceId: 'exp', flow: 'expenditure' };

  it('numbers annotations by year and uses detail, else the source caveats', () => {
    const notes = annotationNotes([longA, gasb, sameYear], sources);
    expect(notes.map((n) => [n.n, n.fiscalYear])).toEqual([[1, 2021], [2, 2023], [3, 2023]]);
    expect(notes[0].text).toEqual(['Page caveat.']);
    expect(notes[1].text).toEqual(['FY 2022-23: expenditure account 581 exceeds revenue account 381.']);
    expect(notes[1].refs).toEqual(['2023!N90']);
    expect(notes[1].source?.id).toBe('exp');
  });

  it('spells out view-independent labels on the chart and numbers the rest', () => {
    const conditional = { ...gasb, fiscalYear: 2021, label: 'Custodial column is all zeros', custodial: 'included' } as AnnotationRecord;
    const groups = markLineGroups(annotationNotes([gasb, conditional, longA, sameYear], sources));
    expect(groups).toEqual([
      { fiscalYear: 2021, kind: 'methodology', label: 'Custodial fund reporting begins (GASB 84). · Note 2' },
      { fiscalYear: 2023, kind: 'methodology', label: 'Notes 3, 4' },
    ]);
  });

  it('numbers a view-independent label that is too long for the chart', () => {
    const long = { ...gasb, label: 'x'.repeat(49) };
    expect(markLineGroups(annotationNotes([long], sources))[0].label).toBe('Note 1');
  });

  it('lists annotations for the hovered year in the tooltip', () => {
    const notes = annotationNotes([longA], sources);
    expect(tooltipHtml(point(2023), DEFAULT_SETTINGS, 'R', notes)).toContain('1. Transfers out (581)');
    expect(tooltipHtml(point(2022), DEFAULT_SETTINGS, 'R', notes)).not.toContain('Transfers out');
  });
});

describe('cssLengthToPx', () => {
  it('converts px and rem token values, with a fallback', () => {
    expect(cssLengthToPx('2.5px', 16, 0)).toBe(2.5);
    expect(cssLengthToPx(' 0.75rem ', 16, 0)).toBe(12);
    expect(cssLengthToPx('6', 16, 0)).toBe(6);
    expect(cssLengthToPx('', 16, 11)).toBe(11);
    expect(cssLengthToPx('calc(1px + 1rem)', 16, 11)).toBe(11);
  });
});

describe('transfer-imbalance dedupe (annotation vs per-point note)', () => {
  const NOTE =
    'Transfers out (581) and transfers in (381) differ in FY 2022-23: $1,160,934,246 out, $536,330,405 in (difference $624,603,841).';
  const sources = [] as SourceRecord[];
  const imbalanceAnnotation = {
    fiscalYear: 2023,
    kind: 'methodology',
    label: 'Transfers out (581) exceed transfers in (381) by $624.6M; account 521 Law Enforcement $732,874',
    sourceId: 'exp',
    flow: 'expenditure',
  } as AnnotationRecord;
  const other = { ...imbalanceAnnotation, label: 'Amounts reported rounded to $1,000' } as AnnotationRecord;
  const p2023 = point(2023, [NOTE, 'Custodial fund amounts (GASB 84) are excluded.']);
  const p2024 = point(2024, [NOTE.replace('2022-23', '2023-24')]);

  it('recognises the note and the annotation', () => {
    expect(isTransferImbalanceNote(NOTE)).toBe(true);
    expect(isTransferImbalanceNote('Custodial fund amounts (GASB 84) are excluded.')).toBe(false);
    expect(isTransferImbalanceAnnotation(imbalanceAnnotation)).toBe(true);
    expect(isTransferImbalanceAnnotation({ label: NOTE })).toBe(false);
    expect(isTransferImbalanceAnnotation(other)).toBe(false);
  });

  it('Notes for this view: the annotation wins; the per-point note is dropped for that year only', () => {
    const notes = annotationNotes([imbalanceAnnotation, other], sources);
    const grouped = groupPointNotes([p2023, p2024], notes);
    expect(grouped.map((g) => g.note)).not.toContain(NOTE);
    // FY 2023-24 has no annotation in this fixture, so its note stays.
    expect(grouped.map((g) => g.years)).toContain('FY 2023-24');
    expect(grouped.find((g) => g.note.startsWith('Custodial'))?.years).toBe('FY 2022-23');
  });

  it('revenue flow: no expenditure annotation in view, so the per-point note is the only display', () => {
    expect(groupPointNotes([p2023], []).map((g) => g.note)).toContain(NOTE);
  });

  it('tooltip: keeps the per-point note and leaves out the matching annotation', () => {
    const notes = annotationNotes([imbalanceAnnotation, other], sources);
    const html = tooltipHtml(p2023, DEFAULT_SETTINGS, 'Expenditures', notes);
    expect(html).toContain('Transfers out (581) and transfers in (381) differ');
    expect(html).not.toContain('exceed transfers in');
    expect(html).toContain('Amounts reported rounded to $1,000');
    expect(annotationsForTooltip(point(2023), notes)).toHaveLength(2); // no note: annotation kept
  });

  it('chart lines still mark the annotation year', () => {
    const groups = markLineGroups(annotationNotes([imbalanceAnnotation], sources));
    expect(groups).toEqual([{ fiscalYear: 2023, kind: 'methodology', label: 'Note 1' }]);
  });
});
