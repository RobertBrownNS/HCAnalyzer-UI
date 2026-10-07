import { Component, ElementRef, computed, inject, input } from '@angular/core';
import type { EChartsCoreOption } from 'echarts/core';
import { NgxEchartsDirective } from 'ngx-echarts';

import { readChartColors } from '../core/chart-palette';
import { ColorSchemeService } from '../core/color-scheme.service';
import { formatAxisValue, formatCount, formatCpi, formatUsd, formatValue } from '../core/format';
import { isPerCapita, isReal } from '../core/labels';
import { SeriesPoint, TransformSettings, fiscalYearLabel } from '../core/transform';
import { AnnotationNote, markLineGroups } from './view-notes';

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
    .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td style="text-align:right;padding-left:12px">${escapeHtml(v)}</td></tr>`)
    .join('');
  const marks = annotations
    .filter((a) => a.fiscalYear === p.fiscalYear)
    .map((a) => `<div style="max-width:260px;white-space:normal;margin-top:4px">${a.n}. ${escapeHtml(a.label)}</div>`)
    .join('');
  const notes = p.notes.map((n) => `<div style="max-width:260px;white-space:normal;margin-top:4px">${escapeHtml(n)}</div>`).join('');
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
      min-height: 280px;
    }
  `,
})
export class SeriesChartComponent {
  readonly points = input.required<SeriesPoint[]>();
  readonly annotations = input<AnnotationNote[]>([]);
  readonly settings = input.required<TransformSettings>();
  /** Axis/series name, e.g. "Revenues, per resident". */
  readonly valueLabel = input.required<string>();

  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly scheme = inject(ColorSchemeService).scheme;

  private readonly colors = computed(() => {
    this.scheme(); // re-read resolved colors when the scheme changes
    return readChartColors(this.host.nativeElement);
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
    const label = this.valueLabel();

    const notes = this.annotations();
    const markLines = markLineGroups(notes).map((g) => ({
      xAxis: fiscalYearLabel(g.fiscalYear),
      label: { formatter: g.label },
      lineStyle: { color: c.annotation[g.kind] ?? c.annotation.methodology },
    }));

    return {
      backgroundColor: 'transparent',
      color: c.series,
      aria: { enabled: true },
      animationDuration: 300,
      textStyle: { color: c.text, fontFamily: 'inherit' },
      grid: { left: 8, right: 16, top: 40, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'axis',
        confine: true,
        backgroundColor: c.surface,
        borderColor: c.gridLine,
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
        axisLabel: { color: c.textMuted, hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        scale: s.indexTo100,
        axisLabel: { color: c.textMuted, formatter: (v: number) => formatAxisValue(v, s) },
        splitLine: { lineStyle: { color: c.gridLine } },
      },
      series: [
        {
          type: 'line',
          name: label,
          data: pts.map((p) => p.value ?? '-'), // '-' is ECharts' missing-value marker
          connectNulls: false,
          showSymbol: true,
          symbolSize: 6,
          lineStyle: { width: 2.5 },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { type: 'dashed', width: 1.5 },
            label: { position: 'insideEndTop', distance: 6, color: c.text, fontSize: 11 },
            data: markLines,
          },
        },
      ],
    };
  });
}
