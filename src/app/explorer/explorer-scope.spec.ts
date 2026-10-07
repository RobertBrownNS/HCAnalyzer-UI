import { Location } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';
import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { ANALYTICS_TOKEN } from '../core/analytics';
import { DataService, DataStatus } from '../core/data.service';
import { formatValue } from '../core/format';
import { AccountRecord, AfrObservation, CategoriesFile, CpiFile, FundsFile, PopulationFile } from '../core/models';
import { TransformData, settingsWithDefaults } from '../core/transform';
import { ExplorerControlsComponent, FUNDS_MODE_KEY } from './explorer-controls.component';
import { ExplorerStore } from './explorer-store';
import { kpiCards, measureCaption, unitPhrase } from './kpi';
import { MethodologyComponent, categoryMappingRows } from './methodology.component';

// Phase 3 store behaviour: fund and category selection (D-18, D-19), chart type (D-20) in the URL,
// the net-of-transfers rule, and the source drawer's content.

function obs(fiscalYear: number, account: string, category: string, fundType: string, amount: number): AfrObservation {
  return {
    account,
    amount,
    category,
    fiscalYear,
    flow: 'revenue',
    fundType,
    jurisdiction: 'hillsborough',
    ref: `${fiscalYear}!${fundType === 'general' ? 'D' : 'E'}${account}`,
    section: category,
    sourceId: 'edr-afr-revenue',
  };
}

// Hillsborough revenues FY 2019-2021 in three funds and three categories, plus custodial in FY 2021.
const fixture: TransformData = {
  observations: [2019, 2020, 2021].flatMap((y) => [
    obs(y, '311', 'ad_valorem', 'general', 100),
    obs(y, '381', 'other_sources', 'general', 10),
    obs(y, '335', 'intergovernmental', 'special_revenue', 50),
    obs(y, '343', 'charges_for_services', 'enterprise', 30),
    ...(y === 2021 ? [obs(y, '311', 'ad_valorem', 'custodial', 999)] : []),
  ]),
  population: {} as PopulationFile,
  cpi: Object.fromEntries(
    ['national', 'tampa', 'tampa_semiannual'].map((k) => [
      k,
      { sourceId: k, fiscalYear: {}, calendarYear: {}, fiscalYearUnavailable: {}, calendarYearUnavailable: {} },
    ]),
  ) as unknown as CpiFile,
  annotations: [
    { fiscalYear: 2021, kind: 'methodology', label: 'Custodial fund reporting begins (GASB 84)', sourceId: 'edr-afr-revenue' },
    {
      fiscalYear: 2020,
      kind: 'methodology',
      label: 'Account 335 classified differently in LOGERX',
      detail: 'LOGERX has this amount under 335.9; EDR has it under 335.',
      sourceId: 'logerx',
      jurisdiction: 'hillsborough',
      cells: [{ account: '335', fundType: 'special_revenue' }],
    },
  ],
  sources: [
    {
      id: 'edr-afr-revenue',
      publisher: 'EDR',
      title: 'County revenues',
      url: 'https://edr.example/rev.xlsx',
      retrieved: '2026-10-01',
      sha256: 'a',
      caveats: ['Shared caveat'],
      caveatsByJurisdiction: { hillsborough: ['Hillsborough caveat'], pinellas: ['Pinellas caveat'] },
    },
    { id: 'logerx', publisher: 'DFS', title: 'LOGERX', url: 'https://dfs.example', retrieved: '2026-10-01', sha256: 'b', caveats: [] },
  ],
};

const funds: FundsFile = {
  groups: [
    { id: 'governmental', label: 'Governmental funds' },
    { id: 'proprietary', label: 'Proprietary funds' },
    { id: 'fiduciary', label: 'Fiduciary funds' },
  ],
  funds: [
    { id: 'general', label: 'General', group: 'governmental' },
    { id: 'special_revenue', label: 'Special Revenue', group: 'governmental' },
    { id: 'enterprise', label: 'Enterprise', group: 'proprietary' },
    { id: 'custodial', label: 'Custodial', group: 'fiduciary', handledByToggle: 'custodial' },
  ],
  presets: [
    { id: 'general', label: 'General Fund', funds: ['general'] },
    { id: 'governmental', label: 'Governmental funds', funds: ['general', 'special_revenue', 'permanent'] },
    { id: 'all', label: 'All funds', funds: ['general', 'special_revenue', 'enterprise', 'pension'] },
  ],
};

const categories: CategoriesFile = [
  { id: 'ad_valorem', flow: 'revenue', label: 'Ad Valorem Taxes', accountRanges: [{ from: '311', to: '311.999' }] },
  { id: 'intergovernmental', flow: 'revenue', label: 'Intergovernmental Revenues' },
  { id: 'charges_for_services', flow: 'revenue', label: 'Charges for Services' },
  { id: 'other_sources', flow: 'revenue', label: 'Other Sources' },
];

const accounts: AccountRecord[] = [
  { account: '311', flow: 'revenue', category: 'ad_valorem', section: 'taxes', name: 'Ad Valorem Taxes', names: [] },
  {
    account: '335',
    flow: 'revenue',
    category: 'intergovernmental',
    section: 'intergovernmental',
    name: 'State Shared Revenues',
    names: [{ fiscalYears: [2019], name: 'State Shared Revenues (old name)' }],
  },
];

class FakeDataService {
  readonly counties = signal(['hillsborough']);
  readonly defaultCounty = signal<string | null>('hillsborough');
  readonly fundsMeta = signal<FundsFile | null>(funds);
  readonly categoriesMeta = signal<CategoriesFile | null>(categories);
  accountsFor = () => accounts;
  readonly countyNames = signal<Record<string, string>>({ hillsborough: 'Hillsborough County' });
  statusFor = (): DataStatus => 'ready';
  errorFor = (): string | null => null;
  dataFor = (): TransformData => ({ ...fixture, categories });
  load = vi.fn(() => Promise.resolve());
  loadCounty = vi.fn(() => Promise.resolve());
}

@Component({ template: '', providers: [ExplorerStore] })
class HostComponent {
  readonly store = inject(ExplorerStore);
}

@Component({
  template: '<app-explorer-controls /><app-methodology />',
  imports: [ExplorerControlsComponent, MethodologyComponent],
  providers: [ExplorerStore],
})
class ControlsHostComponent {
  readonly store = inject(ExplorerStore);
}

describe('ExplorerStore fund scope, categories and chart type', () => {
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

  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 10));
      await harness.fixture.whenStable();
    }
  }

  describe('URL state', () => {
    it('a link from before Phase 3 opens the same view: all funds, all categories, line chart', async () => {
      const store = await open('/?flow=revenue&measure=nominal&base=2021&idx=0&from=2019&to=2021&cust=0&cpi=cpi-u-us&cpiper=fiscal&xfer=gross&county=hillsborough');
      expect(store.settings().funds).toBeUndefined();
      expect(store.settings().categories).toBeUndefined();
      expect(store.view().chart).toBe('line');
      expect(store.categorySeries()).toBeNull();
      expect(store.points().map((p) => p.nominal)).toEqual([190, 190, 190]);
      expect(query()['funds']).toBeUndefined();
      expect(query()['cats']).toBeUndefined();
      expect(query()['chart']).toBe('line');
    });

    it('round-trips funds, cats and chart, lists sorted', async () => {
      const store = await open('/?funds=special_revenue,general&cats=intergovernmental,ad_valorem&chart=stacked');
      expect(store.settings().funds).toEqual(['general', 'special_revenue']);
      expect(store.settings().categories).toEqual(['ad_valorem', 'intergovernmental']);
      expect(store.view().chart).toBe('stacked');
      expect(query()).toMatchObject({ funds: 'general,special_revenue', cats: 'ad_valorem,intergovernmental', chart: 'stacked' });

      store.update({ funds: ['enterprise', 'general'] });
      await harness.fixture.whenStable();
      expect(query()['funds']).toBe('enterprise,general');
      expect(query()['chart']).toBe('stacked');
    });

    it('selecting every fund or category writes neither param (absent = all)', async () => {
      const store = await open('/?funds=enterprise,general,special_revenue&cats=ad_valorem,charges_for_services,intergovernmental,other_sources');
      expect(store.settings().funds).toBeUndefined();
      expect(store.settings().categories).toBeUndefined();
      expect(query()['funds']).toBeUndefined();
      expect(query()['cats']).toBeUndefined();
    });

    it('drops unknown ids and falls back to defaults for invalid values', async () => {
      const store = await open('/?funds=general,bogus,Bad-Id&cats=nope&chart=pie');
      expect(store.settings().funds).toEqual(['general']);
      expect(store.settings().categories).toBeUndefined();
      expect(store.view().chart).toBe('line');
      expect(query()).toMatchObject({ funds: 'general', chart: 'line' });
      expect(query()['cats']).toBeUndefined();
    });

    it('custodial is never a fund-list member; it keeps its own toggle', async () => {
      const store = await open('/?funds=custodial,general&cust=1');
      expect(store.settings().funds).toEqual(['general']);
      expect(store.settings().includeCustodial).toBe(true);
    });

    it('Back and Forward restore chart type and fund selection', async () => {
      router.setUpLocationChangeListener();
      const store = await open('/');
      const location = TestBed.inject(Location);
      store.updateView({ chart: 'bars' });
      await settle();
      store.update({ funds: ['general'] });
      await settle();
      expect(store.view().chart).toBe('bars');
      expect(store.settings().funds).toEqual(['general']);

      location.back();
      await settle();
      expect(store.view().chart).toBe('bars');
      expect(store.settings().funds).toBeUndefined();

      location.back();
      await settle();
      expect(store.view().chart).toBe('line');

      location.forward();
      await settle();
      expect(store.view().chart).toBe('bars');
    });

    it('reset() returns to all funds, all categories and the line chart', async () => {
      const store = await open('/?funds=general&cats=ad_valorem&chart=share');
      store.reset();
      await harness.fixture.whenStable();
      expect(store.settings().funds).toBeUndefined();
      expect(store.settings().categories).toBeUndefined();
      expect(store.view().chart).toBe('line');
    });
  });

  describe('net of transfers (R-19)', () => {
    it('is allowed with every fund selected', async () => {
      const store = await open('/?xfer=net');
      expect(store.netAllowed()).toBe(true);
      expect(store.settings().transfers).toBe('net');
      // 381 (transfers in) removed: 100 + 50 + 30.
      expect(store.points()[0].nominal).toBe(180);
    });

    it('with some funds selected, net is not allowed and the URL falls back to gross', async () => {
      const store = await open('/?funds=general&xfer=net');
      expect(store.netAllowed()).toBe(false);
      expect(store.settings().transfers).toBe('gross');
      expect(query()['xfer']).toBe('gross');
      expect(store.points()[0].nominal).toBe(110);
    });
  });

  describe('fund scope wording', () => {
    it('names the preset the selection matches, else the funds', async () => {
      let store = await open('/');
      expect(store.fundScope()).toBe('All funds as reported by EDR');
      expect(store.fundScopeShort()).toBe('All funds');
      expect(store.fundsIncluded()).toBe('Includes General, Special Revenue and Enterprise.');
      store = await open('/?funds=general');
      expect(store.fundScope()).toBe('General Fund');
      expect(store.fundsIncluded()).toBeNull();
      store = await open('/?funds=general,special_revenue');
      expect(store.fundScope()).toBe('Governmental funds');
      store = await open('/?funds=enterprise,general');
      expect(store.fundScope()).toBe('Funds: General, Enterprise');
    });
  });

  describe('category series', () => {
    it('follows categories.json order and the cats filter', async () => {
      let store = await open('/?chart=stacked');
      expect(store.categorySeries()!.map((c) => c.category)).toEqual([
        'ad_valorem',
        'intergovernmental',
        'charges_for_services',
        'other_sources',
      ]);
      expect(store.categoryLabels()['ad_valorem']).toBe('Ad Valorem Taxes');
      store = await open('/?chart=stacked&cats=intergovernmental,ad_valorem');
      expect(store.categorySeries()!.map((c) => c.category)).toEqual(['ad_valorem', 'intergovernmental']);
    });

    it('stacked total equals the total line, and index-to-100 applies only to lines by category', async () => {
      let store = await open('/?chart=stacked&idx=1');
      const total = store.chartTotal();
      const stack = store.categorySeries()!;
      total.forEach((p, i) => expect(stack.reduce((sum, c) => sum + (c.points[i].value ?? 0), 0)).toBeCloseTo(p.value!));
      expect(total[0].value).toBe(190);

      store = await open('/?chart=lines&idx=1');
      expect(store.categorySeries()![0].points[0].value).toBe(100);
      expect(store.chartTotal()[0].value).toBe(100);
    });
  });

  describe('source drawer content', () => {
    it('total: every account row, summing to the value, with names, funds, cells and sources', async () => {
      const store = await open('/?from=2019&to=2021');
      const c = store.drawerContent(2019, null, 'Revenues, nominal dollars')!;
      expect(c.fiscalYearLabel).toBe('FY 2018-19');
      expect(c.context).toBe('Hillsborough County · All funds as reported by EDR, excluding custodial');
      expect(c.seriesLabel).toBe('Revenues, nominal dollars');
      expect(c.valueText).toBe(formatValue(190, store.settings()));
      expect(c.nominalText).toBe('$190');
      expect(c.rows.reduce((sum, r) => sum + r.amount, 0)).toBe(190);
      expect(c.rows.map((r) => [r.account, r.fund, r.ref])).toEqual([
        ['311', 'General', '2019!D311'],
        ['381', 'General', '2019!D381'],
        ['335', 'Special Revenue', '2019!E335'],
        ['343', 'Enterprise', '2019!E343'],
      ]);
      // The name printed in that year's report.
      expect(c.rows.find((r) => r.account === '335')!.name).toBe('State Shared Revenues (old name)');
      expect(c.sources).toEqual([
        expect.objectContaining({ id: 'edr-afr-revenue', caveats: ['Shared caveat', 'Hillsborough caveat'] }),
      ]);
    });

    it('category: only that category, with its share; custodial follows the toggle', async () => {
      let store = await open('/?chart=share');
      let c = store.drawerContent(2021, 'ad_valorem', 'Revenues, nominal dollars')!;
      expect(c.seriesLabel).toBe('Ad Valorem Taxes · Revenues, nominal dollars');
      expect(c.rows.map((r) => r.account)).toEqual(['311']);
      expect(c.valueText).toContain('(52.6% of the selected total)');

      store = await open('/?chart=share&cust=1');
      c = store.drawerContent(2021, 'ad_valorem', 'Revenues, nominal dollars')!;
      expect(c.rows.map((r) => r.fund)).toEqual(['General', 'Custodial']);
      expect(c.nominalText).toBe('$1,099');
    });

    it('lists annotations for the year and those about the point accounts (DR-50), with their sources', async () => {
      const store = await open('/?chart=stacked');
      const c = store.drawerContent(2020, null, 'Revenues, nominal dollars')!;
      expect(c.annotations).toEqual([
        { label: 'Account 335 classified differently in LOGERX', detail: 'LOGERX has this amount under 335.9; EDR has it under 335.' },
      ]);
      expect(c.sources.map((s) => s.id)).toEqual(['edr-afr-revenue', 'logerx']);
      expect(store.drawerContent(2020, 'intergovernmental', 'x')!.annotations).toHaveLength(1);

      // Not for a point without the 335 Special Revenue cell.
      expect(store.drawerContent(2020, 'ad_valorem', 'x')!.annotations).toEqual([]);
      // The year's chart annotations are listed too.
      expect(store.drawerContent(2021, null, 'x')!.annotations.map((a) => a.label)).toEqual([
        'Custodial fund reporting begins (GASB 84)',
      ]);
    });

    it('fund selection limits the rows', async () => {
      const store = await open('/?funds=general');
      const c = store.drawerContent(2019, null, 'x')!;
      expect(c.context).toBe('Hillsborough County · General Fund, excluding custodial');
      expect(c.rows.map((r) => r.account)).toEqual(['311', '381']);
    });

    it('returns null for a year with no point', async () => {
      const store = await open('/');
      expect(store.drawerContent(2010, null, 'x')).toBeNull();
    });
  });
});

describe('Funds and categories controls', () => {
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '', component: ControlsHostComponent }]),
        provideLocationMocks(),
        { provide: DataService, useClass: FakeDataService },
      ],
    });
    harness = await RouterTestingHarness.create();
  });

  async function open(url: string): Promise<{ el: HTMLElement; store: ExplorerStore }> {
    const host = await harness.navigateByUrl(url, ControlsHostComponent);
    await harness.fixture.whenStable();
    return { el: harness.routeNativeElement as HTMLElement, store: host.store };
  }
  const netOption = (el: HTMLElement) => el.querySelector<HTMLOptionElement>('option[value="net"]')!;
  const pressed = (el: HTMLElement) =>
    [...el.querySelectorAll('.presets button[aria-pressed="true"]')].map((b) => b.textContent?.trim());

  it('all funds: net allowed, the All preset pressed, what it includes stated (QA-07)', async () => {
    const { el } = await open('/');
    expect(netOption(el).disabled).toBe(false);
    expect(pressed(el)).toEqual(['All funds']);
    expect(el.textContent).toContain('Includes General, Special Revenue and Enterprise.');
    // Custodial is its own toggle, not a fund checkbox.
    const funds = [...el.querySelectorAll('.fund-group label')].map((l) => l.textContent?.trim());
    expect(funds).toEqual(['General', 'Special Revenue', 'Enterprise']);
    expect(el.querySelector('.fund-group legend')?.textContent?.trim()).toBe('Governmental funds');
  });

  it('some funds: the net option is disabled with the reason shown next to it', async () => {
    const { el } = await open('/?funds=general');
    expect(netOption(el).disabled).toBe(true);
    const hint = el.querySelector('#net-hint')!;
    expect(hint.textContent).toContain('Excluded (net) needs all funds selected');
    expect(netOption(el).closest('select')!.getAttribute('aria-describedby')).toBe('net-hint');
  });

  it('editing a preset selection shows "Custom selection." and no preset pressed (P3-05)', async () => {
    const { el, store } = await open('/?funds=general');
    expect(pressed(el)).toEqual(['General Fund']);
    const enterprise = [...el.querySelectorAll<HTMLLabelElement>('.fund-group label')].find((l) =>
      l.textContent?.includes('Enterprise'),
    )!;
    enterprise.querySelector('input')!.click();
    await harness.fixture.whenStable();
    expect(store.settings().funds).toEqual(['enterprise', 'general']);
    expect(pressed(el)).toEqual([]);
    expect(el.textContent).toContain('Custom selection.');
  });

  it('the last selected fund cannot be unchecked', async () => {
    const { el } = await open('/?funds=general');
    const general = [...el.querySelectorAll<HTMLInputElement>('.fund-group input')][0];
    expect(general.checked).toBe(true);
    expect(general.disabled).toBe(true);
  });

  it('a preset button applies its funds (limited to those reported)', async () => {
    const { el, store } = await open('/');
    [...el.querySelectorAll<HTMLButtonElement>('.presets button')].find((b) => b.textContent?.includes('Governmental'))!.click();
    await harness.fixture.whenStable();
    expect(store.settings().funds).toEqual(['general', 'special_revenue']);
  });

  describe('Simple / Advanced fund filter (desktop pane)', () => {
    const toggle = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.mode-toggle')!;
    const checkboxes = (el: HTMLElement) => el.querySelector<HTMLElement>('#fund-checkboxes')!;
    const url = () => TestBed.inject(Router).url;

    beforeEach(() => localStorage.removeItem(FUNDS_MODE_KEY));
    afterEach(() => localStorage.removeItem(FUNDS_MODE_KEY));

    it('defaults to Simple: presets and the Includes line, no per-fund checkboxes', async () => {
      const { el } = await open('/');
      expect(toggle(el).textContent?.trim()).toBe('Advanced');
      expect(toggle(el).getAttribute('aria-expanded')).toBe('false');
      expect(toggle(el).getAttribute('aria-controls')).toBe('fund-checkboxes');
      expect(checkboxes(el).hidden).toBe(true);
      expect(el.querySelectorAll('.presets button').length).toBe(3);
      expect(el.textContent).toContain('Includes General, Special Revenue and Enterprise.');
    });

    it('toggles to Advanced and back, storing the choice, never in the URL', async () => {
      const { el } = await open('/');
      const before = url();
      toggle(el).click();
      await harness.fixture.whenStable();
      expect(checkboxes(el).hidden).toBe(false);
      expect(toggle(el).getAttribute('aria-expanded')).toBe('true');
      expect(toggle(el).textContent?.trim()).toBe('Simple');
      expect(localStorage.getItem(FUNDS_MODE_KEY)).toBe('advanced');
      toggle(el).click();
      await harness.fixture.whenStable();
      expect(checkboxes(el).hidden).toBe(true);
      expect(localStorage.getItem(FUNDS_MODE_KEY)).toBe('simple');
      expect(url()).toBe(before);
      expect(url()).not.toMatch(/mode|advanced|simple/i);
    });

    it('opens in the stored mode', async () => {
      localStorage.setItem(FUNDS_MODE_KEY, 'advanced');
      const { el } = await open('/');
      expect(checkboxes(el).hidden).toBe(false);
    });

    it('without storage (blocked): Simple, and the toggle still works for the page', async () => {
      const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      try {
        const { el } = await open('/');
        expect(checkboxes(el).hidden).toBe(true);
        toggle(el).click();
        await harness.fixture.whenStable();
        expect(checkboxes(el).hidden).toBe(false);
      } finally {
        spy.mockRestore();
        set.mockRestore();
      }
    });

    it('a custom selection (link or Back/Forward) shows Advanced, whatever is stored', async () => {
      localStorage.setItem(FUNDS_MODE_KEY, 'simple');
      const { el } = await open('/?funds=enterprise,general');
      expect(checkboxes(el).hidden).toBe(false);
      expect(el.textContent).toContain('Custom selection.');
    });

    it('Simple with a custom selection keeps it and says so; another custom selection opens Advanced again', async () => {
      const { el, store } = await open('/?funds=enterprise,general');
      toggle(el).click();
      await harness.fixture.whenStable();
      expect(checkboxes(el).hidden).toBe(true);
      expect(store.settings().funds).toEqual(['enterprise', 'general']);
      expect(el.textContent).toContain('Custom selection.');
      expect(el.querySelectorAll('.presets button').length).toBe(3);
      store.update({ funds: ['enterprise', 'special_revenue'] });
      await harness.fixture.whenStable();
      expect(checkboxes(el).hidden).toBe(false);
    });

    it('picking a preset in Simple applies it (checkboxes stay hidden)', async () => {
      const { el, store } = await open('/');
      [...el.querySelectorAll<HTMLButtonElement>('.presets button')].find((b) => b.textContent?.includes('General Fund'))!.click();
      await harness.fixture.whenStable();
      expect(store.settings().funds).toEqual(['general']);
      expect(checkboxes(el).hidden).toBe(true);
    });
  });

  it('category charts show the category picker and a link to the mapping table', async () => {
    let { el } = await open('/');
    expect(el.querySelector('#cats-label')).toBeNull();
    ({ el } = await open('/?chart=stacked'));
    expect(el.querySelector('#cats-label')).not.toBeNull();
    expect(el.querySelector('#category-mapping')?.textContent).toBe('Category mapping');
    const link = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('How account codes map'));
    expect(link).toBeDefined();
  });
});

describe('categoryMappingRows (D-19)', () => {
  const uas = (id: string) => ({
    id,
    publisher: 'DFS',
    title: `UAS ${id}`,
    url: `https://dfs.example/${id}`,
    retrieved: '2026-10-07',
    sha256: 'x',
    caveats: [],
  });
  const cats: CategoriesFile = [
    {
      id: 'ad_valorem',
      flow: 'revenue',
      label: 'Ad Valorem Taxes',
      sourceId: 'uas-2025',
      accountRanges: [{ from: '311', to: '311.999', uasReference: 'class 311.000, p. 38', sourceIds: ['uas-2025'] }],
    },
    {
      id: 'other_sources',
      flow: 'revenue',
      label: 'Other Sources',
      accountRanges: [
        { from: '380', to: '389.999', uasReference: 'class 38x', sourceIds: ['uas-2025'] },
        { from: '390', to: '399.999', toFiscalYear: 2021, uasReference: 'class 39x (2019-20)', sourceIds: ['uas-2019', 'uas-2011'] },
      ],
    },
    {
      id: 'proprietary_nonoperating_sources',
      flow: 'revenue',
      label: 'Proprietary Non-Operating Sources',
      accountRanges: [{ from: '390', to: '399.999', fromFiscalYear: 2022 }],
    },
    { id: 'public_safety', flow: 'expenditure', label: 'Public Safety', accountRanges: [{ from: '520', to: '529.999' }] },
  ];

  it('one row per range for the flow, in UAS order, with years, reference and sources', () => {
    const rows = categoryMappingRows(cats, 'revenue', [uas('uas-2025'), uas('uas-2019'), uas('uas-2011')]);
    expect(rows.map((r) => [r.category, r.accounts, r.years, r.reference])).toEqual([
      ['Ad Valorem Taxes', '311 to 311.999', 'All years', 'class 311.000, p. 38'],
      ['Other Sources', '380 to 389.999', 'All years', 'class 38x'],
      ['Other Sources', '390 to 399.999', 'Through FY 2020-21', 'class 39x (2019-20)'],
      ['Proprietary Non-Operating Sources', '390 to 399.999', 'FY 2021-22 onward', ''],
    ]);
    expect(rows[2].sources.map((s) => s.id)).toEqual(['uas-2019', 'uas-2011']);
    expect(categoryMappingRows(cats, 'expenditure', []).map((r) => r.category)).toEqual(['Public Safety']);
  });
});

describe('Privacy line (Cloudflare Web Analytics)', () => {
  async function render(token: string | null): Promise<HTMLElement> {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '', component: ControlsHostComponent }]),
        provideLocationMocks(),
        { provide: DataService, useClass: FakeDataService },
        ...(token === null ? [] : [{ provide: ANALYTICS_TOKEN, useValue: token }]),
      ],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/', ControlsHostComponent);
    await harness.fixture.whenStable();
    return harness.routeNativeElement as HTMLElement;
  }

  it('is absent in a build without a token (the default)', async () => {
    const el = await render(null);
    expect(el.textContent).not.toContain('Cloudflare Web Analytics');
  });

  it('states the analytics plainly when the build has a token', async () => {
    const el = await render('0123456789abcdef0123456789abcdef');
    expect(el.querySelector('.privacy')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'This site counts page views with Cloudflare Web Analytics. It sets no cookies and collects no personal information. Do Not Track and Global Privacy Control are respected.',
    );
  });
});

describe('Index to 100 on stacked, share and bars (QA-39)', () => {
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '', component: HostComponent }]),
        provideLocationMocks(),
        { provide: DataService, useClass: FakeDataService },
      ],
    });
    harness = await RouterTestingHarness.create();
  });

  async function open(url: string): Promise<ExplorerStore> {
    const host = await harness.navigateByUrl(url, HostComponent);
    await harness.fixture.whenStable();
    return host.store;
  }

  for (const chart of ['stacked', 'share', 'bars']) {
    it(`${chart}: the setting stays on, but everything shown uses values (no index)`, async () => {
      const store = await open(`/?chart=${chart}&idx=1&base=2019`);
      expect(store.settings().indexTo100).toBe(true);
      expect(store.indexNotShown()).toBe(true);
      expect(store.displaySettings().indexTo100).toBe(false);
      // The total the chart, table and KPIs use is dollars, not 100 at the base year.
      expect(store.chartTotal().map((p) => p.value)).toEqual([190, 190, 190]);
      const kpis = kpiCards(store.chartTotal(), store.displaySettings());
      expect(kpis[0].value).toContain('$');
      expect(measureCaption(store.displaySettings())).toBe('Nominal dollars');
      expect(store.drawerContent(2019, null, 'x')!.valueText).toBe('$190');
    });
  }

  it('line and lines by category show the index', async () => {
    for (const chart of ['line', 'lines']) {
      const store = await open(`/?chart=${chart}&idx=1&base=2019`);
      expect(store.indexNotShown()).toBe(false);
      expect(store.displaySettings()).toBe(store.settings());
      expect(store.chartTotal()[0].value).toBe(100);
      expect(measureCaption(store.displaySettings())).toContain('Index, FY 2018-19 = 100');
    }
  });

  it('unitPhrase names the unit for the note line', () => {
    const s = settingsWithDefaults('hillsborough', { baseYear: 2019 });
    expect(unitPhrase(s)).toBe('nominal dollars');
    expect(unitPhrase({ ...s, measure: 'real_per_capita' })).toBe('FY 2018-19 dollars per resident');
  });
});
