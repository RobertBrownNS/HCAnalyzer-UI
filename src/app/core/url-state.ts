// Pure conversion between TransformSettings and URL query params, so links reproduce views.
// Unknown or malformed params fall back to defaults; nothing here throws.
import {
  CpiIndex,
  CpiPeriod,
  Measure,
  TransferMode,
  TransformSettings,
  settingsWithDefaults,
} from './transform';
import { Flow } from './models';
import { normalizeIdList, parseIdList, serializeIdList } from './view-state';

/** Settings written on every URL (DR-32). */
export const QUERY_KEYS = ['flow', 'measure', 'base', 'idx', 'from', 'to', 'cust', 'cpi', 'cpiper', 'xfer', 'county'] as const;
/** Id-list settings, omitted when "all" (D-18; old links without them keep their meaning). */
export const LIST_KEYS = ['funds', 'cats'] as const;
/** Every key this module reads or writes. */
export const ALL_SETTING_KEYS = [...QUERY_KEYS, ...LIST_KEYS] as const;
export type QueryKey = (typeof QUERY_KEYS)[number];
export type QueryParams = Record<QueryKey, string> & Partial<Record<(typeof LIST_KEYS)[number], string>>;

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

/** County ids are lowercase slugs ("miami-dade"); anything else is not a county. */
function county(value: string | null): string | null {
  return value !== null && /^[a-z]+(-[a-z]+)*$/.test(value) ? value : null;
}

function flag(value: string | null, fallback: boolean): boolean {
  if (value === '1') return true;
  if (value === '0') return false;
  return fallback;
}

/** Parses query params. Each invalid value falls back to the matching default on its own. */
/** County not known yet: the URL names none and the data's county list hasn't loaded. */
export const NO_COUNTY = '';

/** Methodology defaults with no county; the county comes from the URL or the data's default. */
const BASE_DEFAULTS = (): TransformSettings => settingsWithDefaults(NO_COUNTY);

export function parseSettings(params: ParamSource, defaults: TransformSettings = BASE_DEFAULTS()): TransformSettings {
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
    jurisdiction: county(params.get('county')) ?? defaults.jurisdiction,
    ...idLists(parseIdList(params.get('funds')), parseIdList(params.get('cats'))),
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
    county: s.jurisdiction,
    ...(serializeIdList(s.funds ?? null) ? { funds: serializeIdList(s.funds ?? null) } : {}),
    ...(serializeIdList(s.categories ?? null) ? { cats: serializeIdList(s.categories ?? null) } : {}),
  };
}

function idLists(funds: string[] | null, categories: string[] | null): Pick<TransformSettings, 'funds' | 'categories'> {
  return { ...(funds ? { funds } : {}), ...(categories ? { categories } : {}) };
}

/**
 * Keeps only funds and categories the data offers for this county and flow; a selection that
 * names every one of them, or none, becomes "all" (the setting is removed). With no lists yet
 * (data loading) settings are returned unchanged.
 */
export function normalizeScope(
  s: TransformSettings,
  availableFunds: readonly string[],
  availableCategories: readonly string[],
): TransformSettings {
  const { funds: _f, categories: _c, ...rest } = s;
  const funds = normalizeIdList(s.funds ?? null, availableFunds);
  const categories = normalizeIdList(s.categories ?? null, availableCategories);
  return { ...rest, ...idLists(funds, categories) };
}

/**
 * A county the data doesn't offer falls back to `fallbackCounty` (the data's default county).
 * With no county list yet (manifest still loading) the county is returned unchanged.
 */
export function normalizeCounty(
  s: TransformSettings,
  counties: readonly string[],
  fallbackCounty: string,
): TransformSettings {
  if (counties.length === 0) return s;
  const jurisdiction = s.jurisdiction && counties.includes(s.jurisdiction) ? s.jurisdiction : fallbackCounty;
  return jurisdiction === s.jurisdiction ? s : { ...s, jurisdiction };
}

/**
 * Fits settings to the fiscal years that exist for the selected county and flow: the range is
 * clamped to the available span and the base year must be an available year. With no years
 * known (data still loading) settings are returned unchanged.
 */
export function normalizeSettings(
  s: TransformSettings,
  years: readonly number[],
  defaults: TransformSettings = BASE_DEFAULTS(),
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
  return ALL_SETTING_KEYS.every((k) => (a[k] ?? null) === (b[k] ?? null));
}
