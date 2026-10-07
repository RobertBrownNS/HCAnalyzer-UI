// URL state for how the data is shown (chart type), and id-list helpers for the fund and
// category selections. Pure; unknown or malformed values fall back to defaults, nothing throws.

/** Chart types (D-20). `line` is the total; the others break it down by category. */
export type ChartType = 'line' | 'lines' | 'stacked' | 'share' | 'bars';
export const CHART_TYPES: readonly ChartType[] = ['line', 'lines', 'stacked', 'share', 'bars'];
export const DEFAULT_CHART: ChartType = 'line';

export const CHART_LABELS: Record<ChartType, string> = {
  line: 'Line',
  lines: 'Lines by category',
  stacked: 'Stacked area',
  share: '100% share',
  bars: 'Bars',
};

/** Chart types that show categories (and use the category picker). */
/** Line and lines by category: the chart types that can show index-to-100. */
export function isLineChart(chart: ChartType): boolean {
  return chart === 'line' || chart === 'lines';
}

export function isCategoryChart(chart: ChartType): boolean {
  return chart !== 'line';
}

/** How the data is shown. The category selection is a transform setting (`categories`, URL `cats`). */
export interface ViewState {
  chart: ChartType;
}

export const VIEW_KEYS = ['chart'] as const;

/** Ids are lowercase slugs with underscores ("special_revenue", "ad_valorem"). */
const ID = /^[a-z][a-z0-9_]*$/;

/** "b,a,a" -> ["a", "b"]: sorted, de-duplicated, malformed entries dropped; null when absent or empty. */
export function parseIdList(value: string | null): string[] | null {
  if (value === null) return null;
  const ids = [...new Set(value.split(',').map((v) => v.trim()).filter((v) => ID.test(v)))].sort();
  return ids.length ? ids : null;
}

/**
 * Keeps only ids in `allowed`. A list that names every allowed id, or nothing valid, becomes null
 * ("all"), so the URL omits it. With no `allowed` list yet (data loading) the list is kept as is.
 */
export function normalizeIdList(list: readonly string[] | null, allowed: readonly string[]): string[] | null {
  if (list === null) return null;
  if (allowed.length === 0) return [...list];
  const kept = list.filter((id) => allowed.includes(id)).sort();
  if (kept.length === 0) return null;
  if (allowed.every((id) => kept.includes(id))) return null;
  return kept;
}

/** null ("all") -> undefined (param omitted); otherwise a sorted, comma-separated list. */
export function serializeIdList(list: readonly string[] | null): string | undefined {
  return list && list.length ? [...list].sort().join(',') : undefined;
}

export function parseView(params: { get(name: string): string | null }): ViewState {
  const chart = params.get('chart');
  return {
    chart: chart !== null && (CHART_TYPES as readonly string[]).includes(chart) ? (chart as ChartType) : DEFAULT_CHART,
  };
}

/** Writes `chart` always, like every other setting (DR-32). */
export function serializeView(v: ViewState): { chart: string } {
  return { chart: v.chart };
}
