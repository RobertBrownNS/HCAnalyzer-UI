// Resolves theme colors for ECharts, which draws on canvas and cannot read CSS variables.
// Colors come from the colorblind-safe palette (src/styles/_palette.scss) and Material
// system tokens. Both use light-dark(), so they are resolved through a probe element.
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
  return Array.from({ length: SERIES_COUNT }, (_, i) => resolveCssColor(`var(--series-${i + 1})`, host)).filter(
    (c) => c.length > 0,
  );
}

export function readChartColors(host?: Element): ChartColors {
  const c = (expr: string) => resolveCssColor(expr, host);
  return {
    series: readSeriesPalette(host),
    text: c('var(--mat-sys-on-surface)'),
    textMuted: c('var(--mat-sys-on-surface-variant)'),
    axisLine: c('var(--mat-sys-outline)'),
    gridLine: c('var(--mat-sys-outline-variant)'),
    surface: c('var(--mat-sys-surface-container-high)'),
    annotation: {
      methodology: c('var(--annotation-methodology)'),
      policy: c('var(--annotation-policy)'),
      event: c('var(--annotation-event)'),
    },
  };
}
