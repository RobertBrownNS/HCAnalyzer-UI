"""QA P3-09: independent category, fund and preset sums (standard library only, no pipeline code).

Reads the EDR workbooks with qa/phase1/xlsxraw.py and assigns categories from QA's own reading of
the DFS UAS Manual class headings (checked in the 2011, 2019-20, 2021-22, 2022-23 and 2025 editions):
  revenue  31x taxes (311 Ad Valorem split out, D-19), 32x permits/fees/special assessments,
           33x intergovernmental, 34x charges for services, 35x judgments/fines/forfeits,
           36x miscellaneous, 38x other sources,
           39x "Other Sources, Continued" (2011, 2019-20) -> other_sources through FY 2020-21,
               "Proprietary Non-Operating Sources" (2021-22 on) -> FY 2021-22 onward
  expense  51x..58x by function, 59x "Other Nonoperating" (separate class in every edition),
           60x-76x court-related.
Compares, for both counties, every FY and both flows (custodial excluded):
  - category sums vs EDR total (Total Account minus Custodial) and vs the pipeline's category field;
  - fund-type sums and preset sums (General, Governmental, All) vs transform.ts (dump-transform.mts);
  - category sums vs transform.ts buildCategorySeries.
Usage: python -I qa/phase3/sums_check.py <repoRoot> <transform-dump.json>
"""
import json
import os
import sys
from collections import defaultdict
from decimal import Decimal

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'phase1'))
sys.path.insert(0, os.path.join(HERE, '..', 'phase4a'))
from xlsxraw import read_workbook, col_to_num  # noqa: E402
import logerx_check as L  # noqa: E402  (its read_edr is stdlib-only and pipeline-free)

ROOT, DUMP = sys.argv[1], sys.argv[2]
L.ROOT = ROOT
REV = {31: 'other_taxes', 32: 'permits_fees_special_assessments', 33: 'intergovernmental', 34: 'charges_for_services',
       35: 'judgments_fines_forfeits', 36: 'miscellaneous', 38: 'other_sources'}
EXP = {51: 'general_government', 52: 'public_safety', 53: 'physical_environment', 54: 'transportation',
       55: 'economic_environment', 56: 'human_services', 57: 'culture_recreation', 58: 'other_uses', 59: 'other_nonoperating'}
GOVERNMENTAL = {'general', 'special_revenue', 'debt_service', 'capital', 'permanent'}


def category(flow, code, fy):
    major = int(float(code))
    group = major // 10
    if flow == 'revenue':
        if major == 311:
            return 'ad_valorem'
        if group == 39:
            return 'other_sources' if fy <= 2021 else 'proprietary_nonoperating_sources'
        return REV[group]
    if 600 <= major <= 769:
        return 'court_related'
    return EXP[group]


def edr_totals(county, flow):
    """Total Account minus Custodial from each sheet's total row (EDR's recalculation)."""
    out = {}
    for sh in read_workbook(os.path.join(ROOT, 'data', 'raw', 'edr', f'{county}county{"revenues" if flow == "revenue" else "expenditures"}.xlsx')):
        hdr = {sh.text(4, c): c for c in range(4, 18)}
        for r in range(1, sh.max_row + 1):
            if sh.text(r, 1).startswith('Total - All'):
                total = sh.val(r, hdr.get('Total Account') or hdr.get('Account Total'))
                cust = sh.val(r, hdr['Custodial']) if 'Custodial' in hdr else 0
                out[int(sh.name)] = Decimal(str(int(total))) - Decimal(str(int(cust)))
    return out


def main():
    dump = json.load(open(DUMP, encoding='utf-8'))
    presets = {p['id']: set(p['funds']) for p in json.load(open(os.path.join(ROOT, 'src/assets/data/funds.json')))['presets']}
    assert presets['governmental'] == GOVERNMENTAL, presets['governmental']
    problems = 0
    moved59 = 0
    rows39 = []
    for county in ('hillsborough', 'pinellas'):
        obs = json.load(open(os.path.join(ROOT, 'src/assets/data', f'{county}.observations.json')))
        for flow in ('revenue', 'expenditure'):
            edr, _ = L.read_edr(county, flow)
            totals = edr_totals(county, flow)
            T = dump[f'{county}|{flow}']
            pipe_cat = defaultdict(lambda: defaultdict(Decimal))
            for o in obs:
                if o['flow'] == flow and o['fundType'] != 'custodial':
                    pipe_cat[o['fiscalYear']][o['category']] += Decimal(str(o['amount']))
            checks = 0
            for fy in sorted(edr):
                cats = defaultdict(Decimal)
                funds = defaultdict(Decimal)
                for (code, fund), amt in edr[fy].items():
                    if fund == 'custodial' or not amt:
                        continue
                    c = category(flow, code, fy)
                    cats[c] += amt
                    funds[fund] += amt
                    if flow == 'expenditure' and int(float(code)) // 10 == 59:
                        moved59 += 1
                    if flow == 'revenue' and int(float(code)) // 10 == 39:
                        rows39.append((county, fy, code, fund, c))
                total = sum(cats.values())
                presets_mine = {
                    'general': funds.get('general', Decimal(0)),
                    'governmental': sum(v for f, v in funds.items() if f in GOVERNMENTAL),
                    'all': sum(funds.values()),
                    'default': sum(funds.values()),
                }

                def cmp(label, mine, theirs):
                    nonlocal problems, checks
                    checks += 1
                    if theirs is None or Decimal(str(theirs)) != mine:
                        problems += 1
                        print(f'  MISMATCH {county} {flow} FY{fy} {label}: mine {mine} vs {theirs}')

                cmp('category sum vs EDR total', total, totals[fy])
                for c, v in cats.items():
                    cmp(f'category {c} vs pipeline', v, pipe_cat[fy].get(c))
                    cmp(f'category {c} vs transform', v, T['categories'].get(c, {}).get(str(fy)))
                for c in set(pipe_cat[fy]) - set(cats):
                    cmp(f'pipeline-only category {c}', Decimal(0), pipe_cat[fy][c])
                for name, v in presets_mine.items():
                    cmp(f'preset {name} vs transform', v, T['totals'][name].get(str(fy)))
                for f in T['availableFunds']:
                    if f == 'custodial':
                        continue
                    cmp(f'fund {f} vs transform', funds.get(f, Decimal(0)), T['totals'].get(f'fund:{f}', {}).get(str(fy)))
            print(f'{county:12s} {flow:11s} years {min(edr)}-{max(edr)}: {checks} comparisons')
    print(f'59x expenditure cells (non-custodial, non-zero), both counties: {moved59}')
    print(f'39x revenue cells: {rows39}')
    print(f'problems: {problems}')
    return problems


if __name__ == '__main__':
    sys.exit(1 if main() else 0)
