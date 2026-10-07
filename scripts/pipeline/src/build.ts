/**
 * Builds the normalized JSON in src/assets/data/ from the raw files in data/raw/.
 * Deterministic: same raw bytes -> same output bytes (no timestamps; retrieval dates come
 * from data/raw/retrieval.json).
 *
 *   npm run build
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { averageOf, calendarYearMonths, fiscalYearAverage, type CpiSeriesConfig, type ParsedCpi } from './bls/cpi.js';
import type { AfrSheet } from './edr/afr.js';
import { toAccounts, toObservations } from './edr/observations.js';
import { selectPopulation } from './edr/population.js';
import { fiscalYearMonths } from './lib/fiscal.js';
import { sha256, stableStringify } from './lib/hash.js';
import { OUT_DIR, rel } from './lib/paths.js';
import { loadInputs, retrievalFor, type Inputs } from './inputs.js';
import { afrSource, countyFiscalPageSource, cpiSource, populationSource, sourceIds, type Source } from './sources.js';

export const SCHEMA_VERSION = 1;

interface Annotation {
  fiscalYear: number;
  label: string;
  kind: 'methodology' | 'policy' | 'event';
  sourceId: string;
}

/** Arrays of flat records: one JSON object per line, so git diffs stay readable. */
function stringifyRows(rows: unknown[]): string {
  if (!rows.length) return '[]\n';
  return '[\n' + rows.map((r) => stableStringify(r).trimEnd()).join(',\n') + '\n]\n';
}

function workbookTotals(sheets: AfrSheet[]) {
  return sheets
    .map((s) => ({
      fiscalYear: s.fiscalYear,
      flow: s.flow,
      sheet: s.sheetName,
      row: s.grandTotal.row,
      label: s.grandTotal.label,
      byFund: Object.fromEntries(Object.entries(s.grandTotal.cached).map(([k, v]) => [k, v ?? 0])),
      total: s.grandTotal.cachedTotal,
      perCapita: s.grandTotal.cachedPerCapita,
      population: s.population.value,
    }))
    .sort((a, b) => a.fiscalYear - b.fiscalYear);
}

function cpiEntry(config: CpiSeriesConfig, parsed: ParsedCpi): { entry: Record<string, unknown>; caveats: string[] } {
  const months = [...parsed.monthly.keys()].sort();
  const halves = [...parsed.semiannual.keys()].sort();
  const periods = months.length ? months : halves;
  const first = periods[0];
  const last = periods.at(-1)!;
  const firstYear = Number(first.slice(0, 4));
  const lastYear = Number(last.slice(0, 4));

  // Fiscal-year averages need sub-annual values that line up with Oct-Sep; only the monthly and
  // bimonthly series have them.
  const fiscalYear: Record<string, number> = {};
  const fiscalYearUnavailable: Record<string, string> = {};
  if (months.length) {
    for (let fy = firstYear; fy <= lastYear + 1; fy++) {
      if (!fiscalYearMonths(fy).some((ym) => parsed.monthly.has(ym) || parsed.missing.has(ym))) continue;
      const r = fiscalYearAverage(parsed, config, fy);
      if (r.ok) fiscalYear[String(fy)] = r.value;
      else fiscalYearUnavailable[String(fy)] = r.reason;
    }
  }

  const calendarYear: Record<string, number> = {};
  const calendarYearUnavailable: Record<string, string> = {};
  for (let y = firstYear; y <= lastYear; y++) {
    const published = parsed.annual.get(y);
    if (published !== undefined) calendarYear[String(y)] = published;
    else if (months.length) {
      const r = averageOf(parsed, config, calendarYearMonths(y));
      calendarYearUnavailable[String(y)] = r.ok ? 'BLS annual average not published' : `BLS annual average not published; ${r.reason}`;
    } else calendarYearUnavailable[String(y)] = 'BLS annual average not published';
  }

  const caveats = [`Series data in this file run from ${first} to ${last}.`];
  for (const [ym, why] of [...parsed.missing].sort()) caveats.push(`BLS published no value for ${ym}: ${why}.`);

  const fiscalYearBasis =
    config.frequency === 'monthly'
      ? 'Mean of the 12 monthly BLS values from October of the prior year through September, rounded to 3 decimals (computed by this pipeline).'
      : config.frequency === 'bimonthly'
        ? 'Mean of the 6 published bimonthly BLS values (Nov, Jan, Mar, May, Jul, Sep) in the fiscal year, rounded to 3 decimals (computed by this pipeline). The same method applied to calendar years does not reproduce the BLS-published annual averages for this area (it runs 0.06-0.29% lower in 2018-2025; see data/validation.md).'
        : 'Not available: semiannual periods (Jan-Jun, Jul-Dec) do not align with the Oct-Sep fiscal year.';

  return {
    caveats,
    entry: {
      seriesId: config.id,
      title: config.title,
      area: config.area,
      basePeriod: config.basePeriod,
      frequency: config.frequency,
      sourceId: sourceIds.cpi(config),
      monthly: Object.fromEntries(months.map((ym) => [ym, parsed.monthly.get(ym)!])),
      missingMonths: Object.fromEntries([...parsed.missing].sort()),
      semiannual: Object.fromEntries(halves.map((h) => [h, parsed.semiannual.get(h)!])),
      calendarYear,
      calendarYearBasis: `BLS-published annual average (period ${config.frequency === 'semiannual' ? 'S03' : 'M13'})`,
      calendarYearUnavailable,
      fiscalYear,
      fiscalYearBasis,
      fiscalYearUnavailable,
    },
  };
}

export function buildOutputs(inputs: Inputs): Map<string, string> {
  const files = new Map<string, string>();
  const sources: Source[] = [];
  const population: Record<string, unknown> = {};

  for (const { county, revenues, expenditures, population: pop } of inputs.counties) {
    const revId = sourceIds.afr(county, 'revenue');
    const expId = sourceIds.afr(county, 'expenditure');
    sources.push(afrSource(county, 'revenue', rel(revenues.file), retrievalFor(inputs.retrieval, revenues.file)));
    sources.push(afrSource(county, 'expenditure', rel(expenditures.file), retrievalFor(inputs.retrieval, expenditures.file)));

    const observations = [
      ...toObservations(county.slug, revenues.sheets, revId),
      ...toObservations(county.slug, expenditures.sheets, expId),
    ];
    files.set(`${county.slug}.observations.json`, stringifyRows(observations));
    files.set(`${county.slug}.accounts.json`, stringifyRows(toAccounts([...revenues.sheets, ...expenditures.sheets])));
    files.set(
      `${county.slug}.workbook-totals.json`,
      stringifyRows([...workbookTotals(revenues.sheets), ...workbookTotals(expenditures.sheets)]),
    );

    const { selected, alternates } = selectPopulation(pop);
    population[county.slug] = {
      sourceId: sourceIds.population,
      reference: 'April 1 of the year shown',
      fiscalYearAlignment:
        'EDR per-capita figures for fiscal year N (Oct 1, N-1 to Sep 30, N) use the April 1, N value.',
      byYear: Object.fromEntries(
        [...selected].map(([year, v]) => [String(year), { value: v.value, basis: v.basis, sheet: v.sheet }]),
      ),
      alternates: Object.fromEntries(
        [...alternates].map(([year, list]) => [
          String(year),
          list.map((v) => ({ value: v.value, basis: v.basis, sheet: v.sheet })),
        ]),
      ),
    };
  }

  sources.push(populationSource(rel(inputs.populationFile), retrievalFor(inputs.retrieval, inputs.populationFile)));
  sources.push(
    countyFiscalPageSource(rel(inputs.countyFiscalPageFile), retrievalFor(inputs.retrieval, inputs.countyFiscalPageFile)),
  );

  const cpi: Record<string, unknown> = {};
  for (const { config, file, parsed } of inputs.cpi) {
    const { entry, caveats } = cpiEntry(config, parsed);
    cpi[config.key] = entry;
    sources.push(cpiSource(config, rel(file), retrievalFor(inputs.retrieval, file), caveats));
  }

  const annotations: Annotation[] = [
    {
      fiscalYear: 2021,
      label: 'Custodial fund reporting begins (GASB 84)',
      kind: 'methodology',
      sourceId: sourceIds.countyFiscalPage,
    },
  ];

  files.set('population.json', stableStringify(population, 2));
  files.set('cpi.json', stableStringify(cpi, 2));
  files.set('annotations.json', stringifyRows(annotations));
  files.set('sources.json', stableStringify([...sources].sort((a, b) => a.id.localeCompare(b.id)), 2));

  const outputs = [...files]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, content]) => ({ path: name, sha256: sha256(content), bytes: Buffer.byteLength(content) }));
  const inputsList = Object.entries(inputs.retrieval.files)
    .map(([p, r]) => ({ path: p, sha256: r.sha256 }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    dataVersion: sha256(outputs.map((o) => `${o.path}:${o.sha256}`).join('\n')).slice(0, 16),
    generator: 'scripts/pipeline (npm run build)',
    jurisdictions: inputs.counties.map((c) => c.county.slug),
    inputs: inputsList,
    outputs,
  };
  files.set('manifest.json', stableStringify(manifest, 2));
  return files;
}

async function main() {
  const inputs = await loadInputs();
  const files = buildOutputs(inputs);
  mkdirSync(OUT_DIR, { recursive: true });
  for (const [name, content] of files) {
    writeFileSync(path.join(OUT_DIR, name), content);
    console.log(`wrote ${rel(path.join(OUT_DIR, name))} (${Buffer.byteLength(content).toLocaleString('en-US')} bytes)`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
