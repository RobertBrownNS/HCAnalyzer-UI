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
