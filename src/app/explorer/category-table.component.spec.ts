import { TestBed } from '@angular/core/testing';

import { CategoryPoint, CategorySeries, SeriesPoint, settingsWithDefaults } from '../core/transform';
import { ChartType } from '../core/view-state';
import { CategoryTableComponent } from './category-table.component';

const pt = (fiscalYear: number, value: number): SeriesPoint => ({
  fiscalYear,
  label: `FY ${fiscalYear - 1}-${String(fiscalYear % 100).padStart(2, '0')}`,
  value,
  nominal: value,
  custodialNominal: 0,
  transfersNominal: 0,
  sourceIds: [],
  notes: [],
});
const cat = (category: string, values: number[], totals: number[]): CategorySeries => ({
  category,
  points: values.map((v, i): CategoryPoint => ({ ...pt(2024 + i, v), share: (v / totals[i]) * 100 })),
});

describe('CategoryTableComponent', () => {
  async function render(chartType: ChartType) {
    const fixture = TestBed.createComponent(CategoryTableComponent);
    const totals = [1_000, 2_000];
    fixture.componentRef.setInput('total', totals.map((t, i) => pt(2024 + i, t)));
    fixture.componentRef.setInput('categories', [cat('ad_valorem', [600, 500], totals), cat('other_taxes', [400, 1_500], totals)]);
    fixture.componentRef.setInput('labels', { ad_valorem: 'Ad Valorem Taxes', other_taxes: 'Other Taxes' });
    fixture.componentRef.setInput('settings', settingsWithDefaults('hillsborough'));
    fixture.componentRef.setInput('chartType', chartType);
    fixture.componentRef.setInput('valueLabel', 'Revenues, nominal dollars');
    const selected: { fiscalYear: number; category: string | null }[] = [];
    fixture.componentInstance.cellSelect.subscribe((e) => selected.push(e));
    await fixture.whenStable();
    return { el: fixture.nativeElement as HTMLElement, selected };
  }
  const text = (els: NodeListOf<Element>) => [...els].map((e) => e.textContent?.trim());

  it('years as rows, one column per category, then Total; caption states the unit and span', async () => {
    const { el } = await render('stacked');
    expect(text(el.querySelectorAll('thead th'))).toEqual(['Fiscal year', 'Ad Valorem Taxes', 'Other Taxes', 'Total']);
    expect([...el.querySelectorAll('thead th')].every((th) => th.getAttribute('scope') === 'col')).toBe(true);
    expect(text(el.querySelectorAll('tbody th[scope="row"]'))).toEqual(['FY 2023-24', 'FY 2024-25']);
    expect(el.querySelector('caption')?.textContent?.trim()).toBe('By category: Revenues, nominal dollars, FY 2023-24 to FY 2024-25');
    expect(text(el.querySelectorAll('tbody tr:first-child td'))).toEqual(['$600', '$400', '$1,000']);
  });

  it('lines by category: no Total column', async () => {
    const { el } = await render('lines');
    expect(text(el.querySelectorAll('thead th'))).toEqual(['Fiscal year', 'Ad Valorem Taxes', 'Other Taxes']);
  });

  it('100% share: shares, with the total at 100%, and a share caption', async () => {
    const { el } = await render('share');
    expect(text(el.querySelectorAll('tbody tr:last-child td'))).toEqual(['25.0%', '75.0%', '100.0%']);
    expect(el.querySelector('caption')?.textContent).toContain('share of the selected total (%)');
  });

  it('each cell is a labelled button that opens the drawer for that category and year', async () => {
    const { el, selected } = await render('bars');
    const buttons = el.querySelectorAll<HTMLButtonElement>('tbody button');
    expect(buttons[1].getAttribute('aria-label')).toBe('Other Taxes, FY 2023-24: $400. Show sources');
    buttons[1].click();
    buttons[5].click();
    expect(selected).toEqual([
      { fiscalYear: 2024, category: 'other_taxes' },
      { fiscalYear: 2025, category: null },
    ]);
  });
});
