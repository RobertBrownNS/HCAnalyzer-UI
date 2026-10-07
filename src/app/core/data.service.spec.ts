import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { DATA_BASE_URL, DataService, ManifestFile } from './data.service';

const manifest: ManifestFile = { schemaVersion: 1, dataVersion: 'abc123', jurisdictions: ['hillsborough'], outputs: [] };

const files = {
  'hillsborough.observations.json': [
    {
      account: '311',
      amount: 100,
      category: 'ad_valorem',
      fiscalYear: 2006,
      flow: 'revenue',
      fundType: 'general',
      jurisdiction: 'hillsborough',
      ref: '2006!D6',
      section: 'taxes',
      sourceId: 'edr-afr-revenues-hillsborough',
    },
  ],
  'population.json': { hillsborough: { byYear: {}, sourceId: 'edr-population-flcopops' } },
  'cpi.json': { national: {}, tampa: {}, tampa_semiannual: {} },
  'annotations.json': [
    { fiscalYear: 2021, kind: 'methodology', label: 'Custodial fund reporting begins (GASB 84)', sourceId: 'edr-cntyfiscal-page' },
  ],
  'sources.json': [{ id: 'edr-cntyfiscal-page' }],
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

  /** Answers the manifest, then waits for the data requests and answers each one. */
  async function flushAll(): Promise<void> {
    http.expectOne(DATA_BASE_URL + 'manifest.json').flush(manifest);
    await Promise.resolve();
    await Promise.resolve();
    for (const [file, body] of Object.entries(files)) {
      http.expectOne(`${DATA_BASE_URL}${file}?v=abc123`).flush(body);
    }
  }

  it('starts idle with no data', () => {
    expect(service.status()).toBe('idle');
    expect(service.data()).toBeNull();
  });

  it('loads the manifest, then every file versioned by dataVersion', async () => {
    const done = service.load();
    expect(service.status()).toBe('loading');
    await flushAll();
    await done;

    expect(service.status()).toBe('ready');
    expect(service.ready()).toBe(true);
    expect(service.manifest()?.dataVersion).toBe('abc123');
    const data = service.data()!;
    expect(data.observations).toEqual(files['hillsborough.observations.json']);
    expect(data.population).toEqual(files['population.json']);
    expect(data.cpi).toEqual(files['cpi.json']);
    expect(data.annotations).toEqual(files['annotations.json']);
    expect(data.sources).toEqual(files['sources.json']);
  });

  it('requests the data only once for repeated load() calls', async () => {
    const a = service.load();
    const b = service.load();
    expect(a).toBe(b);
    await flushAll();
    await a;
    await service.load();
    http.expectNone(DATA_BASE_URL + 'manifest.json');
  });

  it('reports an error and allows a retry', async () => {
    const first = service.load();
    http.expectOne(DATA_BASE_URL + 'manifest.json').flush('nope', { status: 404, statusText: 'Not Found' });
    await first;
    expect(service.status()).toBe('error');
    expect(service.error()).toContain('404');
    expect(service.data()).toBeNull();

    const retry = service.load();
    await flushAll();
    await retry;
    expect(service.status()).toBe('ready');
  });
});
