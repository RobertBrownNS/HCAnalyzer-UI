import { Component, DestroyRef, ElementRef, computed, inject, input, output, signal } from '@angular/core';
import type { ECharts, EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';

import { ChartColors, ChartMetrics, readChartColors, readChartMetrics } from '../core/chart-palette';
import { crossCheckYearText } from '../core/cross-check';
import { CrossCheckRange, CrossCheckStatus } from '../core/models';
import { ColorSchemeService } from '../core/color-scheme.service';
import { formatAxisValue, formatCount, formatCpi, formatUsd, formatValue } from '../core/format';
import { isPerCapita, isReal } from '../core/labels';
import { CategorySeries, SeriesPoint, TransformSettings, fiscalYearLabel } from '../core/transform';
import { ChartType } from '../core/view-state';
import {
  CategoryChartInput,
  TOTAL_ID,
  categoryAt,
  categoryFromSeriesId,
  categorySeriesOptions,
  categoryTooltipHtml,
} from './category-chart';
import { ChartSkeletonComponent } from './chart-skeleton.component';
import { ZOOM_SETTLE_MS, zoomWindowToRange } from './chart-zoom';
import { AnnotationNote, annotationsForTooltip, markLineGroups } from './view-notes';

// ECharts renders the tooltip as HTML in the page, so tokens apply.
const NOTE_STYLE = 'max-width:var(--fx-tooltip-width);white-space:normal;margin-top:var(--fx-space-1)';

/**
 * Cross-check markers on the total line of a category chart (the cross-check is about the year's
 * total). The 100% share chart has no total line, so nothing changes there.
 */
function withCrossCheckMarkers(
  series: Record<string, unknown>[],
  pts: readonly SeriesPoint[],
  check: ReadonlyMap<number, CrossCheckRange | null> | null,
  color: string,
  surface: string,
  m: Pick<ChartMetrics, 'symbolSize' | 'lineWidth'>,
): Record<string, unknown>[] {
  if (!check) return series;
  return series.map((s) => {
    if (s['id'] !== TOTAL_ID) return s;
    const data = pts.map((p) => {
      const marker = crossCheckMarker(check.get(p.fiscalYear)?.status ?? null, color, surface, m);
      return marker ? { value: p.value ?? '-', ...marker } : (p.value ?? '-');
    });
    return { ...s, data };
  });
}

/**
 * Point marker by cross-check status. Checked years (full, spot-check): filled circle.
 * Not cross-checked: hollow circle (series outline, tile fill). Mismatch (yearly total matches, an
 * amount classified differently): small filled diamond.
 * Shape, not colour, carries the meaning. Null = default marker (no coverage: no marking).
 */
export function crossCheckMarker(
  status: CrossCheckStatus | null,
  series: string,
  surface: string,
  m: Pick<ChartMetrics, 'symbolSize' | 'lineWidth'>,
): { symbol: string; symbolSize?: number; itemStyle: Record<string, unknown> } | null {
  switch (status) {
    case 'full':
    case 'spot-check':
      return { symbol: 'circle', itemStyle: { color: series } };
    case 'not-checked':
      return { symbol: 'circle', itemStyle: { color: surface, borderColor: series, borderWidth: m.lineWidth * 0.75 } };
    case 'mismatch':
      // Distinct but not alarming: a small diamond, near the circles' size (QA-35).
      return { symbol: 'diamond', symbolSize: m.symbolSize * 1.3, itemStyle: { color: series } };
    default:
      return null;
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Tooltip HTML for one point. Exported for tests. */
export function tooltipHtml(
  p: SeriesPoint,
  s: TransformSettings,
  valueLabel: string,
  annotations: readonly AnnotationNote[] = [],
  crossCheck: CrossCheckRange | null = null,
): string {
  const rows: [string, string][] = [[valueLabel, formatValue(p.value, s)], ['Nominal total', formatUsd(p.nominal)]];
  if (isPerCapita(s.measure)) rows.push(['Population (April 1)', formatCount(p.population)]);
  if (isReal(s.measure)) {
    rows.push([`CPI ${p.label}`, formatCpi(p.cpi)]);
    rows.push([`CPI ${fiscalYearLabel(s.baseYear)} (base)`, formatCpi(p.cpiBase)]);
  }
  const table = rows
    .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td style="text-align:right;padding-left:var(--fx-space-3);font-family:var(--fx-font-mono)">${escapeHtml(v)}</td></tr>`)
    .join('');
  const marks = annotationsForTooltip(p, annotations)
    .map((a) => `<div style="${NOTE_STYLE}">${a.n}. ${escapeHtml(a.label)}</div>`)
    .join('');
  const notes = p.notes.map((n) => `<div style="${NOTE_STYLE}">${escapeHtml(n)}</div>`).join('');
  const check = crossCheck ? `<div style="${NOTE_STYLE}">${escapeHtml(crossCheckYearText(crossCheck))}</div>` : '';
  return `<strong>${escapeHtml(p.label)}</strong><table>${table}</table>${check}${marks}${notes}`;
}

@Component({
  selector: 'app-series-chart',
  imports: [NgxEchartsDirective, ChartSkeletonComponent],
  template: `@if (!rendered()) {
      <!-- Until the ECharts chunk has loaded and drawn its first frame: never an empty chart. -->
      <app-chart-skeleton class="overlay" [class.fx-skel-pending]="!revealSkeleton()" />
    }
    <div
    class="chart"
    echarts
    [options]="options()"
    role="img"
    [attr.aria-label]="ariaLabel()"
    (chartInit)="onChartInit($event)"
    (chartRendered)="onRendered()"
    (chartDataZoom)="onDataZoom()"
    (chartClick)="onPointClick($event)"
  ></div>`,
  styles: `
    :host {
      display: block;
      position: relative;
      min-height: 0;
    }
    .overlay {
      position: absolute;
      inset: 0;
      z-index: 1;
      background: var(--fx-color-tile);
    }
    .chart {
      width: 100%;
      height: 100%;
      min-height: var(--fx-chart-min-height);
    }
  `,
})
export class SeriesChartComponent {
  readonly points = input.required<SeriesPoint[]>();
  readonly annotations = input<AnnotationNote[]>([]);
  readonly settings = input.required<TransformSettings>();
  /** Axis/series name, e.g. "Revenues, per resident". */
  readonly valueLabel = input.required<string>();
  /** Cross-check status per fiscal year; null when the source has no coverage (no marking). */
  readonly crossCheck = input<ReadonlyMap<number, CrossCheckRange | null> | null>(null);
  /** Palette slot for the line: 1 = revenue, 2 = spending (see _tokens.scss $series). */
  readonly seriesIndex = input<number>(1);

  /** Chart type (D-20); category types need `categories`. */
  readonly chartType = input<ChartType>('line');
  /** Category series (buildCategorySeries) for the category chart types. */
  readonly categories = input<readonly CategorySeries[] | null>(null);
  /** Display label per category id. */
  readonly categoryLabels = input<Readonly<Record<string, string>>>({});
  /** A point was clicked or tapped: open the source drawer (category null = the total). */
  readonly pointSelect = output<{ fiscalYear: number; category: string | null }>();

  /** A pinch (or slider) zoom, snapped to whole fiscal years, once the gesture settles. */
  readonly rangeChange = output<[number, number]>();

  private readonly host = inject(ElementRef<HTMLElement>);
  protected chart?: ECharts;
  private zoomTimer?: ReturnType<typeof setTimeout>;

  /** Narrow screens: annotation lines carry note numbers only; full labels go in the caption. */
  readonly compact = signal(false);

  constructor() {
    const win = this.host.nativeElement.ownerDocument?.defaultView;
    const bp = win ? getComputedStyle(win.document.documentElement).getPropertyValue('--fx-breakpoint-tablet').trim() : '';
    const mql = bp ? win?.matchMedia?.(`(min-width: ${bp})`) : undefined;
    if (mql) {
      const sync = () => this.compact.set(!mql.matches);
      sync();
      mql.addEventListener('change', sync);
      inject(DestroyRef).onDestroy(() => mql.removeEventListener('change', sync));
    }
    inject(DestroyRef).onDestroy(() => clearTimeout(this.zoomTimer));


    // QA-11: ECharts' inside dataZoom cancels every wheel event over the plot, even with
    // wheel zoom/move off, which traps page scrolling. Stop wheel events before they reach
    // ECharts (capture phase, passive) so the browser scrolls the page. Pinch uses touch events.
    const stopWheel = (e: Event) => e.stopPropagation();
    this.host.nativeElement.addEventListener('wheel', stopWheel, { capture: true, passive: true });
    inject(DestroyRef).onDestroy(() =>
      this.host.nativeElement.removeEventListener('wheel', stopWheel, { capture: true }),
    );
  }

  /** True once ECharts has drawn its first frame (lazy chunk loaded, options applied). */
  readonly rendered = signal(false);
  /** Show the placeholder (set by the page's once-per-load reveal flag; QA-26). */
  readonly revealSkeleton = input(false);

  onChartInit(chart: ECharts): void {
    this.chart = chart;
    performance.mark?.('fx:chartInit');
    // A tap anywhere in the plot opens the drawer for the nearest year (symbols are too small to be
    // the only tap target). ECharts' item click runs first and takes precedence.
    chart.getZr().on('click', (e: { offsetX: number; offsetY: number }) => {
      queueMicrotask(() => {
        if (this.itemClicked) {
          this.itemClicked = false;
          return;
        }
        this.onPlotTap([e.offsetX, e.offsetY]);
      });
    });
  }

  private itemClicked = false;

  private onPlotTap(pixel: [number, number]): void {
    const chart = this.chart;
    if (!chart || !chart.containPixel({ gridIndex: 0 }, pixel)) return;
    const [x, y] = chart.convertFromPixel({ gridIndex: 0 }, pixel) as number[];
    const index = Math.round(x);
    const p = this.points()[index];
    if (!p) return;
    const cats = this.categories();
    const type = this.chartType();
    const category = cats && type !== 'line' ? categoryAt(type, cats, index, y) : null;
    this.pointSelect.emit({ fiscalYear: p.fiscalYear, category });
  }

  onRendered(): void {
    if (!this.rendered()) {
      this.rendered.set(true);
      performance.mark?.('fx:chartRendered');
    }
  }

  onPointClick(e: { dataIndex?: number; seriesId?: string }): void {
    this.itemClicked = true;
    const p = e.dataIndex !== undefined ? this.points()[e.dataIndex] : undefined;
    if (p) this.pointSelect.emit({ fiscalYear: p.fiscalYear, category: categoryFromSeriesId(e.seriesId) });
  }

  onDataZoom(): void {
    clearTimeout(this.zoomTimer);
    this.zoomTimer = setTimeout(() => {
      const dz = (this.chart?.getOption() as { dataZoom?: { start?: number; end?: number }[] } | undefined)
        ?.dataZoom?.[0];
      const range = zoomWindowToRange(
        this.points().map((p) => p.fiscalYear),
        dz?.start ?? 0,
        dz?.end ?? 100,
      );
      if (range) this.rangeChange.emit(range);
    }, ZOOM_SETTLE_MS);
  }
  private readonly scheme = inject(ColorSchemeService).scheme;

  private readonly colors = computed(() => {
    this.scheme(); // re-read resolved colors when the scheme changes
    return readChartColors(this.host.nativeElement);
  });

  private readonly metrics = computed(() => {
    this.scheme();
    return readChartMetrics(this.host.nativeElement);
  });

  readonly ariaLabel = computed(() => {
    const pts = this.points();
    if (pts.length === 0) return `${this.valueLabel()}: no data`;
    return `Line chart of ${this.valueLabel()}, ${pts[0].label} to ${pts[pts.length - 1].label}. A data table is available with the "Table" button.`;
  });

  readonly options = computed<EChartsCoreOption>(() => {
    const pts = this.points();
    const s = this.settings();
    const c = this.colors();
    const m = this.metrics();
    const label = this.valueLabel();

    const notes = this.annotations();
    const check = this.crossCheck();
    const series = c.series[this.seriesIndex() - 1] ?? c.series[0];
    const type = this.chartType();
    const cats = this.categories();
    const categoryInput: CategoryChartInput | null =
      type !== 'line' && cats
        ? { type, total: pts, categories: cats, labels: this.categoryLabels(), totalColor: series, totalLabel: label, s, c, m }
        : null;
    const markLines = markLineGroups(notes, this.compact()).map((g) => ({
      xAxis: fiscalYearLabel(g.fiscalYear),
      label: { formatter: g.label },
      lineStyle: { color: c.annotation[g.kind] ?? c.annotation.methodology },
    }));

    return {
      backgroundColor: 'transparent',
      color: [series],
      // Decal patterns on stacked areas and bars, so colour is never the only cue (D-20).
      aria: { enabled: true, decal: { show: !!categoryInput && type !== 'lines' } },
      legend: categoryInput
        ? {
            type: 'scroll',
            bottom: 0,
            textStyle: { color: c.textMuted, fontSize: m.labelSize },
            pageTextStyle: { color: c.textMuted },
          }
        : { show: false },
      animationDuration: 300,
      textStyle: { color: c.text, fontFamily: m.fontFamily },
      grid: {
        left: m.space(2),
        right: m.space(4),
        top: m.space(6) + m.space(2),
        bottom: categoryInput ? m.space(6) : m.space(2), // room for the legend
        containLabel: true,
      },
      tooltip: {
        trigger: 'axis',
        confine: true,
        backgroundColor: c.surface,
        borderColor: c.axisLine,
        textStyle: { color: c.text },
        formatter: (params: unknown) => {
          const first = Array.isArray(params) ? params[0] : params;
          const index = (first as { dataIndex: number }).dataIndex;
          if (categoryInput) return categoryTooltipHtml(index, categoryInput);
          const p = pts[index];
          return p ? tooltipHtml(p, s, label, notes, check?.get(p.fiscalYear) ?? null) : '';
        },
      },
      dataZoom: [
        // Pinch to zoom on touch. The wheel and one-finger drag scroll the page (QA-11); a
        // settled zoom becomes the fiscal-year range (see onDataZoom).
        {
          type: 'inside',
          xAxisIndex: 0,
          zoomOnMouseWheel: false,
          moveOnMouseWheel: false,
          moveOnMouseMove: false,
          start: 0,
          end: 100,
        },
      ],
      xAxis: {
        type: 'category',
        data: pts.map((p) => p.label),
        boundaryGap: type === 'bars',
        axisLine: { lineStyle: { color: c.axisLine } },
        axisLabel: { color: c.textFaint, hideOverlap: true, fontFamily: m.monoFamily, fontSize: m.axisSize },
      },
      yAxis: {
        type: 'value',
        scale: s.indexTo100 && type !== 'share',
        name: type === 'share' ? 'Share of selected total' : undefined,
        // Starts at the axis, so the name is never clipped at the tile edge.
        nameTextStyle: { color: c.textFaint, fontSize: m.axisSize, align: 'left' },
        ...(type === 'share' ? { min: 0, max: 100 } : {}),
        axisLabel: {
          color: c.textFaint,
          fontFamily: m.monoFamily,
          fontSize: m.axisSize,
          formatter: (v: number) => (type === 'share' ? `${v}%` : formatAxisValue(v, s)),
        },
        splitLine: { lineStyle: { color: c.gridLine } },
      },
      series: categoryInput
        ? withMarkLines(withCrossCheckMarkers(categorySeriesOptions(categoryInput), pts, check, series, c.surface, m), markLines, c, m)
        : [
        {
          type: 'line',
          name: label,
          // '-' is ECharts' missing-value marker. Marker shape carries the cross-check status
          // (never colour alone): see crossCheckMarker.
          data: pts.map((p) => {
            const marker = crossCheckMarker(check?.get(p.fiscalYear)?.status ?? null, series, c.surface, m);
            return marker ? { value: p.value ?? '-', ...marker } : (p.value ?? '-');
          }),
          connectNulls: false,
          showSymbol: true,
          symbolSize: m.symbolSize,
          itemStyle: { color: series },
          lineStyle: { width: m.lineWidth, color: series },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { type: 'dashed', width: m.annotationWidth },
            // Anchored at the axis: on 0-based charts the lower area is usually empty.
            label: { position: 'insideStartTop', distance: m.symbolSize, color: c.textMuted, fontSize: m.labelSize },
            data: markLines,
          },
        },
      ],
    };
  });
}

/** Annotation lines on the first series of a category chart (same style as the line chart). */
function withMarkLines(
  series: Record<string, unknown>[],
  data: unknown[],
  c: ChartColors,
  m: ChartMetrics,
): Record<string, unknown>[] {
  if (!series.length) return series;
  const [first, ...rest] = series;
  return [
    {
      ...first,
      markLine: {
        silent: true,
        symbol: 'none',
        lineStyle: { type: 'dashed', width: m.annotationWidth },
        label: { position: 'insideStartTop', distance: m.symbolSize, color: c.textMuted, fontSize: m.labelSize },
        data,
      },
    },
    ...rest,
  ];
}
