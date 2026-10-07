import { TestBed } from '@angular/core/testing';

import { SeriesPoint, settingsWithDefaults } from '../core/transform';
import { CrossCheckRange } from '../core/models';
import { SeriesTableComponent } from './series-table.component';

/** Full settings for the default county (county names are fine in fixtures). */
const DEFAULT_SETTINGS = settingsWithDefaults('hillsborough');

const pt = (fy: number): SeriesPoint => ({
  fiscalYear: fy, label: `FY ${fy - 1}-${String(fy % 100).padStart(2, '0')}`, value: 1, nominal: 1,
  custodialNominal: 0, transfersNominal: 0, sourceIds: [], notes: [],
});

describe('SeriesTableComponent cross-check column', () => {
  async function render(crossCheck: ReadonlyMap<number, CrossCheckRange | null> | null) {
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
    const el = await render(new Map([[2012, null], [2013, { fromFiscalYear: 2013, toFiscalYear: 2025, status: 'full' as const }]]));
    expect([...el.querySelectorAll('.check')].map((c) => c.textContent?.trim())).toEqual(['—', 'Matches']);
  });
});
