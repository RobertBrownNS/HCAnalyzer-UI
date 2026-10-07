/**
 * Validates the built JSON against the raw workbooks and writes data/validation.md.
 * Exits non-zero if any check fails.
 *
 *   npm run validate
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { averageOf, calendarYearMonths, round3 } from './bls/cpi.js';
import { classifyAccount, normalizeHeading, SECTION_HEADINGS } from './edr/accounts.js';
import { CATEGORIES, categoriesFor } from './edr/categories.js';
import { FUND_METADATA } from './edr/funds.js';
import { colLetter, type AfrSheet } from './edr/afr.js';
import type { Observation } from './edr/observations.js';
import { buildOutputs, countyCrossChecks, PER_COUNTY_FILE } from './build.js';
import { crossCheckSourceProblems, reclassificationPairs } from './logerx/crosscheck.js';
import { APPROVED_RECLASSIFICATIONS } from '../config/approved-annotations.js';
import { indexComparisonSection } from './index-comparison.js';
import { APPROVED_GAPS } from '../config/approved-gaps.js';
import {
  ANNOTATION_TOPICS,
  findGaps,
  GAP_DROP,
  GAP_MAX_YEARS,
  GAP_MIN_BASELINE,
  scopeLabel,
  money,
  SWING_THRESHOLD,
  TRANSFER_IMBALANCE_THRESHOLD,
  transferBalances,
  yearOverYearSwings,
  type Annotation,
} from './edr/anomalies.js';
import { COUNTY_AFR_CHECKS } from './edr/county-afr-checks.js';
import { fiscalYearLabel } from './lib/fiscal.js';
import { sha256 } from './lib/hash.js';
import { OUT_DIR, rel, VALIDATION_REPORT } from './lib/paths.js';
import { NOT_CROSS_CHECKED_CAVEAT } from './sources.js';
import { readWorkbook } from './lib/xlsx.js';
import ExcelJS, { type Workbook } from 'exceljs';
import { loadInputs } from './inputs.js';

type Status = 'PASS' | 'FAIL' | 'NOTE';
interface Check {
  name: string;
  status: Status;
  detail: string;
}

/**
 * Differences that are understood and documented. Anything not listed here fails validation.
 * Key format is check-specific; see where each list is consulted.
 */
interface KnownPlacement {
  jurisdiction: string;
  flow: 'revenue' | 'expenditure';
  account: string;
  /** Section heading as printed. */
  heading: string;
  /** Exactly the fiscal years in which the account is printed under that heading. */
  fiscalYears: number[];
  note: string;
}

const KNOWN_SECTION_PLACEMENTS: KnownPlacement[] = [
  // EDR printed account 367 (Licenses) under the permits heading in these years; by its Uniform
  // Accounting System code it belongs to Miscellaneous Revenues (36x). The pipeline classifies by code.
  {
    jurisdiction: 'hillsborough', flow: 'revenue', account: '367', heading: 'Permits, Fees, and Special Assessments',
    fiscalYears: [2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019],
    note: 'Account 367 (Licenses) printed under "Permits, Fees, and Special Assessments" in FY 2009-10 to FY 2018-19; classified by code as miscellaneous.',
  },
  {
    jurisdiction: 'pinellas', flow: 'revenue', account: '367', heading: 'Permits, Fees, and Special Assessments',
    fiscalYears: [2010, 2011, 2013, 2014, 2015, 2016, 2017, 2018, 2019],
    note: 'Account 367 (Licenses) printed under "Permits, Fees, and Special Assessments" in FY 2009-10, FY 2010-11 and FY 2012-13 to FY 2018-19; classified by code as miscellaneous.',
  },
  // Account 313.5 (a franchise fee code in the 31x taxes group) printed under a 32x heading.
  {
    jurisdiction: 'pinellas', flow: 'revenue', account: '313.5', heading: 'Franchise Fees, Licenses, and Permits',
    fiscalYears: [2007],
    note: 'Account 313.5 printed under "Franchise Fees, Licenses, and Permits" in FY 2006-07; classified by code as taxes.',
  },
];

const KNOWN_CPI_DIFFERENCES: Record<string, string> = {
  'CUUSS35DSA0|2025': 'BLS published no October 2025 index values (footnote: data unavailable due to the 2025 lapse in appropriations). For 2025 the published S01 and S02 averages do not average to the published S03 annual value; S03 is used as published.',
};

interface CpiJson {
  fiscalYear: Record<string, number | null>;
  calendarYear: Record<string, number | null>;
  fiscalYearUnavailable: Record<string, string>;
  calendarYearUnavailable: Record<string, string>;
}

const tag2 = (slug: string, s: string) => `${slug}: ${s}`;

/**
 * Patterns that must not appear in text shown to users (QA-19): file names, repository paths,
 * dotted key paths, and snake_case / camelCase identifiers.
 */
export const INTERNAL_TEXT_PATTERNS: Array<[string, RegExp]> = [
  ['.json', /\.json\b/i],
  ['file extension', /\.(ts|md|xlsx|xls|pdf|html|cfm|csv)\b/i],
  ['repository path', /\b(scripts|src|data|docs|config|test)\//],
  ['dotted key path', /\b[a-z][A-Za-z0-9_]*\.[a-z][A-Za-z0-9_]*\b/],
  ['snake_case identifier', /\b[a-z]+_[a-z0-9_]+\b/],
  ['camelCase identifier', /\b[a-z]+[A-Z][A-Za-z]*\b/],
];

/** Text fields of the published JSON that the UI shows to users. */
function userFacingStrings(outDir: string): Array<{ where: string; text: string }> {
  const out: Array<{ where: string; text: string }> = [];
  const push = (where: string, text: unknown) => {
    if (typeof text === 'string') out.push({ where, text });
  };
  const cpi = JSON.parse(readFileSync(path.join(outDir, 'cpi.json'), 'utf8')) as Record<string, Record<string, unknown>>;
  for (const [key, e] of Object.entries(cpi)) {
    for (const f of ['title', 'area', 'basePeriod', 'alignmentRule', 'calendarYearBasis', 'fiscalYearBasis']) push(`cpi ${key} ${f}`, e[f]);
    for (const f of ['fiscalYearUnavailable', 'calendarYearUnavailable', 'calendarYearNotes', 'missingMonths']) {
      for (const [y, t] of Object.entries((e[f] ?? {}) as Record<string, string>)) push(`cpi ${key} ${f} ${y}`, t);
    }
  }
  for (const a of JSON.parse(readFileSync(path.join(outDir, 'annotations.json'), 'utf8')) as Annotation[]) {
    push(`annotation ${a.fiscalYear} ${a.topic} label`, a.label);
    push(`annotation ${a.fiscalYear} ${a.topic} detail`, a.detail);
  }
  for (const src of JSON.parse(readFileSync(path.join(outDir, 'sources.json'), 'utf8')) as Array<{ id: string; title: string; publisher: string; caveats: string[]; caveatsByJurisdiction?: Record<string, string[]>; crossCheckSummary?: string }>) {
    push(`source ${src.id} title`, src.title);
    push(`source ${src.id} publisher`, src.publisher);
    push(`source ${src.id} crossCheckSummary`, src.crossCheckSummary);
    src.caveats.forEach((c, i) => push(`source ${src.id} caveat ${i + 1}`, c));
    for (const [j, list] of Object.entries(src.caveatsByJurisdiction ?? {})) list.forEach((c, i) => push(`source ${src.id} ${j} caveat ${i + 1}`, c));
  }
  const pop = JSON.parse(readFileSync(path.join(outDir, 'population.json'), 'utf8')) as Record<string, Record<string, unknown>>;
  for (const [key, e] of Object.entries(pop)) {
    push(`population ${key} reference`, e['reference']);
    push(`population ${key} fiscalYearAlignment`, e['fiscalYearAlignment']);
  }
  return out;
}

/** Annotation refs: "revenues:2023!P124", "expenditures:2024!I29", "population:2010 Census!B31". */
const REF_PATTERN = /^(revenues|expenditures|population):([^!]+)!([A-Z]+\d+)$/;

/** [2006, 2007, 2008, 2011] -> "2006-2008, 2011" */
function ranges(years: number[]): string {
  const ys = [...new Set(years)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < ys.length; i++) {
    let j = i;
    while (j + 1 < ys.length && ys[j + 1] === ys[j] + 1) j++;
    out.push(i === j ? String(ys[i]) : `${ys[i]}-${ys[j]}`);
    i = j;
  }
  return out.join(', ');
}

const usd = (n: number) => (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
const decimals = (n: number) => (String(n).split('.')[1] ?? '').length;
const roundTo = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

function sumBy<T>(items: T[], f: (t: T) => number): number {
  // Amounts are whole dollars, so plain addition is exact well within Number.MAX_SAFE_INTEGER.
  return items.reduce((acc, t) => acc + f(t), 0);
}

async function main() {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string, note = false) =>
    checks.push({ name, status: note ? 'NOTE' : ok ? 'PASS' : 'FAIL', detail });
  const tables: string[] = [];

  const inputs = await loadInputs();

  // --- Output files are exactly what the pipeline produces from the raw inputs -------------
  const expected = buildOutputs(inputs);
  const stale: string[] = [];
  for (const [name, content] of expected) {
    const file = path.join(OUT_DIR, name);
    if (!existsSync(file) || readFileSync(file, 'utf8') !== content) stale.push(name);
  }
  add('Outputs match a fresh build (deterministic, up to date)', !stale.length,
    stale.length ? `differs: ${stale.join(', ')} - run npm run build` : `${expected.size} files in ${rel(OUT_DIR)} are byte-identical to a fresh in-memory build`);

  const manifest = JSON.parse(readFileSync(path.join(OUT_DIR, 'manifest.json'), 'utf8')) as {
    outputs: Array<{ path: string; sha256: string; bytes: number }>;
  };
  const badHash = manifest.outputs.filter((o) => {
    const file = path.join(OUT_DIR, o.path);
    return !existsSync(file) || sha256(readFileSync(file)) !== o.sha256;
  });
  const strayFiles = readdirSync(OUT_DIR).filter((n) => PER_COUNTY_FILE.test(n) && !expected.has(n));
  add('No per-county output files for counties that are not configured', !strayFiles.length, strayFiles.length ? strayFiles.join(', ') : 'none');

  add('manifest.json checksums', !badHash.length,
    badHash.length ? `mismatch: ${badHash.map((o) => o.path).join(', ')}` : `${manifest.outputs.length} output checksums verified`);

  for (const { county, revenues, expenditures } of inputs.counties) {
    const observations = JSON.parse(readFileSync(path.join(OUT_DIR, `${county.slug}.observations.json`), 'utf8')) as Observation[];
    const population = JSON.parse(readFileSync(path.join(OUT_DIR, 'population.json'), 'utf8'))[county.slug] as {
      byYear: Record<string, { value: number }>;
    };
    const tag = (s: string) => `${county.slug}: ${s}`;

    // --- Observation sanity --------------------------------------------------------------
    const keys = new Set<string>();
    const dupes: string[] = [];
    let nonFinite = 0;
    let nonInteger = 0;
    let zero = 0;
    for (const o of observations) {
      const k = `${o.fiscalYear}|${o.flow}|${o.account}|${o.fundType}`;
      if (keys.has(k)) dupes.push(k);
      keys.add(k);
      if (!Number.isFinite(o.amount)) nonFinite++;
      else if (!Number.isInteger(o.amount)) nonInteger++;
      if (o.amount === 0) zero++;
    }
    add(tag('No duplicate observation keys (FY, flow, account, fund)'), !dupes.length,
      dupes.length ? `${dupes.length} duplicates, e.g. ${dupes.slice(0, 3).join('; ')}` : `${observations.length.toLocaleString('en-US')} observations, all keys unique`);
    add(tag('No NaN / non-finite amounts'), nonFinite === 0, `${nonFinite} non-finite`);
    add(tag('Amounts are whole dollars'), nonInteger === 0, `${nonInteger} non-integer amounts`);
    const roundedYears: string[] = [];
    for (const fy of [...new Set(observations.map((o) => o.fiscalYear))].sort()) {
      for (const flow of ['revenue', 'expenditure'] as const) {
        const list = observations.filter((o) => o.fiscalYear === fy && o.flow === flow);
        const round = list.filter((o) => o.amount % 1000 === 0).length;
        if (list.length && round / list.length > 0.9) roundedYears.push(`${fiscalYearLabel(fy)} ${flow}s ${round}/${list.length}`);
      }
    }
    if (roundedYears.length) {
      add(tag('Years where more than 90% of amounts are whole thousands (reported rounded)'), true, roundedYears.join('; '), true);
    }
    add(tag('Zero cells omitted'), zero === 0, `${zero} zero-valued observations`);
    const missingFields = observations.filter((o) => !o.jurisdiction || !o.account || !o.category || !o.fundType || !o.sourceId || !o.ref);
    add(tag('Every observation has account, category, fund, source and cell reference'), !missingFields.length, `${missingFields.length} incomplete`);

    for (const [label, sheets] of [['revenue', revenues.sheets], ['expenditure', expenditures.sheets]] as const) {
      const flowTag = (s: string) => tag(`${label}s: ${s}`);

      // --- Years present ------------------------------------------------------------------
      const years = sheets.map((s) => s.fiscalYear).sort((a, b) => a - b);
      const gaps = years.slice(1).filter((y, i) => y !== years[i] + 1);
      add(flowTag('Fiscal years contiguous'), !gaps.length,
        `${fiscalYearLabel(years[0])} to ${fiscalYearLabel(years.at(-1)!)} (${years.length} sheets)${gaps.length ? `; gaps before ${gaps.join(', ')}` : ''}`);
      const obsYears = new Set(observations.filter((o) => o.flow === label).map((o) => o.fiscalYear));
      const missingYears = years.filter((y) => !obsYears.has(y));
      add(flowTag('Every sheet year has observations'), !missingYears.length, missingYears.length ? `missing ${missingYears.join(', ')}` : 'all years present');

      // --- Workbook internal consistency ----------------------------------------------------
      let rowCount = 0;
      const rowMismatch: string[] = [];
      const sectionMismatch: string[] = [];
      const grandMismatch: string[] = [];
      const placement = new Map<string, number[]>();
      const unknownHeadings = new Set<string>();
      const dupRows: string[] = [];
      for (const s of sheets) {
        const seen = new Set<string>();
        for (const a of s.accounts) {
          rowCount++;
          if (seen.has(a.account)) dupRows.push(`${s.sheetName}:${a.account}`);
          seen.add(a.account);
          const sum = sumBy(a.values, (v) => v.amount);
          if (a.cachedTotal === null || sum !== a.cachedTotal) rowMismatch.push(`${s.sheetName}!row ${a.row}: funds ${sum} vs total ${a.cachedTotal}`);
          const headingSection = SECTION_HEADINGS[normalizeHeading(a.sectionHeading)];
          if (!headingSection) unknownHeadings.add(a.sectionHeading);
          else if (!headingSection.includes(classifyAccount(s.flow, a.account, s.fiscalYear).section)) {
            const k = `${s.flow}|${a.account}|${a.sectionHeading}`;
            placement.set(k, [...(placement.get(k) ?? []), s.fiscalYear]);
          }
        }
        for (const sec of s.sections) {
          const rows = s.accounts.filter((a) => a.sectionHeading === sec.label && a.row > sec.row);
          for (const f of s.fundColumns) {
            const sum = sumBy(rows, (a) => a.values.find((v) => v.fundType === f.fundType)!.amount);
            if (sum !== (sec.cached[f.fundType] ?? 0)) sectionMismatch.push(`${s.sheetName} "${sec.label}" ${f.fundType}: ${sum} vs ${sec.cached[f.fundType]}`);
          }
          const total = sumBy(rows, (a) => sumBy(a.values, (v) => v.amount));
          if (total !== (sec.cachedTotal ?? 0)) sectionMismatch.push(`${s.sheetName} "${sec.label}" total: ${total} vs ${sec.cachedTotal}`);
        }
        for (const f of s.fundColumns) {
          const sum = sumBy(s.accounts, (a) => a.values.find((v) => v.fundType === f.fundType)!.amount);
          if (sum !== (s.grandTotal.cached[f.fundType] ?? 0)) grandMismatch.push(`${s.sheetName} ${f.fundType}: ${sum} vs ${s.grandTotal.cached[f.fundType]}`);
        }
        const sectionSum = sumBy(s.sections, (x) => x.cachedTotal ?? 0);
        if (sectionSum !== s.grandTotal.cachedTotal) grandMismatch.push(`${s.sheetName} sections ${sectionSum} vs grand ${s.grandTotal.cachedTotal}`);
      }
      add(flowTag('Account codes unique within each sheet'), !dupRows.length, dupRows.length ? dupRows.join(', ') : 'no repeated codes');
      add(flowTag('Each account row: sum of fund cells = workbook row total'), !rowMismatch.length,
        rowMismatch.length ? `${rowMismatch.length} mismatches, e.g. ${rowMismatch.slice(0, 3).join('; ')}` : `${rowCount.toLocaleString('en-US')} rows match exactly`);
      add(flowTag('Section subtotals = sum of their account rows (every fund + total)'), !sectionMismatch.length,
        sectionMismatch.length ? `${sectionMismatch.length} mismatches, e.g. ${sectionMismatch.slice(0, 3).join('; ')}` : `${sumBy(sheets, (s) => s.sections.length)} sections match exactly`);
      add(flowTag('"Total - All Account Codes" row = sum of account rows (every fund) and of section subtotals'), !grandMismatch.length,
        grandMismatch.length ? grandMismatch.slice(0, 5).join('; ') : `${sheets.length} sheets match exactly`);
      add(flowTag('Section headings recognized'), !unknownHeadings.size, unknownHeadings.size ? [...unknownHeadings].join('; ') : 'all headings mapped');

      const unexplained: string[] = [];
      for (const [k, fys] of placement) {
        const [flow, account, heading] = k.split('|');
        const years = [...fys].sort((a, b) => a - b);
        const known = KNOWN_SECTION_PLACEMENTS.find(
          (p) => p.jurisdiction === county.slug && p.flow === flow && p.account === account && p.heading === heading &&
            p.fiscalYears.length === years.length && p.fiscalYears.every((y, i) => y === years[i]),
        );
        if (known) add(flowTag('Account placed outside its code\'s section (documented)'), true, known.note, true);
        else unexplained.push(`${k} in FY ${years.join(',')}`);
      }
      const unused = KNOWN_SECTION_PLACEMENTS.filter(
        (p) => p.jurisdiction === county.slug && p.flow === label && !placement.has(`${p.flow}|${p.account}|${p.heading}`),
      );
      for (const p of unused) unexplained.push(`documented exception no longer present: ${p.account} under "${p.heading}"`);
      add(flowTag('Code-based category agrees with the workbook section heading'), !unexplained.length,
        unexplained.length ? unexplained.join('; ') : 'all rows agree (documented exceptions noted separately)');

      // --- Emitted observations vs workbook totals, per fiscal year -------------------------
      const rows: string[] = [];
      const totalFails: string[] = [];
      const custodialFails: string[] = [];
      const fundFails: string[] = [];
      const popFails: string[] = [];
      const perCapitaFails: string[] = [];
      for (const s of [...sheets].sort((a: AfrSheet, b: AfrSheet) => a.fiscalYear - b.fiscalYear)) {
        const obs = observations.filter((o) => o.flow === label && o.fiscalYear === s.fiscalYear);
        const parsed = sumBy(obs, (o) => o.amount);
        const wbTotal = s.grandTotal.cachedTotal ?? NaN;
        if (parsed !== wbTotal) totalFails.push(`${s.fiscalYear}: ${parsed} vs ${wbTotal}`);
        for (const f of s.fundColumns) {
          const fundSum = sumBy(obs.filter((o) => o.fundType === f.fundType), (o) => o.amount);
          if (fundSum !== (s.grandTotal.cached[f.fundType] ?? 0)) fundFails.push(`${s.fiscalYear} ${f.fundType}: ${fundSum} vs ${s.grandTotal.cached[f.fundType]}`);
        }
        const hasCustodialCol = s.fundColumns.some((f) => f.fundType === 'custodial');
        const custodialCached = hasCustodialCol ? (s.grandTotal.cached['custodial'] ?? 0) : 0;
        const exclParsed = sumBy(obs.filter((o) => o.fundType !== 'custodial'), (o) => o.amount);
        const recalcA = wbTotal - custodialCached;
        const recalcB = sumBy(s.fundColumns.filter((f) => f.fundType !== 'custodial'), (f) => s.grandTotal.cached[f.fundType] ?? 0);
        const custodialObs = obs.filter((o) => o.fundType === 'custodial').length;
        if (exclParsed !== recalcA || exclParsed !== recalcB) custodialFails.push(`${s.fiscalYear}: ${exclParsed} vs ${recalcA} / ${recalcB}`);
        if (!hasCustodialCol && custodialObs) custodialFails.push(`${s.fiscalYear}: custodial observations in a year without the column`);
        if (hasCustodialCol !== s.fiscalYear >= 2021) custodialFails.push(`${s.fiscalYear}: custodial column ${hasCustodialCol ? 'present' : 'absent'}`);

        const popJson = population.byYear[String(s.fiscalYear)]?.value;
        if (popJson !== s.population.value) popFails.push(`${s.fiscalYear}: workbook ${s.population.value} vs population.json ${popJson}`);
        const pc = s.grandTotal.cachedPerCapita ?? NaN;
        if (Math.abs(pc - wbTotal / s.population.value) > 1e-6) perCapitaFails.push(`${s.fiscalYear}: ${pc} vs ${wbTotal / s.population.value}`);

        rows.push(`| ${fiscalYearLabel(s.fiscalYear)} | ${obs.length} | ${usd(parsed)} | ${usd(wbTotal)} | ${usd(parsed - wbTotal)} | ${hasCustodialCol ? usd(custodialCached) : 'n/a (no column)'} | ${usd(exclParsed)} | ${usd(recalcA)} | ${usd(exclParsed - recalcA)} | ${s.population.value.toLocaleString('en-US')} | ${popJson === s.population.value ? 'match' : 'MISMATCH'} |`);
      }
      add(flowTag('Sum of observations = workbook Total Account, every FY (to the cent)'), !totalFails.length, totalFails.length ? totalFails.join('; ') : `${sheets.length} fiscal years match exactly`);
      add(flowTag('Sum of observations per fund = workbook total row per fund, every FY'), !fundFails.length, fundFails.length ? fundFails.slice(0, 5).join('; ') : 'all fund columns match exactly');
      add(flowTag('Excluding custodial: observations = EDR recalculation (Total Account minus Custodial column = sum of remaining fund columns)'), !custodialFails.length,
        custodialFails.length ? custodialFails.join('; ') : 'all years match exactly; custodial column present exactly for FY 2020-21 onward');
      add(flowTag('Workbook population = population.json (selected April 1 value)'), !popFails.length, popFails.length ? popFails.join('; ') : 'all years match');
      add(flowTag('Workbook per-capita total = Total Account / population (tolerance 1e-6 $/person)'), !perCapitaFails.length, perCapitaFails.length ? perCapitaFails.join('; ') : 'all years within 1e-6');

      tables.push(
        `### ${county.name} - ${label}s\n\n` +
          `| Fiscal year | Observations | Sum of observations | Workbook Total Account | Diff | Workbook Custodial column | Observations excl. custodial | EDR recalculated total (Total - Custodial) | Diff | Workbook population | population.json |\n` +
          `|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|\n` +
          rows.join('\n') + '\n',
      );
    }
  }

  // --- CPI ------------------------------------------------------------------------------
  const cpiRows: string[] = [];
  const byKey = new Map(inputs.cpi.map((c) => [c.config.key, c]));
  const matchesAtPrecision = (computed: number, published: number) =>
    roundTo(computed, Math.max(decimals(published), 1)) === published || round3(computed) === published;

  for (const { config, parsed } of inputs.cpi) {
    const tag = (s: string) => `CPI ${config.id}: ${s}`;
    const mismatches: string[] = [];
    const diffs: string[] = [];
    let compared = 0;
    for (const [year, published] of [...parsed.annual].sort((a, b) => a[0] - b[0])) {
      if (config.frequency === 'semiannual') {
        const h1 = parsed.semiannual.get(`${year}-H1`);
        const h2 = parsed.semiannual.get(`${year}-H2`);
        if (h1 === undefined || h2 === undefined) continue;
        const mean = (h1 + h2) / 2;
        // Halves and annual are each rounded from unrounded data, so allow one unit in the last place.
        const ok = Math.abs(mean - published) <= 10 ** -Math.max(decimals(published), decimals(h1), decimals(h2), 1) + 1e-9;
        const known = KNOWN_CPI_DIFFERENCES[`${config.id}|${year}`];
        compared++;
        if (!ok && known) add(tag(`${year} annual average differs from mean of halves (documented)`), true, `mean ${round3(mean)} vs BLS ${published}. ${known}`, true);
        else if (!ok) mismatches.push(`${year}: mean of halves ${round3(mean)} vs BLS ${published}`);
        cpiRows.push(`| ${config.id} | ${year} | 2 halves | ${round3(mean)} | ${published} | ${ok ? 'match' : known ? 'differs (documented)' : 'MISMATCH'} |`);
        continue;
      }
      const r = averageOf(parsed, config, calendarYearMonths(year));
      if (!r.ok) {
        add(tag('Annual average with missing months'), true, `${year}: BLS annual average ${published} published although ${r.reason}; used as published`, true);
        continue;
      }
      compared++;
      const ok = matchesAtPrecision(r.value, published);
      if (!ok) {
        if (config.frequency === 'bimonthly') diffs.push(`${year}: ${r.value} vs ${published} (${(((r.value - published) / published) * 100).toFixed(2)}%)`);
        else mismatches.push(`${year}: mean ${r.value} vs BLS ${published}`);
      }
      cpiRows.push(`| ${config.id} | ${year} | ${r.months.length} | ${r.value} | ${published} | ${ok ? 'match' : config.frequency === 'bimonthly' ? 'differs (expected, see note)' : 'MISMATCH'} |`);
    }
    if (config.frequency !== 'bimonthly') add(tag(config.frequency === 'semiannual'
      ? 'Mean of the two semiannual averages = BLS annual average (within rounding: one unit in the last published decimal)'
      : 'Mean of published months reproduces BLS annual average (the method used for fiscal-year values)'),
      !mismatches.length,
      mismatches.length ? mismatches.join('; ') : `${compared - diffs.length} of ${compared} complete years match at BLS precision`);
    if (diffs.length) {
      add(tag('Bimonthly mean vs BLS annual average (expected difference)'), true,
        `The mean of the 6 published bimonthly values does not reproduce the BLS-published annual average for this area (BLS does not derive it from the published bimonthly values alone): ${diffs.join('; ')}. Fiscal-year values for this series use the 6-value mean and carry this caveat.`, true);
    }
    const nonFinite = [...parsed.monthly.values(), ...parsed.semiannual.values(), ...parsed.annual.values()].filter((v) => !Number.isFinite(v) || v <= 0).length;
    add(tag('All values finite and positive'), nonFinite === 0, `${parsed.monthly.size} monthly, ${parsed.semiannual.size} semiannual, ${parsed.annual.size} annual values; ${nonFinite} invalid`);
    const missing = [...parsed.missing].map(([ym, why]) => `${ym}: ${why}`);
    if (missing.length) add(tag('Months BLS did not publish'), true, missing.join('; '), true);
  }

  const tampa = byKey.get('tampa');
  const tampaSemi = byKey.get('tampa_semiannual');
  if (tampa && tampaSemi) {
    const overlap = [...tampa.parsed.annual.keys()].filter((y) => tampaSemi.parsed.annual.has(y));
    const bad = overlap.filter((y) => tampa.parsed.annual.get(y) !== tampaSemi.parsed.annual.get(y));
    add('CPI Tampa: annual averages identical in the bimonthly (M13) and semiannual (S03) series', !bad.length && overlap.length > 0,
      bad.length ? `differ in ${bad.join(', ')}` : `${overlap.length} overlapping years (${Math.min(...overlap)}-${Math.max(...overlap)}) identical`);
  }

  const cpiJson = JSON.parse(readFileSync(path.join(OUT_DIR, 'cpi.json'), 'utf8')) as Record<string, CpiJson>;
  const finYears = inputs.counties.flatMap((c) => [...c.revenues.sheets, ...c.expenditures.sheets].map((s) => s.fiscalYear));
  const [minFy, maxFy] = [Math.min(...finYears), Math.max(...finYears)];
  const gapsIn = (series: Record<string, number | null> | undefined) => {
    const out: number[] = [];
    for (let y = minFy; y <= maxFy; y++) if (series?.[String(y)] == null) out.push(y);
    return out;
  };
  for (const [key, entry] of Object.entries(cpiJson)) {
    const unexplained: string[] = [];
    for (const kind of ['fiscalYear', 'calendarYear'] as const) {
      const reasons = entry[`${kind}Unavailable`];
      for (let y = minFy; y <= maxFy; y++) if (!(String(y) in entry[kind])) unexplained.push(`${kind} ${y} has no key`);
      for (const [y, v] of Object.entries(entry[kind])) if (v === null && !reasons[y]) unexplained.push(`${kind} ${y} null without reason`);
      for (const y of Object.keys(reasons)) if (entry[kind][y] !== null) unexplained.push(`${kind} ${y} has a reason but a value`);
    }
    add(`CPI ${key}: every finance year has a key; null years carry a reason (no partial averages, no splicing)`, !unexplained.length,
      unexplained.length ? unexplained.join('; ') : `FY ${minFy}-${maxFy} keyed`);
  }
  const natFy = gapsIn(cpiJson['national']?.fiscalYear);
  add(`CPI national: fiscal-year average for every finance year (FY ${minFy}-${maxFy})`, !natFy.length, natFy.length ? `null for ${natFy.join(', ')}` : 'complete');
  const natCy = gapsIn(cpiJson['national']?.calendarYear);
  add(`CPI national: calendar-year average for every finance year (${minFy}-${maxFy})`, !natCy.length, natCy.length ? `null for ${natCy.join(', ')}` : 'complete');
  const tampaCy = gapsIn(cpiJson['tampa_semiannual']?.calendarYear);
  add(`CPI Tampa: calendar-year average (semiannual series) for every finance year (${minFy}-${maxFy})`, !tampaCy.length, tampaCy.length ? `null for ${tampaCy.join(', ')}` : 'complete');
  const tampaFy = Object.entries(cpiJson['tampa']?.fiscalYear ?? {}).filter(([, v]) => v !== null).map(([y]) => Number(y));
  add('CPI Tampa: fiscal-year coverage', true,
    `fiscal-year values exist for FY ${Math.min(...tampaFy)}-${Math.max(...tampaFy)} only; earlier finance years are null with a reason. The bimonthly series starts Nov 2017; before that BLS published only semiannual averages, which do not align with Oct-Sep`, true);

  // --- County-filed AFR cross-check (QA-01) ----------------------------------------------
  const afrRows: string[] = [];
  for (const { county, countyAfrFiles } of inputs.counties) {
    const obs = JSON.parse(readFileSync(path.join(OUT_DIR, `${county.slug}.observations.json`), 'utf8')) as Observation[];
    const checksHere = COUNTY_AFR_CHECKS.filter((c) => c.jurisdiction === county.slug);
    const bad: string[] = [];
    for (const c of checksHere) {
      const file = countyAfrFiles.find((f) => f.fiscalYear === c.fiscalYear);
      const matching = obs.filter(
        (x) => x.fiscalYear === c.fiscalYear && x.flow === c.flow && x.fundType === c.fundType && (c.account === '*' || x.account === c.account),
      );
      // Zero cells are not emitted, so no observation means $0 in the workbook.
      const edr = sumBy(matching, (x) => x.amount);
      const afr = sumBy(c.lines, (l) => l.amount);
      const ok = !!file && edr === afr;
      const edrRef = c.account === '*' ? `sum of ${matching.length} cells` : (matching[0]?.ref ?? 'no non-zero cell');
      if (!ok) bad.push(`${c.fiscalYear} ${c.flow} ${c.account} ${c.fundType}: county AFR ${afr} vs EDR ${edr}${file ? '' : ' (PDF not in data/raw)'}`);
      afrRows.push(`| ${fiscalYearLabel(c.fiscalYear)} | ${c.flow} | ${c.account === '*' ? 'all accounts' : c.account} | ${c.fundType} | ${file ? `\`${rel(file.file)}\`` : 'missing'} p. ${c.page} | ${c.lines.length ? c.lines.map((l) => `${l.label}: ${usd(l.amount)}`).join('<br>') : 'no line for this account and fund'} | ${usd(afr)} | ${edrRef} ${usd(edr)} | ${ok ? 'match' : 'MISMATCH'} |`);
    }
    if (checksHere.length) {
      add(tag2(county.slug, 'County-filed AFR (PDF) lines = EDR workbook cells'), !bad.length,
        bad.length ? bad.join('; ') : `${checksHere.length} values checked in ${new Set(checksHere.map((c) => c.fiscalYear)).size} county AFR filings; EDR matches what the county filed`);
    }
  }

  // --- Interfund transfer balance and year-over-year swings (QA-01) ------------------------
  const transferRows: string[] = [];
  const swingRows: string[] = [];
  for (const { county, revenues, expenditures } of inputs.counties) {
    const balances = transferBalances(revenues.sheets, expenditures.sheets);
    for (const b of balances) {
      transferRows.push(`| ${county.slug} | ${fiscalYearLabel(b.fiscalYear)} | ${usd(b.transfersIn)} | ${usd(b.transfersOut)} | ${usd(b.difference)} | ${b.flagged ? 'over threshold' : ''} |`);
    }
    const flagged = balances.filter((b) => b.flagged);
    add(tag2(county.slug, `Inter-fund transfers: 581 out vs 381 in, non-custodial (threshold ${usd(TRANSFER_IMBALANCE_THRESHOLD)})`), true,
      flagged.length
        ? `${balances.length - flagged.length} of ${balances.length} years within threshold (largest gap ${usd(Math.max(...balances.filter((b) => !b.flagged).map((b) => Math.abs(b.difference))))}); over threshold: ${flagged.map((b) => `${fiscalYearLabel(b.fiscalYear)} ${usd(b.difference)}`).join('; ')}. Annotated in annotations.json.`
        : `all ${balances.length} years within threshold`,
      true);
    for (const sheets of [revenues.sheets, expenditures.sheets]) {
      const swings = yearOverYearSwings(sheets);
      for (const w of swings) {
        swingRows.push(`| ${county.slug} | ${w.flow} | ${w.scope} | ${fiscalYearLabel(w.fiscalYear - 1)} to ${fiscalYearLabel(w.fiscalYear)} | ${money(w.from)} | ${money(w.to)} | ${(w.change * 100).toFixed(1)}% |`);
      }
      const label = sheets[0]?.flow ?? '';
      add(tag2(county.slug, `${label}s: year-over-year changes above ${(SWING_THRESHOLD * 100).toFixed(0)}% (non-custodial)`), true,
        `${swings.length} changes over the threshold across totals and sections; listed under "Year-over-year changes"`, true);
    }
  }

  // --- Drop-and-recover gaps (QA-09 scan) ---------------------------------------------------
  const gapRows: string[] = [];
  for (const { county, revenues, expenditures } of inputs.counties) {
    const approved = APPROVED_GAPS.filter((g) => g.jurisdiction === county.slug);
    let open = 0;
    let total = 0;
    for (const sheets of [revenues.sheets, expenditures.sheets]) {
      for (const g of findGaps(sheets)) {
        total++;
        const match = approved.find((a) => a.flow === g.flow && g.years.includes(a.fiscalYear) && a.scopes.includes(g.scope));
        const isApproved = !!match;
        if (!isApproved) open++;
        gapRows.push(
          `| ${county.slug} | ${g.flow} | ${scopeLabel(g.scope)} | ${fiscalYearLabel(g.before.fiscalYear)}: ${money(g.before.value)} | ${g.values.map((v) => `${fiscalYearLabel(v.fiscalYear)}: ${money(v.value)}`).join('<br>')} | ${fiscalYearLabel(g.after.fiscalYear)}: ${money(g.after.value)} | ${match ? (match.coveredBy ? `annotated (in ${match.coveredBy} annotation)` : `annotated (${match.topic ?? 'fund-gap'})`) : 'listed for reference; not annotated'} |`,
        );
      }
    }
    add(tag2(county.slug, `Drop-and-recover gaps: fund type or section falls more than ${GAP_DROP * 100}% and recovers within ${GAP_MAX_YEARS} years (non-custodial, baseline at least ${usd(GAP_MIN_BASELINE)})`), true,
      `${total} found; ${total - open} annotated (config/approved-gaps.ts), ${open} listed for reference only. Listed under "Drop-and-recover gaps"`, true);
  }

  // --- Annotations: every one resolves and is well-formed ----------------------------------
  const annotationsJson = JSON.parse(readFileSync(path.join(OUT_DIR, 'annotations.json'), 'utf8')) as Annotation[];
  const sourceIdsJson = new Set((JSON.parse(readFileSync(path.join(OUT_DIR, 'sources.json'), 'utf8')) as Array<{ id: string }>).map((x) => x.id));
  const badAnnotations = annotationsJson.filter(
    (a) =>
      !sourceIdsJson.has(a.sourceId) ||
      !a.label ||
      !['methodology', 'policy', 'event'].includes(a.kind) ||
      (a.flow !== undefined && !['revenue', 'expenditure'].includes(a.flow)) ||
      (a.custodial !== undefined && !['included', 'excluded'].includes(a.custodial)) ||
      (a.refs ?? []).some((r) => !REF_PATTERN.test(r)) ||
      !a.topic ||
      !(ANNOTATION_TOPICS as readonly string[]).includes(a.topic) ||
      (a.funds ?? []).some((f) => !FUND_METADATA.some((m) => m.id === f)) ||
      (a.categories ?? []).some((c) => !CATEGORIES.some((d) => d.id === c)),
  );
  add('Annotations: sourceId resolves, topic set and known, fields valid, cell references well-formed', !badAnnotations.length,
    badAnnotations.length ? badAnnotations.map((a) => `${a.fiscalYear} ${a.label}`).join('; ') : `${annotationsJson.length} annotations`);
  // Every ref must point to a non-empty cell in the workbook it names (QA-08).
  const refWorkbooks = new Map<string, Map<string, Workbook>>();
  for (const { county, revenues, expenditures } of inputs.counties) {
    refWorkbooks.set(county.slug, new Map([
      ['revenues', await readWorkbook(revenues.file)],
      ['expenditures', await readWorkbook(expenditures.file)],
      ['population', await readWorkbook(inputs.populationFile)],
    ]));
  }
  const unresolved: string[] = [];
  let refCount = 0;
  for (const a of annotationsJson) {
    for (const r of a.refs ?? []) {
      refCount++;
      const m = REF_PATTERN.exec(r);
      const books = refWorkbooks.get(a.jurisdiction ?? '');
      const ws = m && books?.get(m[1])?.getWorksheet(m[2]);
      const cell = ws ? ws.getCell(m![3]) : null;
      const v = cell ? (cell.type === ExcelJS.ValueType.Formula ? cell.result : cell.value) : null;
      if (v === null || v === undefined || v === '') unresolved.push(`${a.fiscalYear} "${a.label}": ${r}`);
    }
  }
  add('Annotation refs resolve to a non-empty cell in the named workbook (format workbook:sheet!cell)', !unresolved.length,
    unresolved.length ? unresolved.join('; ') : `${refCount} refs resolved`);
  // User-facing text must not mention files, paths or JSON keys (QA-19).
  const leaks: string[] = [];
  const texts = userFacingStrings(OUT_DIR);
  for (const { where, text } of texts) {
    for (const [what, re] of INTERNAL_TEXT_PATTERNS) {
      const m = re.exec(text);
      if (m) leaks.push(`${where}: ${what} "${m[0]}"`);
    }
  }
  add('User-facing text has no file names, paths, JSON keys or code identifiers', !leaks.length,
    leaks.length ? leaks.slice(0, 10).join('; ') + (leaks.length > 10 ? `; and ${leaks.length - 10} more` : '') : `${texts.length} strings checked in cpi, annotations, sources and population`);
  // UAS categories: every account in every county maps to exactly one category.
  const unmapped: string[] = [];
  let mappedCount = 0;
  for (const c of inputs.counties) {
    for (const sheets of [c.revenues.sheets, c.expenditures.sheets]) {
      for (const sh of sheets) {
        for (const acct of sh.accounts) {
          const n = categoriesFor(sh.flow, acct.account, sh.fiscalYear).length;
          if (n === 1) mappedCount++;
          else unmapped.push(`${c.county.slug} ${sh.flow} ${acct.account} FY ${sh.fiscalYear}: ${n} categories`);
        }
      }
    }
  }
  add('UAS categories: every account row in every county maps to exactly one category', !unmapped.length,
    unmapped.length ? unmapped.slice(0, 10).join('; ') : `${mappedCount.toLocaleString('en-US')} account rows, ${CATEGORIES.length} categories`);

  // UAS classes EDR prints under a shared heading (38x+39x, 58x+59x): list the rows in the classes
  // that were split out, so the re-categorisation can be checked (DR-48, P3-09).
  const splitRows: string[] = [];
  for (const c of inputs.counties) {
    const obs = JSON.parse(readFileSync(path.join(OUT_DIR, `${c.county.slug}.observations.json`), 'utf8')) as Observation[];
    const groups = new Map<string, { n: number; sum: number; years: number[] }>();
    for (const o of obs) {
      const heading = o.category === 'other_nonoperating' ? 'Other Uses (and Non-Operating)' : Number(o.account) >= 390 && Number(o.account) < 400 ? 'Other Sources' : null;
      if (!heading) continue;
      const k = `${o.flow}|${o.account}|${o.category}|${heading}`;
      const g = groups.get(k) ?? { n: 0, sum: 0, years: [] };
      g.n++; g.sum += o.amount; g.years.push(o.fiscalYear);
      groups.set(k, g);
    }
    for (const [k, g] of [...groups].sort()) {
      const [flow, account, category, heading] = k.split('|');
      splitRows.push(`| ${c.county.name} | ${flow} | ${account} | "${heading}" | ${category} | ${g.n} | ${usd(g.sum)} | ${fiscalYearLabel(Math.min(...g.years))} to ${fiscalYearLabel(Math.max(...g.years))} |`);
    }
  }

  // County metadata the UI relies on: display names, cross-check status, DR-42 caveat text.
  const manifestJson = JSON.parse(readFileSync(path.join(OUT_DIR, 'manifest.json'), 'utf8')) as { jurisdictions: string[]; jurisdictionNames?: Record<string, string>; defaultJurisdiction?: string };
  const configDefaults = inputs.counties.filter((c) => c.county.default).map((c) => c.county.slug);
  add('manifest: defaultJurisdiction is the one county marked default in config, and is one of jurisdictions', configDefaults.length === 1 && manifestJson.defaultJurisdiction === configDefaults[0] && manifestJson.jurisdictions.includes(manifestJson.defaultJurisdiction),
    `defaultJurisdiction = ${JSON.stringify(manifestJson.defaultJurisdiction)}; jurisdictions = ${manifestJson.jurisdictions.join(', ')}`);
  const manifestJsonForScope = manifestJson;
  const missingNames = manifestJson.jurisdictions.filter((j) => !manifestJson.jurisdictionNames?.[j]);
  // QA-33: county-specific caveats on shared sources are keyed by jurisdiction, never prefixed text.
  const scopeProblems: string[] = [];
  const countyNames = inputs.counties.map((c) => c.county.name);
  for (const src of JSON.parse(readFileSync(path.join(OUT_DIR, 'sources.json'), 'utf8')) as Array<{ id: string; caveats: string[]; caveatsByJurisdiction?: Record<string, string[]> }>) {
    for (const c of src.caveats) if (countyNames.some((n) => c.startsWith(`${n}: `))) scopeProblems.push(`${src.id}: shared caveat starts with a county name`);
    for (const j of Object.keys(src.caveatsByJurisdiction ?? {})) if (!manifestJsonForScope.jurisdictions.includes(j)) scopeProblems.push(`${src.id}: caveatsByJurisdiction key "${j}" is not a jurisdiction`);
  }
  add('Shared sources: county-specific caveats are in caveatsByJurisdiction (no county-name prefixes in shared caveats)', !scopeProblems.length,
    scopeProblems.length ? scopeProblems.join('; ') : 'ok');
  add('manifest: every jurisdiction has a display name (jurisdictionNames)', !missingNames.length,
    missingNames.length ? `missing: ${missingNames.join(', ')}` : manifestJson.jurisdictions.map((j) => `${j} = "${manifestJson.jurisdictionNames![j]}"`).join('; '));
  const sourcesList = JSON.parse(readFileSync(path.join(OUT_DIR, 'sources.json'), 'utf8')) as Array<{
    id: string; caveats: string[]; countyAfrCrossCheck?: string; crossCheckSummary?: string;
    crossCheckCoverage?: Array<{ fromFiscalYear: number; toFiscalYear: number; status: string }>;
  }>;
  const crossProblems: string[] = [];
  const crossChecks = new Map<string, ReturnType<typeof countyCrossChecks>>();
  for (const c of inputs.counties) {
    const derived = countyCrossChecks(c);
    crossChecks.set(c.county.slug, derived);
    for (const flow of ['revenue', 'expenditure'] as const) {
      const d = derived[flow];
      const src = sourcesList.find((x) => x.id === `edr-afr-${flow}s-${c.county.slug}`);
      if (!src) { crossProblems.push(`${c.county.slug} ${flow}: source missing`); continue; }
      const sheetYears = (flow === 'revenue' ? c.revenues.sheets : c.expenditures.sheets).map((x) => x.fiscalYear);
      crossProblems.push(...crossCheckSourceProblems(src, d, sheetYears, NOT_CROSS_CHECKED_CAVEAT));
    }
  }
  add('EDR AFR sources: countyAfrCrossCheck, coverage and summary follow the cross-check results; DR-42 caveat text exact where not-checked', !crossProblems.length,
    crossProblems.length ? crossProblems.join('; ') : [...crossChecks].map(([slug, d]) => `${slug}: revenue ${d.revenue.status}, expenditure ${d.expenditure.status}`).join('; '));

  // --- LOGERX reconciliation (P4a-07) -------------------------------------------------------
  const logerxRows: string[] = [];
  const logerxDiffs: string[] = [];
  for (const c of inputs.counties) {
    if (!c.county.logerxEntityCode) continue;
    const d = crossChecks.get(c.county.slug)!;
    const yearsBy = (flow: string) => c.logerx.filter((e) => e.flow === flow).map((e) => e.fiscalYear).sort((x, y) => x - y);
    const ry = yearsBy('revenue');
    const ey = yearsBy('expenditure');
    const gaps = ry.slice(1).filter((y, i) => y !== ry[i] + 1);
    add(tag2(c.county.slug, 'LOGERX extracts present for the same contiguous years in both flows'), !!ry.length && ry.join(',') === ey.join(',') && !gaps.length,
      ry.length ? `revenue ${fiscalYearLabel(ry[0])} to ${fiscalYearLabel(ry.at(-1)!)} (${ry.length}), expenditure ${ey.length ? `${fiscalYearLabel(ey[0])} to ${fiscalYearLabel(ey.at(-1)!)}` : 'none'} (${ey.length})` : 'no extracts');
    const badMeta = c.logerx.filter((e) => !e.record.fullDownload?.sha256 || !e.record.reportAsOf || e.record.entityCode !== c.county.logerxEntityCode || !e.record.rows);
    add(tag2(c.county.slug, 'LOGERX manifest entries record request, full-download hash, "as of" stamp, entity code and row count'), !badMeta.length,
      badMeta.length ? badMeta.map((e) => rel(e.file)).join(', ') : `${c.logerx.length} extracts`);
    let cells = 0;
    let matched = 0;
    for (const flow of ['revenue', 'expenditure'] as const) {
      for (const r of d[flow].reconciliations) {
        cells += r.cells;
        matched += r.match;
        const diffs = r.mismatches.length + r.onlyLogerx.length + r.onlyEdr.length;
        logerxRows.push(`| ${c.county.name} | ${fiscalYearLabel(r.fiscalYear)} | ${flow} | ${r.cells} | ${r.match} | ${r.mismatches.length} | ${r.onlyLogerx.length} | ${r.onlyEdr.length} | ${usd(r.logerxTotal)} | ${usd(r.edrTotal)} | ${diffs ? 'differences listed below' : 'all match'} |`);
        for (const [kind, list] of [['mismatch', r.mismatches], ['only in LOGERX', r.onlyLogerx], ['only in EDR', r.onlyEdr]] as const) {
          for (const x of list) {
            logerxDiffs.push(`| ${c.county.name} | ${fiscalYearLabel(r.fiscalYear)} | ${flow} | ${x.account} | ${x.fundType} | ${kind} | ${x.logerx === null ? 'n/a' : usd(x.logerx)} | ${x.edr === null ? 'n/a' : usd(x.edr)} | ${x.ref ? `\`${x.ref}\`` : 'n/a'} |`);
          }
        }
      }
    }
    const pairs = (['revenue', 'expenditure'] as const).flatMap((flow) => d[flow].reconciliations.flatMap(reclassificationPairs));
    const unapproved = pairs.filter((p) => !APPROVED_RECLASSIFICATIONS.some((a) => a.jurisdiction === c.county.slug && a.flow === p.flow && a.fiscalYear === p.fiscalYear && Math.abs(a.amount - p.amount) < 0.5));
    add(tag2(c.county.slug, 'Every LOGERX/EDR classification difference has an approved annotation (DR-47)'), !unapproved.length,
      unapproved.length ? unapproved.map((p) => `${fiscalYearLabel(p.fiscalYear)} ${p.flow} $${p.amount}`).join('; ') : `${pairs.length} difference(s), all approved`);
    const diffCount = cells - matched;
    add(tag2(c.county.slug, 'LOGERX reconciliation: every account x fund amount vs EDR (differences are listed for review, never applied)'), true,
      `${matched.toLocaleString('en-US')} of ${cells.toLocaleString('en-US')} cells match${diffCount ? `; ${diffCount} differ or are in one source only (listed under "LOGERX reconciliation")` : ''}`, !!diffCount);
  }

  const gasb = annotationsJson.find((a) => a.fiscalYear === 2021 && a.label === 'Custodial fund reporting begins (GASB 84).' && a.kind === 'methodology');
  add('GASB 84 annotation present at FY 2020-21', !!gasb, gasb ? `sourceId ${gasb.sourceId}` : 'missing');

  // --- Cross-county summary ---------------------------------------------------------------
  const crossRows: string[] = [];
  for (const { county, revenues, expenditures, countyAfrFiles } of inputs.counties) {
    const firstCustodial = (sheets: AfrSheet[]) => {
      const withCol = [...sheets].filter((s) => s.fundColumns.some((f) => f.fundType === 'custodial')).sort((a, b) => a.fiscalYear - b.fiscalYear);
      const nonZero = withCol.find((s) => (s.grandTotal.cached['custodial'] ?? 0) !== 0);
      return { column: withCol[0]?.fiscalYear, amounts: nonZero?.fiscalYear };
    };
    const rc = firstCustodial(revenues.sheets);
    const ec = firstCustodial(expenditures.sheets);
    const flagged = transferBalances(revenues.sheets, expenditures.sheets).filter((b) => b.flagged);
    const gaps = [...findGaps(revenues.sheets), ...findGaps(expenditures.sheets)];
    const afrChecks = COUNTY_AFR_CHECKS.filter((c) => c.jurisdiction === county.slug).length;
    const yearsOf = (sheets: AfrSheet[]) => `${fiscalYearLabel(Math.min(...sheets.map((s) => s.fiscalYear)))} to ${fiscalYearLabel(Math.max(...sheets.map((s) => s.fiscalYear)))}`;
    crossRows.push(
      `| ${county.name} | ${yearsOf(revenues.sheets)} | ${yearsOf(expenditures.sheets)} | ${rc.column ? fiscalYearLabel(rc.column) : 'n/a'} | ` +
        `${rc.amounts ? fiscalYearLabel(rc.amounts) : 'none'} / ${ec.amounts ? fiscalYearLabel(ec.amounts) : 'none'} | ` +
        `${flagged.length ? flagged.map((b) => `${fiscalYearLabel(b.fiscalYear)} ${usd(b.difference)}`).join('<br>') : 'none'} | ${gaps.length} | ` +
        `${afrChecks ? `${afrChecks} values in ${countyAfrFiles.length} county-filed AFRs` : 'not cross-checked (EDR totals only)'} | ` +
        `${KNOWN_SECTION_PLACEMENTS.filter((p) => p.jurisdiction === county.slug).length} |`,
    );
  }

  // --- Index comparison (informational) ---------------------------------------------------
  const firstCounty = inputs.counties[0];
  const indexSection = indexComparisonSection({
    nationalCalendar: cpiJson['national'].calendarYear,
    tampaCalendar: cpiJson['tampa_semiannual'].calendarYear,
    nationalFiscal: cpiJson['national'].fiscalYear,
    tampaFiscal: cpiJson['tampa'].fiscalYear,
    revenueExclCustodial: Object.fromEntries(
      firstCounty.revenues.sheets.map((s) => [s.fiscalYear, (s.grandTotal.cachedTotal ?? NaN) - (s.grandTotal.cached['custodial'] ?? 0)]),
    ),
    jurisdictionName: firstCounty.county.name,
  });

  // --- Account codes appearing / disappearing, fund usage changes ------------------------
  const accountSections: string[] = [];
  for (const { county, revenues, expenditures } of inputs.counties) {
    for (const [label, sheets] of [['revenue', revenues.sheets], ['expenditure', expenditures.sheets]] as const) {
      const years = sheets.map((s) => s.fiscalYear).sort((a, b) => a - b);
      const presence = new Map<string, { name: string; years: number[]; funds: Map<string, number[]> }>();
      for (const s of [...sheets].sort((a, b) => a.fiscalYear - b.fiscalYear)) {
        for (const a of s.accounts) {
          const e = presence.get(a.account) ?? { name: a.name, years: [] as number[], funds: new Map<string, number[]>() };
          e.name = a.name;
          e.years.push(s.fiscalYear);
          for (const v of a.values) if (v.amount !== 0) e.funds.set(v.fundType, [...(e.funds.get(v.fundType) ?? []), s.fiscalYear]);
          presence.set(a.account, e);
        }
      }
      const partial = [...presence].filter(([, e]) => e.years.length !== years.length).sort((x, y) => Number(x[0]) - Number(y[0]));
      const always = presence.size - partial.length;
      add(tag2(county.slug, `${label}s: account codes present in some years only`), true,
        `${presence.size} distinct codes; ${always} in every year (${fiscalYearLabel(years[0])} to ${fiscalYearLabel(years.at(-1)!)}); ${partial.length} appear, disappear or have gaps (listed under "Account codes by year")`, true);
      const fundChanges = [...presence].filter(([, e]) => e.funds.size > 1).sort((x, y) => Number(x[0]) - Number(y[0]));
      accountSections.push(
        `### ${county.name} - ${label} account codes not present in every year\n\n` +
          `${partial.length} of ${presence.size} codes. A gap can mean the county reported nothing under that code that year, a code added or retired in the Uniform Accounting System, or a change in how the county coded the item; the data do not say which.\n\n` +
          '| Account | Latest name | Fiscal years present (year ending) |\n|---|---|---|\n' +
          partial.map(([code, e]) => `| ${code} | ${e.name.replace(/\|/g, '\\|')} | ${ranges(e.years)} |`).join('\n') +
          `\n\n<details><summary>${label} accounts reported in more than one fund type (${fundChanges.length}), with the years each fund was non-zero</summary>\n\n` +
          '| Account | Latest name | Fund: years non-zero |\n|---|---|---|\n' +
          fundChanges.map(([code, e]) => `| ${code} | ${e.name.replace(/\|/g, '\\|')} | ${[...e.funds].map(([f, ys]) => `${f}: ${ranges(ys)}`).join('; ')} |`).join('\n') +
          '\n\n</details>\n',
      );
    }
  }

  // --- Cells to re-derive by hand ----------------------------------------------------------
  const handRows: string[] = [];
  for (const { county, revenues, expenditures } of inputs.counties) {
    for (const [file, sheets] of [[revenues.file, revenues.sheets], [expenditures.file, expenditures.sheets]] as const) {
      const latest = sheets.reduce((x, y) => (y.fiscalYear > x.fiscalYear ? y : x));
      const pre = sheets.find((s) => s.fiscalYear === 2020) ?? sheets[0];
      for (const s of [pre, latest]) {
        const first = s.accounts[0];
        const gen = first.values.find((v) => v.fundType === 'general')!;
        handRows.push(`| ${county.slug} | \`${path.basename(file)}\` | ${fiscalYearLabel(s.fiscalYear)} | account ${first.account} (${first.name}), General | \`${s.sheetName}!${gen.address}\` | ${usd(gen.amount)} |`);
        handRows.push(`| ${county.slug} | \`${path.basename(file)}\` | ${fiscalYearLabel(s.fiscalYear)} | Total - All Account Codes, Total column (formula, cached value) | \`${s.sheetName}!${colLetter(s.totalCol)}${s.grandTotal.row}\` | ${usd(s.grandTotal.cachedTotal ?? NaN)} |`);
        const cust = s.fundColumns.find((f) => f.fundType === 'custodial');
        if (cust) {
          const c = s.grandTotal.cached['custodial'] ?? 0;
          handRows.push(`| ${county.slug} | \`${path.basename(file)}\` | ${fiscalYearLabel(s.fiscalYear)} | Total - All Account Codes, Custodial column | \`${s.sheetName}!${colLetter(cust.col)}${s.grandTotal.row}\` | ${usd(c)} (total excl. custodial ${usd((s.grandTotal.cachedTotal ?? NaN) - c)}) |`);
        }
        handRows.push(`| ${county.slug} | \`${path.basename(file)}\` | ${fiscalYearLabel(s.fiscalYear)} | Countywide population | \`${s.sheetName}!${colLetter(s.perCapitaCol)}${s.population.row}\` | ${s.population.value.toLocaleString('en-US')} |`);
      }
    }
  }

  // --- Counts -------------------------------------------------------------------------------
  const countRows: string[] = [];
  for (const { county, revenues, expenditures } of inputs.counties) {
    const obs = JSON.parse(readFileSync(path.join(OUT_DIR, `${county.slug}.observations.json`), 'utf8')) as Observation[];
    for (const [label, sheets] of [['revenue', revenues.sheets], ['expenditure', expenditures.sheets]] as const) {
      const o = obs.filter((x) => x.flow === label);
      const funds = new Set(sheets.flatMap((s) => s.fundColumns.map((f) => f.fundType)));
      countRows.push(`| ${county.slug} | ${label}s | ${sheets.length} | ${new Set(sheets.flatMap((s) => s.accounts.map((a) => a.account))).size} | ${sumBy(sheets, (s) => s.accounts.length).toLocaleString('en-US')} | ${funds.size} (${[...funds].join(', ')}) | ${new Set(o.map((x) => x.fundType)).size} | ${o.length.toLocaleString('en-US')} |`);
    }
  }

  // --- Report ---------------------------------------------------------------------------
  const failed = checks.filter((c) => c.status === 'FAIL');
  const md = [
    '# Data validation report',
    '',
    'Generated by `npm run validate` in `scripts/pipeline`. Do not edit by hand.',
    '',
    `**Result: ${failed.length ? `FAIL (${failed.length} failing checks)` : 'PASS'}** - ${checks.filter((c) => c.status === 'PASS').length} passed, ${failed.length} failed, ${checks.filter((c) => c.status === 'NOTE').length} notes.`,
    '',
    'Inputs (sha256 verified against `data/raw/manifest.json`):',
    '',
    ...Object.entries(inputs.retrieval.files).sort().map(([p, r]) => `- \`${p}\` - ${r.sha256} (retrieved ${r.retrieved})`),
    '',
    '## Checks',
    '',
    '| Status | Check | Detail |',
    '|---|---|---|',
    ...checks.map((c) => `| ${c.status} | ${c.name} | ${c.detail.replace(/\|/g, '\\|')} |`),
    '',
    '## Counts',
    '',
    '| Jurisdiction | Flow | Fiscal years | Distinct account codes | Account rows | Fund columns in workbook | Fund types with non-zero amounts | Observations (non-zero cells) |',
    '|---|---|---:|---:|---:|---|---:|---:|',
    ...countRows,
    '',
    'Tolerances: all dollar comparisons are exact (amounts are whole dollars, and the sums are exact in double precision). Per-capita: |workbook per-capita - Total / population| <= 1e-6 dollars per person. CPI method check: equal at the published BLS precision (semiannual halves: within one unit in the last published decimal).',
    '',
    '## Cells to re-derive by hand',
    '',
    'Open the raw workbook, go to the cell, and compare. Total and per-capita cells are formulas; the value shown is the result Excel cached in the file, which validation recomputes from the account rows.',
    '',
    '| Jurisdiction | Workbook | Fiscal year | What | Cell | Value |',
    '|---|---|---|---|---|---|',
    ...handRows,
    '',
    '## Totals by fiscal year',
    '',
    '"Workbook" columns are the cached values of the formulas in EDR\'s "Total - All Account Codes" row. "EDR recalculated total" is what EDR\'s Total Account column shows after deleting the Custodial column, per EDR\'s data-use notice. All amounts are nominal dollars and include every fund column (fiduciary funds and Component Units included).',
    '',
    ...tables,
    '## CPI: annual-average method check',
    '',
    'The fiscal-year CPI values are a simple mean of the published monthly (national) or bimonthly (Tampa) index values. This table checks that the same method reproduces the BLS-published calendar-year annual averages.',
    '',
    '| Series | Year | Months | Mean of months | BLS annual average | Result |',
    '|---|---:|---:|---:|---:|---|',
    ...cpiRows,
    '',
    '## Cross-county notes',
    '',
    'One row per configured county. All values come from the same checks reported above for each county.',
    '',
    '| County | Revenue years | Expenditure years | Custodial column from | First non-zero custodial (revenue / expenditure) | Transfer-imbalance years (annotated) | Drop-and-recover gaps found | County-filed AFR cross-check | Documented section-placement exceptions |',
    '|---|---|---|---|---|---|---:|---|---:|',
    ...crossRows,
    '',
    '## LOGERX reconciliation',
    '',
    "Every account and fund amount in the DFS LOGERX public \"Revenue Details\" and \"Expenditure Details\" reports (data DFS marks \"Verified\"; the county's own Annual Financial Report filing) compared with the EDR workbook cell for the same fiscal year, flow, account and fund. Impact-fee rows split by dwelling and fee type are summed to the account. Extracts: data/raw/logerx/<county>/. Differences never change EDR values; they are listed here for review.",
    '',
    '| County | Fiscal year | Flow | Cells | Match | Mismatch | Only in LOGERX | Only in EDR | LOGERX total | EDR total | Result |',
    '|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|',
    ...logerxRows,
    '',
    ...(logerxDiffs.length
      ? ['### Differences', '', '| County | Fiscal year | Flow | Account | Fund | Kind | LOGERX | EDR | EDR cell |', '|---|---|---|---|---|---|---:|---:|---|', ...logerxDiffs, '']
      : ['No differences.', '']),
    ...indexSection,
    '## County-filed AFR cross-check',
    '',
    "Lines read from the county's own Annual Financial Report PDFs (the Florida DFS form as filed with the CFO, published by the Hillsborough County Clerk of Court & Comptroller), compared with the EDR workbook cell for the same fiscal year, account and fund. The lines are listed in `scripts/pipeline/src/edr/county-afr-checks.ts`.",
    '',
    '| Fiscal year | Flow | Account | Fund | County AFR file, page | Lines in county AFR | County AFR sum | EDR cell | Result |',
    '|---|---|---|---|---|---|---:|---|---|',
    ...afrRows,
    '',
    '## Inter-fund transfers (informational)',
    '',
    `Revenue account 381 (inter-fund group transfers in) and expenditure account 581 (inter-fund group transfers out), all funds except custodial. Difference = out minus in. Years whose absolute difference is more than ${usd(TRANSFER_IMBALANCE_THRESHOLD)} are marked; each must be approved, and approved years are annotated.`,
    '',
    '| Jurisdiction | Fiscal year | 381 transfers in | 581 transfers out | Difference | |',
    '|---|---|---:|---:|---:|---|',
    ...transferRows,
    '',
    '## UAS classes split from a shared EDR heading',
    '',
    'EDR prints UAS classes 38x and 39x under one heading ("Other Sources"), and 58x and 59x under another ("Other Uses" / "Other Uses and Non-Operating"). Categories follow the UAS manual edition in force (src/edr/categories.ts): 59x is "Other Nonoperating" in every edition compared; 39x is part of Other Sources before FY 2021-22 and "Proprietary Non-Operating Sources" from FY 2021-22. Rows below are every observation in those codes. Amounts are unchanged; only category and section differ from the EDR heading.',
    '',
    '| County | Flow | Account | EDR heading | Category | Cells | Sum | Years |',
    '|---|---|---|---|---|---:|---:|---|',
    ...splitRows,
    '',
    '## Drop-and-recover gaps (informational)',
    '',
    `Non-custodial fund-type totals and sections that fall by more than ${GAP_DROP * 100}% from the prior year and come back to at least ${(1 - GAP_DROP) * 100}% of the prior-year value within ${GAP_MAX_YEARS} years, in either flow. Only scopes with a prior-year value of at least ${usd(GAP_MIN_BASELINE)} are scanned. Annotated gaps are listed in \`scripts/pipeline/config/approved-gaps.ts\`. Per the user decision recorded in docs/decisions.md, only filing breaks are annotated: the FY 2023-24 proprietary-fund and component-unit gaps, and the FY 2022-23 and FY 2023-24 court-related and public safety gaps, which are described in the transfer-imbalance annotations for those years. The other rows are listed for reference only and are not annotated.`,
    '',
    '| Jurisdiction | Flow | Scope | Before | During | After | Status |',
    '|---|---|---|---|---|---|---|',
    ...gapRows,
    '',
    '## Year-over-year changes (informational)',
    '',
    `Changes larger than ${(SWING_THRESHOLD * 100).toFixed(0)}% from the prior fiscal year in the non-custodial total or in a section (all funds except custodial, nominal dollars).`,
    '',
    '| Jurisdiction | Flow | Scope | Years | From | To | Change |',
    '|---|---|---|---|---:|---:|---:|',
    ...swingRows,
    '',
    '## Account codes by year',
    '',
    ...accountSections,
  ].join('\n');
  writeFileSync(VALIDATION_REPORT, md);

  for (const c of checks) console.log(`${c.status.padEnd(4)} ${c.name}${c.status !== 'PASS' ? ` - ${c.detail}` : ''}`);
  console.log(`\nwrote ${rel(VALIDATION_REPORT)}`);
  if (failed.length) {
    console.error(`\nVALIDATION FAILED: ${failed.length} check(s)`);
    process.exit(1);
  }
  console.log('\nVALIDATION PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
