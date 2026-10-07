import { Directive, input, output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NgxEchartsDirective } from 'ngx-echarts';

import { DEFAULT_SETTINGS } from '../core/transform';
import { SeriesChartComponent } from './series-chart.component';

/** Stand-in for ngx-echarts (no canvas in jsdom); lets a test fire chartRendered. */
@Directive({ selector: '[echarts]', exportAs: 'fakeEcharts' })
class FakeEchartsDirective {
  static last?: FakeEchartsDirective;
  readonly options = input<unknown>();
  readonly chartInit = output<unknown>();
  readonly chartRendered = output<unknown>();
  readonly chartDataZoom = output<unknown>();
  constructor() {
    FakeEchartsDirective.last = this;
  }
}

describe('SeriesChartComponent placeholder (QA-26)', () => {
  beforeEach(() => {
    TestBed.overrideComponent(SeriesChartComponent, {
      remove: { imports: [NgxEchartsDirective] },
      add: { imports: [FakeEchartsDirective] },
    });
  });

  async function render(reveal: boolean) {
    const fixture = TestBed.createComponent(SeriesChartComponent);
    fixture.componentRef.setInput('points', []);
    fixture.componentRef.setInput('settings', { ...DEFAULT_SETTINGS });
    fixture.componentRef.setInput('valueLabel', 'Revenues');
    fixture.componentRef.setInput('revealSkeleton', reveal);
    await fixture.whenStable();
    return fixture;
  }

  it('shows the placeholder at once when the page placeholders are already revealed (no blink)', async () => {
    const fixture = await render(true);
    const overlay = (fixture.nativeElement as HTMLElement).querySelector('app-chart-skeleton');
    expect(overlay).not.toBeNull();
    expect(overlay?.classList).not.toContain('fx-skel-pending');
  });

  it('keeps it laid out but hidden while the page-level delay is still running', async () => {
    const fixture = await render(false);
    expect((fixture.nativeElement as HTMLElement).querySelector('app-chart-skeleton')?.classList).toContain(
      'fx-skel-pending',
    );
  });

  it('removes the placeholder only after the first rendered frame', async () => {
    const fixture = await render(true);
    const el = fixture.nativeElement as HTMLElement;
    FakeEchartsDirective.last!.chartInit.emit({ getOption: () => ({}) });
    await fixture.whenStable();
    expect(el.querySelector('app-chart-skeleton')).not.toBeNull(); // init alone: nothing drawn yet
    FakeEchartsDirective.last!.chartRendered.emit({});
    await fixture.whenStable();
    expect(el.querySelector('app-chart-skeleton')).toBeNull();
  });
});
