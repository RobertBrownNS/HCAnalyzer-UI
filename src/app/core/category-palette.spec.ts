import { CATEGORY_COUNT } from './chart-palette';

// QA-41: no category chart may show two series in the same colour. Reads the real token file and
// the published categories.json, so adding a category or editing a colour can't break this silently.

interface Fs {
  readFileSync(path: string, encoding: string): string;
}
// Node's fs at run time (Vitest runs in Node); the spec tsconfig has no Node types.
const fs = (): Promise<Fs> => import(/* @vite-ignore */ ['node', 'fs'].join(':'));

function block(scss: string, name: string): string {
  const start = scss.indexOf(`$${name}: (`);
  if (start < 0) throw new Error(`$${name} not found`);
  return scss.slice(start, scss.indexOf('\n);', start));
}
const pairs = (text: string) =>
  [...text.matchAll(/\((#[0-9a-f]{6}),\s*(#[0-9a-f]{6})\)/gi)].map((m) => ({ light: m[1].toLowerCase(), dark: m[2].toLowerCase() }));

describe('category palette (QA-41)', () => {
  let categories: { light: string; dark: string }[];
  let total: { light: string; dark: string };
  let maxCategories: number;

  beforeAll(async () => {
    const { readFileSync } = await fs();
    const scss = readFileSync('src/styles/_tokens.scss', 'utf-8');
    categories = pairs(block(scss, 'categories'));
    const totalLine = scss.split('\n').find((l) => /^\s*chart-total:/.test(l));
    if (!totalLine) throw new Error('chart-total token not found');
    total = pairs(totalLine)[0];
    const defs: { flow: string }[] = JSON.parse(readFileSync('src/assets/data/categories.json', 'utf-8'));
    // Every category a county can show is listed here, per flow: the most any chart can draw.
    maxCategories = Math.max(...['revenue', 'expenditure'].map((f) => defs.filter((d) => d.flow === f).length));
  });

  it('has a colour for every category of the largest flow, and CATEGORY_COUNT matches the tokens', () => {
    expect(maxCategories).toBeGreaterThanOrEqual(10);
    expect(categories.length).toBeGreaterThanOrEqual(maxCategories);
    expect(categories.length).toBeGreaterThanOrEqual(11);
    expect(CATEGORY_COUNT).toBe(categories.length);
  });

  it('no two palette entries share a colour, in light or dark (so no chart can repeat one)', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const colours = categories.map((c) => c[scheme]);
      expect(new Set(colours).size, `${scheme}: ${colours.join(' ')}`).toBe(colours.length);
    }
  });

  it('the total line colour is not a category colour', () => {
    expect(categories.map((c) => c.light)).not.toContain(total.light);
    expect(categories.map((c) => c.dark)).not.toContain(total.dark);
  });
});
