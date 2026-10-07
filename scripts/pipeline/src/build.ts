/**
 * Builds the normalized JSON in src/assets/data/ from the raw files in data/raw/.
 * Deterministic: same raw bytes -> same output bytes (no timestamps; retrieval dates come
 * from data/raw/manifest.json).
 *
 *   npm run build
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { averageOf, calendarYearMonths, fiscalYearAverage, type CpiSeriesConfig, type ParsedCpi } from './bls/cpi.js';
import type { AfrSheet } from './edr/afr.js';
import { generateAnomalies, type Annotation } from './edr/anomalies.js';
import { countyAfrNote } from './edr/county-afr-checks.js';
import { flowCrossCheck, preCoverageTransferNotes, reclassificationPairs, type FlowCrossCheck } from './logerx/crosscheck.js';
import { APPROVED_RECLASSIFICATIONS, APPROVED_TRANSFER_IMBALANCES, RESEARCH_NOTES } from '../config/approved-annotations.js';
import { APPROVED_GAPS } from '../config/approved-gaps.js';
import { toAccounts, toObservations } from './edr/observations.js';
import { CATEGORIES, rangeLabel } from './edr/categories.js';
import { FUND_METADATA, FUND_PRESETS } from './edr/funds.js';
import { selectPopulation } from './edr/population.js';
import { fiscalYearLabel, fiscalYearMonths } from './lib/fiscal.js';
import { sha256, stableStringify } from './lib/hash.js';
import { OUT_DIR, rel } from './lib/paths.js';
import { loadInputs, retrievalFor, type Inputs } from './inputs.js';
import { UAS_EDITIONS, uasManualSource, afrSource, countyAfrSource, countyFiscalPageSource, cpiSource, populationSource, sourceIds, type Source } from './sources.js';

export const SCHEMA_VERSION = 1;

/** Output files written once per county: <slug>.observations.json etc. */
export const PER_COUNTY_FILE = /^[a-z0-9-]+\.(observations|accounts|workbook-totals)\.json$/;


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

/**
 * Year-keyed CPI for one series. Every year in `coverYears` (the finance years) and every year
 * with data gets a key; years without a complete value are null, with the reason in
 * *Unavailable. Partial years are never averaged.
 */
function cpiEntry(
  config: CpiSeriesConfig,
  parsed: ParsedCpi,
  coverYears: [number, number],
  /** Calendar years with a value in another BLS series for the same area, and that series' id. */
  sibling?: { seriesId: string; years: Set<number> },
): { entry: Record<string, unknown>; caveats: string[] } {
  const months = [...parsed.monthly.keys()].sort();
  const halves = [...parsed.semiannual.keys()].sort();
  const periods = months.length ? months : halves;
  const first = periods[0];
  const last = periods.at(-1)!;
  const firstYear = Number(first.slice(0, 4));
  const lastYear = Number(last.slice(0, 4));
  const fromYear = Math.min(firstYear, coverYears[0]);
  const coverage = `this series (${config.id}) has data from ${first} to ${last}`;
  const siblingHint = (y: number) =>
    sibling?.years.has(y)
      ? `. BLS publishes a calendar-year average for this area (series ${sibling.seriesId}); select the calendar-year CPI period to use it`
      : '';

  // Fiscal-year averages need sub-annual values that line up with Oct-Sep; only the monthly and
  // bimonthly series have them.
  const fiscalYear: Record<string, number | null> = {};
  const fiscalYearUnavailable: Record<string, string> = {};
  for (let fy = fromYear; fy <= Math.max(lastYear, coverYears[1]); fy++) {
    const key = String(fy);
    const touches = fiscalYearMonths(fy).some((ym) => parsed.monthly.has(ym) || parsed.missing.has(ym));
    if (!months.length) {
      fiscalYear[key] = null;
      fiscalYearUnavailable[key] = 'semiannual series: periods do not align with the Oct-Sep fiscal year';
    } else if (!touches) {
      if (fy < coverYears[0] || fy > coverYears[1]) continue;
      fiscalYear[key] = null;
      fiscalYearUnavailable[key] = `no fiscal-year value: ${coverage}${siblingHint(fy)}`;
    } else {
      const r = fiscalYearAverage(parsed, config, fy);
      fiscalYear[key] = r.ok ? r.value : null;
      if (!r.ok) fiscalYearUnavailable[key] = `incomplete fiscal year, not averaged: ${r.reason}`;
    }
  }

  const calendarYear: Record<string, number | null> = {};
  const calendarYearNotes: Record<string, string> = {};
  const calendarYearUnavailable: Record<string, string> = {};
  for (let y = fromYear; y <= Math.max(lastYear, coverYears[1]); y++) {
    const key = String(y);
    const published = parsed.annual.get(y);
    if (published !== undefined) {
      calendarYear[key] = published;
      if (months.length) {
        const r = averageOf(parsed, config, calendarYearMonths(y));
        if (!r.ok) calendarYearNotes[key] = `BLS-published annual average, used as published; ${r.reason.replace(/^missing /, 'months not published: ')}`;
      }
      continue;
    }
    const hasData = y >= firstYear && y <= lastYear;
    if (!hasData && (y < coverYears[0] || y > coverYears[1])) continue;
    calendarYear[key] = null;
    if (!hasData) calendarYearUnavailable[key] = `no value: ${coverage}${siblingHint(y)}`;
    else if (months.length) {
      const r = averageOf(parsed, config, calendarYearMonths(y));
      calendarYearUnavailable[key] = `${r.ok ? 'BLS annual average not published' : `BLS annual average not published for this series; ${r.reason}`}${siblingHint(y)}`;
    } else calendarYearUnavailable[key] = `BLS annual average not published${siblingHint(y)}`;
  }

  const caveats = [`Series data in this file run from ${first} to ${last}.`];
  for (const [ym, why] of [...parsed.missing].sort()) caveats.push(`BLS published no value for ${ym}: ${why}.`);

  const fiscalYearBasis =
    config.frequency === 'monthly'
      ? 'Mean of the 12 monthly BLS values from October of the prior year through September, rounded to 3 decimals (computed by this pipeline).'
      : config.frequency === 'bimonthly'
        ? 'Mean of the 6 published bimonthly BLS values (Nov, Jan, Mar, May, Jul, Sep) in the fiscal year, rounded to 3 decimals (computed by this pipeline). The same method applied to calendar years does not reproduce the BLS-published annual averages for this area (it runs 0.06-0.29% lower in 2018-2025).'
        : 'Not available: semiannual periods (Jan-Jun, Jul-Dec) do not align with the Oct-Sep fiscal year.';

  return {
    caveats,
    entry: {
      seriesId: config.id,
      title: config.title,
      startPeriod: first,
      endPeriod: last,
      defaultAlignment: 'fiscalYear',
      alignmentRule:
        'Default deflator is the fiscal-year (Oct-Sep) average. Fiscal-year values are computed by this pipeline only when every month BLS publishes for this series in that fiscal year is present; otherwise the year has no value and the reason is given (no partial averages). Calendar-year values are BLS-published annual averages, used exactly as published, including any year BLS published despite a missing month (noted for that year). No values from another series are spliced in.',
      calendarYearNotes,
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

/** LOGERX / county-AFR cross-check per flow for one county. Shared by build and validate. */
export function countyCrossChecks(c: Inputs['counties'][number]): { revenue: FlowCrossCheck; expenditure: FlowCrossCheck } {
  const observations = [
    ...toObservations(c.county.slug, c.revenues.sheets, sourceIds.afr(c.county, 'revenue')),
    ...toObservations(c.county.slug, c.expenditures.sheets, sourceIds.afr(c.county, 'expenditure')),
  ];
  const firstChecked = c.logerx.length ? Math.min(...c.logerx.map((e) => e.fiscalYear)) : null;
  const approved = APPROVED_TRANSFER_IMBALANCES.filter((a) => a.jurisdiction === c.county.slug).map((a) => a.fiscalYear);
  return {
    revenue: flowCrossCheck(c.county.slug, 'revenue', c.revenues.sheets, observations, c.logerx, preCoverageTransferNotes(approved, firstChecked)),
    expenditure: flowCrossCheck(c.county.slug, 'expenditure', c.expenditures.sheets, observations, c.logerx, preCoverageTransferNotes(approved, firstChecked)),
  };
}

/** The one configured county marked `default: true`; anything else is a config error. */
export function defaultJurisdiction(counties: Array<{ slug: string; default?: boolean }>): string {
  const defaults = counties.filter((c) => c.default);
  if (defaults.length !== 1) throw new Error(`config/counties.ts: exactly one county must have default: true (found ${defaults.length})`);
  return defaults[0].slug;
}

/** DR-47: chart annotations for approved LOGERX/EDR classification differences, generated from the reconciliation. */
function reclassificationAnnotations(c: Inputs['counties'][number], rev: FlowCrossCheck, exp: FlowCrossCheck): Annotation[] {
  const names = new Map(toAccounts([...c.revenues.sheets, ...c.expenditures.sheets]).map((a) => [`${a.flow}|${a.account}`, a.name]));
  const fundLabel = (f: string) => FUND_METADATA.find((m) => m.id === f)?.label ?? f;
  return APPROVED_RECLASSIFICATIONS.filter((a) => a.jurisdiction === c.county.slug).map((a) => {
    const check = a.flow === 'revenue' ? rev : exp;
    const pair = check.reconciliations
      .filter((r) => r.fiscalYear === a.fiscalYear)
      .flatMap(reclassificationPairs)
      .find((p) => Math.abs(p.amount - a.amount) < 0.5);
    if (!pair) throw new Error(`Approved reclassification ${c.county.slug} ${a.flow} FY ${a.fiscalYear} $${a.amount} not found in the LOGERX reconciliation; review config/approved-annotations.ts`);
    const where = (x: { account: string; fundType: string }) => `account ${x.account} (${names.get(`${a.flow}|${x.account}`) ?? 'not in the EDR workbook'}), ${fundLabel(x.fundType)}`;
    const amount = `$${a.amount.toLocaleString('en-US')}`;
    const what = pair.edr.fundType !== pair.logerx.fundType && pair.edr.account === pair.logerx.account
      ? `under ${fundLabel(pair.edr.fundType)} in the EDR workbook and under ${fundLabel(pair.logerx.fundType)} in the county's filing`
      : `under account ${pair.edr.account} in the EDR workbook and under account ${pair.logerx.account} in the county's filing`;
    return {
      fiscalYear: a.fiscalYear,
      label: `${amount} reported ${what}`,
      kind: 'methodology' as const,
      topic: 'reconciliation-difference' as const,
      sourceId: sourceIds.afr(c.county, a.flow),
      jurisdiction: c.county.slug,
      flow: a.flow,
      ...(a.funds ? { funds: a.funds } : {}),
      ...(a.categories ? { categories: a.categories } : {}),
      accounts: [...new Set([pair.edr.account, pair.logerx.account])].sort((x, y) => Number(x) - Number(y)),
      detail:
        `${fiscalYearLabel(a.fiscalYear)} ${a.flow}s: ${amount} is in ${where(pair.edr)} in the EDR workbook (${pair.edr.ref}) and in ${where(pair.logerx)} in the Annual Financial Report data the county filed with the Florida Department of Financial Services (LOGERX). ` +
        'Yearly totals are equal in both sources; the explorer shows the EDR classification.',
      refs: [pair.edr.ref],
    };
  });
}

export function buildOutputs(inputs: Inputs): Map<string, string> {
  const files = new Map<string, string>();
  const sources: Source[] = [];
  const population: Record<string, unknown> = {};

  const generatedAnnotations: Annotation[] = [];
  const extraCaveats = new Map<string, string[]>();
  const sharedCaveats = new Map<string, Record<string, string[]>>();
  for (const { county, revenues, expenditures, population: pop, countyAfrFiles } of inputs.counties) {
    const revId = sourceIds.afr(county, 'revenue');
    const expId = sourceIds.afr(county, 'expenditure');
    const { revenue: revCheck, expenditure: expCheck } = countyCrossChecks(inputs.counties.find((c) => c.county.slug === county.slug)!);
    sources.push(afrSource(county, 'revenue', rel(revenues.file), retrievalFor(inputs.retrieval, revenues.file), revCheck));
    sources.push(afrSource(county, 'expenditure', rel(expenditures.file), retrievalFor(inputs.retrieval, expenditures.file), expCheck));

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
    for (const f of countyAfrFiles) {
      sources.push(countyAfrSource(county, f.fiscalYear, rel(f.file), retrievalFor(inputs.retrieval, f.file)));
    }
    const generated = generateAnomalies({
      jurisdiction: county.slug,
      revenues: revenues.sheets,
      expenditures: expenditures.sheets,
      revenueSourceId: revId,
      expenditureSourceId: expId,
      populationSourceId: sourceIds.population,
      population: { selected, alternates },
      countyAfrNote: (fy, topic) =>
        countyAfrFiles.some((x) => x.fiscalYear === fy) ? countyAfrNote(county.slug, fy, topic, `${county.name} Annual Financial Report for ${fiscalYearLabel(fy)}`) : undefined,
      approvedGaps: APPROVED_GAPS,
      approvedTransferImbalances: APPROVED_TRANSFER_IMBALANCES,
      researchNotes: RESEARCH_NOTES,
    });
    generatedAnnotations.push(...generated.annotations);
    generatedAnnotations.push(...reclassificationAnnotations(inputs.counties.find((c) => c.county.slug === county.slug)!, revCheck, expCheck));
    for (const [id, list] of generated.caveats) extraCaveats.set(id, [...(extraCaveats.get(id) ?? []), ...list]);
    for (const [id, list] of generated.sharedSourceCaveats) {
      const byCounty = sharedCaveats.get(id) ?? {};
      byCounty[county.slug] = [...(byCounty[county.slug] ?? []), ...list];
      sharedCaveats.set(id, byCounty);
    }
    population[county.slug] = {
      sourceId: sourceIds.population,
      reference: 'April 1 of the year shown',
      fiscalYearAlignment:
        'Fiscal year N (Oct 1, N-1 to Sep 30, N) uses the April 1, N value: the same population EDR used for the Per Capita column of each AFR sheet (checked for every fiscal year). Basis is the BEBR estimate published for that April 1, except 2010 (census count) and 2020 (revised BEBR estimate).',
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
  for (const { key, file } of inputs.uasManualFiles) {
    sources.push(uasManualSource(UAS_EDITIONS.find((e) => e.key === key)!, rel(file), retrievalFor(inputs.retrieval, file)));
  }
  files.set('categories.json', stringifyRows(CATEGORIES.map((c) => ({
    id: c.id,
    flow: c.flow,
    label: c.label,
    section: c.section,
    accountRanges: c.ranges.map(rangeLabel),
    sourceId: sourceIds.uasManual,
  }))));
  files.set('funds.json', stableStringify({
    sourceId: sourceIds.uasManual,
    funds: FUND_METADATA.map((f) => ({ id: f.id, label: f.label, group: f.group, description: f.description, ...(f.ownToggle ? { handledByToggle: 'custodial' } : {}) })),
    groups: [
      { id: 'governmental', label: 'Governmental funds' },
      { id: 'proprietary', label: 'Proprietary funds' },
      { id: 'fiduciary', label: 'Fiduciary funds' },
      { id: 'component_unit', label: 'Component units' },
    ],
    presets: FUND_PRESETS,
    note: 'Custodial amounts are controlled by the custodial toggle, so no preset lists the custodial fund.',
  }, 2));
  sources.push(
    countyFiscalPageSource(rel(inputs.countyFiscalPageFile), retrievalFor(inputs.retrieval, inputs.countyFiscalPageFile)),
  );

  const allFy = inputs.counties.flatMap((c) => [...c.revenues.sheets, ...c.expenditures.sheets].map((s) => s.fiscalYear));
  const financeYears: [number, number] = [Math.min(...allFy), Math.max(...allFy)];
  const cpi: Record<string, unknown> = {};
  for (const { config, file, parsed } of inputs.cpi) {
    const sib = config.key === 'tampa' ? inputs.cpi.find((c) => c.config.key === 'tampa_semiannual') : undefined;
    const { entry, caveats } = cpiEntry(
      config,
      parsed,
      financeYears,
      sib ? { seriesId: sib.config.id, years: new Set(sib.parsed.annual.keys()) } : undefined,
    );
    cpi[config.key] = entry;
    sources.push(cpiSource(config, rel(file), retrievalFor(inputs.retrieval, file), caveats));
  }

  const annotations: Annotation[] = [
    {
      fiscalYear: 2021,
      label: 'Custodial fund reporting begins (GASB 84).',
      kind: 'methodology' as const,
      topic: 'gasb84' as const,
      sourceId: sourceIds.countyFiscalPage,
    },
    ...generatedAnnotations,
  ].sort(
    (a, b) =>
      a.fiscalYear - b.fiscalYear ||
      (a.jurisdiction ?? '').localeCompare(b.jurisdiction ?? '') ||
      (a.flow ?? '').localeCompare(b.flow ?? '') ||
      a.label.localeCompare(b.label),
  );
  for (const src of sources) {
    const extra = extraCaveats.get(src.id);
    if (extra) src.caveats = [...src.caveats, ...extra];
    const byCounty = sharedCaveats.get(src.id);
    if (byCounty) src.caveatsByJurisdiction = byCounty;
  }

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
    jurisdictionNames: Object.fromEntries(inputs.counties.map((c) => [c.county.slug, c.county.name])),
    defaultJurisdiction: defaultJurisdiction(inputs.counties.map((c) => c.county)),
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
  // Per-county files for counties no longer configured would otherwise linger outside the manifest.
  for (const name of readdirSync(OUT_DIR)) {
    if (PER_COUNTY_FILE.test(name) && !files.has(name)) {
      rmSync(path.join(OUT_DIR, name));
      console.log(`removed stale ${rel(path.join(OUT_DIR, name))}`);
    }
  }
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
