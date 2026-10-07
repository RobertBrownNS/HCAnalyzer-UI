import { TestBed } from '@angular/core/testing';

import { DEFAULT_SETTINGS, SeriesPoint } from '../core/transform';
import { SeriesTableComponent } from './series-table.component';

const pt = (fy: number): SeriesPoint => ({
  fiscalYear: fy, label: `FY ${fy - 1}-${String(fy % 100).padStart(2, '0')}`, value: 1, nominal: 1,
  custodialNominal: 0, transfersNominal: 0, sourceIds: [], notes: [],
});

describe('SeriesTableComponent cross-check column', () => {
  async function render(crossCheck: ReadonlyMap<number, 'full' | 'not-checked' | null> | null) {
    const fixture = TestBed.createComponent(SeriesTableComponent);
    fixture.componentRef.setInput('points', [pt(2012), pt(2013)]);
    fixture.componentRef.setInput('settings', { ...DEFAULT_SETTINGS });
    fixture.componentRef.setInput('valueLabel', 'Revenues');
    fixture.componentRef.setInput('crossCheck', crossCheck);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('no coverage: no column at all (nothing guessed)', async () => {
    const el = await render(null);
    expect([...el.querySelectorAll('th')].map((t) => t.textContent?.trim())).not.toContain('Cross-check');
    expect(el.querySelector('.check')).toBeNull();
  });

  it('a year outside every range shows a dash, not a guess', async () => {
    const el = await render(new Map([[2012, null], [2013, 'full']]));
    expect([...el.querySelectorAll('.check')].map((c) => c.textContent?.trim())).toEqual(['—', 'Matches']);
  });
});
