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

function obs(flow: 'revenue' | 'expenditure', fiscalYear: number, amount: number, fundType = 'general'): AfrObservation {
  return {
    account: flow === 'revenue' ? '311' : '513',
    amount,
    category: 'x',
    fiscalYear,
    flow,
    fundType,
    jurisdiction: 'hillsborough',
    ref: `${fiscalYear}!D6`,
    section: 'x',
    sourceId: `edr-afr-${flow}`,
  };
}

// Revenues FY 2018-2021, expenditures FY 2017-2021.
const fixture: TransformData = {
  observations: [
    obs('expenditure', 2017, 50),
    ...[2018, 2019, 2020, 2021].flatMap((y) => [obs('revenue', y, 100 * (y - 2017)), obs('expenditure', y, 90)]),
    obs('revenue', 2021, 1000, 'custodial'),
  ],
  population: {} as PopulationFile,
  cpi: Object.fromEntries(
    ['national', 'tampa', 'tampa_semiannual'].map((k) => [
      k,
      { sourceId: k, fiscalYear: {}, calendarYear: {}, fiscalYearUnavailable: {}, calendarYearUnavailable: {} },
    ]),
  ) as unknown as CpiFile,
  annotations: [{ fiscalYear: 2021, kind: 'methodology', label: 'Custodial fund reporting begins (GASB 84)', sourceId: 'p' }],
  sources: [],
};

class FakeDataService {
  readonly status = signal<DataStatus>('ready');
  readonly error = signal<string | null>(null);
  readonly data = signal<TransformData | null>(fixture);
  load = vi.fn(() => Promise.resolve());
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

  it('reveals loading placeholders once per load, after the delay, and keeps them revealed (QA-26)', async () => {
    const store = await open('/');
    expect(store.revealSkeleton()).toBe(false);
    await new Promise((r) => setTimeout(r, SKELETON_DELAY_MS + 30));
    expect(store.revealSkeleton()).toBe(true);
    store.update({ measure: 'per_capita' });
    await harness.fixture.whenStable();
    expect(store.revealSkeleton()).toBe(true);
  });

  it('computes points and in-range annotations from settings', async () => {
    const store = await open('/?from=2018&to=2020');
    expect(store.points().map((p) => p.fiscalYear)).toEqual([2018, 2019, 2020]);
    expect(store.annotations()).toEqual([]);

    store.update({ range: [2018, 2021] });
    await harness.fixture.whenStable();
    expect(store.annotations().map((a) => a.fiscalYear)).toEqual([2021]);
    // Custodial excluded by default: FY 2021 revenue is the general-fund amount only.
    expect(store.points().at(-1)?.nominal).toBe(400);
  });
});
