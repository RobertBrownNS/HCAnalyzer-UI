import { Component, ElementRef, computed, inject, input } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';

import { readChartColors, readChartMetrics } from '../core/chart-palette';
import { ColorSchemeService } from '../core/color-scheme.service';
import { formatAxisValue, formatCount, formatCpi, formatUsd, formatValue } from '../core/format';
import { isPerCapita, isReal } from '../core/labels';
import { SeriesPoint, TransformSettings, fiscalYearLabel } from '../core/transform';
import { AnnotationNote, annotationsForTooltip, markLineGroups } from './view-notes';

// ECharts renders the tooltip as HTML in the page, so tokens apply.
const NOTE_STYLE = 'max-width:var(--fx-tooltip-width);white-space:normal;margin-top:var(--fx-space-1)';

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Tooltip HTML for one point. Exported for tests. */
export function tooltipHtml(
  p: SeriesPoint,
  s: TransformSettings,
  valueLabel: string,
  annotations: readonly AnnotationNote[] = [],
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
  return `<strong>${escapeHtml(p.label)}</strong><table>${table}</table>${marks}${notes}`;
}

@Component({
  selector: 'app-series-chart',
  imports: [NgxEchartsDirective],
  template: `<div class="chart" echarts [options]="options()" role="img" [attr.aria-label]="ariaLabel()"></div>`,
  styles: `
    :host {
      display: block;
      min-height: 0;
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
  /** Palette slot for the line: 1 = revenue, 2 = spending (see _tokens.scss $series). */
  readonly seriesIndex = input<number>(1);

  private readonly host = inject(ElementRef<HTMLElement>);
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
    const markLines = markLineGroups(notes).map((g) => ({
      xAxis: fiscalYearLabel(g.fiscalYear),
      label: { formatter: g.label },
      lineStyle: { color: c.annotation[g.kind] ?? c.annotation.methodology },
    }));

    return {
      backgroundColor: 'transparent',
      color: [c.series[this.seriesIndex() - 1] ?? c.series[0]],
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
          return p ? tooltipHtml(p, s, label, notes) : '';
        },
      },
      dataZoom: [
        // Pinch to zoom on touch, wheel on desktop. One-finger drag scrolls the page.
        { type: 'inside', xAxisIndex: 0, moveOnMouseMove: false, start: 0, end: 100 },
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
          data: pts.map((p) => p.value ?? '-'), // '-' is ECharts' missing-value marker
          connectNulls: false,
          showSymbol: true,
          symbolSize: m.symbolSize,
          lineStyle: { width: m.lineWidth },
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
