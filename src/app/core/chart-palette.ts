// Reads the colorblind-safe series palette from CSS custom properties (src/styles/_palette.scss)
// so charts follow the active light/dark scheme.
const SERIES_COUNT = 8;

export function readSeriesPalette(el: Element = document.documentElement): string[] {
  const style = getComputedStyle(el);
  return Array.from({ length: SERIES_COUNT }, (_, i) =>
    style.getPropertyValue(`--series-${i + 1}`).trim(),
  ).filter((c) => c.length > 0);
}
