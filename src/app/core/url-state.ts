// Pure conversion between TransformSettings and URL query params, so links reproduce views.
// Unknown or malformed params fall back to defaults; nothing here throws.
import { CpiIndex, CpiPeriod, DEFAULT_SETTINGS, Measure, TransferMode, TransformSettings } from './transform';
import { Flow } from './models';

export const QUERY_KEYS = ['flow', 'measure', 'base', 'idx', 'from', 'to', 'cust', 'cpi', 'cpiper', 'xfer'] as const;
export type QueryKey = (typeof QUERY_KEYS)[number];
export type QueryParams = Record<QueryKey, string>;

/** Anything with a `get(name)` lookup, e.g. Angular's ParamMap or URLSearchParams. */
export interface ParamSource {
  get(name: string): string | null;
}

const FLOWS: readonly Flow[] = ['revenue', 'expenditure'];
const MEASURES: readonly Measure[] = ['nominal', 'per_capita', 'real', 'real_per_capita'];
const CPI_INDEXES: readonly CpiIndex[] = ['cpi-u-us', 'cpi-u-tampa'];
const CPI_PERIODS: readonly CpiPeriod[] = ['fiscal', 'calendar'];
const TRANSFER_MODES: readonly TransferMode[] = ['gross', 'net'];

function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function year(value: string | null): number | null {
  if (value === null || !/^\d{4}$/.test(value)) return null;
  return Number(value);
}

function flag(value: string | null, fallback: boolean): boolean {
  if (value === '1') return true;
  if (value === '0') return false;
  return fallback;
}

/** Parses query params. Each invalid value falls back to the matching default on its own. */
export function parseSettings(params: ParamSource, defaults: TransformSettings = DEFAULT_SETTINGS): TransformSettings {
  const from = year(params.get('from')) ?? defaults.range[0];
  const to = year(params.get('to')) ?? defaults.range[1];
  return {
    flow: oneOf(params.get('flow'), FLOWS, defaults.flow),
    measure: oneOf(params.get('measure'), MEASURES, defaults.measure),
    baseYear: year(params.get('base')) ?? defaults.baseYear,
    indexTo100: flag(params.get('idx'), defaults.indexTo100),
    range: from <= to ? [from, to] : [to, from],
    includeCustodial: flag(params.get('cust'), defaults.includeCustodial),
    cpiIndex: oneOf(params.get('cpi'), CPI_INDEXES, defaults.cpiIndex),
    cpiPeriod: oneOf(params.get('cpiper'), CPI_PERIODS, defaults.cpiPeriod),
    transfers: oneOf(params.get('xfer'), TRANSFER_MODES, defaults.transfers ?? 'gross'),
  };
}

/** Writes every setting explicitly, so a link keeps its meaning if defaults change later. */
export function serializeSettings(s: TransformSettings): QueryParams {
  return {
    flow: s.flow,
    measure: s.measure,
    base: String(s.baseYear),
    idx: s.indexTo100 ? '1' : '0',
    from: String(s.range[0]),
    to: String(s.range[1]),
    cust: s.includeCustodial ? '1' : '0',
    cpi: s.cpiIndex,
    cpiper: s.cpiPeriod,
    xfer: s.transfers ?? 'gross',
  };
}

/**
 * Fits settings to the fiscal years that exist for the selected flow: the range is clamped to
 * the available span and the base year must be an available year. With no years known
 * (data still loading) settings are returned unchanged.
 */
export function normalizeSettings(
  s: TransformSettings,
  years: readonly number[],
  defaults: TransformSettings = DEFAULT_SETTINGS,
): TransformSettings {
  if (years.length === 0) return s;
  const min = years[0];
  const max = years[years.length - 1];
  const clamp = (y: number) => Math.min(max, Math.max(min, y));
  let [from, to] = [clamp(s.range[0]), clamp(s.range[1])];
  if (from > to) [from, to] = [to, from];
  const baseYear = years.includes(s.baseYear)
    ? s.baseYear
    : years.includes(defaults.baseYear)
      ? defaults.baseYear
      : max;
  return { ...s, range: [from, to], baseYear };
}

export function sameParams(a: Partial<QueryParams>, b: Partial<QueryParams>): boolean {
  return QUERY_KEYS.every((k) => (a[k] ?? null) === (b[k] ?? null));
}
