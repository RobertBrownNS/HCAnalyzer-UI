// Desktop Filters pane accordion (P3-14): sections, their one-line summaries, and which are open.
// Pure apart from the storage helpers. Summaries reuse the chips' approved label strings, and
// together the collapsed headers state every active setting (CLAUDE.md: methodology choices are
// always visible). The range is shown under the chart, so it is not repeated here.
import { CPI_PERIOD_LABELS, CPI_SHORT_LABELS, FLOW_LABELS, MEASURE_LABELS, TRANSFER_LABELS, isReal } from '../core/labels';
import { TransformSettings, fiscalYearLabel } from '../core/transform';

export type PaneSection = 'view' | 'inflation' | 'funds' | 'categories';

export const SECTION_TITLES: Record<PaneSection, string> = {
  view: 'View',
  inflation: 'Inflation',
  funds: 'Funds & transfers',
  categories: 'Categories',
};

/** One section open at a time (D-24 as amended); View at first visit. */
export const DEFAULT_OPEN: PaneSection = 'view';
export const SECTIONS_KEY = 'fx.filterSections';
/** Stored when the viewer closed every section. */
const NONE = 'none';
const ALL: readonly PaneSection[] = ['view', 'inflation', 'funds', 'categories'];

/** The section the viewer left open (null: all closed), or View when storage is empty, invalid or blocked. */
export function readOpenSection(): PaneSection | null {
  try {
    const raw = globalThis.localStorage?.getItem(SECTIONS_KEY);
    if (raw === NONE) return null;
    if (raw && (ALL as readonly string[]).includes(raw)) return raw as PaneSection;
  } catch {
    // fall through to the default
  }
  return DEFAULT_OPEN;
}

export function writeOpenSection(open: PaneSection | null): void {
  try {
    globalThis.localStorage?.setItem(SECTIONS_KEY, open ?? NONE);
  } catch {
    // Storage blocked: the state lasts for this page only.
  }
}

export interface SummaryInput {
  s: TransformSettings;
  /** "Pinellas"; empty until the county is known. */
  countyName: string;
  /** Fund scope: a preset's name, "Custom: n funds", or "Funds" while it can't be told (QA-48). */
  funds: string;
  /** Display labels of the selected categories (when the data has them). */
  categoryLabels: Readonly<Record<string, string>>;
}

/** "1 category", "4 categories" (phone chip and pane summary). */
export function categoryCount(n: number): string {
  return `${n} ${n === 1 ? 'category' : 'categories'}`;
}

/** One line per section, " · "-separated, from the same strings as the phone chips. */
export function sectionSummaries(i: SummaryInput): Record<PaneSection, string> {
  const s = i.s;
  const base = fiscalYearLabel(s.baseYear);
  const cats = s.categories ?? [];
  const catNames = cats.map((id) => i.categoryLabels[id]);
  return {
    view: [
      i.countyName || 'County',
      FLOW_LABELS[s.flow],
      MEASURE_LABELS[s.measure],
      `Base year ${base}`,
      s.indexTo100 ? `${base} = 100` : 'Index to 100: off',
    ].join(' · '),
    inflation: isReal(s.measure) ? `${CPI_SHORT_LABELS[s.cpiIndex]} · ${CPI_PERIOD_LABELS[s.cpiPeriod]}` : 'Not used',
    funds: [
      i.funds,
      s.includeCustodial ? 'Custodial included' : 'Custodial excluded',
      `Transfers: ${TRANSFER_LABELS[s.transfers ?? 'gross'].toLowerCase()}`,
    ].join(' · '),
    categories: !cats.length
      ? 'All categories'
      : cats.length <= 3 && catNames.every(Boolean)
        ? catNames.join(', ')
        : categoryCount(cats.length),
  };
}

/** The pane may stay sticky only while all of it fits under the header (one scrollbar, ever). */
export function paneFits(paneHeight: number, viewportHeight: number, headerHeight: number): boolean {
  return paneHeight <= viewportHeight - headerHeight + 1;
}
