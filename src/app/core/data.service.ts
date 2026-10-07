import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { AfrObservation, Annotation, CpiFile, PopulationFile, SourceRecord } from './models';
import { TransformData } from './transform';

/** manifest.json (fields the UI uses). */
export interface ManifestFile {
  schemaVersion: number;
  dataVersion: string;
  /** Counties with data, as lowercase slugs (see manifest.json). */
  jurisdictions: string[];
  /** Display names, e.g. { pinellas: "Pinellas County" }. */
  jurisdictionNames?: Record<string, string>;
  outputs: { path: string; sha256: string; bytes: number }[];
}

/** Relative on purpose: resolves against <base href>, so the site works at a root or a sub-path. */
export const DATA_BASE_URL = 'assets/data/';

/** manifest.json schemaVersion this build understands. Bump together with the pipeline. */
export const SUPPORTED_SCHEMA_VERSION = 1;

export class DataVersionError extends Error {
  constructor(readonly found: unknown) {
    super(
      `The data files use schema version ${String(found)}, but this version of the site reads schema version ` +
        `${SUPPORTED_SCHEMA_VERSION}. The site and its data are out of step; reload the page, and if this persists ` +
        `the site needs to be rebuilt.`,
    );
    this.name = 'DataVersionError';
  }
}

export type DataStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Files every county view uses: loaded once. */
interface SharedData {
  population: PopulationFile;
  cpi: CpiFile;
  annotations: Annotation[];
  sources: SourceRecord[];
}

interface CountyEntry {
  status: DataStatus;
  error: string | null;
  observations: AfrObservation[] | null;
}

const IDLE: CountyEntry = { status: 'idle', error: null, observations: null };

/**
 * Loads the build-time JSON and exposes it as signals. Shared files (manifest, population, CPI,
 * annotations, sources) load once; each county's observations load the first time that county
 * is viewed and are kept. Files are requested with the manifest's dataVersion as a query string
 * so a new data build is never served from cache.
 */
@Injectable({ providedIn: 'root' })
export class DataService {
  private readonly http = inject(HttpClient);
  private sharedLoad?: Promise<void>;
  private readonly countyLoads = new Map<string, Promise<void>>();

  private readonly _sharedStatus = signal<DataStatus>('idle');
  private readonly _sharedError = signal<string | null>(null);
  private readonly _manifest = signal<ManifestFile | null>(null);
  private readonly _shared = signal<SharedData | null>(null);
  private readonly _counties = signal<Record<string, CountyEntry>>({});

  readonly manifest = this._manifest.asReadonly();
  /** Counties the data offers (empty until the manifest has loaded). */
  readonly counties = computed(() => this._manifest()?.jurisdictions ?? []);
  /** County display names from the manifest (empty until it has loaded). */
  readonly countyNames = computed<Record<string, string>>(() => this._manifest()?.jurisdictionNames ?? {});

  /** Loads the shared files. Later calls return the same promise; a failed load can be retried. */
  load(): Promise<void> {
    this.sharedLoad ??= this.fetchShared();
    return this.sharedLoad;
  }

  /** Loads one county's observations (after the shared files). Cached; a failed load can be retried. */
  loadCounty(county: string): Promise<void> {
    let p = this.countyLoads.get(county);
    if (!p) {
      p = this.fetchCounty(county);
      this.countyLoads.set(county, p);
    }
    return p;
  }

  /** Combined status of the shared files and one county. */
  statusFor(county: string): DataStatus {
    const shared = this._sharedStatus();
    if (shared === 'error') return 'error';
    const c = this._counties()[county]?.status ?? 'idle';
    if (c === 'error') return 'error';
    if (shared === 'ready' && c === 'ready') return 'ready';
    return shared === 'loading' || c === 'loading' ? 'loading' : 'idle';
  }

  errorFor(county: string): string | null {
    return this._sharedError() ?? this._counties()[county]?.error ?? null;
  }

  /** Everything the transform needs for one county, or null until it has loaded. */
  dataFor(county: string): TransformData | null {
    const shared = this._shared();
    const observations = this._counties()[county]?.observations;
    return shared && observations ? { ...shared, observations } : null;
  }

  private async fetchShared(): Promise<void> {
    this._sharedStatus.set('loading');
    this._sharedError.set(null);
    try {
      const manifest = await this.get<ManifestFile>('manifest.json');
      if (manifest?.schemaVersion !== SUPPORTED_SCHEMA_VERSION) throw new DataVersionError(manifest?.schemaVersion);
      const v = this.version(manifest);
      const [population, cpi, annotations, sources] = await Promise.all([
        this.get<PopulationFile>(`population.json${v}`),
        this.get<CpiFile>(`cpi.json${v}`),
        this.get<Annotation[]>(`annotations.json${v}`),
        this.get<SourceRecord[]>(`sources.json${v}`),
      ]);
      this._manifest.set(manifest);
      this._shared.set({ population, cpi, annotations, sources });
      this._sharedStatus.set('ready');
    } catch (err) {
      this._sharedError.set(message(err));
      this._sharedStatus.set('error');
      this.sharedLoad = undefined; // allow a retry
    }
  }

  private async fetchCounty(county: string): Promise<void> {
    this.setCounty(county, { ...IDLE, status: 'loading' });
    try {
      await this.load();
      const manifest = this._manifest();
      if (!manifest) throw new Error('The data index (manifest) is not available.');
      if (!manifest.jurisdictions.includes(county)) throw new Error(`No data for county "${county}".`);
      const observations = await this.get<AfrObservation[]>(`${county}.observations.json${this.version(manifest)}`);
      this.setCounty(county, { status: 'ready', error: null, observations });
      performance.mark?.('fx:dataReady');
    } catch (err) {
      this.setCounty(county, { status: 'error', error: message(err), observations: null });
      this.countyLoads.delete(county); // allow a retry
    }
  }

  private setCounty(county: string, entry: CountyEntry): void {
    this._counties.update((all) => ({ ...all, [county]: entry }));
  }

  private version(manifest: ManifestFile): string {
    return `?v=${encodeURIComponent(manifest.dataVersion)}`;
  }

  private get<T>(file: string): Promise<T> {
    return firstValueFrom(this.http.get<T>(DATA_BASE_URL + file));
  }
}

function message(err: unknown): string {
  return (err as { message?: string } | null)?.message ?? String(err);
}
