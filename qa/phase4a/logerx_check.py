"""QA P4a-05/07: independent LOGERX reconciliation (standard library only, no pipeline code).

Reads the committed per-county LOGERX extracts (data/raw/logerx/<county>/*.csv) and the EDR AFR
workbooks (data/raw/edr/*.xlsx, via qa/phase1/xlsxraw.py), and compares every
fiscal year x flow x account x fund amount.

Mapping, as documented in docs/data-layout.md and re-implemented here independently:
- LOGERX "Account" is "NNN.ddd - Name". The code is NNN.ddd with trailing zeros dropped
  (312.410 -> 312.41, 311.000 -> 311). "NNN.xxx" (catch-all) -> NNN.
- Revenue rows split by Dwelling Type / Fee Type and expenditure rows split by Object Code are
  summed to (account, fund).

Usage: python -I qa/phase4a/logerx_check.py [repo_root]   (prints counts, differences and a sample)
"""
import csv
import io
import os
import re
import sys
from collections import defaultdict
from decimal import Decimal

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'phase1'))
from xlsxraw import read_workbook  # noqa: E402

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', '..'))
FUNDS = {
    'general': 'general', 'special revenue': 'special_revenue', 'debt service': 'debt_service',
    'capital projects': 'capital', 'permanent': 'permanent', 'enterprise': 'enterprise',
    'internal service': 'internal_service', 'custodial': 'custodial', 'pension': 'pension',
    'trust': 'trust', 'private purpose': 'private_purpose', 'component units': 'component_unit',
}
ENTITY = {'hillsborough': '100029', 'pinellas': '100052'}


def norm_code(text):
    m = re.match(r'^\s*(\d{3})\.(\d{2,3}|xxx)\s*-', text)
    if not m:
        raise ValueError(f'unparsed account: {text!r}')
    whole, frac = m.groups()
    if frac == 'xxx':
        return whole, True
    code = f'{whole}.{frac}'.rstrip('0').rstrip('.')
    return code, False


def read_logerx(county, flow):
    """{fy: {(code, fund): Decimal}}, plus provenance {(fy, code, fund): [rows]} and stats."""
    out = defaultdict(lambda: defaultdict(Decimal))
    prov = defaultdict(list)
    stats = defaultdict(int)
    d = os.path.join(ROOT, 'data', 'raw', 'logerx', county)
    for name in sorted(os.listdir(d)):
        m = re.match(rf'{"revenues" if flow == "revenue" else "expenditures"}-fy(\d{{4}})\.csv$', name)
        if not m:
            continue
        fy = int(m.group(1))
        raw = open(os.path.join(d, name), 'rb').read()
        stats['crlf'] += raw.count(b'\r\n')
        rows = list(csv.reader(io.StringIO(raw.decode('utf-8'))))
        header = [h.strip() for h in rows[0]]
        fund_cols = {i: FUNDS[h.lower()] for i, h in enumerate(header) if h.lower() in FUNDS}
        assert len(fund_cols) == 12, (name, header)
        for line_no, r in enumerate(rows[1:], start=2):
            if r[0] != ENTITY[county]:
                stats['wrong_entity'] += 1
            code, xxx = norm_code(r[2])
            stats['xxx_rows'] += xxx
            for i, fund in fund_cols.items():
                v = r[i].strip()
                if not v:
                    continue
                amt = Decimal(v)
                if amt != amt.to_integral_value():
                    stats['non_integer'] += 1
                out[fy][(code, fund)] += amt
                prov[(fy, code, fund)].append(f'{name}:{line_no}')
    return out, prov, stats


def read_edr(county, flow):
    """{fy: {(code, fund): Decimal}} from the raw EDR xlsx account rows, plus cell refs."""
    wb = read_workbook(os.path.join(ROOT, 'data', 'raw', 'edr', f'{county}county{"revenues" if flow == "revenue" else "expenditures"}.xlsx'))
    out = defaultdict(dict)
    refs = {}
    for sh in wb:
        fy = int(sh.name)
        hdr = next(r for r in range(1, 11) if any(sh.text(r, c).lower() == 'general' for c in range(1, 30)))
        cols = {c: FUNDS[sh.text(hdr, c).lower()] for c in range(1, 40) if sh.text(hdr, c).lower() in FUNDS}
        for r in range(hdr + 1, sh.max_row + 1):
            b = sh.get(r, 2)
            if b is None or b.type == 's' or not isinstance(b.value, float):
                continue
            code = repr(float(b.raw))
            code = code[:-2] if code.endswith('.0') else code
            for c, fund in cols.items():
                v = sh.val(r, c)
                if v:
                    out[fy][(code, fund)] = Decimal(str(int(v))) if v == int(v) else Decimal(str(v))
                    refs[(fy, code, fund)] = f'{sh.name}!{chr(64 + c)}{r}'
    return out, refs


def main():
    totals = {}
    for county in ('hillsborough', 'pinellas'):
        for flow in ('revenue', 'expenditure'):
            lx, prov, stats = read_logerx(county, flow)
            edr, refs = read_edr(county, flow)
            compared = matched = 0
            diffs = []
            year_totals_equal = 0
            for fy in sorted(lx):
                a, b = lx[fy], edr.get(fy, {})
                keys = {k for k, v in a.items() if v != 0} | {k for k, v in b.items() if v != 0}
                for k in sorted(keys):
                    compared += 1
                    va, vb = a.get(k, Decimal(0)), b.get(k, Decimal(0))
                    if va == vb:
                        matched += 1
                    else:
                        diffs.append((fy, k, va, vb, refs.get((fy,) + k), prov.get((fy,) + k)))
                year_totals_equal += sum(a.values()) == sum(b.values())
            totals[(county, flow)] = (compared, matched, diffs)
            print(f'== {county} {flow}: years {min(lx)}-{max(lx)} ({len(lx)}), cells compared {compared:,}, matched {matched:,}, '
                  f'differing cells {len(diffs)}, year totals equal {year_totals_equal}/{len(lx)}, stats {dict(stats)}')
            for fy, k, va, vb, ref, pv in diffs:
                print(f'     FY{fy} account {k[0]:>8} {k[1]:16s} LOGERX {va:>14,} EDR {vb:>14,}  EDR ref {ref}  LOGERX rows {pv}')
    return totals


if __name__ == '__main__':
    main()
