// Number formatting for chart axes, tooltips and tables. Rounding happens only here.
import { isPerCapita } from './labels';
import { TransformSettings } from './transform';

type ValueSettings = Pick<TransformSettings, 'measure' | 'indexTo100'>;

const usdWhole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usdCents = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const usdCompact = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 2,
});
const indexFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const intFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const cpiFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 3 });

export const EM_DASH = '—';

function missing(v: number | null | undefined): v is null | undefined {
  return v === null || v === undefined || !Number.isFinite(v);
}

/** Value in the unit of the active measure (table and tooltip). */
export function formatValue(v: number | null | undefined, s: ValueSettings): string {
  if (missing(v)) return EM_DASH;
  if (s.indexTo100) return indexFmt.format(v);
  return isPerCapita(s.measure) ? usdCents.format(v) : usdWhole.format(v);
}

/** Short value for axis labels. */
export function formatAxisValue(v: number, s: ValueSettings): string {
  if (s.indexTo100) return intFmt.format(v);
  return isPerCapita(s.measure) ? usdWhole.format(v) : usdCompact.format(v);
}

export function formatUsd(v: number | null | undefined): string {
  return missing(v) ? EM_DASH : usdWhole.format(v);
}

export function formatCount(v: number | null | undefined): string {
  return missing(v) ? EM_DASH : intFmt.format(v);
}

export function formatCpi(v: number | null | undefined): string {
  return missing(v) ? EM_DASH : cpiFmt.format(v);
}

const pctFmt = new Intl.NumberFormat('en-US', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: 'exceptZero',
});
const usdCompactSigned = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 2,
  signDisplay: 'exceptZero',
});
const usdCentsSigned = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: 'exceptZero',
});
const indexSigned = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: 'exceptZero',
});

/** Headline value for a KPI card: compact totals ($5.47B), full per-resident, index to 0.1. */
export function formatKpiValue(v: number | null | undefined, s: ValueSettings): string {
  if (missing(v)) return EM_DASH;
  if (s.indexTo100) return indexFmt.format(v);
  return isPerCapita(s.measure) ? usdCents.format(v) : usdCompact.format(v);
}

/** Signed difference in the unit of the measure: "+$1.63B", "+$412.10", "+12.4". */
export function formatSignedDelta(v: number, s: ValueSettings): string {
  if (s.indexTo100) return indexSigned.format(v);
  return isPerCapita(s.measure) ? usdCentsSigned.format(v) : usdCompactSigned.format(v);
}

/** Signed percent with one decimal: "+41.6%", "-3.0%". Input is a ratio (0.416). */
export function formatSignedPercent(ratio: number): string {
  return pctFmt.format(ratio);
}

export function formatUsdCompact(v: number | null | undefined): string {
  return missing(v) ? EM_DASH : usdCompact.format(v);
}
