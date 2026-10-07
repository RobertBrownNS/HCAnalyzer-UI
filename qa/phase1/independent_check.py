"""QA P1-09: independent re-derivation of Phase 1 outputs from data/raw/.

Run from repo root:  python -I qa/phase1/independent_check.py
Uses only the Python standard library (zipfile + ElementTree); shares no code with
scripts/pipeline (exceljs). Prints findings; exits 1 if any hard check fails.
"""
import hashlib
import json
import os
import random
import re
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from xlsxraw import read_workbook, num_to_col  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
RAW = os.path.join(ROOT, 'data', 'raw')
OUT = os.path.join(ROOT, 'src', 'assets', 'data')

FAILS = []
NOTES = []


def fail(msg):
    FAILS.append(msg)
    print('FAIL', msg)


def note(msg):
    NOTES.append(msg)
    print('NOTE', msg)


def ok(msg):
    print('ok  ', msg)


# My own header -> fundType mapping, written from CLAUDE.md, not copied from funds.ts
MY_FUNDS = {
    'general': 'general', 'special revenue': 'special_revenue', 'debt service': 'debt_service',
    'capital projects': 'capital', 'permanent': 'permanent', 'enterprise': 'enterprise',
    'internal service': 'internal_service', 'custodial': 'custodial', 'pension': 'pension',
    'trust': 'trust', 'private purpose': 'private_purpose', 'component units': 'component_unit',
}


def norm(s):
    return re.sub(r'\s+', ' ', str(s or '')).strip()


def parse_afr(path, flow):
    sheets = read_workbook(path)
    result = {}
    for sh in sheets:
        where = f'{flow}!{sh.name}'
        # title row
        fy = None
        title_row = None
        for r in range(1, 8):
            for c in range(1, 18):
                m = re.search(r'Fiscal Year Ended September 30,\s*(\d{4})', sh.text(r, c))
                if m:
                    fy, title_row = int(m.group(1)), r
                    break
            if fy:
                break
        if fy is None:
            fail(f'{where}: no FY title')
            continue
        if str(fy) != sh.name:
            fail(f'{where}: title FY {fy} != sheet name')
        # header row: any row in 1..10 with a cell exactly "General"
        hdr = None
        for r in range(1, 11):
            if any(norm(sh.val(r, c)).lower() == 'general' for c in range(1, 30)):
                hdr = r
                break
        cols = {}
        total_col = pc_col = None
        for c in range(1, 40):
            t = norm(sh.val(hdr, c)).lower()
            if not t and 'per capita' in norm(sh.val(hdr - 1, c)).lower():
                t = norm(sh.val(hdr - 1, c)).lower()  # merged vertically from row 3
            if not t:
                continue
            if t in MY_FUNDS:
                cols[c] = MY_FUNDS[t]
            elif 'per capita' in t:
                pc_col = c
            elif 'total' in t:
                total_col = c
            else:
                note(f'{where}: header {num_to_col(c)}{hdr} = {t!r} not a fund')
        # any numeric cell under a column with no header (below header row)?
        known = set(cols) | {total_col, pc_col, 1, 2, 3}
        for (r, c), cell in sh.cells.items():
            if r > hdr and c not in known and isinstance(cell.value, float):
                # population value sits in pc_col; label left of it. anything else is unexpected
                fail(f'{where}: numeric cell in unmapped column {cell.ref} = {cell.value}')
        accounts = []
        grand = None
        pop = None
        for r in range(hdr + 1, sh.max_row + 1):
            b = sh.get(r, 2)
            a = sh.text(r, 1)
            if b is not None and b.type != 's' and isinstance(b.value, float):
                code_raw = b.raw
                vals = {}
                for c, fund in cols.items():
                    cell = sh.get(r, c)
                    if cell is not None and cell.formula:
                        fail(f'{where}: formula in account cell {cell.ref}')
                    v = cell.value if cell is not None else None
                    if v is not None and not isinstance(v, float):
                        fail(f'{where}: non-numeric account cell {cell.ref}={v!r}')
                        v = None
                    vals[fund] = (v if v is not None else 0.0, f'{num_to_col(c)}{r}', v is None)
                tot = sh.val(r, total_col)
                accounts.append(dict(row=r, code_raw=code_raw, code=b.value, fmt=b.style,
                                     name=norm(sh.val(r, 3)), vals=vals, total=tot, colA=a))
            elif b is not None and b.type == 's' and re.match(r'^\d{3}(\.\d+)?$', str(b.value).strip()):
                fail(f'{where}: account code stored as text at {b.ref}: {b.value!r}')
            elif a.lower().startswith('total'):
                grand = dict(row=r, label=a, funds={f: (sh.val(r, c) or 0.0) for c, f in cols.items()},
                             total=sh.val(r, total_col), pc=sh.val(r, pc_col),
                             total_formula=(sh.get(r, total_col).formula if sh.get(r, total_col) else None))
            else:
                lbl = next((sh.text(r, c) for c in range(1, pc_col) if 'population' in sh.text(r, c).lower()), '')
                if lbl:
                    pop = dict(row=r, label=lbl, value=sh.val(r, pc_col))
        result[fy] = dict(sheet=sh.name, title_row=title_row, hdr=hdr, cols=cols, total_col=total_col,
                          pc_col=pc_col, accounts=accounts, grand=grand, pop=pop, raw=sh)
    return result


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        h.update(f.read())
    return h.hexdigest()


def main():
    obs = json.load(open(os.path.join(OUT, 'hillsborough.observations.json'), encoding='utf-8'))
    sources = {s['id']: s for s in json.load(open(os.path.join(OUT, 'sources.json'), encoding='utf-8'))}
    obs_map = {}
    dup = 0
    for o in obs:
        k = (o['fiscalYear'], o['flow'], o['account'], o['fundType'])
        if k in obs_map:
            dup += 1
        obs_map[k] = o
    (fail if dup else ok)(f'duplicate observation keys: {dup}')

    parsed = {
        'revenue': parse_afr(os.path.join(RAW, 'edr', 'hillsboroughcountyrevenues.xlsx'), 'revenue'),
        'expenditure': parse_afr(os.path.join(RAW, 'edr', 'hillsboroughcountyexpenditures.xlsx'), 'expenditure'),
    }

    # ---------- full cell-by-cell comparison, every year ----------
    mine = {}
    code_issues = []
    for flow, years in parsed.items():
        for fy, sh in years.items():
            seen_codes = {}
            for acc in sh['accounts']:
                raw = acc['code_raw']
                # independent code string: shortest repr of the stored double
                code_str = repr(float(raw))
                if code_str.endswith('.0'):
                    code_str = code_str[:-2]
                if len(code_str.split('.')[-1]) > 3 and '.' in code_str:
                    code_issues.append(f'{flow} {fy} {acc["code_raw"]} has >3 decimals')
                if code_str in seen_codes:
                    fail(f'{flow} FY{fy}: code {code_str} repeated rows {seen_codes[code_str]} and {acc["row"]}')
                seen_codes[code_str] = acc['row']
                rowsum = 0.0
                for fund, (amt, ref, blank) in acc['vals'].items():
                    rowsum += amt
                    if amt != int(amt):
                        fail(f'{flow} {sh["sheet"]}!{ref}: non-integer {amt}')
                    if amt != 0:
                        mine[(fy, flow, code_str, fund)] = (amt, f'{sh["sheet"]}!{ref}')
                if acc['total'] is not None and abs(rowsum - acc['total']) > 0.005:
                    fail(f'{flow} FY{fy} row {acc["row"]}: fund sum {rowsum} != row total {acc["total"]}')
    for i in code_issues:
        fail(i)
    missing = [k for k in mine if k not in obs_map]
    extra = [k for k in obs_map if k not in mine]
    wrong = [(k, mine[k], obs_map[k]['amount'], obs_map[k]['ref']) for k in mine if k in obs_map and
             (mine[k][0] != obs_map[k]['amount'] or mine[k][1] != obs_map[k]['ref'])]
    (fail if missing else ok)(f'cells in xlsx missing from observations.json: {len(missing)} {missing[:5]}')
    (fail if extra else ok)(f'observations not found in xlsx: {len(extra)} {extra[:5]}')
    (fail if wrong else ok)(f'amount/ref mismatches: {len(wrong)} {wrong[:5]}')
    print(f'     independent non-zero cells: {len(mine)}; observations.json rows: {len(obs)}')

    # ---------- per-year totals: mine vs workbook grand total; custodial ----------
    print('\nPer-year totals (independent):')
    for flow, years in parsed.items():
        for fy in sorted(years):
            sh = years[fy]
            g = sh['grand']
            per_fund = defaultdict(float)
            for (y, fl, code, fund), (amt, _) in mine.items():
                if y == fy and fl == flow:
                    per_fund[fund] += amt
            for fund, cached in g['funds'].items():
                if abs(per_fund[fund] - cached) > 0.005:
                    fail(f'{flow} FY{fy} fund {fund}: sum {per_fund[fund]} != grand total row {cached}')
            tot = sum(per_fund.values())
            if abs(tot - g['total']) > 0.005:
                fail(f'{flow} FY{fy}: sum {tot} != workbook total {g["total"]}')
            has_cust = 'custodial' in sh['cols'].values()
            if has_cust != (fy >= 2021):
                fail(f'{flow} FY{fy}: custodial column present={has_cust}')
            cust = g['funds'].get('custodial', 0.0)
            excl = tot - per_fund.get('custodial', 0.0)
            obs_excl = sum(o['amount'] for o in obs if o['fiscalYear'] == fy and o['flow'] == flow
                           and o['fundType'] != 'custodial')
            if abs(excl - obs_excl) > 0.005 or abs((g['total'] - cust) - obs_excl) > 0.005:
                fail(f'{flow} FY{fy}: excl-custodial mismatch {excl} / {g["total"] - cust} / {obs_excl}')
            pop = sh['pop']['value']
            pc = g['pc']
            if pc is None or abs(g['total'] / pop - pc) > 1e-6:
                fail(f'{flow} FY{fy}: per-capita {pc} vs {g["total"] / pop}')
            if fy in (2005, 2006, 2020, 2021, 2022, 2025):
                print(f'  {flow:11s} FY{fy - 1}-{fy % 100:02d} sheet {sh["sheet"]} title row {sh["title_row"]}: '
                      f'total {g["total"]:,.0f}  custodial {cust:,.0f}  excl {excl:,.0f}  obs_excl {obs_excl:,.0f}  '
                      f'pop {pop:,.0f} (row {sh["pop"]["row"]}: {sh["pop"]["label"]!r})  totalFormula {g["total_formula"]}')

    # Custodial column cells by year, and the 2022!K8 claim
    e22 = parsed['expenditure'][2022]
    k8 = e22['raw'].get(8, 11)
    print(f'\n2022!K8 (expenditure): {k8}  header K{e22["hdr"]} = {e22["raw"].text(e22["hdr"], 11)!r}  '
          f'code B8 = {e22["raw"].val(8, 2)}  name {e22["raw"].text(8, 3)!r}')
    # thousands check per year
    for flow, years in parsed.items():
        for fy in sorted(years):
            amts = [amt for (y, fl, _, _), (amt, _) in mine.items() if y == fy and fl == flow]
            nk = sum(1 for a in amts if a % 1000 != 0)
            if fy in (2020, 2021, 2022, 2023):
                print(f'  {flow} FY{fy}: {len(amts)} nonzero cells, {nk} not whole thousands')

    # ---------- random spot check of refs ----------
    random.seed(20261006)
    print('\nRandom 20 observation spot checks by ref:')
    books = {'revenue': {s['sheet']: s['raw'] for s in parsed['revenue'].values()},
             'expenditure': {s['sheet']: s['raw'] for s in parsed['expenditure'].values()}}
    for o in random.sample(obs, 20):
        sheet, cell = o['ref'].split('!')
        m = re.match(r'([A-Z]+)(\d+)', cell)
        from xlsxraw import col_to_num
        r, c = int(m.group(2)), col_to_num(m.group(1))
        sh = books[o['flow']][sheet]
        v = sh.val(r, c)
        code = sh.val(r, 2)
        hdr_row = parsed[o['flow']][int(sheet)]['hdr']
        hdr = norm(sh.val(hdr_row, c))
        good = v == o['amount'] and abs(code - float(o['account'])) < 1e-9 and MY_FUNDS[hdr.lower()] == o['fundType'] \
            and int(sheet) == o['fiscalYear']
        (ok if good else fail)(f'{o["flow"]:11s} {o["ref"]:9s} FY{o["fiscalYear"]} acct {o["account"]:>6s} '
                               f'{o["fundType"]:16s} json={o["amount"]:>14,.0f} xlsx={v:>14,.0f} code={code} hdr={hdr}')

    # ---------- category sanity ----------
    cats = defaultdict(set)
    for o in obs:
        cats[(o['flow'], o['category'], o['section'])].add(int(float(o['account']) // 10))
    print('\nCategory -> account prefixes (x10):')
    for k in sorted(cats):
        print('  ', k, sorted(cats[k]))
    for o in obs:
        a = float(o['account'])
        if o['flow'] == 'revenue' and (a // 1 == 311) != (o['category'] == 'ad_valorem'):
            fail(f'ad_valorem misclass {o["ref"]}')
        if o['sourceId'] not in sources:
            fail(f'unresolved sourceId {o["sourceId"]}')
        exp_src = 'edr-afr-revenues-hillsborough' if o['flow'] == 'revenue' else 'edr-afr-expenditures-hillsborough'
        if o['sourceId'] != exp_src:
            fail(f'wrong sourceId {o["ref"]} {o["sourceId"]}')

    # code string collisions: different raw doubles mapping to same string, or 312.30 vs 312.3
    by_str = defaultdict(set)
    for flow, years in parsed.items():
        for fy, sh in years.items():
            for acc in sh['accounts']:
                by_str[(flow, f'{acc["code"]:.3f}')].add(acc['code_raw'])
    coll = {k: v for k, v in by_str.items() if len(v) > 1}
    (fail if coll else ok)(f'raw code collisions at 3dp: {coll}')
    fmts = defaultdict(set)
    for flow, years in parsed.items():
        for fy, sh in years.items():
            for acc in sh['accounts']:
                fmts[flow].add(acc['fmt'])
    print('  account code number formats:', dict(fmts))
    # codes that display with a trailing zero e.g. 0.000 format -> "312.300"? capture codes with 2 decimals in UAS
    return parsed, obs, sources, mine


def check_population(parsed):
    print('\nPopulation:')
    pop = json.load(open(os.path.join(OUT, 'population.json'), encoding='utf-8'))['hillsborough']
    sheets = {s.name: s for s in read_workbook(os.path.join(RAW, 'edr-population', 'FLcopops.xlsx'))}
    print('  population sheets (first/last):', list(sheets)[:6], '...', list(sheets)[-3:])

    def hills(sheetname):
        sh = sheets[sheetname]
        for r in range(1, sh.max_row + 1):
            a = sh.text(r, 1)
            if a.replace('*', '').strip().lower() == 'hillsborough':
                return sh.val(r, 2), r, sh.text(2, 2), sh.text(3, 2)
        return None
    for y in range(2004, 2026):
        cands = [n for n in sheets if n.startswith(str(y))]
        vals = {n: hills(n) for n in cands}
        j = pop['byYear'].get(str(y))
        wb_rev = parsed['revenue'].get(y, {}).get('pop', {}) if y in parsed['revenue'] else {}
        wb_exp = parsed['expenditure'].get(y, {}).get('pop', {}) if y in parsed['expenditure'] else {}
        wbv = {wb_rev.get('value'), wb_exp.get('value')} - {None}
        msg = f'  {y}: json={j["value"] if j else None} ({j["sheet"] if j else ""})  file={ {k: v[0] for k, v in vals.items()} }  workbook={wbv}'
        good = j is not None and j['value'] in [v[0] for v in vals.values()] and (not wbv or wbv == {j['value']})
        if j and vals.get(j['sheet']) and vals[j['sheet']][0] != j['value']:
            good = False
        (ok if good else fail)(msg)
    print('  header B2/B3 of 2025 BEBR:', hills('2025 BEBR')[2:] if '2025 BEBR' in sheets else None)


def check_cpi():
    print('\nCPI (from raw BLS JSON):')
    cpi = json.load(open(os.path.join(OUT, 'cpi.json'), encoding='utf-8'))

    def load(sid):
        d = json.load(open(os.path.join(RAW, 'bls', sid + '.json'), encoding='utf-8'))
        pts = {}
        foot = {}
        assert d['seriesId'] == sid
        reqs = [r['response'] for r in d['requests']]
        for req in reqs:
            for s in req['Results']['series']:
                assert s['seriesID'] == sid, s['seriesID']
                for p in s['data']:
                    key = (int(p['year']), p['period'])
                    if key in pts and pts[key] != p['value']:
                        fail(f'{sid} conflicting duplicate {key}')
                    pts[key] = p['value']
                    if p.get('footnotes') and any(f for f in p['footnotes'] if f):
                        foot[key] = p['footnotes']
        return pts, foot, reqs
    nat, natf, natreq = load('CUUR0000SA0')
    print('  national request statuses:', [r.get('status') for r in natreq], [r.get('message') for r in natreq])
    for fy in (2006, 2007, 2020, 2021, 2022, 2025, 2026):
        months = [(fy - 1, f'M{m:02d}') for m in (10, 11, 12)] + [(fy, f'M{m:02d}') for m in range(1, 10)]
        vals = [nat.get(k) for k in months]
        have = [float(v) for v in vals if v not in (None, '-')]
        mean = sum(have) / 12 if len(have) == 12 else None
        out = cpi['national']['fiscalYear'].get(str(fy))
        missing = [k for k, v in zip(months, vals) if v in (None, '-')]
        good = (mean is None and out is None) or (mean is not None and out is not None and abs(round(mean, 3) - out) < 1e-9)
        (ok if good else fail)(f'  national FY{fy}: hand mean={mean} json={out} missing={missing}')
    print('  2025 M10 raw:', nat.get((2025, 'M10')), natf.get((2025, 'M10')), ' M13 2025:', nat.get((2025, 'M13')))
    tpa, tpaf, _ = load('CUURS35DSA0')
    for fy in (2018, 2021, 2025):
        months = [(fy - 1, 'M11')] + [(fy, f'M{m:02d}') for m in (1, 3, 5, 7, 9)]
        vals = [float(tpa[k]) for k in months]
        mean = sum(vals) / 6
        out = cpi['tampa']['fiscalYear'].get(str(fy))
        (ok if abs(round(mean, 3) - out) < 1e-9 else fail)(f'  tampa FY{fy}: hand mean={mean:.4f} json={out}')
    even = [k for k in tpa if k[1].startswith('M') and k[1] != 'M13' and int(k[1][1:]) % 2 == 0]
    print('  tampa even-month points present:', even[:5], ' earliest:', min(k for k in tpa if k[1] != 'M13'))
    early_fy = [y for y, v in cpi['tampa']['fiscalYear'].items() if int(y) < 2018 and v is not None]
    (fail if early_fy else ok)(f'  tampa non-null fiscal values before FY2018 (would imply splicing): {early_fy}')
    nulls_without_reason = [(k, y) for k in cpi for y, v in cpi[k]['fiscalYear'].items()
                            if v is None and y not in cpi[k].get('fiscalYearUnavailable', {})]
    (fail if nulls_without_reason else ok)(f'  null fiscal-year CPI without a reason: {nulls_without_reason}')
    # check tampa FY uses only tampa series (compare national-spliced impossibility)
    tsa, _, _ = load('CUUSS35DSA0')
    for y in (2005, 2017, 2025):
        print(f'  tampa semiannual {y}: S01={tsa.get((y, "S01"))} S02={tsa.get((y, "S02"))} S03={tsa.get((y, "S03"))} json CY={cpi["tampa_semiannual"]["calendarYear"].get(str(y))}')
    return cpi


def check_provenance():
    print('\nProvenance / checksums:')
    sources = json.load(open(os.path.join(OUT, 'sources.json'), encoding='utf-8'))
    for s in sources:
        missing = [k for k in ('id', 'publisher', 'title', 'url', 'retrieved', 'sha256', 'caveats') if not s.get(k) and k != 'caveats']
        rf = os.path.join(ROOT, s['rawFile'])
        h = sha256(rf) if os.path.exists(rf) else None
        (ok if (h == s['sha256'] and not missing) else fail)(f'  {s["id"]}: sha ok={h == s["sha256"]} missing={missing} retrieved={s["retrieved"]}')
    man = json.load(open(os.path.join(OUT, 'manifest.json'), encoding='utf-8'))
    for o in man['outputs']:
        p = os.path.join(OUT, o['path'])
        h = sha256(p)
        sz = os.path.getsize(p)
        (ok if (h == o['sha256'] and sz == o['bytes']) else fail)(f'  output {o["path"]}: sha ok={h == o["sha256"]} bytes ok={sz == o["bytes"]}')
    for i in man['inputs']:
        h = sha256(os.path.join(ROOT, i['path']))
        (ok if h == i['sha256'] else fail)(f'  input {i["path"]}: sha ok={h == i["sha256"]}')
    listed = {o['path'] for o in man['outputs']} | {'manifest.json'}
    on_disk = set(os.listdir(OUT))
    (ok if on_disk == listed else fail)(f'  output files on disk vs manifest: unlisted={on_disk - listed} missing={listed - on_disk}')
    rm = os.path.join(RAW, 'manifest.json')
    if os.path.exists(rm):
        raw_man = json.load(open(rm, encoding='utf-8'))
        print('  data/raw/manifest.json keys:', list(raw_man)[:5] if isinstance(raw_man, dict) else type(raw_man))


if __name__ == '__main__':
    parsed, obs, sources, mine = main()
    check_population(parsed)
    check_cpi()
    check_provenance()
    print(f'\n{len(FAILS)} FAIL, {len(NOTES)} NOTE')
    sys.exit(1 if FAILS else 0)
