"""QA P3-10 / QA-41: category palette distinctness, stdlib only.

Reads $categories and chart-total from src/styles/_tokens.scss and reports, for light and dark:
exact duplicates, and the closest pairs by CIE76 delta-E in normal vision and simulated protanopia,
deuteranopia and tritanopia (Machado et al. 2009, severity 1.0). Only the first N categories are
used in a flow; N per flow comes from categories.json.
Usage: python -I qa/phase3/palette_check.py <repo root>
"""
import json
import re
import sys
from itertools import combinations

root = sys.argv[1]
scss = open(f'{root}/src/styles/_tokens.scss', encoding='utf-8').read()
block = scss[scss.index('$categories: ('):]
block = block[:block.index(');')]
pairs = re.findall(r'\((#[0-9a-fA-F]{6}),\s*(#[0-9a-fA-F]{6})\)', block)
total = re.search(r'chart-total:\s*\((#[0-9a-fA-F]{6}),\s*(#[0-9a-fA-F]{6})\)', scss).groups()
tile = re.search(r'\btile:\s*\((#[0-9a-fA-F]{6}),\s*(#[0-9a-fA-F]{6})\)', scss).groups()
cats = json.load(open(f'{root}/src/assets/data/categories.json', encoding='utf-8'))
per_flow = {f: sum(1 for c in cats if c['flow'] == f) for f in ('revenue', 'expenditure')}

MACHADO = {
    'protan': ((0.152286, 1.052583, -0.204868), (0.114503, 0.786281, 0.099216), (-0.003882, -0.048116, 1.051998)),
    'deutan': ((0.367322, 0.860646, -0.227968), (0.280085, 0.672501, 0.047413), (-0.011820, 0.042940, 0.968881)),
    'tritan': ((1.255528, -0.076749, -0.178779), (-0.078411, 0.930809, 0.147602), (0.004733, 0.691367, 0.303900)),
}


def lin(c):
    c /= 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rgb(h):
    return [lin(int(h[i:i + 2], 16)) for i in (1, 3, 5)]


def sim(lrgb, kind):
    if kind == 'normal':
        return lrgb
    m = MACHADO[kind]
    return [min(1, max(0, sum(m[r][k] * lrgb[k] for k in range(3)))) for r in range(3)]


def lab(lrgb):
    r, g, b = lrgb
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
    f = lambda t: t ** (1 / 3) if t > 216 / 24389 else (24389 / 27 * t + 16) / 116
    fx, fy, fz = f(x), f(y), f(z)
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)


def de(a, b):
    return sum((p - q) ** 2 for p, q in zip(a, b)) ** 0.5


def lum(h):
    r, g, b = rgb(h)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


print(f'{len(pairs)} category colours; categories per flow {per_flow}; total {total}; tile {tile}')
for mode, idx in (('light', 0), ('dark', 1)):
    cols = [p[idx] for p in pairs]
    dups = len(cols) - len({c.lower() for c in cols})
    print(f'== {mode}: exact duplicates among categories: {dups}; total in categories: {total[idx].lower() in {c.lower() for c in cols}}')
    for flow, n in per_flow.items():
        named = [(f'c{i + 1}', c) for i, c in enumerate(cols[:n])] + [('total', total[idx])]
        for kind in ('normal', 'protan', 'deutan', 'tritan'):
            labs = {k: lab(sim(rgb(h), kind)) for k, h in named}
            close = sorted((de(labs[a], labs[b]), a, b) for (a, _), (b, _) in combinations(named, 2))[:3]
            print(f'   {flow:11} {kind:6} closest: ' + ', '.join(f'{a}-{b} {d:.1f}' for d, a, b in close))
    low = [(f'c{i + 1}', h, round(contrast(h, tile[idx]), 2)) for i, h in enumerate(cols) if contrast(h, tile[idx]) < 1.5]
    print(f'   contrast vs tile < 1.5:1: {low}  (total {contrast(total[idx], tile[idx]):.2f}:1)')
