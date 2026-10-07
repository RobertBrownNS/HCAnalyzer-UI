import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(here, '../../../..');
export const RAW_DIR = path.join(REPO_ROOT, 'data', 'raw');
/** Raw-file manifest: URL, publisher, retrieval date, sha256 and size of every file in data/raw/. */
export const RETRIEVAL_FILE = path.join(RAW_DIR, 'manifest.json');
export const OUT_DIR = path.join(REPO_ROOT, 'src', 'assets', 'data');
export const VALIDATION_REPORT = path.join(REPO_ROOT, 'data', 'validation.md');

/** Repo-relative path with forward slashes, for stable output on every OS. */
export function rel(p: string): string {
  return path.relative(REPO_ROOT, p).split(path.sep).join('/');
}

export function edrAfrPath(fileStem: string, flow: 'revenues' | 'expenditures'): string {
  return path.join(RAW_DIR, 'edr', `${fileStem}${flow}.xlsx`);
}

/** DFS Uniform Accounting System Manual, 2025 edition (category groupings). */
export const UAS_MANUAL_FILE = path.join(RAW_DIR, 'dfs', 'uas-manual-2025.pdf');

export const POPULATION_FILE = path.join(RAW_DIR, 'edr-population', 'FLcopops.xlsx');

export function blsPath(seriesId: string): string {
  return path.join(RAW_DIR, 'bls', `${seriesId}.json`);
}

/** Full LOGERX statewide downloads: local only, gitignored. */
export const LOGERX_CACHE_DIR = path.join(REPO_ROOT, 'data', 'cache', 'logerx');

export function logerxCachePath(reportName: string, fiscalYear: number): string {
  return path.join(LOGERX_CACHE_DIR, `${reportName}-${fiscalYear}.xlsx`);
}

/** Committed per-county extract of a LOGERX statewide report. */
export function logerxExtractPath(slug: string, flow: 'revenue' | 'expenditure', fiscalYear: number): string {
  return path.join(RAW_DIR, 'logerx', slug, `${flow === 'revenue' ? 'revenues' : 'expenditures'}-fy${fiscalYear}.csv`);
}

export function countyAfrPath(slug: string, fiscalYear: number): string {
  return path.join(RAW_DIR, 'county-afr', slug, `afr-fy${fiscalYear}.pdf`);
}
