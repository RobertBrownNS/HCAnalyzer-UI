import { FundsFile } from './models';
import { categoryLabel, fundGroups, fundLabel, fundScopeText, fundsIncludedText, humanize, matchingPreset } from './scope';

const meta: FundsFile = {
  groups: [
    { id: 'governmental', label: 'Governmental funds' },
    { id: 'proprietary', label: 'Proprietary funds' },
    { id: 'fiduciary', label: 'Fiduciary funds' },
  ],
  funds: [
    { id: 'general', label: 'General', group: 'governmental' },
    { id: 'special_revenue', label: 'Special Revenue', group: 'governmental' },
    { id: 'capital', label: 'Capital Projects', group: 'governmental' },
    { id: 'enterprise', label: 'Enterprise', group: 'proprietary' },
    { id: 'custodial', label: 'Custodial', group: 'fiduciary', handledByToggle: 'custodial' },
    { id: 'pension', label: 'Pension', group: 'fiduciary' },
  ],
  presets: [
    { id: 'general', label: 'General Fund', funds: ['general'] },
    { id: 'governmental', label: 'Governmental funds', funds: ['general', 'special_revenue', 'capital', 'permanent'] },
    { id: 'all', label: 'All funds', funds: ['general', 'special_revenue', 'capital', 'enterprise', 'pension'] },
  ],
};

describe('fund and category wording', () => {
  it('labels come from the metadata, else readable ids (never guessed names)', () => {
    expect(fundLabel('capital', meta)).toBe('Capital Projects');
    expect(fundLabel('component_unit', meta)).toBe('Component unit');
    expect(fundLabel('capital', null)).toBe('Capital');
    expect(humanize('internal_service')).toBe('Internal service');
    expect(categoryLabel('ad_valorem', [{ id: 'ad_valorem', flow: 'revenue', label: 'Ad Valorem Taxes' }])).toBe('Ad Valorem Taxes');
    expect(categoryLabel('ad_valorem', null)).toBe('Ad valorem');
  });

  describe('fundGroups', () => {
    it('groups available funds in funds.json order and leaves out the custodial toggle fund', () => {
      const groups = fundGroups(['pension', 'general', 'custodial', 'enterprise', 'special_revenue'], meta);
      expect(groups.map((g) => [g.label, g.funds.map((f) => f.label)])).toEqual([
        ['Governmental funds', ['General', 'Special Revenue']],
        ['Proprietary funds', ['Enterprise']],
        ['Fiduciary funds', ['Pension']],
      ]);
    });

    it('keeps funds the metadata does not list, under "Other funds"', () => {
      const groups = fundGroups(['general', 'mystery'], meta);
      expect(groups.at(-1)).toEqual({ id: 'other', label: 'Other funds', funds: [{ id: 'mystery', label: 'Mystery' }] });
    });

    it('without metadata: one group of every available fund', () => {
      expect(fundGroups(['general', 'enterprise'], null)).toEqual([
        { id: 'all', label: 'Funds', funds: [{ id: 'general', label: 'General' }, { id: 'enterprise', label: 'Enterprise' }] },
      ]);
    });
  });

  describe('matchingPreset', () => {
    const available = ['general', 'special_revenue', 'capital', 'enterprise'];

    it('matches a preset on the funds this county reports', () => {
      expect(matchingPreset(['general'], available, meta)).toBe('general');
      // "permanent" isn't reported here, so the governmental preset is these three.
      expect(matchingPreset(['capital', 'general', 'special_revenue'], available, meta)).toBe('governmental');
      // No selection = every fund = the All preset (pension isn't reported here).
      expect(matchingPreset(null, available, meta)).toBe('all');
    });

    it('anything else is "custom" (P3-05)', () => {
      expect(matchingPreset(['general', 'enterprise'], available, meta)).toBe('custom');
      expect(matchingPreset(['general'], available, null)).toBe('custom');
    });
  });

  describe('fundScopeText', () => {
    const available = ['general', 'special_revenue', 'capital', 'enterprise'];

    it('is the preset name, else the funds in column order, else a count', () => {
      expect(fundScopeText(['general'], available, meta)).toBe('General Fund');
      // The every-fund scope uses its full name (QA-42); the short form is the preset label (chip).
      expect(fundScopeText(null, available, meta)).toBe('All funds as reported by EDR');
      expect(fundScopeText(['capital', 'enterprise', 'general', 'special_revenue'], available, meta)).toBe(
        'All funds as reported by EDR',
      );
      expect(fundScopeText(null, available, meta, 'short')).toBe('All funds');
      expect(fundScopeText(['general'], available, meta, 'short')).toBe('General Fund');
      expect(fundScopeText(['enterprise', 'general'], available, meta)).toBe('Funds: General, Enterprise');
      expect(fundScopeText(['capital', 'enterprise', 'special_revenue'], ['general', ...available.slice(1), 'pension'], meta)).toBe(
        'Funds: Special Revenue, Capital Projects, Enterprise',
      );
      expect(fundScopeText(['capital', 'enterprise', 'pension', 'special_revenue'], [...available, 'pension'], meta)).toBe(
        'Funds: 4 of 5 selected',
      );
    });

    it('without metadata, no selection reads "All funds as reported by EDR"', () => {
      expect(fundScopeText(null, available, null)).toBe('All funds as reported by EDR');
    });
  });

  it('fundsIncludedText names each included fund this county reports (QA-07)', () => {
    expect(fundsIncludedText(['pension', 'general', 'enterprise'], ['general', 'enterprise', 'pension'], meta)).toBe(
      'Includes General, Enterprise and Pension.',
    );
    expect(fundsIncludedText(['general', 'permanent'], ['general'], meta)).toBe('Includes General.');
    expect(fundsIncludedText(['permanent'], ['general'], meta)).toBe('');
  });
});
