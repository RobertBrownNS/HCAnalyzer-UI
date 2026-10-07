"""QA P4a-07: re-create a per-county LOGERX extract from a statewide report xlsx, independently.

Rules (docs/data-layout.md, re-implemented without pipeline code): header = row 3, data from row 4;
keep every row whose Code equals the entity code, all columns verbatim; sort by Account, then the
remaining non-fund columns, then the whole row; CSV with \\n line endings.

Usage: python -I qa/phase4a/logerx_extract.py <report.xlsx> <entityCode> <out.csv>
Prints the sha256 of the result and of the first differing line, if a committed file is given as 4th arg.
"""
import csv
import hashlib
import io
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'phase1'))
from xlsxraw import read_workbook  # noqa: E402

FUND_NAMES = {'general', 'special revenue', 'debt service', 'capital projects', 'permanent', 'enterprise',
              'internal service', 'custodial', 'pension', 'trust', 'private purpose', 'component units'}


def text(cell):
    if cell is None or cell.value is None:
        return ''
    v = cell.value
    if isinstance(v, float):
        return str(int(v)) if v == int(v) else repr(v)
    return str(v)


def main():
    src, entity, out = sys.argv[1:4]
    committed = sys.argv[4] if len(sys.argv) > 4 else None
    sh = read_workbook(src)[0]
    title = sh.text(1, 1)
    ncols = max(c for (r, c) in sh.cells if r == 3)
    header = [text(sh.get(3, c)) for c in range(1, ncols + 1)]
    rows = []
    for r in range(4, sh.max_row + 1):
        row = [text(sh.get(r, c)) for c in range(1, ncols + 1)]
        if row[0] == entity:
            rows.append(row)
    acct = header.index('Account')
    nonfund = [i for i, h in enumerate(header) if h.strip().lower() not in FUND_NAMES and i != acct]
    rows.sort(key=lambda r: (r[acct], [r[i] for i in nonfund], r))
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator='\n')
    w.writerow(header)
    w.writerows(rows)
    data = buf.getvalue().encode('utf-8')
    open(out, 'wb').write(data)
    print(f'title: {title!r}')
    print(f'header: {header}')
    print(f'rows for {entity}: {len(rows)}  bytes {len(data)}  sha256 {hashlib.sha256(data).hexdigest()}')
    if committed:
        ref = open(committed, 'rb').read()
        print(f'committed: bytes {len(ref)} sha256 {hashlib.sha256(ref).hexdigest()}  identical: {ref == data}')
        if ref != data:
            a, b = ref.decode('utf-8').split('\n'), data.decode('utf-8').split('\n')
            for i, (x, y) in enumerate(zip(a, b)):
                if x != y:
                    print(f'first difference at line {i + 1}:\n  committed: {x!r}\n  mine:      {y!r}')
                    break
            else:
                print(f'line counts differ: committed {len(a)} mine {len(b)}')


if __name__ == '__main__':
    main()
