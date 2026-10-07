// Converts an ECharts dataZoom window into a fiscal-year range, so a zoom becomes a settings
// change (URL, KPIs, readout) instead of a chart-only state. Pure; exported for tests.

/**
 * @param years fiscal years on the category axis, in order
 * @param startPct dataZoom start, 0-100
 * @param endPct dataZoom end, 0-100
 * @returns the snapped [from, to], or null when it covers every year (nothing to change)
 */
export function zoomWindowToRange(years: readonly number[], startPct: number, endPct: number): [number, number] | null {
  const n = years.length;
  if (n === 0 || !Number.isFinite(startPct) || !Number.isFinite(endPct)) return null;
  const clamp = (i: number) => Math.min(n - 1, Math.max(0, i));
  let from = clamp(Math.round((Math.min(startPct, endPct) / 100) * (n - 1)));
  let to = clamp(Math.round((Math.max(startPct, endPct) / 100) * (n - 1)));
  if (to === from) {
    // Keep at least two years visible so a line can still be drawn.
    if (to < n - 1) to += 1;
    else if (from > 0) from -= 1;
  }
  if (from === 0 && to === n - 1) return null;
  return [years[from], years[to]];
}

/** Debounce for zoom gestures: the range updates once the pinch or drag settles. */
export const ZOOM_SETTLE_MS = 400;
