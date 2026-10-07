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

export const POPULATION_FILE = path.join(RAW_DIR, 'edr-population', 'FLcopops.xlsx');

export function blsPath(seriesId: string): string {
  return path.join(RAW_DIR, 'bls', `${seriesId}.json`);
}
