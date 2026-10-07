import { Location } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';
import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { DataService, DataStatus } from '../core/data.service';
import { AfrObservation, CpiFile, PopulationFile } from '../core/models';
import { TransformData } from '../core/transform';
import { ExplorerStore } from './explorer-store';
import { SKELETON_DELAY_MS } from './skeleton';

function obs(
  flow: 'revenue' | 'expenditure',
  fiscalYear: number,
  amount: number,
  fundType = 'general',
  jurisdiction = 'hillsborough',
): AfrObservation {
  return {
    account: flow === 'revenue' ? '311' : '513',
    amount,
    category: 'x',
    fiscalYear,
    flow,
    fundType,
    jurisdiction,
    ref: `${fiscalYear}!D6`,
    section: 'x',
    sourceId: `edr-afr-${flow}`,
  };
}

// Hillsborough: revenues FY 2018-2021, expenditures FY 2017-2021.
// Pinellas: revenues and expenditures FY 2020-2023.
const fixture: TransformData = {
  observations: [
    obs('expenditure', 2017, 50),
    ...[2018, 2019, 2020, 2021].flatMap((y) => [obs('revenue', y, 100 * (y - 2017)), obs('expenditure', y, 90)]),
    obs('revenue', 2021, 1000, 'custodial'),
    ...[2020, 2021, 2022, 2023].flatMap((y) => [
      obs('revenue', y, 10 * (y - 2019), 'general', 'pinellas'),
      obs('expenditure', y, 9, 'general', 'pinellas'),
    ]),
  ],
  population: {} as PopulationFile,
  cpi: Object.fromEntries(
    ['national', 'tampa', 'tampa_semiannual'].map((k) => [
      k,
      { sourceId: k, fiscalYear: {}, calendarYear: {}, fiscalYearUnavailable: {}, calendarYearUnavailable: {} },
    ]),
  ) as unknown as CpiFile,
  annotations: [
    { fiscalYear: 2021, kind: 'methodology', label: 'Custodial fund reporting begins (GASB 84)', sourceId: 'p' },
    { fiscalYear: 2021, kind: 'methodology', label: 'Hillsborough-only note', sourceId: 'p', jurisdiction: 'hillsborough' },
    { fiscalYear: 2021, kind: 'methodology', label: 'Pinellas-only note', sourceId: 'p', jurisdiction: 'pinellas' },
  ],
  sources: [],
};

/** Per-county fake: `loaded` says which counties have their observations in. */
class FakeDataService {
  readonly counties = signal(['hillsborough', 'pinellas']);
  readonly countyNames = signal<Record<string, string>>({ hillsborough: 'Hillsborough County', pinellas: 'Pinellas County' });
  readonly loaded = signal<Record<string, boolean>>({ hillsborough: true, pinellas: true });
  readonly failed = signal<string | null>(null);
  statusFor = (c: string): DataStatus => (this.failed() ? 'error' : this.loaded()[c] ? 'ready' : 'loading');
  errorFor = (): string | null => this.failed();
  dataFor = (c: string): TransformData | null =>
    this.loaded()[c] ? { ...fixture, observations: fixture.observations.filter((o) => o.jurisdiction === c) } : null;
  load = vi.fn(() => Promise.resolve());
  loadCounty = vi.fn((c: string) => {
    this.loaded.update((l) => ({ ...l, [c]: true }));
    return Promise.resolve();
  });
}

@Component({ template: '', providers: [ExplorerStore] })
class HostComponent {
  readonly store = inject(ExplorerStore);
}

describe('ExplorerStore URL state', () => {
  let harness: RouterTestingHarness;
  let router: Router;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '', component: HostComponent }]),
        provideLocationMocks(),
        { provide: DataService, useClass: FakeDataService },
      ],
    });
    harness = await RouterTestingHarness.create();
    router = TestBed.inject(Router);
  });

  async function open(url: string): Promise<ExplorerStore> {
    const host = await harness.navigateByUrl(url, HostComponent);
    await harness.fixture.whenStable();
    return host.store;
  }

  function query(): Record<string, string> {
    return Object.fromEntries(new URLSearchParams(router.url.split('?')[1] ?? ''));
  }

  it('reads settings from the URL', async () => {
    const store = await open('/?flow=expenditure&measure=per_capita&base=2019&idx=1&from=2018&to=2020&cust=1&cpi=cpi-u-tampa&cpiper=calendar');
    expect(store.settings()).toEqual({
      flow: 'expenditure',
      measure: 'per_capita',
      baseYear: 2019,
      indexTo100: true,
      range: [2018, 2020],
      includeCustodial: true,
      cpiIndex: 'cpi-u-tampa',
      cpiPeriod: 'calendar',
      transfers: 'gross',
      jurisdiction: 'hillsborough',
    });
  });

  it('writes the full canonical settings to a bare URL, custodial excluded by default', async () => {
    const store = await open('/');
    expect(query()).toEqual({
      flow: 'revenue',
      measure: 'nominal',
      base: '2021',
      idx: '0',
      from: '2018',
      to: '2021',
      cust: '0',
      cpi: 'cpi-u-us',
      cpiper: 'fiscal',
      xfer: 'gross',
      county: 'hillsborough',
    });
    expect(store.settings().includeCustodial).toBe(false);
  });

  it('replaces bad and out-of-range params with defaults or clamped values', async () => {
    const store = await open('/?flow=expenditure&measure=bogus&from=1990&to=2099&base=1800&cust=maybe');
    expect(store.settings().measure).toBe('nominal');
    expect(store.settings().range).toEqual([2017, 2021]);
    expect(store.settings().baseYear).toBe(2021);
    expect(store.settings().includeCustodial).toBe(false);
    expect(query()).toMatchObject({ flow: 'expenditure', measure: 'nominal', from: '2017', to: '2021', base: '2021', cust: '0' });
  });

  it('update() writes to the URL and the URL drives settings', async () => {
    const store = await open('/');
    store.update({ measure: 'real', includeCustodial: true, range: [2019, 2020] });
    await harness.fixture.whenStable();
    expect(query()).toMatchObject({ measure: 'real', cust: '1', from: '2019', to: '2020' });
    expect(store.settings().measure).toBe('real');

    await router.navigateByUrl('/?' + new URLSearchParams({ ...query(), flow: 'expenditure' }).toString());
    await harness.fixture.whenStable();
    expect(store.settings().flow).toBe('expenditure');
  });

  it('re-clamps the range when switching to a flow with fewer years', async () => {
    const store = await open('/?flow=expenditure&from=2017&to=2021');
    store.update({ flow: 'revenue' });
    await harness.fixture.whenStable();
    expect(store.settings().range).toEqual([2018, 2021]);
    expect(query()).toMatchObject({ flow: 'revenue', from: '2018' });
  });

  it('takes defaults from the loaded data (defaultSettingsFor), per flow', async () => {
    const store = await open('/?flow=expenditure');
    expect(store.settings().range).toEqual([2017, 2021]);
    expect(store.settings().baseYear).toBe(2021);
    store.update({ flow: 'revenue', range: [2000, 2030] });
    await harness.fixture.whenStable();
    expect(store.settings().range).toEqual([2018, 2021]);
  });

  it('round-trips the transfers setting through xfer', async () => {
    const store = await open('/?xfer=net');
    expect(store.settings().transfers).toBe('net');
    store.update({ transfers: 'gross' });
    await harness.fixture.whenStable();
    expect(query()['xfer']).toBe('gross');
  });

  it('reset() restores data-derived defaults', async () => {
    const store = await open('/?measure=real&cust=1&from=2019&to=2020&xfer=net');
    store.reset();
    await harness.fixture.whenStable();
    expect(query()).toMatchObject({ measure: 'nominal', cust: '0', from: '2018', to: '2021', base: '2021', xfer: 'gross' });
  });

  describe('history (QA-12)', () => {
    /** Lets the router finish the navigation a popstate (Back/Forward) starts. */
    async function settle(): Promise<void> {
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 10));
        await harness.fixture.whenStable();
      }
    }

    it('Back and Forward restore earlier views after user changes', async () => {
      // In the app, bootstrap starts the router's popstate listener; TestBed doesn't bootstrap.
      router.setUpLocationChangeListener();
      const store = await open('/');
      const location = TestBed.inject(Location);
      store.update({ measure: 'per_capita' });
      await settle();
      store.update({ range: [2019, 2020] });
      await settle();
      expect(store.settings()).toMatchObject({ measure: 'per_capita', range: [2019, 2020] });

      location.back();
      await settle();
      expect(store.settings()).toMatchObject({ measure: 'per_capita', range: [2018, 2021] });

      location.back();
      await settle();
      expect(store.settings()).toMatchObject({ measure: 'nominal', range: [2018, 2021] });

      location.forward();
      await settle();
      expect(store.settings().measure).toBe('per_capita');
    });

    it('canonicalizing the URL replaces the entry instead of pushing one', async () => {
      router.setUpLocationChangeListener();
      await open('/?measure=bogus');
      const location = TestBed.inject(Location);
      const before = location.path();
      expect(before).toContain('measure=nominal');
      // Going back from the canonical URL must not land on the invalid or bare one we replaced.
      location.back();
      await settle();
      expect(location.path()).not.toContain('measure=bogus');
    });

    it('an update that changes nothing pushes no entry', async () => {
      const store = await open('/');
      const location = TestBed.inject(Location);
      const navigate = vi.spyOn(router, 'navigate');
      store.update({ measure: 'nominal' });
      expect(navigate).not.toHaveBeenCalled();
      expect(location.path()).toContain('measure=nominal');
    });
  });

  describe('county switch', () => {
    const fake = () => TestBed.inject(DataService) as unknown as FakeDataService;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

    it('reads the county from the URL and writes it back (round trip)', async () => {
      const store = await open('/?county=pinellas');
      expect(store.county()).toBe('pinellas');
      expect(store.settings().jurisdiction).toBe('pinellas');
      expect(query()['county']).toBe('pinellas');
    });

    it('falls back to the default county for unknown or malformed values', async () => {
      let store = await open('/?county=atlantis');
      expect(store.county()).toBe('hillsborough');
      expect(query()['county']).toBe('hillsborough');
      store = await open('/?county=Pinellas%20County');
      expect(store.county()).toBe('hillsborough');
    });

    it('a county switch pushes history, like any other setting', async () => {
      router.setUpLocationChangeListener();
      const store = await open('/');
      store.update({ jurisdiction: 'pinellas' });
      await harness.fixture.whenStable();
      expect(store.county()).toBe('pinellas');
      TestBed.inject(Location).back();
      for (let i = 0; i < 5; i++) {
        await wait(10);
        await harness.fixture.whenStable();
      }
      expect(store.county()).toBe('hillsborough');
    });

    it("re-clamps range and base year to the new county's years", async () => {
      const store = await open('/?from=2018&to=2021&base=2018');
      store.update({ jurisdiction: 'pinellas' });
      await harness.fixture.whenStable();
      // Pinellas revenues are FY 2020-2023.
      expect(store.years()).toEqual([2020, 2021, 2022, 2023]);
      expect(store.settings().range).toEqual([2020, 2021]);
      expect(store.settings().baseYear).toBe(2023);
      expect(query()).toMatchObject({ county: 'pinellas', from: '2020', to: '2021', base: '2023' });
    });

    it('loads a county lazily on first view and shows its data and annotations only', async () => {
      fake().loaded.set({ hillsborough: true, pinellas: false });
      const store = await open('/');
      expect(fake().loadCounty).toHaveBeenCalledWith('hillsborough');
      expect(fake().loadCounty).not.toHaveBeenCalledWith('pinellas');

      store.update({ jurisdiction: 'pinellas' });
      await harness.fixture.whenStable();
      expect(fake().loadCounty).toHaveBeenCalledWith('pinellas');
      expect(store.points().every((p) => p.sourceIds.every((id) => !id.includes('hillsborough')))).toBe(true);
      expect(store.annotations().map((a) => a.label)).toContain('Pinellas-only note');
      expect(store.annotations().map((a) => a.label)).not.toContain('Hillsborough-only note');
    });

    it('reveals placeholders once per load: after the delay on a switch to a county not loaded yet', async () => {
      fake().loaded.set({ hillsborough: true, pinellas: false });
      fake().loadCounty.mockImplementation(() => Promise.resolve()); // Pinellas stays loading
      const store = await open('/');
      expect(store.loading()).toBe(false);
      store.update({ jurisdiction: 'pinellas' });
      await harness.fixture.whenStable();
      expect(store.loading()).toBe(true);
      expect(store.revealSkeleton()).toBe(false);
      await wait(SKELETON_DELAY_MS + 30);
      expect(store.revealSkeleton()).toBe(true);
      store.update({ measure: 'per_capita' }); // still the same load
      await harness.fixture.whenStable();
      expect(store.revealSkeleton()).toBe(true);
    });

    it('switching to a county already loaded shows no loading state', async () => {
      const store = await open('/');
      store.update({ jurisdiction: 'pinellas' });
      await harness.fixture.whenStable();
      expect(store.loading()).toBe(false);
    });
  });

  it('computes points and in-range annotations from settings', async () => {
    const store = await open('/?from=2018&to=2020');
    expect(store.points().map((p) => p.fiscalYear)).toEqual([2018, 2019, 2020]);
    expect(store.annotations()).toEqual([]);

    store.update({ range: [2018, 2021] });
    await harness.fixture.whenStable();
    expect(store.annotations().map((a) => a.label)).toEqual([
      'Custodial fund reporting begins (GASB 84)',
      'Hillsborough-only note',
    ]);
    // Custodial excluded by default: FY 2021 revenue is the general-fund amount only.
    expect(store.points().at(-1)?.nominal).toBe(400);
  });
});
