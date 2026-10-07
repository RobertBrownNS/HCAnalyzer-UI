import { existsSync, readFileSync } from 'node:fs';
import { COUNTIES, type CountyConfig } from '../config/counties.js';
import { CPI_SERIES, parseBlsResponses, type BlsResponse, type CpiSeriesConfig, type ParsedCpi } from './bls/cpi.js';
import { parseAfrWorkbook, type AfrSheet } from './edr/afr.js';
import { parseCountyPopulation, type PopulationValue } from './edr/population.js';
import { sha256File } from './lib/hash.js';
import { blsPath, countyAfrPath, edrAfrPath, logerxExtractPath, POPULATION_FILE, rel, RETRIEVAL_FILE } from './lib/paths.js';
import { readWorkbook } from './lib/xlsx.js';
import { EDR_COUNTY_FISCAL_PAGE_FILE, type RetrievalLog, type RetrievalRecord } from './sources.js';

/** Everything parsed from data/raw/, after checking each file against data/raw/manifest.json. */
export interface Inputs {
  retrieval: RetrievalLog;
  counties: Array<{
    county: CountyConfig;
    revenues: { file: string; sheets: AfrSheet[] };
    expenditures: { file: string; sheets: AfrSheet[] };
    population: PopulationValue[];
    countyAfrFiles: Array<{ fiscalYear: number; file: string }>;
    /** Committed LOGERX extracts (from data/raw/manifest.json), with their contents. */
    logerx: Array<{ fiscalYear: number; flow: 'revenue' | 'expenditure'; file: string; csv: string; record: RetrievalRecord }>;
  }>;
  populationFile: string;
  countyFiscalPageFile: string;
  cpi: Array<{ config: CpiSeriesConfig; file: string; parsed: ParsedCpi }>;
}

export function retrievalFor(log: RetrievalLog, file: string): RetrievalRecord {
  const r = log.files[rel(file)];
  if (!r) throw new Error(`${rel(file)} is not listed in ${rel(RETRIEVAL_FILE)}; run npm run fetch`);
  return r;
}

function verified(log: RetrievalLog, file: string): string {
  if (!existsSync(file)) throw new Error(`Missing raw input ${rel(file)}; run npm run fetch`);
  const expected = retrievalFor(log, file).sha256;
  const actual = sha256File(file);
  if (actual !== expected) {
    throw new Error(`${rel(file)} sha256 ${actual} does not match data/raw/manifest.json (${expected}). Re-run npm run fetch to record a new download.`);
  }
  return file;
}

/** Every LOGERX extract listed in the manifest for one county, verified and read. Needs no cache or network. */
function logerxExtracts(log: RetrievalLog, slug: string): Inputs['counties'][number]['logerx'] {
  const out: Inputs['counties'][number]['logerx'] = [];
  for (const key of Object.keys(log.files).sort()) {
    const m = new RegExp(`^data/raw/logerx/${slug}/(revenues|expenditures)-fy(\\d{4})\\.csv$`).exec(key);
    if (!m) continue;
    const flow = m[1] === 'revenues' ? 'revenue' : 'expenditure';
    const file = verified(log, logerxExtractPath(slug, flow, Number(m[2])));
    out.push({ fiscalYear: Number(m[2]), flow, file, csv: readFileSync(file, 'utf8'), record: log.files[key] });
  }
  return out;
}

export async function loadInputs(): Promise<Inputs> {
  const retrieval = JSON.parse(readFileSync(RETRIEVAL_FILE, 'utf8')) as RetrievalLog;
  const populationFile = verified(retrieval, POPULATION_FILE);
  const populationWb = await readWorkbook(populationFile);

  const counties: Inputs['counties'] = [];
  for (const county of COUNTIES) {
    const revFile = verified(retrieval, edrAfrPath(county.edrFileStem, 'revenues'));
    const expFile = verified(retrieval, edrAfrPath(county.edrFileStem, 'expenditures'));
    counties.push({
      county,
      revenues: { file: revFile, sheets: parseAfrWorkbook(await readWorkbook(revFile), 'revenue') },
      expenditures: { file: expFile, sheets: parseAfrWorkbook(await readWorkbook(expFile), 'expenditure') },
      population: parseCountyPopulation(populationWb, county.populationName),
      countyAfrFiles: (county.countyAfr?.files ?? []).map((f) => ({ fiscalYear: f.fiscalYear, file: verified(retrieval, countyAfrPath(county.slug, f.fiscalYear)) })),
      logerx: logerxExtracts(retrieval, county.slug),
    });
  }

  const cpi = CPI_SERIES.map((config) => {
    const file = verified(retrieval, blsPath(config.id));
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { requests: Array<{ response: BlsResponse }> };
    return { config, file, parsed: parseBlsResponses(config.id, raw.requests.map((r) => r.response)) };
  });

  return {
    retrieval,
    counties,
    populationFile,
    countyFiscalPageFile: verified(retrieval, EDR_COUNTY_FISCAL_PAGE_FILE),
    cpi,
  };
}
