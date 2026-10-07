import { normalizeIdList, parseIdList, parseView, serializeIdList, serializeView } from './view-state';

const params = (q: string) => new URLSearchParams(q);

describe('id lists (funds, cats)', () => {
  it('parses sorted, unique, well-formed ids; absent or empty means all (null)', () => {
    expect(parseIdList('special_revenue,general,general')).toEqual(['general', 'special_revenue']);
    expect(parseIdList('general,Bad Id,<x>')).toEqual(['general']);
    expect(parseIdList(null)).toBeNull();
    expect(parseIdList('')).toBeNull();
    expect(parseIdList(',,')).toBeNull();
  });

  it('keeps only known ids; naming every id, or none valid, means all', () => {
    const allowed = ['capital', 'general', 'special_revenue'];
    expect(normalizeIdList(['general', 'pension'], allowed)).toEqual(['general']);
    expect(normalizeIdList(['capital', 'general', 'special_revenue'], allowed)).toBeNull();
    expect(normalizeIdList(['pension'], allowed)).toBeNull();
    expect(normalizeIdList(['general'], [])).toEqual(['general']); // list not loaded yet: keep
  });

  it('serializes "all" as an absent param and a selection as a sorted list', () => {
    expect(serializeIdList(null)).toBeUndefined();
    expect(serializeIdList(['special_revenue', 'general'])).toBe('general,special_revenue');
  });
});

describe('view state (chart)', () => {
  it('round-trips every chart type through the URL', () => {
    for (const chart of ['line', 'lines', 'stacked', 'share', 'bars'] as const) {
      const q = new URLSearchParams(serializeView({ chart })).toString();
      expect(parseView(params(q))).toEqual({ chart });
    }
  });

  it('defaults to the line chart; unknown chart types fall back', () => {
    expect(parseView(params(''))).toEqual({ chart: 'line' });
    expect(parseView(params('chart=pie'))).toEqual({ chart: 'line' });
  });
});
