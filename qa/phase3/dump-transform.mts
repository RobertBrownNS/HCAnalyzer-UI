// QA P3-09: dump transform.ts outputs (nominal) for every county x flow: totals for each preset and
// each single fund, and per-category values (all funds), so an independent stdlib re-derivation can
// be compared against them. Run from the repo root of the build under test:
//   npx tsx qa/phase3/dump-transform.mts <repoRoot> <out.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [root, outFile] = process.argv.slice(2);
const T = await import(pathToFileURL(join(root, 'src/app/core/transform.ts')).href);
const d = (f: string) => JSON.parse(readFileSync(join(root, 'src/assets/data', f), 'utf8'));
const manifest = d('manifest.json');
const funds = d('funds.json');
const presets: Record<string, string[]> = Object.fromEntries(funds.presets.map((p: { id: string; funds: string[] }) => [p.id, p.funds]));
const out: Record<string, unknown> = {};
for (const county of manifest.jurisdictions as string[]) {
  const data = {
    observations: d(`${county}.observations.json`),
    population: d('population.json'),
    cpi: d('cpi.json'),
    annotations: d('annotations.json'),
    sources: d('sources.json'),
    categories: d('categories.json'),
    funds,
  };
  for (const flow of ['revenue', 'expenditure']) {
    const base = T.settingsWithDefaults(county, { flow, measure: 'nominal', range: [2000, 2030], indexTo100: false, includeCustodial: false });
    const totals: Record<string, Record<number, number | null>> = {};
    const scopes: Record<string, string[] | undefined> = { default: undefined, ...presets };
    for (const f of T.availableFunds(data, county)) scopes[`fund:${f}`] = [f];
    for (const [name, sel] of Object.entries(scopes)) {
      const pts = T.buildSeries(data, { ...base, funds: sel });
      totals[name] = Object.fromEntries(pts.map((p: { fiscalYear: number; nominal: number }) => [p.fiscalYear, p.nominal]));
    }
    const cats: Record<string, Record<number, number | null>> = {};
    for (const series of T.buildCategorySeries(data, base)) {
      cats[series.category ?? series.id] = Object.fromEntries(
        series.points.map((p: { fiscalYear: number; nominal: number }) => [p.fiscalYear, p.nominal]),
      );
    }
    // Shares: the 100% share values for all categories, all funds.
    out[`${county}|${flow}`] = { totals, categories: cats, availableFunds: T.availableFunds(data, county), availableCategories: T.availableCategories(data, flow, county) };
  }
}
writeFileSync(outFile, JSON.stringify(out));
console.log('wrote', outFile, Object.keys(out));
