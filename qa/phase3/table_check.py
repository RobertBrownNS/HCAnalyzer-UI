"""QA P3-10: re-derive every cell of the on-screen category tables from the raw files (stdlib only).

Inputs: the p3probe.mjs results.json and the repo root of the build under test. For each probed
table, recompute each category value from the EDR xlsx (QA's UAS class mapping, sums_check.py),
FLcopops population and BLS CPI (exact half-up fiscal-year means), apply the measure, format like
the UI, and compare the strings. Shares: category / selected total x 100, one decimal; also checks
that each row's shares add to 100.0% before rounding.
Usage: python -I qa/phase3/table_check.py <results.json> <repoRoot>
"""
import json
import os
import sys
from collections import defaultdict
from decimal import ROUND_HALF_UP, Decimal
from urllib.parse import parse_qs

sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', 'phase1'))
sys.path.insert(0, os.path.join(HERE, '..', 'phase4a'))
import logerx_check as L  # noqa: E402
from sums_check import category  # noqa: E402
from xlsxraw import read_workbook  # noqa: E402

RES, ROOT = sys.argv[1], sys.argv[2]
L.ROOT = ROOT
cats_meta = json.load(open(os.path.join(ROOT, 'src/assets/data/categories.json'), encoding='utf-8'))
LABEL_TO_ID = {(c['flow'], c['label']): c['id'] for c in cats_meta}


def pop(county):
    sheets = {s.name: s for s in read_workbook(os.path.join(ROOT, 'data/raw/edr-population/FLcopops.xlsx'))}
    out = {}
    for y in range(2004, 2026):
        for n in (f'{y} Revised BEBR', f'{y} BEBR', f'{y} Census'):
            if n in sheets:
                s = sheets[n]
                for r in range(1, s.max_row + 1):
                    if s.text(r, 1).replace('*', '').strip().lower() == county:
                        out[y] = Decimal(str(int(s.val(r, 2))))
                break
    return out


def cpi_fy(sid):
    d = json.load(open(os.path.join(ROOT, f'data/raw/bls/{sid}.json')))
    o = {}
    for q in d['requests']:
        for p in q['response']['Results']['series'][0]['data']:
            o[(int(p['year']), p['period'])] = p['value']
    out = {}
    for y in range(2001, 2027):
        if sid == 'CUUR0000SA0':
            ks = [(y - 1, f'M{m:02d}') for m in (10, 11, 12)] + [(y, f'M{m:02d}') for m in range(1, 10)]
        else:
            ks = [(y - 1, 'M11')] + [(y, f'M{m:02d}') for m in (1, 3, 5, 7, 9)]
        if all(k in o and o[k] != '-' for k in ks):
            out[y] = (sum(Decimal(o[k]) for k in ks) / len(ks)).quantize(Decimal('0.001'), ROUND_HALF_UP)
    return out


def money(v, cents):
    q = Decimal('0.01') if cents else Decimal('1')
    v = v.quantize(q, ROUND_HALF_UP)
    s = f'{abs(v):,.2f}' if cents else f'{abs(v):,.0f}'
    return ('-' if v < 0 else '') + '$' + s


def main():
    R = json.load(open(RES, encoding='utf-8'))
    cache = {}
    bad = total_cells = 0
    for name, r in R.items():
        q = {k: v[0] for k, v in parse_qs(r['search'].lstrip('?')).items()}
        county, flow, measure = q.get('county', 'hillsborough'), q['flow'], q['measure']
        funds = set(q['funds'].split(',')) if 'funds' in q else None
        key = (county, flow)
        if key not in cache:
            cache[key] = L.read_edr(county, flow)[0]
        edr = cache[key]
        P = pop(county)
        cpi = cpi_fy('CUUR0000SA0' if q.get('cpi', 'cpi-u-us') == 'cpi-u-us' else 'CUURS35DSA0')
        base = int(q['base'])
        for t in r['tables']:
            head = t['head']
            ids = [LABEL_TO_ID.get((flow, h)) for h in head[1:]]
            for row in t['rows']:
                fy = int(row[0][3:7]) + 1
                sums = defaultdict(Decimal)
                for (code, fund), amt in edr[fy].items():
                    if fund == 'custodial' or (funds and fund not in funds):
                        continue
                    sums[category(flow, code, fy)] += amt
                selected = [i for i in ids if i]
                tot = sum(sums.values())
                share_sum = Decimal(0)
                for col, cid in zip(row[1:], ids):
                    if name.endswith('share') or 'share' in name:
                        v = sums.get(cid, Decimal(0)) if cid else tot
                        pct = (v / tot * 100) if tot else None
                        if cid:
                            share_sum += pct
                        exp = f'{pct.quantize(Decimal("0.1"), ROUND_HALF_UP)}%' if pct is not None else '—'
                    else:
                        v = sums.get(cid, Decimal(0)) if cid else sum(sums.get(i, Decimal(0)) for i in selected)
                        if measure in ('per_capita', 'real_per_capita'):
                            v = v / P[fy]
                        if measure in ('real', 'real_per_capita'):
                            v = v * cpi[base] / cpi[fy]
                        exp = money(v, measure in ('per_capita', 'real_per_capita'))
                    total_cells += 1
                    if exp != col:
                        bad += 1
                        print(f'  MISMATCH {name} {row[0]} {cid or "Total"}: screen {col} expected {exp}')
                if 'share' in name and abs(share_sum - 100) > Decimal('1e-9'):
                    bad += 1
                    print(f'  SHARES {name} {row[0]} sum {share_sum}')
        print(f'{name:18s} checked {sum(len(t["rows"]) for t in r["tables"])} rows')
    print(f'cells compared {total_cells}, mismatches {bad}')


if __name__ == '__main__':
    main()
