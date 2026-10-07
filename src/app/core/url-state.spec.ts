import { DEFAULT_SETTINGS, TransformSettings } from './transform';
import { normalizeSettings, parseSettings, sameParams, serializeSettings } from './url-state';

const params = (q: string) => new URLSearchParams(q);

describe('url-state', () => {
  describe('round trip', () => {
    const cases: TransformSettings[] = [
      { ...DEFAULT_SETTINGS, range: [...DEFAULT_SETTINGS.range] },
      {
        flow: 'expenditure',
        measure: 'real_per_capita',
        baseYear: 2020,
        indexTo100: true,
        range: [2010, 2024],
        includeCustodial: true,
        cpiIndex: 'cpi-u-tampa',
        cpiPeriod: 'calendar',
        transfers: 'net',
      },
      {
        flow: 'revenue',
        measure: 'per_capita',
        baseYear: 2006,
        indexTo100: false,
        range: [2015, 2015],
        includeCustodial: false,
        cpiIndex: 'cpi-u-us',
        cpiPeriod: 'fiscal',
        transfers: 'gross',
      },
    ];

    for (const s of cases) {
      it(`parse(serialize(s)) === s for ${s.flow}/${s.measure}`, () => {
        const query = new URLSearchParams(serializeSettings(s)).toString();
        expect(parseSettings(params(query))).toEqual(s);
      });
    }

    it('serializes every key with the documented param names', () => {
      const q = serializeSettings({
        flow: 'expenditure',
        measure: 'real',
        baseYear: 2019,
        indexTo100: true,
        range: [2008, 2021],
        includeCustodial: true,
        cpiIndex: 'cpi-u-tampa',
        cpiPeriod: 'calendar',
        transfers: 'net',
      });
      expect(q).toEqual({
        flow: 'expenditure',
        measure: 'real',
        base: '2019',
        idx: '1',
        from: '2008',
        to: '2021',
        cust: '1',
        cpi: 'cpi-u-tampa',
        cpiper: 'calendar',
        xfer: 'net',
      });
    });
  });

  describe('parseSettings fallbacks', () => {
    it('returns defaults for an empty query', () => {
      expect(parseSettings(params(''))).toEqual(DEFAULT_SETTINGS);
    });

    it('defaults custodial to excluded', () => {
      expect(parseSettings(params('')).includeCustodial).toBe(false);
    });

    it('replaces each invalid value with its default and keeps valid ones', () => {
      const s = parseSettings(
        params('flow=expenditure&measure=bogus&base=20x1&idx=yes&from=abc&to=2020&cust=2&cpi=cpi-u-mars&cpiper=calendar'),
      );
      expect(s).toEqual({
        ...DEFAULT_SETTINGS,
        flow: 'expenditure',
        range: [DEFAULT_SETTINGS.range[0], 2020],
        cpiPeriod: 'calendar',
      });
    });

    it('treats transfers as gross unless xfer=net', () => {
      expect(parseSettings(params('')).transfers).toBe('gross');
      expect(parseSettings(params('xfer=net')).transfers).toBe('net');
      expect(parseSettings(params('xfer=both')).transfers).toBe('gross');
    });

    it('swaps a reversed range', () => {
      expect(parseSettings(params('from=2020&to=2010')).range).toEqual([2010, 2020]);
    });

    it('rejects years that are not four digits', () => {
      expect(parseSettings(params('base=99999&from=-2010&to=2010.5')).baseYear).toBe(DEFAULT_SETTINGS.baseYear);
      expect(parseSettings(params('from=-2010&to=2010.5')).range).toEqual([...DEFAULT_SETTINGS.range]);
    });

    it('is case sensitive for enum values', () => {
      expect(parseSettings(params('flow=Revenue')).flow).toBe(DEFAULT_SETTINGS.flow);
    });
  });

  describe('normalizeSettings', () => {
    const years = [2006, 2007, 2008, 2009, 2010];
    const base: TransformSettings = { ...DEFAULT_SETTINGS, baseYear: 2008, range: [2006, 2010] };

    it('leaves settings unchanged when no years are known', () => {
      const s = { ...base, range: [1990, 2050] as [number, number], baseYear: 1800 };
      expect(normalizeSettings(s, [])).toEqual(s);
    });

    it('clamps the range to the available years', () => {
      expect(normalizeSettings({ ...base, range: [1990, 2050] }, years).range).toEqual([2006, 2010]);
    });

    it('collapses a range entirely outside the data to one edge year', () => {
      expect(normalizeSettings({ ...base, range: [2030, 2040] }, years).range).toEqual([2010, 2010]);
    });

    it('replaces an unavailable base year with the default, then the latest year', () => {
      expect(normalizeSettings({ ...base, baseYear: 1999 }, years, { ...DEFAULT_SETTINGS, baseYear: 2007 }).baseYear).toBe(2007);
      expect(normalizeSettings({ ...base, baseYear: 1999 }, years, { ...DEFAULT_SETTINGS, baseYear: 2025 }).baseYear).toBe(2010);
    });

    it('keeps a valid base year', () => {
      expect(normalizeSettings(base, years).baseYear).toBe(2008);
    });
  });

  it('sameParams compares only the known keys', () => {
    const a = serializeSettings({ ...DEFAULT_SETTINGS, range: [2006, 2025] });
    expect(sameParams(a, { ...a })).toBe(true);
    expect(sameParams(a, { ...a, to: '2024' })).toBe(false);
    expect(sameParams(a, { flow: a.flow })).toBe(false);
  });
});
