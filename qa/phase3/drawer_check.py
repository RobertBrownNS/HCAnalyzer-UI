"""QA P3-10: check every source-drawer account row against the raw EDR workbook (stdlib only).

For each drawer dumped by drawer.mjs: every row's cell ref must hold exactly the row's amount and
account in the raw xlsx, and the rows must be exactly the non-zero cells of that year, flow,
fund selection and category (nothing missing, nothing extra).
Usage: python -I qa/phase3/drawer_check.py <drawer.json> <repoRoot>
"""
import json
import os
import re
import sys
from decimal import Decimal
from urllib.parse import parse_qs

sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', 'phase1'))
sys.path.insert(0, os.path.join(HERE, '..', 'phase4a'))
import logerx_check as L  # noqa: E402
from sums_check import category  # noqa: E402
from xlsxraw import col_to_num, read_workbook  # noqa: E402

DRAWERS, ROOT = sys.argv[1], sys.argv[2]
L.ROOT = ROOT
cats = json.load(open(os.path.join(ROOT, 'src/assets/data/categories.json'), encoding='utf-8'))
wb_cache = {}


def sheet(county, flow, fy):
    k = (county, flow)
    if k not in wb_cache:
        wb_cache[k] = {s.name: s for s in read_workbook(os.path.join(ROOT, 'data/raw/edr', f'{county}county{"revenues" if flow == "revenue" else "expenditures"}.xlsx'))}
    return wb_cache[k][str(fy)]


def main():
    bad = 0
    for d in json.load(open(DRAWERS, encoding='utf-8')):
        q = {k: v[0] for k, v in parse_qs(d['query'].lstrip('?')).items()}
        county, flow = q.get('county', 'hillsborough'), q.get('flow', 'revenue')
        funds = set(q['funds'].split(',')) if 'funds' in q else None
        fy = int(d['fy'][3:7]) + 1
        cat_id = next((c['id'] for c in cats if c['flow'] == flow and c['label'] == d['column']), None)
        sh = sheet(county, flow, fy)
        seen = set()
        for account, name, fund, amount, ref in d['drawer']['rows']:
            m = re.match(r'(?:\w+:)?(\d{4})!([A-Z]+)(\d+)$', ref)
            r, c = int(m.group(3)), col_to_num(m.group(2))
            v = sh.val(r, c)
            code = sh.val(r, 2)
            amt = Decimal(amount.replace('$', '').replace(',', '').replace('(', '-').replace(')', ''))
            if Decimal(str(int(v))) != amt or abs(code - float(account)) > 1e-9:
                bad += 1
                print(f'  ROW MISMATCH {d["name"]} {ref}: drawer {account} {amount}, xlsx {code} {v}')
            seen.add((account, ref))
        # Expected rows: all non-zero, non-custodial cells in scope (and in the category, if any).
        edr, refs = L.read_edr(county, flow)
        expected = set()
        for (code, fund), amt in edr[fy].items():
            if fund == 'custodial' or not amt or (funds and fund not in funds):
                continue
            if cat_id and category(flow, code, fy) != cat_id:
                continue
            expected.add((code, refs[(fy, code, fund)]))
        got = {(a, re.sub(r'^\w+:', '', ref)) for a, ref in seen}
        if got != expected:
            bad += 1
            print(f'  SET MISMATCH {d["name"]}: missing {sorted(expected - got)[:5]} extra {sorted(got - expected)[:5]}')
        print(f'{d["name"]:26s} rows {len(seen):3d} ok' if got == expected else '')
    print('problems', bad)


if __name__ == '__main__':
    main()
