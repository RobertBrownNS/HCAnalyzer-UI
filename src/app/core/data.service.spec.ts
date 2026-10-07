import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { DATA_BASE_URL, DataService, ManifestFile, SUPPORTED_SCHEMA_VERSION } from './data.service';

const manifest: ManifestFile = {
  schemaVersion: SUPPORTED_SCHEMA_VERSION,
  dataVersion: 'abc123',
  jurisdictions: ['hillsborough', 'pinellas'],
  outputs: [],
};

const obs = (jurisdiction: string, amount: number) => [
  {
    account: '311',
    amount,
    category: 'ad_valorem',
    fiscalYear: 2006,
    flow: 'revenue',
    fundType: 'general',
    jurisdiction,
    ref: '2006!D6',
    section: 'taxes',
    sourceId: `edr-afr-revenues-${jurisdiction}`,
  },
];

const shared = {
  'population.json': { hillsborough: { byYear: {}, sourceId: 'pop' }, pinellas: { byYear: {}, sourceId: 'pop' } },
  'cpi.json': { national: {}, tampa: {}, tampa_semiannual: {} },
  'annotations.json': [{ fiscalYear: 2021, kind: 'methodology', label: 'Custodial fund reporting begins (GASB 84).', sourceId: 'p' }],
  'sources.json': [{ id: 'p' }],
};

const tick = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

describe('DataService', () => {
  let service: DataService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(DataService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function flushShared(): Promise<void> {
    http.expectOne(DATA_BASE_URL + 'manifest.json').flush(manifest);
    await tick();
    for (const [file, body] of Object.entries(shared)) http.expectOne(`${DATA_BASE_URL}${file}?v=abc123`).flush(body);
    await tick();
  }

  it('uses relative data URLs, so they resolve against <base href> (site root or a sub-path)', () => {
    expect(DATA_BASE_URL.startsWith('/')).toBe(false);
    expect(DATA_BASE_URL).not.toMatch(/^[a-z]+:/i);
  });

  it('starts idle with no data', () => {
    expect(service.statusFor('hillsborough')).toBe('idle');
    expect(service.dataFor('hillsborough')).toBeNull();
    expect(service.counties()).toEqual([]);
  });

  it('loads the shared files once, then a county\'s observations versioned by dataVersion', async () => {
    const done = service.loadCounty('hillsborough');
    expect(service.statusFor('hillsborough')).toBe('loading');
    await flushShared();
    http.expectOne(`${DATA_BASE_URL}hillsborough.observations.json?v=abc123`).flush(obs('hillsborough', 100));
    http.expectOne(`${DATA_BASE_URL}hillsborough.accounts.json?v=abc123`).flush([]);
    await done;

    expect(service.statusFor('hillsborough')).toBe('ready');
    expect(service.counties()).toEqual(['hillsborough', 'pinellas']);
    const data = service.dataFor('hillsborough')!;
    expect(data.observations[0].jurisdiction).toBe('hillsborough');
    expect(data.population).toEqual(shared['population.json']);
    expect(data.annotations).toEqual(shared['annotations.json']);
  });

  it('loads another county lazily, on first use only, without reloading the shared files', async () => {
    const h = service.loadCounty('hillsborough');
    await flushShared();
    http.expectOne(`${DATA_BASE_URL}hillsborough.observations.json?v=abc123`).flush(obs('hillsborough', 100));
    http.expectOne(`${DATA_BASE_URL}hillsborough.accounts.json?v=abc123`).flush([]);
    await h;

    // Pinellas hasn't been requested yet.
    http.expectNone(`${DATA_BASE_URL}pinellas.observations.json?v=abc123`);
    expect(service.statusFor('pinellas')).toBe('idle');

    const p = service.loadCounty('pinellas');
    expect(service.statusFor('pinellas')).toBe('loading');
    await tick();
    http.expectNone(DATA_BASE_URL + 'manifest.json');
    http.expectOne(`${DATA_BASE_URL}pinellas.observations.json?v=abc123`).flush(obs('pinellas', 50));
    http.expectOne(`${DATA_BASE_URL}pinellas.accounts.json?v=abc123`).flush([]);
    await p;
    expect(service.dataFor('pinellas')!.observations[0].jurisdiction).toBe('pinellas');
    // Hillsborough stays cached.
    expect(service.statusFor('hillsborough')).toBe('ready');
  });

  it('caches each county: switching back requests nothing', async () => {
    const a = service.loadCounty('hillsborough');
    const b = service.loadCounty('hillsborough');
    expect(a).toBe(b);
    await flushShared();
    http.expectOne(`${DATA_BASE_URL}hillsborough.observations.json?v=abc123`).flush(obs('hillsborough', 100));
    http.expectOne(`${DATA_BASE_URL}hillsborough.accounts.json?v=abc123`).flush([]);
    await a;
    await service.loadCounty('hillsborough');
    await tick();
    http.expectNone((req) => req.url.includes('observations'));
  });

  it('never requests a county the manifest does not list', async () => {
    const done = service.loadCounty('atlantis');
    await flushShared();
    await done;
    http.expectNone((req) => req.url.includes('atlantis'));
    expect(service.statusFor('atlantis')).toBe('error');
    expect(service.errorFor('atlantis')).toContain('No data for county');
  });

  it('rejects a manifest with an unsupported schemaVersion, with a clear message and no data requests', async () => {
    const done = service.loadCounty('hillsborough');
    http.expectOne(DATA_BASE_URL + 'manifest.json').flush({ ...manifest, schemaVersion: 99 });
    await done;
    expect(service.statusFor('hillsborough')).toBe('error');
    expect(service.errorFor('hillsborough')).toContain('schema version 99');
    expect(service.errorFor('hillsborough')).toContain(`schema version ${SUPPORTED_SCHEMA_VERSION}`);
    expect(service.dataFor('hillsborough')).toBeNull();
    http.expectNone((req) => req.url.includes('observations'));
  });

  it('reports a failed county load and allows a retry', async () => {
    const first = service.loadCounty('pinellas');
    await flushShared();
    http.expectOne(`${DATA_BASE_URL}pinellas.observations.json?v=abc123`).flush('nope', { status: 404, statusText: 'Not Found' });
    http.expectOne(`${DATA_BASE_URL}pinellas.accounts.json?v=abc123`).flush([]);
    await first;
    expect(service.statusFor('pinellas')).toBe('error');
    expect(service.errorFor('pinellas')).toContain('404');

    const retry = service.loadCounty('pinellas');
    await tick();
    http.expectOne(`${DATA_BASE_URL}pinellas.observations.json?v=abc123`).flush(obs('pinellas', 50));
    http.expectOne(`${DATA_BASE_URL}pinellas.accounts.json?v=abc123`).flush([]);
    await retry;
    expect(service.statusFor('pinellas')).toBe('ready');
  });

  it('reports a failed shared load for every county and allows a retry', async () => {
    const first = service.loadCounty('hillsborough');
    http.expectOne(DATA_BASE_URL + 'manifest.json').flush('nope', { status: 500, statusText: 'Server Error' });
    await first;
    expect(service.statusFor('hillsborough')).toBe('error');
    expect(service.statusFor('pinellas')).toBe('error');

    const retry = service.loadCounty('hillsborough');
    await flushShared();
    http.expectOne(`${DATA_BASE_URL}hillsborough.observations.json?v=abc123`).flush(obs('hillsborough', 100));
    http.expectOne(`${DATA_BASE_URL}hillsborough.accounts.json?v=abc123`).flush([]);
    await retry;
    expect(service.statusFor('hillsborough')).toBe('ready');
  });
});
