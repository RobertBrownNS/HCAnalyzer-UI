// ECharts series and tooltip for the category chart types (D-20). Pure: everything needed comes in
// as arguments, so the mapping from transform output to chart is testable without a canvas.
import { ChartColors, ChartMetrics } from '../core/chart-palette';
import { formatValue } from '../core/format';
import { CategorySeries, SeriesPoint, TransformSettings } from '../core/transform';
import { ChartType } from '../core/view-state';

/**
 * Marker shapes for category lines, so colour is never the only cue. All filled: a hollow circle
 * means "not cross-checked" on the total line, so no category uses a hollow shape.
 */
export const CATEGORY_SYMBOLS = [
  'circle',
  'rect',
  'triangle',
  'diamond',
  'roundRect',
  'pin',
  'arrow',
  'path://M0,0L10,0L5,9Z', // inverted triangle
  'path://M3.5,0H6.5V3.5H10V6.5H6.5V10H3.5V6.5H0V3.5H3.5Z', // plus
];

/** Series id for the total line and for a category; the click handler reads these back. */
export const TOTAL_ID = 'total';
export const categorySeriesId = (category: string) => `cat:${category}`;
export function categoryFromSeriesId(id: string | undefined): string | null {
  return id?.startsWith('cat:') ? id.slice(4) : null;
}

export interface CategoryChartInput {
  type: Exclude<ChartType, 'line'>;
  total: readonly SeriesPoint[];
  categories: readonly CategorySeries[];
  /** Display label per category id. */
  labels: Readonly<Record<string, string>>;
  /** Total line colour (the flow's series colour). */
  totalColor: string;
  totalLabel: string;
  s: TransformSettings;
  c: Pick<ChartColors, 'categories' | 'textMuted' | 'surface'>;
  m: Pick<ChartMetrics, 'symbolSize' | 'lineWidth'>;
}

const missing = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '-' : v);

/** Value a category point contributes on this chart type: its share for 100% share, else its value. */
function plotted(type: CategoryChartInput['type'], p: { value: number | null; share: number | null }): number | null {
  return type === 'share' ? p.share : p.value;
}

/**
 * The category drawn under a tap at plotted value `y` for one year, on the stacked types (stacked
 * area, 100% share, bars): the band whose bottom..top contains y, stacking in series order. Null
 * on the lines chart, below zero, above the stack, or for a year without values.
 */
export function categoryAt(
  type: CategoryChartInput['type'],
  categories: readonly CategorySeries[],
  index: number,
  y: number,
): string | null {
  if (type === 'lines' || y < 0) return null;
  let top = 0;
  for (const cs of categories) {
    const p = cs.points[index];
    const v = p ? plotted(type, p) : null;
    if (v === null || v <= 0) continue;
    top += v;
    if (y <= top) return cs.category;
  }
  return null;
}

/** Legend geometry (ECharts plain legend, horizontal): icon, icon-to-text gap, item gap, padding. */
export const LEGEND = { itemWidth: 25, itemHeight: 14, textGap: 5, itemGap: 10, padding: 5 } as const;

/**
 * Height the wrapped legend needs at `width` px (QA-45: every entry visible, no paging). Mirrors
 * ECharts' horizontal box layout: items flow left to right and wrap when the next one doesn't fit.
 * `textWidth` measures a label in the legend font; `lineHeight` is the label line height.
 */
export function legendHeight(
  labels: readonly string[],
  width: number,
  textWidth: (label: string) => number,
  lineHeight: number,
): number {
  if (!labels.length) return 0;
  const avail = Math.max(1, width - 2 * LEGEND.padding);
  let rows = 1;
  let x = 0;
  for (const label of labels) {
    const w = LEGEND.itemWidth + LEGEND.textGap + textWidth(label);
    if (x > 0 && x + w > avail) {
      rows++;
      x = 0;
    }
    x += w + LEGEND.itemGap;
  }
  const row = Math.max(LEGEND.itemHeight, lineHeight);
  return rows * row + (rows - 1) * LEGEND.itemGap + 2 * LEGEND.padding;
}

/** ECharts series for a category chart, total first where the type shows it. */
export function categorySeriesOptions(inp: CategoryChartInput): Record<string, unknown>[] {
  const { type, c, m } = inp;
  const series: Record<string, unknown>[] = [];
  const showTotal = type !== 'share';
  if (showTotal) {
    series.push({
      id: TOTAL_ID,
      type: 'line',
      name: inp.totalLabel,
      data: inp.total.map((p) => missing(p.value)),
      connectNulls: false,
      symbol: 'circle',
      symbolSize: m.symbolSize,
      // On stacked charts the total is a thin dashed check line on top of the stack.
      lineStyle: { width: type === 'lines' ? m.lineWidth * 1.5 : m.lineWidth * 0.75, type: type === 'lines' ? 'solid' : 'dashed', color: inp.totalColor },
      itemStyle: { color: inp.totalColor },
      z: 3,
    });
  }
  inp.categories.forEach((cs, i) => {
    const color = c.categories[i % c.categories.length];
    const base = {
      id: categorySeriesId(cs.category),
      name: inp.labels[cs.category] ?? cs.category,
      data: cs.points.map((p) => missing(plotted(type, p))),
      itemStyle: { color },
      emphasis: { focus: 'series' },
    };
    if (type === 'bars') {
      series.push({ ...base, type: 'bar', stack: 'categories', barMaxWidth: 28 });
    } else if (type === 'lines') {
      series.push({
        ...base,
        type: 'line',
        connectNulls: false,
        symbol: CATEGORY_SYMBOLS[i % CATEGORY_SYMBOLS.length],
        symbolSize: m.symbolSize * 1.2,
        lineStyle: { width: m.lineWidth * 0.75, color },
      });
    } else {
      // stacked area and 100% share
      series.push({
        ...base,
        type: 'line',
        stack: 'categories',
        connectNulls: false,
        symbol: 'circle',
        symbolSize: m.symbolSize * 0.8,
        lineStyle: { width: m.lineWidth * 0.5, color },
        areaStyle: { color, opacity: 0.85 },
      });
    }
  });
  return series;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

const pct = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const formatShare = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : `${pct.format(v)}%`;

/** Tooltip for one fiscal year: every category with its value and share, then the total. */
export function categoryTooltipHtml(index: number, inp: CategoryChartInput): string {
  const total = inp.total[index];
  if (!total) return '';
  const cell = 'text-align:right;padding-left:var(--fx-space-3);font-family:var(--fx-font-mono)';
  const rows = inp.categories.map((cs, i) => {
    const p = cs.points[index];
    const swatch = `<span style="display:inline-block;width:var(--fx-space-2);height:var(--fx-space-2);margin-right:var(--fx-space-1);background:${inp.c.categories[i % inp.c.categories.length]}"></span>`;
    return `<tr><td>${swatch}${escapeHtml(inp.labels[cs.category] ?? cs.category)}</td><td style="${cell}">${escapeHtml(formatValue(p?.value ?? null, inp.s))}</td><td style="${cell}">${escapeHtml(formatShare(p?.share))}</td></tr>`;
  });
  const totalRow = `<tr><td><strong>${escapeHtml(inp.totalLabel)}</strong></td><td style="${cell}"><strong>${escapeHtml(formatValue(total.value, inp.s))}</strong></td><td></td></tr>`;
  const head = `<tr><td></td><td style="${cell}">Value</td><td style="${cell}">Share</td></tr>`;
  return `<strong>${escapeHtml(total.label)}</strong><table>${head}${rows.join('')}${totalRow}</table>`;
}
