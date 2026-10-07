import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogState } from '@angular/material/dialog';

import { AnnotationRecord, SourceRecord } from '../core/models';
import { DrawerContent, accountName, drawerAnnotations, drawerSources, sortRows } from './source-drawer';
import { SourceDrawerComponent } from './source-drawer.component';

const src = (id: string, extra: Partial<SourceRecord> = {}): SourceRecord => ({
  id,
  publisher: 'EDR',
  title: `Title ${id}`,
  url: `https://example.org/${id}`,
  retrieved: '2026-10-01',
  sha256: 'x',
  caveats: [`${id} caveat`],
  ...extra,
});
const note = (label: string, extra: Partial<AnnotationRecord> = {}): AnnotationRecord => ({
  fiscalYear: 2020,
  kind: 'methodology',
  label,
  sourceId: 's',
  ...extra,
});

const content: DrawerContent = {
  fiscalYearLabel: 'FY 2019-20',
  context: 'Pinellas County · General Fund, excluding custodial',
  seriesLabel: 'Intergovernmental Revenues · Revenues, nominal dollars',
  valueText: '$1,300 (12.0% of the selected total)',
  nominalText: '$1,300',
  rows: [
    { account: '335.8', name: 'Other', fund: 'General', amount: 300, ref: '2020!D48' },
    { account: '331', name: 'Federal Grant', fund: 'General', amount: 1_000, ref: '2020!D40' },
  ],
  sources: [{ id: 'edr', publisher: 'EDR', title: 'County revenues', url: 'https://example.org', retrieved: '2026-10-01', caveats: ['A caveat'] }],
  crossCheck: 'Cross-checked: matches the county-filed AFR',
  notes: ['Custodial fund amounts (GASB 84) are excluded.'],
  annotations: [{ label: 'Reclassified in LOGERX', detail: 'LOGERX has it under 335.9.' }],
};

describe('source drawer content helpers', () => {
  it('accountName uses the name printed that year, else the latest', () => {
    const accounts = [
      { account: '311', flow: 'revenue', name: 'Ad Valorem Taxes', names: [{ fiscalYears: [2008, 2009], name: 'Ad Valorem' }] },
    ];
    expect(accountName('311', 'revenue', 2009, accounts)).toBe('Ad Valorem');
    expect(accountName('311', 'revenue', 2020, accounts)).toBe('Ad Valorem Taxes');
    expect(accountName('311', 'expenditure', 2020, accounts)).toBe('');
  });

  it('drawerSources: each source once, with shared caveats and this county only', () => {
    const sources = [src('a', { caveatsByJurisdiction: { pinellas: ['Pinellas only'], hillsborough: ['Hillsborough only'] } }), src('b')];
    const out = drawerSources(['a', 'missing', 'b', 'a'], sources, 'pinellas');
    expect(out.map((s) => s.id)).toEqual(['a', 'b']);
    expect(out[0].caveats).toEqual(['a caveat', 'Pinellas only']);
  });

  it('sortRows: by account number, then fund', () => {
    const rows = sortRows([
      { account: '335.8', name: '', fund: 'Special Revenue', amount: 1, ref: 'a' },
      { account: '41', name: '', fund: 'General', amount: 1, ref: 'b' },
      { account: '335.8', name: '', fund: 'General', amount: 1, ref: 'c' },
    ]);
    expect(rows.map((r) => r.ref)).toEqual(['b', 'c', 'a']);
  });

  it('drawerAnnotations: year notes then cell notes, each once; cell-scoped notes only through the point', () => {
    const cellNote = note('Reclassified', { cells: [{ account: '335.8', fundType: 'special_revenue' }] });
    expect(drawerAnnotations([note('GASB 84'), cellNote], []).map((a) => a.label)).toEqual(['GASB 84']);
    expect(drawerAnnotations([note('GASB 84'), cellNote], [cellNote]).map((a) => a.label)).toEqual(['GASB 84', 'Reclassified']);
    expect(drawerAnnotations([note('Same')], [note('Same')])).toHaveLength(1);
  });
});

describe('SourceDrawerComponent', () => {
  it('shows FY, scope, value, accounts (sorted, same formatter), sources, caveats, cross-check and notes', async () => {
    TestBed.configureTestingModule({ providers: [{ provide: MAT_DIALOG_DATA, useValue: content }] });
    const fixture = TestBed.createComponent(SourceDrawerComponent);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const text = el.textContent ?? '';

    expect(el.querySelector('h2#drawer-title')?.textContent?.trim()).toBe('FY 2019-20');
    for (const s of [content.context, content.seriesLabel, content.valueText, content.crossCheck!, content.notes[0], 'LOGERX has it under 335.9.']) {
      expect(text).toContain(s);
    }
    const rows = [...el.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent?.trim()));
    expect(rows).toEqual([
      ['331', 'Federal Grant', 'General', '$1,000', '2020!D40'],
      ['335.8', 'Other', 'General', '$300', '2020!D48'],
    ]);
    expect(el.querySelector('h3#drawer-accounts')?.textContent).toContain('(2)');
    const link = el.querySelector<HTMLAnchorElement>('.sources a')!;
    expect(link.href).toBe('https://example.org/');
    expect(link.rel).toBe('noopener');
    expect(el.querySelector('.sources details')?.textContent).toContain('A caveat');
  });

  // Focus trapping and focus return are checked in a real browser (jsdom has no reliable focus model).
  it('as a dialog: labelled by its title; Escape and the Close button close it', async () => {
    const dialog = TestBed.inject(MatDialog);
    let ref = dialog.open(SourceDrawerComponent, { data: content, ariaLabelledBy: 'drawer-title' });
    await new Promise((r) => setTimeout(r, 50));
    expect(document.querySelector('mat-dialog-container')!.getAttribute('aria-labelledby')).toBe('drawer-title');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    expect(ref.getState()).not.toBe(MatDialogState.OPEN);

    ref = dialog.open(SourceDrawerComponent, { data: content });
    await new Promise((r) => setTimeout(r, 50));
    [...document.querySelectorAll<HTMLButtonElement>('app-source-drawer .close')].at(-1)!.click();
    expect(ref.getState()).not.toBe(MatDialogState.OPEN);
  });
});
