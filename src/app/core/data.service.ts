import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { AfrObservation, Annotation, CpiFile, PopulationFile, SourceRecord } from './models';
import { TransformData } from './transform';

/** manifest.json (fields the UI uses). */
export interface ManifestFile {
  schemaVersion: number;
  dataVersion: string;
  jurisdictions: string[];
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

/**
 * Loads the build-time JSON once and exposes it as signals. Files are requested with the
 * manifest's dataVersion as a query string so a new data build is never served from cache.
 */
@Injectable({ providedIn: 'root' })
export class DataService {
  private readonly http = inject(HttpClient);
  private loading?: Promise<void>;

  private readonly _status = signal<DataStatus>('idle');
  private readonly _error = signal<string | null>(null);
  private readonly _manifest = signal<ManifestFile | null>(null);
  private readonly _data = signal<TransformData | null>(null);

  readonly status = this._status.asReadonly();
  readonly error = this._error.asReadonly();
  readonly manifest = this._manifest.asReadonly();
  readonly data = this._data.asReadonly();
  readonly ready = computed(() => this._status() === 'ready');

  /** Starts loading on first call; later calls return the same promise. */
  load(jurisdiction = 'hillsborough'): Promise<void> {
    this.loading ??= this.fetchAll(jurisdiction);
    return this.loading;
  }

  private async fetchAll(jurisdiction: string): Promise<void> {
    this._status.set('loading');
    this._error.set(null);
    try {
      const manifest = await this.get<ManifestFile>('manifest.json');
      if (manifest?.schemaVersion !== SUPPORTED_SCHEMA_VERSION) throw new DataVersionError(manifest?.schemaVersion);
      const v = `?v=${encodeURIComponent(manifest.dataVersion)}`;
      const [observations, population, cpi, annotations, sources] = await Promise.all([
        this.get<AfrObservation[]>(`${jurisdiction}.observations.json${v}`),
        this.get<PopulationFile>(`population.json${v}`),
        this.get<CpiFile>(`cpi.json${v}`),
        this.get<Annotation[]>(`annotations.json${v}`),
        this.get<SourceRecord[]>(`sources.json${v}`),
      ]);
      this._manifest.set(manifest);
      this._data.set({ observations, population, cpi, annotations, sources });
      this._status.set('ready');
      performance.mark?.('fx:dataReady');
    } catch (err) {
      this._error.set((err as { message?: string } | null)?.message ?? String(err));
      this._status.set('error');
      this.loading = undefined; // allow a retry
    }
  }

  private get<T>(file: string): Promise<T> {
    return firstValueFrom(this.http.get<T>(DATA_BASE_URL + file));
  }
}
