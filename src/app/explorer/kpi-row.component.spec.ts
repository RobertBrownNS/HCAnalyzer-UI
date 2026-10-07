import { TestBed } from '@angular/core/testing';

import { KpiCard } from './kpi';
import { KpiRowComponent } from './kpi-row.component';

const cards: KpiCard[] = [
  { id: 'end', label: 'Revenues · FY 2024-25', value: '$5.47B', sub: 'Nominal dollars', raw: 1, accent: 'series' },
  { id: 'change', label: 'Change', value: '+75.0%', sub: 'FY 2005-06 → FY 2024-25', raw: 0.75, accent: 'series' },
];

describe('KpiRowComponent', () => {
  async function render(loading: boolean, reveal = false) {
    const fixture = TestBed.createComponent(KpiRowComponent);
    fixture.componentRef.setInput('cards', cards);
    fixture.componentRef.setInput('ids', ['end', 'change']);
    fixture.componentRef.setInput('seriesColor', 'var(--fx-series-1)');
    fixture.componentRef.setInput('loading', loading);
    fixture.componentRef.setInput('reveal', reveal);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('loading: same grid and card boxes as the real cards, hidden from assistive tech', async () => {
    const el = await render(true);
    const row = el.querySelector('.row')!;
    expect(row.getAttribute('aria-hidden')).toBe('true');
    expect(row.classList).toContain('fx-skel-pending');
    expect(row.querySelectorAll('.card.fx-tile')).toHaveLength(2);
    expect(el.textContent?.trim()).toBe('');
  });

  it('reveal makes the placeholders visible', async () => {
    const el = await render(true, true);
    expect(el.querySelector('.row')?.classList).not.toContain('fx-skel-pending');
  });

  it('loaded: real cards replace the placeholders', async () => {
    const el = await render(false);
    expect(el.querySelectorAll('.card.skel')).toHaveLength(0);
    expect(el.querySelectorAll('li.card')).toHaveLength(2);
    expect(el.textContent).toContain('$5.47B');
  });
});
