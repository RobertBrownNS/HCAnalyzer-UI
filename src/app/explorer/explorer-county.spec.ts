import { Directive, input, output, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { NgxEchartsDirective } from 'ngx-echarts';

import { CountyContext } from '../core/county';
import { DataService, DataStatus } from '../core/data.service';
import { AfrObservation, CpiFile, PopulationFile, SourceRecord } from '../core/models';
import { TransformData } from '../core/transform';
import { ExplorerComponent } from './explorer.component';
import { SeriesChartComponent } from './series-chart.component';

/** Stand-in for ngx-echarts (no canvas in jsdom). */
@Directive({ selector: '[echarts]' })
class FakeEchartsDirective {
  readonly options = input<unknown>();
  readonly chartInit = output<unknown>();
  readonly chartRendered = output<unknown>();
  readonly chartDataZoom = output<unknown>();
}

const PINELLAS_CAVEAT = "Not cross-checked against the county's Annual Financial Report as filed.";

function obs(jurisdiction: string, fiscalYear: number, amount: number): AfrObservation {
  return {
    account: '311', amount, category: 'ad_valorem', fiscalYear, flow: 'revenue', fundType: 'general',
    jurisdiction, ref: `${fiscalYear}!D6`, section: 'taxes', sourceId: `edr-afr-revenues-${jurisdiction}`,
  };
}

const source = (id: string, title: string, caveats: string[] = [], extra: Partial<SourceRecord> = {}): SourceRecord => ({
  id, publisher: 'EDR', title, url: 'https://example.test/' + id, retrieved: '2026-10-07', sha256: 'x', caveats, ...extra,
});
const PINELLAS_SUMMARY = 'Not cross-checked against the county-filed Annual Financial Report.';
const HILLSBOROUGH_SUMMARY = 'Spot check: 14 values in the county-filed Annual Financial Reports match the EDR workbook.';

const cpiSeries = { sourceId: 'cpi', fiscalYear: {}, calendarYear: {}, fiscalYearUnavailable: {}, calendarYearUnavailable: {} };

const shared = {
  population: {
    hillsborough: { byYear: {}, sourceId: 'pop', reference: 'April 1 of the year shown', fiscalYearAlignment: 'x' },
    pinellas: { byYear: {}, sourceId: 'pop', reference: 'April 1 of the year shown', fiscalYearAlignment: 'x' },
  } as unknown as PopulationFile,
  cpi: { national: cpiSeries, tampa: cpiSeries, tampa_semiannual: cpiSeries } as unknown as CpiFile,
  annotations: [
    { fiscalYear: 2021, kind: 'methodology' as const, label: 'Custodial fund reporting begins (GASB 84).', sourceId: 'page' },
    { fiscalYear: 2021, kind: 'methodology' as const, label: 'Hillsborough custodial accounts', sourceId: 'edr-afr-revenues-hillsborough', jurisdiction: 'hillsborough' },
    { fiscalYear: 2022, kind: 'methodology' as const, label: 'Pinellas custodial accounts', sourceId: 'edr-afr-revenues-pinellas', jurisdiction: 'pinellas' },
  ],
  sources: [
    source('page', 'County Government Revenues and Expenditures (index page)'),
    source('edr-afr-revenues-hillsborough', 'Hillsborough County Government Revenues Reported by Account', [], {
      countyAfrCrossCheck: 'spot-check', crossCheckSummary: HILLSBOROUGH_SUMMARY,
      crossCheckCoverage: [
        { fromFiscalYear: 2020, toFiscalYear: 2020, status: 'full' },
        { fromFiscalYear: 2021, toFiscalYear: 2021, status: 'mismatch' },
        { fromFiscalYear: 2022, toFiscalYear: 2023, status: 'full' },
      ],
    }),
    source('edr-afr-revenues-pinellas', 'Pinellas County Government Revenues Reported by Account', [PINELLAS_CAVEAT], {
      countyAfrCrossCheck: 'not-checked', crossCheckSummary: PINELLAS_SUMMARY,
      crossCheckCoverage: [
        { fromFiscalYear: 2020, toFiscalYear: 2021, status: 'not-checked' },
        { fromFiscalYear: 2022, toFiscalYear: 2023, status: 'full' },
      ],
    }),
  ],
};

class ReadyDataService {
  readonly counties = signal(['hillsborough', 'pinellas']);
  readonly countyNames = signal<Record<string, string>>({ hillsborough: 'Hillsborough County', pinellas: 'Pinellas County' });
  statusFor = (): DataStatus => 'ready';
  errorFor = () => null;
  dataFor = (c: string): TransformData => ({
    ...shared,
    observations: [2020, 2021, 2022, 2023].map((y) => obs(c, y, 100 * (y - 2019))),
  });
  load = () => Promise.resolve();
  loadCounty = () => Promise.resolve();
}

describe('Explorer with a county selected', () => {
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    TestBed.overrideComponent(SeriesChartComponent, {
      remove: { imports: [NgxEchartsDirective] },
      add: { imports: [FakeEchartsDirective] },
    });
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: '', component: ExplorerComponent }]), { provide: DataService, useClass: ReadyDataService }],
    });
    harness = await RouterTestingHarness.create();
  });

  async function open(url: string): Promise<HTMLElement> {
    await harness.navigateByUrl(url, ExplorerComponent);
    await harness.fixture.whenStable();
    return harness.routeNativeElement as HTMLElement;
  }

  it('Pinellas: no Hillsborough text anywhere in the explorer', async () => {
    const el = await open('/?county=pinellas');
    expect(el.textContent).toContain('Pinellas County');
    // Everything except the County selector's own option list, which offers every county.
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('option').forEach((o) => o.remove());
    expect(clone.textContent).not.toMatch(/hillsborough/i);
    expect(TestBed.inject(CountyContext).label()).toBe('Pinellas County');
  });

  it('labels the county neutrally: chip "County: Pinellas", Filters select, Settings "Jurisdiction"', async () => {
    const el = await open('/?county=pinellas');
    const chips = [...el.querySelectorAll('.fx-chip')].map((c) => c.textContent?.trim());
    expect(chips[0]).toBe('County: Pinellas');
    const select = [...el.querySelectorAll<HTMLSelectElement>('.filters select')][0];
    expect([...select.options].map((o) => o.text)).toEqual(['Hillsborough', 'Pinellas']);
    expect(select.selectedOptions[0].text).toBe('Pinellas');
    expect(el.querySelector('app-methodology')?.textContent).toContain('Pinellas County');
  });

  it('shows the Pinellas source caveat (not cross-checked against the county-filed AFR)', async () => {
    const el = await open('/?county=pinellas');
    const sources = el.querySelector('app-methodology .sources')?.textContent ?? '';
    expect(sources).toContain('Pinellas County Government Revenues Reported by Account');
    expect(sources).toContain(PINELLAS_CAVEAT); // the explanation, in the caveat list
    // The data's cross-check summary, visible on its own line (keyed off countyAfrCrossCheck).
    const notices = [...el.querySelectorAll('app-methodology .sources .notice')].map((n) => n.textContent?.trim());
    expect(notices).toEqual([PINELLAS_SUMMARY]);
  });

  it("shows Hillsborough's spot-check summary for Hillsborough", async () => {
    const el = await open('/?county=hillsborough');
    const notices = [...el.querySelectorAll('app-methodology .sources .notice')].map((n) => n.textContent?.trim());
    expect(notices).toEqual([HILLSBOROUGH_SUMMARY]);
  });

  it('annotations follow the county', async () => {
    let el = await open('/?county=pinellas');
    let notes = el.querySelector('app-view-notes')?.textContent ?? '';
    expect(notes).toContain('Pinellas custodial accounts');
    expect(notes).not.toContain('Hillsborough custodial accounts');

    el = await open('/?county=hillsborough');
    notes = el.querySelector('app-view-notes')?.textContent ?? '';
    expect(notes).toContain('Hillsborough custodial accounts');
    expect(notes).not.toContain('Pinellas custodial accounts');
  });

  describe('cross-check marking', () => {
    const legend = (el: HTMLElement) => [...el.querySelectorAll('.check-legend li')].map((li) => li.textContent?.trim());

    it('shows the "not cross-checked" legend entry only when such points are in view', async () => {
      let el = await open('/?county=pinellas&from=2020&to=2023');
      expect(legend(el)).toEqual(['Not cross-checked against the county-filed AFR']);
      el = await open('/?county=pinellas&from=2022&to=2023'); // only fully checked years
      expect(el.querySelector('.check-legend')).toBeNull();
    });

    it('shows a separate legend entry for years with unresolved differences', async () => {
      const el = await open('/?county=hillsborough&from=2020&to=2023');
      expect(legend(el)).toEqual(['Cross-checked: differences with the county-filed AFR not resolved']);
    });

    it('legend uses a marker shape plus text, not colour alone', async () => {
      const el = await open('/?county=hillsborough&from=2020&to=2023');
      const item = el.querySelector('.check-legend li')!;
      expect(item.querySelector('svg path')).not.toBeNull(); // diamond shape
      expect(item.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
      expect(item.textContent?.trim().length).toBeGreaterThan(0);
    });

    it('table: a Cross-check column with the status per year', async () => {
      const el = await open('/?county=pinellas&from=2020&to=2023');
      (el.querySelector('.fx-segmented button:last-child') as HTMLButtonElement).click();
      await harness.fixture.whenStable();
      const headers = [...el.querySelectorAll('app-series-table thead th')].map((th) => th.textContent?.trim());
      expect(headers).toContain('Cross-check');
      const rows = [...el.querySelectorAll('app-series-table tbody tr')].map((tr) => [
        tr.querySelector('th')?.textContent?.trim(),
        tr.querySelector('.check')?.textContent?.trim(),
      ]);
      expect(rows).toEqual([
        ['FY 2019-20', 'Not cross-checked'],
        ['FY 2020-21', 'Not cross-checked'],
        ['FY 2021-22', 'Matches'],
        ['FY 2022-23', 'Matches'],
      ]);
    });
  });
});
