/**
 * Downloads raw inputs into data/raw/ and records url / retrieval date / sha256 in
 * data/raw/manifest.json. This is the only non-deterministic step; `npm run build` works
 * offline from the committed raw files.
 *
 *   npm run fetch
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { COUNTIES } from '../config/counties.js';
import { CPI_SERIES, type BlsResponse } from './bls/cpi.js';
import { sha256, stableStringify } from './lib/hash.js';
import { blsPath, edrAfrPath, POPULATION_FILE, RAW_DIR, rel, RETRIEVAL_FILE } from './lib/paths.js';
import { EDR, EDR_AFR_BASE, EDR_COUNTY_FISCAL_PAGE, EDR_COUNTY_FISCAL_PAGE_FILE, EDR_POPULATION_URL, type RetrievalRecord, type RetrievalLog } from './sources.js';

const USER_AGENT = 'Mozilla/5.0 (compatible; fl-county-finance-explorer data pipeline)';
const BLS_API = 'https://api.bls.gov/publicAPI/v2/timeseries/data/';
/** BLS API v2 without a registration key returns at most 10 years per request. */
const BLS_YEARS_PER_REQUEST = 10;
const CPI_START_YEAR = 2000;

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function loadLog(): RetrievalLog {
  return existsSync(RETRIEVAL_FILE) ? (JSON.parse(readFileSync(RETRIEVAL_FILE, 'utf8')) as RetrievalLog) : { files: {} };
}

function record(log: RetrievalLog, file: string, bytes: Buffer, entry: Omit<RetrievalRecord, 'sha256' | 'retrieved' | 'lastVerified' | 'bytes'>) {
  const key = rel(file);
  const hash = sha256(bytes);
  const prev = log.files[key];
  const date = today();
  const unchanged = prev && prev.sha256 === hash;
  log.files[key] = { ...entry, sha256: hash, bytes: bytes.length, retrieved: unchanged ? prev.retrieved : date, lastVerified: date };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, bytes);
  console.log(`${unchanged ? 'unchanged' : 'UPDATED  '} ${key} ${hash.slice(0, 12)}`);
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function fetchBls(seriesId: string, startYear: number, endYear: number): Promise<BlsResponse> {
  const res = await fetch(BLS_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({ seriesid: [seriesId], startyear: String(startYear), endyear: String(endYear), annualaverage: true }),
  });
  if (!res.ok) throw new Error(`BLS ${seriesId} ${startYear}-${endYear}: HTTP ${res.status}`);
  const body = (await res.json()) as BlsResponse;
  if (body.status !== 'REQUEST_SUCCEEDED') throw new Error(`BLS ${seriesId}: ${body.status} ${body.message?.join('; ')}`);
  return body;
}

async function main() {
  const log = loadLog();
  mkdirSync(RAW_DIR, { recursive: true });

  for (const county of COUNTIES) {
    for (const flow of ['revenues', 'expenditures'] as const) {
      const url = `${EDR_AFR_BASE}${county.edrFileStem}${flow}.xlsx`;
      record(log, edrAfrPath(county.edrFileStem, flow), await download(url), { url, publisher: EDR, method: 'HTTP GET' });
    }
  }
  record(log, POPULATION_FILE, await download(EDR_POPULATION_URL), { url: EDR_POPULATION_URL, publisher: EDR, method: 'HTTP GET' });
  record(log, EDR_COUNTY_FISCAL_PAGE_FILE, await download(EDR_COUNTY_FISCAL_PAGE), {
    url: EDR_COUNTY_FISCAL_PAGE,
    publisher: EDR,
    method: 'HTTP GET (HTML page saved for its data-use notice)',
  });

  const endYear = new Date().getFullYear();
  for (const series of CPI_SERIES) {
    const requests: Array<{ startyear: number; endyear: number; response: BlsResponse }> = [];
    for (let start = CPI_START_YEAR; start <= endYear; start += BLS_YEARS_PER_REQUEST) {
      const end = Math.min(start + BLS_YEARS_PER_REQUEST - 1, endYear);
      requests.push({ startyear: start, endyear: end, response: await fetchBls(series.id, start, end) });
    }
    // responseTime varies per call and carries no data; drop it so unchanged data hashes the same.
    for (const r of requests) delete (r.response as { responseTime?: unknown }).responseTime;
    record(log, blsPath(series.id), Buffer.from(stableStringify({ seriesId: series.id, requests }, 1)), {
      url: BLS_API,
      publisher: 'U.S. Bureau of Labor Statistics (BLS)',
      method: `BLS Public Data API v2 (no registration key), POST {seriesid:["${series.id}"], annualaverage:true}, ${CPI_START_YEAR}-${endYear} in ${BLS_YEARS_PER_REQUEST}-year requests; responses stored as JSON without the responseTime field`,
    });
  }

  const sorted: RetrievalLog = { files: Object.fromEntries(Object.entries(log.files).sort(([a], [b]) => a.localeCompare(b))) };
  writeFileSync(RETRIEVAL_FILE, stableStringify(sorted, 2));
  console.log(`wrote ${rel(RETRIEVAL_FILE)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
