/**
 * Downloads raw inputs into data/raw/ and records url / retrieval date / sha256 in
 * data/raw/manifest.json. This is the only non-deterministic step; `npm run build` works
 * offline from the committed raw files.
 *
 *   npm run fetch                      every raw file
 *   npm run fetch -- --county pinellas  only that county's files (shared files untouched)
 *   npm run fetch -- --logerx           only the DFS LOGERX reports and per-county extracts
 *   npm run fetch -- --logerx --use-cache  rebuild the extracts from data/cache/logerx (no network)
 *   npm run fetch -- --uas              only the DFS Uniform Accounting System manual
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { COUNTIES } from '../config/counties.js';
import { CPI_SERIES, type BlsResponse } from './bls/cpi.js';
import { sha256, stableStringify } from './lib/hash.js';
import ExcelJS from 'exceljs';
import { blsPath, countyAfrPath, edrAfrPath, LOGERX_CACHE_DIR, logerxCachePath, logerxExtractPath, POPULATION_FILE, RAW_DIR, rel, RETRIEVAL_FILE, UAS_MANUAL_FILE } from './lib/paths.js';
import { extractEntityCsv, LOGERX_PUBLIC_PAGE, LOGERX_REPORT_ENDPOINT, LOGERX_REPORTS, LOGERX_YEARS_ENDPOINT, parseStatewideReport } from './logerx/logerx.js';
import { UAS_MANUAL_URL, EDR, EDR_AFR_BASE, EDR_COUNTY_FISCAL_PAGE, EDR_COUNTY_FISCAL_PAGE_FILE, EDR_POPULATION_URL, type RetrievalRecord, type RetrievalLog } from './sources.js';

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

function saveLog(log: RetrievalLog) {
  const sorted: RetrievalLog = { files: Object.fromEntries(Object.entries(log.files).sort(([a], [b]) => a.localeCompare(b))) };
  writeFileSync(RETRIEVAL_FILE, stableStringify(sorted, 2));
  console.log(`wrote ${rel(RETRIEVAL_FILE)}`);
}

/**
 * Each file is written together with its manifest entry, and the manifest is saved even when a
 * later download fails, so data/raw/ never holds bytes the manifest doesn't describe. A failed
 * download leaves the previous file and entry untouched and makes the command exit non-zero.
 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Pause between LOGERX requests (each report takes the server about 10 s to build). */
const LOGERX_PAUSE_MS = 15_000;

async function fetchLogerxReport(reportName: string, fiscalYear: number): Promise<Buffer> {
  const res = await fetch(LOGERX_REPORT_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({ afrYear: fiscalYear, reportFormat: 'EXCEL', reportName }),
  });
  if (res.status !== 200) throw new Error(`LOGERX ${reportName} ${fiscalYear}: HTTP ${res.status} (stopping; possible rate limit)`);
  const body = (await res.json()) as { content?: string; mimeType?: string };
  if (!body?.content || !String(body.mimeType).includes('spreadsheetml')) throw new Error(`LOGERX ${reportName} ${fiscalYear}: no spreadsheet in response (stopping)`);
  return Buffer.from(body.content, 'base64');
}

/**
 * Downloads (or reads from the cache) each LOGERX statewide report, keeps the full file in the
 * gitignored cache, and writes one committed CSV extract per configured county. Stops at the first
 * failed request rather than retrying.
 */
async function fetchLogerx(log: RetrievalLog, useCache: boolean) {
  const counties = COUNTIES.filter((c) => c.logerxEntityCode);
  const yearsRes = await fetch(LOGERX_YEARS_ENDPOINT, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } });
  if (yearsRes.status !== 200) throw new Error(`LOGERX reportYears: HTTP ${yearsRes.status}`);
  const years = ((await yearsRes.json()) as number[]).filter((y) => Number.isInteger(y)).sort((a, b) => a - b);
  console.log(`LOGERX report years: ${years.join(', ')}`);
  mkdirSync(LOGERX_CACHE_DIR, { recursive: true });
  let first = true;
  for (const year of years) {
    for (const report of LOGERX_REPORTS) {
      const cache = logerxCachePath(report.name, year);
      let xlsx: Buffer;
      if (useCache && existsSync(cache)) xlsx = readFileSync(cache);
      else {
        if (!first) await sleep(LOGERX_PAUSE_MS);
        first = false;
        xlsx = await fetchLogerxReport(report.name, year);
        writeFileSync(cache, xlsx);
      }
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(xlsx as unknown as ArrayBuffer);
      const statewide = parseStatewideReport(wb, year, report.flow);
      for (const county of counties) {
        const { csv, rows } = extractEntityCsv(statewide, county.logerxEntityCode!);
        if (!rows) throw new Error(`LOGERX ${report.name} ${year}: no rows for ${county.name} (entity ${county.logerxEntityCode})`);
        record(log, logerxExtractPath(county.slug, report.flow, year), Buffer.from(csv), {
          url: LOGERX_PUBLIC_PAGE,
          publisher: 'Florida Department of Financial Services (DFS), Local Government Electronic Reporting (LOGERX)',
          method: `Public LOGERX "${report.label}" report (data DFS marks "Verified"), statewide, Excel; rows for entity ${county.logerxEntityCode} extracted verbatim, sorted, as CSV`,
          request: { endpoint: LOGERX_REPORT_ENDPOINT, body: { afrYear: year, reportFormat: 'EXCEL', reportName: report.name } },
          fullDownload: { cachePath: rel(cache), bytes: xlsx.length, sha256: sha256(xlsx) },
          entityCode: county.logerxEntityCode,
          rows,
          reportAsOf: statewide.asOf,
        });
      }
    }
  }
}

async function main() {
  const log = loadLog();
  mkdirSync(RAW_DIR, { recursive: true });
  const failures: string[] = [];
  const attempt = async (what: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      failures.push(`${what}: ${(err as Error).message}`);
      console.error(`FAILED   ${what}: ${(err as Error).message} (previous file kept)`);
    }
  };
  try {
    if (process.argv.includes('--logerx')) await fetchLogerx(log, process.argv.includes('--use-cache'));
    else if (process.argv.includes('--uas')) {
      await attempt(UAS_MANUAL_URL, async () =>
        record(log, UAS_MANUAL_FILE, await download(UAS_MANUAL_URL), {
          url: UAS_MANUAL_URL,
          publisher: 'Florida Department of Financial Services (DFS), Bureau of Financial Reporting',
          method: 'HTTP GET (PDF; 2025 edition, effective beginning FY 2024-25)',
        }),
      );
    }
    else await downloadAll(log, attempt);
  } finally {
    saveLog(log);
  }
  if (failures.length) {
    console.error(`\n${failures.length} download(s) failed; previous raw files were kept.`);
    process.exit(1);
  }
}

/** `--county <slug>` restricts the run to one county's own files. */
function countyFilter(): string | null {
  const i = process.argv.indexOf('--county');
  if (i < 0) return null;
  const slug = process.argv[i + 1];
  if (!COUNTIES.some((c) => c.slug === slug)) throw new Error(`--county ${slug}: not in config/counties.ts`);
  return slug;
}

async function downloadAll(log: RetrievalLog, attempt: (what: string, fn: () => Promise<void>) => Promise<void>) {
  const only = countyFilter();
  const counties = COUNTIES.filter((c) => !only || c.slug === only);
  for (const county of counties) {
    for (const flow of ['revenues', 'expenditures'] as const) {
      const url = `${EDR_AFR_BASE}${county.edrFileStem}${flow}.xlsx`;
      await attempt(url, async () => record(log, edrAfrPath(county.edrFileStem, flow), await download(url), { url, publisher: EDR, method: 'HTTP GET' }));
    }
  }
  for (const county of counties) {
    for (const f of county.countyAfr?.files ?? []) {
      await attempt(f.url, async () =>
        record(log, countyAfrPath(county.slug, f.fiscalYear), await download(f.url), {
          url: f.url,
          publisher: county.countyAfr!.publisher,
          method: 'HTTP GET (PDF; used only to cross-check EDR transcription)',
        }),
      );
    }
  }
  if (only) return;
  await attempt(EDR_POPULATION_URL, async () =>
    record(log, POPULATION_FILE, await download(EDR_POPULATION_URL), { url: EDR_POPULATION_URL, publisher: EDR, method: 'HTTP GET' }),
  );
  await attempt(EDR_COUNTY_FISCAL_PAGE, async () => record(log, EDR_COUNTY_FISCAL_PAGE_FILE, await download(EDR_COUNTY_FISCAL_PAGE), {
    url: EDR_COUNTY_FISCAL_PAGE,
    publisher: EDR,
    method: 'HTTP GET (HTML page saved for its data-use notice)',
  }));

  const endYear = new Date().getFullYear();
  for (const series of CPI_SERIES) await attempt(`BLS ${series.id}`, async () => {
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
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
