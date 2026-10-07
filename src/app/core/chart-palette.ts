// Resolves theme values for ECharts, which draws on canvas and cannot read CSS variables.
// Everything comes from the design tokens (src/styles/_tokens.scss). Colors use light-dark(),
// so they are resolved through a probe element.
const SERIES_COUNT = 8;

export interface ChartColors {
  series: string[];
  text: string;
  textMuted: string;
  axisLine: string;
  gridLine: string;
  surface: string;
  annotation: { methodology: string; policy: string; event: string };
}

export interface ChartMetrics {
  fontFamily: string;
  lineWidth: number;
  symbolSize: number;
  labelSize: number;
  /** --fx-space-1..6 in px */
  space: (step: 1 | 2 | 3 | 4 | 5 | 6) => number;
}

/** Converts a "12px" or "0.75rem" token value to pixels; fallback when unset or unparseable. */
export function cssLengthToPx(value: string, rootFontPx: number, fallback: number): number {
  const m = /^\s*(-?[\d.]+)(px|rem)?\s*$/.exec(value);
  if (!m) return fallback;
  const n = parseFloat(m[1]);
  return m[2] === 'rem' ? n * rootFontPx : n;
}

/** Non-color chart values from the tokens. Fallbacks apply where CSS isn't computed (tests). */
export function readChartMetrics(host: Element = document.body): ChartMetrics {
  const style = getComputedStyle(host);
  const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const len = (name: string, fallback: number) => cssLengthToPx(style.getPropertyValue(name), rootPx, fallback);
  return {
    fontFamily: style.getPropertyValue('--fx-font-plain').trim() || 'sans-serif',
    lineWidth: len('--fx-chart-line', 2.5),
    symbolSize: len('--fx-chart-symbol', 6),
    labelSize: len('--fx-type-label-small-size', 11),
    space: (step) => len(`--fx-space-${step}`, [4, 8, 12, 16, 24, 32][step - 1]),
  };
}

export function resolveCssColor(expr: string, host: Element = document.body): string {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  probe.style.color = expr;
  host.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

export function readSeriesPalette(host?: Element): string[] {
  return Array.from({ length: SERIES_COUNT }, (_, i) => resolveCssColor(`var(--fx-series-${i + 1})`, host)).filter(
    (c) => c.length > 0,
  );
}

export function readChartColors(host?: Element): ChartColors {
  const c = (expr: string) => resolveCssColor(expr, host);
  return {
    series: readSeriesPalette(host),
    text: c('var(--fx-color-on-surface)'),
    textMuted: c('var(--fx-color-on-surface-variant)'),
    axisLine: c('var(--fx-color-outline)'),
    gridLine: c('var(--fx-color-outline-variant)'),
    surface: c('var(--fx-color-surface-container-high)'),
    annotation: {
      methodology: c('var(--fx-annotation-methodology)'),
      policy: c('var(--fx-annotation-policy)'),
      event: c('var(--fx-annotation-event)'),
    },
  };
}
