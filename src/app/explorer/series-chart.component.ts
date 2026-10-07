import { Component, DestroyRef, ElementRef, computed, inject, input, output, signal } from '@angular/core';
import type { ECharts, EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';

import { ChartMetrics, readChartColors, readChartMetrics } from '../core/chart-palette';
import { CROSS_CHECK_LABELS } from '../core/cross-check';
import { CrossCheckStatus } from '../core/models';
import { ColorSchemeService } from '../core/color-scheme.service';
import { formatAxisValue, formatCount, formatCpi, formatUsd, formatValue } from '../core/format';
import { isPerCapita, isReal } from '../core/labels';
import { SeriesPoint, TransformSettings, fiscalYearLabel } from '../core/transform';
import { ChartSkeletonComponent } from './chart-skeleton.component';
import { ZOOM_SETTLE_MS, zoomWindowToRange } from './chart-zoom';
import { AnnotationNote, annotationsForTooltip, markLineGroups } from './view-notes';

// ECharts renders the tooltip as HTML in the page, so tokens apply.
const NOTE_STYLE = 'max-width:var(--fx-tooltip-width);white-space:normal;margin-top:var(--fx-space-1)';

/**
 * Point marker by cross-check status. Checked years (full, spot-check): filled circle.
 * Not cross-checked: hollow circle (series outline, tile fill). Mismatch: filled diamond, larger.
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
      return { symbol: 'diamond', symbolSize: m.symbolSize * 1.6, itemStyle: { color: series } };
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
  crossCheck: CrossCheckStatus | null = null,
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
  const check = crossCheck ? `<div style="${NOTE_STYLE}">${escapeHtml(CROSS_CHECK_LABELS[crossCheck])}</div>` : '';
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
  readonly crossCheck = input<ReadonlyMap<number, CrossCheckStatus | null> | null>(null);
  /** Palette slot for the line: 1 = revenue, 2 = spending (see _tokens.scss $series). */
  readonly seriesIndex = input<number>(1);

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
  }

  onRendered(): void {
    if (!this.rendered()) {
      this.rendered.set(true);
      performance.mark?.('fx:chartRendered');
    }
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
    return `Line chart of ${this.valueLabel()}, ${pts[0].label} to ${pts[pts.length - 1].label}. A data table is available with "View as table".`;
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
    const markLines = markLineGroups(notes, this.compact()).map((g) => ({
      xAxis: fiscalYearLabel(g.fiscalYear),
      label: { formatter: g.label },
      lineStyle: { color: c.annotation[g.kind] ?? c.annotation.methodology },
    }));

    return {
      backgroundColor: 'transparent',
      color: [series],
      aria: { enabled: true },
      animationDuration: 300,
      textStyle: { color: c.text, fontFamily: m.fontFamily },
      grid: { left: m.space(2), right: m.space(4), top: m.space(6) + m.space(2), bottom: m.space(2), containLabel: true },
      tooltip: {
        trigger: 'axis',
        confine: true,
        backgroundColor: c.surface,
        borderColor: c.axisLine,
        textStyle: { color: c.text },
        formatter: (params: unknown) => {
          const first = Array.isArray(params) ? params[0] : params;
          const p = pts[(first as { dataIndex: number }).dataIndex];
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
        boundaryGap: false,
        axisLine: { lineStyle: { color: c.axisLine } },
        axisLabel: { color: c.textFaint, hideOverlap: true, fontFamily: m.monoFamily, fontSize: m.axisSize },
      },
      yAxis: {
        type: 'value',
        scale: s.indexTo100,
        axisLabel: {
          color: c.textFaint,
          fontFamily: m.monoFamily,
          fontSize: m.axisSize,
          formatter: (v: number) => formatAxisValue(v, s),
        },
        splitLine: { lineStyle: { color: c.gridLine } },
      },
      series: [
        {
          type: 'line',
          name: label,
          // '-' is ECharts' missing-value marker. Marker shape carries the cross-check status
          // (never colour alone): see crossCheckMarker.
          data: pts.map((p) => {
            const marker = crossCheckMarker(check?.get(p.fiscalYear) ?? null, series, c.surface, m);
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
