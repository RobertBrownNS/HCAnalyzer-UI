// KPI card contents. Neutrality rule: cards only restate values for the user's current settings
// (range end, range start, the change between those two years, and the custodial amount for the
// end year). No comparison year is chosen for the user and nothing signals good or bad.
import { EM_DASH, formatKpiValue, formatSignedDelta, formatSignedPercent, formatUsdCompact } from '../core/format';
import { FLOW_LABELS } from '../core/labels';
import { SeriesPoint, TransformSettings, fiscalYearLabel } from '../core/transform';

export type KpiId = 'end' | 'start' | 'change' | 'custodial';

export interface KpiCard {
  id: KpiId;
  label: string;
  value: string;
  sub: string;
  /** The unformatted number behind `value` (transform output; change is a ratio). */
  raw: number | null;
  /** 'series' = colored by the flow's series color; 'neutral' = grey. */
  accent: 'series' | 'neutral';
}

/** Describes the unit of the values: "Nominal dollars", "Per resident, FY 2024-25 dollars", ... */
export function measureCaption(s: TransformSettings): string {
  const base = fiscalYearLabel(s.baseYear);
  const unit = {
    nominal: 'Nominal dollars',
    per_capita: 'Per resident, nominal dollars',
    real: `${base} dollars`,
    real_per_capita: `Per resident, ${base} dollars`,
  }[s.measure];
  return s.indexTo100 ? `Index, ${base} = 100 · ${unit}` : unit;
}

/**
 * @param emptySub sub-line when there are no points: "No years in range" by default; the page
 *   passes "Data not loaded" after a failed load (QA-27).
 */
export function kpiCards(points: readonly SeriesPoint[], s: TransformSettings, emptySub = 'No years in range'): KpiCard[] {
  const flow = FLOW_LABELS[s.flow];
  const caption = measureCaption(s);
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) {
    return [
      { id: 'end', label: flow, value: EM_DASH, sub: caption, raw: null, accent: 'series' },
      { id: 'change', label: 'Change', value: EM_DASH, sub: emptySub, raw: null, accent: 'series' },
    ];
  }

  const cards: KpiCard[] = [
    { id: 'end', label: `${flow} · ${last.label}`, value: formatKpiValue(last.value, s), sub: caption, raw: last.value, accent: 'series' },
    { id: 'start', label: `${flow} · ${first.label}`, value: formatKpiValue(first.value, s), sub: caption, raw: first.value, accent: 'series' },
  ];

  const span = `${first.label} → ${last.label}`;
  const a = first.value;
  const b = last.value;
  if (first === last) {
    cards.push({ id: 'change', label: 'Change', value: EM_DASH, sub: 'Select more than one year', raw: null, accent: 'series' });
  } else if (a === null || b === null || a === 0) {
    cards.push({ id: 'change', label: 'Change', value: EM_DASH, sub: `${span}: not computable`, raw: null, accent: 'series' });
  } else {
    const ratio = (b - a) / Math.abs(a);
    cards.push({
      id: 'change',
      label: 'Change',
      value: formatSignedPercent(ratio),
      sub: `${span} · ${formatSignedDelta(b - a, s)}`,
      raw: ratio,
      accent: 'series',
    });
  }

  const custodialFrom = 2021; // GASB 84: first fiscal year with a custodial column
  cards.push({
    id: 'custodial',
    label: `Custodial fund · ${last.label}`,
    value: last.fiscalYear < custodialFrom ? EM_DASH : formatUsdCompact(last.custodialNominal),
    raw: last.fiscalYear < custodialFrom ? null : last.custodialNominal,
    sub:
      last.fiscalYear < custodialFrom
        ? `Not reported before ${fiscalYearLabel(custodialFrom)}`
        : `Nominal; ${s.includeCustodial ? 'included in' : 'excluded from'} totals`,
    accent: 'neutral',
  });
  return cards;
}
