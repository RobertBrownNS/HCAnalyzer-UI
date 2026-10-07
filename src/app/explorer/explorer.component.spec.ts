import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { DataService, DataStatus } from '../core/data.service';
import { TransformData } from '../core/transform';
import { ExplorerComponent } from './explorer.component';
import { SKELETON_DELAY_MS } from './skeleton';

class LoadingDataService {
  readonly status = signal<DataStatus>('loading');
  readonly error = signal<string | null>(null);
  readonly data = signal<TransformData | null>(null);
  readonly counties = signal(['hillsborough', 'pinellas']);
  statusFor = () => this.status();
  errorFor = () => this.error();
  dataFor = () => this.data();
  load = () => Promise.resolve();
  loadCounty = () => Promise.resolve();
}

describe('ExplorerComponent', () => {
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '', component: ExplorerComponent }]),
        { provide: DataService, useClass: LoadingDataService },
      ],
    });
    harness = await RouterTestingHarness.create();
  });

  describe('loading skeletons', () => {
    async function open(): Promise<HTMLElement> {
      await harness.navigateByUrl('/', ExplorerComponent);
      await harness.fixture.whenStable();
      return harness.routeNativeElement as HTMLElement;
    }

    it('reserves the content boxes at once but keeps them invisible for the first moments', async () => {
      const el = await open();
      const placeholders = [...el.querySelectorAll('app-chart-skeleton, .kpis-wide .card.skel, .skel-tile')];
      expect(placeholders.length).toBeGreaterThanOrEqual(3);
      // Not yet revealed: laid out (no layout shift later) but hidden (no flash on fast loads).
      expect(el.querySelector('.figure app-chart-skeleton')?.classList).toContain('fx-skel-pending');
      expect(el.querySelector('mat-progress-bar')).toBeNull();
    });

    it('reveals the placeholders after SKELETON_DELAY_MS', async () => {
      const el = await open();
      await new Promise((r) => setTimeout(r, SKELETON_DELAY_MS + 30));
      await harness.fixture.whenStable();
      expect(el.querySelector('.figure app-chart-skeleton')?.classList).not.toContain('fx-skel-pending');
    });

    it('marks the region busy, announces once, and hides the shapes from assistive tech', async () => {
      const el = await open();
      expect(el.querySelector('.main')?.getAttribute('aria-busy')).toBe('true');
      const live = el.querySelector('[aria-live="polite"]');
      expect(live?.textContent?.trim()).toBe('Loading data…');
      for (const shape of el.querySelectorAll('.fx-skel')) {
        expect(shape.closest('[aria-hidden="true"]')).not.toBeNull();
      }
    });

    it('does not state a fiscal-year range before the data says which years exist', async () => {
      const el = await open();
      const chips = [...el.querySelectorAll('.fx-chip')].map((c) => c.textContent?.trim());
      expect(chips).toContain('Fiscal years');
      expect(chips.some((c) => c?.startsWith('FY '))).toBe(false);
    });

    it('error and Retry replace the skeletons', async () => {
      const el = await open();
      await new Promise((r) => setTimeout(r, SKELETON_DELAY_MS + 30)); // placeholders revealed first
      const data = TestBed.inject(DataService) as unknown as LoadingDataService;
      data.error.set('The data files use schema version 99, but this version of the site reads schema version 1.');
      data.status.set('error');
      await harness.fixture.whenStable();
      expect(el.querySelector('app-chart-skeleton')).toBeNull();
      expect(el.querySelector('.card.skel')).toBeNull();
      expect(el.querySelector('.skel-tile')).toBeNull();
      expect(el.querySelector('[role="alert"]')?.textContent).toContain('schema version 99');
      expect(el.querySelector('.main')?.getAttribute('aria-busy')).toBe('false');
    });

    it('after a failed load: no skeleton anywhere, no unchecked range, KPIs say the data is not loaded (QA-27)', async () => {
      const el = await open();
      await new Promise((r) => setTimeout(r, SKELETON_DELAY_MS + 30));
      const data = TestBed.inject(DataService) as unknown as LoadingDataService;
      data.error.set('Http failure response: 404 Not Found');
      data.status.set('error');
      await harness.fixture.whenStable();
      expect(el.querySelectorAll('.fx-skel, app-chart-skeleton, .card.skel, .skel-tile, app-range-control .pending')).toHaveLength(0);
      const chips = [...el.querySelectorAll('.fx-chip')].map((c) => c.textContent?.trim());
      expect(chips).toContain('Fiscal years');
      expect(chips.some((c) => c?.startsWith('FY '))).toBe(false);
      const kpiText = el.querySelector('.kpis-wide')?.textContent ?? '';
      expect(kpiText).toContain('Data not loaded');
      expect(kpiText).not.toContain('No years in range');
      expect(el.querySelector('[role="alert"] button')?.textContent?.trim()).toBe('Retry');
    });
  });

  it('shows one chip per active setting, custodial excluded by default', async () => {
    await harness.navigateByUrl('/', ExplorerComponent);
    await harness.fixture.whenStable();
    const chips = [...(harness.routeNativeElement as HTMLElement).querySelectorAll('.fx-chip')].map((c) =>
      c.textContent?.trim(),
    );
    expect(chips).toContain('Revenues');
    expect(chips).toContain('Nominal dollars');
    expect(chips).toContain('Custodial excluded');
    expect(chips).toContain('Transfers: as reported (gross)');
    expect(chips.some((c) => c?.startsWith('CPI'))).toBe(false);
  });

  it('adds base-year and inflation chips for inflation-adjusted measures', async () => {
    const page = await harness.navigateByUrl('/?measure=real&base=2020&cpi=cpi-u-tampa&cpiper=calendar', ExplorerComponent);
    await harness.fixture.whenStable();
    const labels = page.chips().map((c) => c.label);
    expect(labels).toContain('FY 2019-20 dollars');
    expect(labels).toContain('CPI-U Tampa, calendar-year');
    expect(page.valueLabel()).toBe('Revenues, inflation-adjusted, FY 2019-20 dollars');
  });

  it('renders the Filters pane, report tab and chart tile title', async () => {
    await harness.navigateByUrl('/?flow=expenditure', ExplorerComponent);
    await harness.fixture.whenStable();
    const el = harness.routeNativeElement as HTMLElement;
    expect(el.querySelector('aside.filters h2')?.textContent).toBe('Filters');
    expect(el.querySelector('.tab[aria-current="page"]')?.textContent?.trim()).toBe('Overview');
    expect(el.querySelector('#chart-title')?.textContent).toContain('Expenditures by fiscal year');
  });

  it('colors the series by flow: revenue = series 1, expenditure = series 2', async () => {
    const page = await harness.navigateByUrl('/?flow=expenditure', ExplorerComponent);
    await harness.fixture.whenStable();
    expect(page.seriesColor()).toBe('var(--fx-series-2)');
    const rev = await harness.navigateByUrl('/?flow=revenue', ExplorerComponent);
    await harness.fixture.whenStable();
    expect(rev.seriesColor()).toBe('var(--fx-series-1)');
  });

  it('states the fund scope and transfer mode under the title', async () => {
    const page = await harness.navigateByUrl('/?cust=1&xfer=net', ExplorerComponent);
    await harness.fixture.whenStable();
    expect(page.scopeLine()).toBe(
      'All funds as reported by EDR, including custodial. Transfers between funds: excluded (net).',
    );
    const tile = (harness.routeNativeElement as HTMLElement).querySelector('.chart-tile')?.textContent ?? '';
    expect(tile).toContain('All funds as reported by EDR, including custodial');
  });
});
