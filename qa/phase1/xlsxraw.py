"""Minimal stdlib-only OOXML reader for QA. Deliberately shares no code with the pipeline
(which uses exceljs). Reads cached values (<v>), formulas (<f>), shared strings, inline strings,
hidden rows/cols, merged cells, and number formats."""
import re
import zipfile
import xml.etree.ElementTree as ET

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
      'pr': 'http://schemas.openxmlformats.org/package/2006/relationships'}
M = '{%s}' % NS['m']


def col_to_num(letters):
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n


def num_to_col(n):
    s = ''
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def split_ref(ref):
    m = re.match(r'([A-Z]+)(\d+)$', ref)
    return m.group(1), int(m.group(2))


class Cell:
    __slots__ = ('ref', 'col', 'row', 'type', 'raw', 'formula', 'style', 'value')

    def __repr__(self):
        return f'Cell({self.ref}={self.value!r}{" f="+self.formula if self.formula else ""})'


class Sheet:
    def __init__(self, name):
        self.name = name
        self.cells = {}          # (row, col) -> Cell
        self.hidden_rows = set()
        self.hidden_cols = set()
        self.merges = []
        self.state = 'visible'

    def get(self, row, col):
        return self.cells.get((row, col))

    def val(self, row, col):
        c = self.cells.get((row, col))
        return None if c is None else c.value

    def text(self, row, col):
        v = self.val(row, col)
        return '' if v is None else str(v).strip()

    @property
    def max_row(self):
        return max((r for r, _ in self.cells), default=0)


def read_workbook(path):
    z = zipfile.ZipFile(path)
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        root = ET.fromstring(z.read('xl/sharedStrings.xml'))
        for si in root.findall(M + 'si'):
            # concatenate all <t> including rich-text runs, but skip phonetic <rPh>
            parts = []
            for el in si.iter():
                if el.tag == M + 't':
                    parts.append(el.text or '')
                if el.tag == M + 'rPh':
                    pass
            # remove text from rPh runs
            rph = ''.join((t.text or '') for r in si.findall(M + 'rPh') for t in r.iter(M + 't'))
            s = ''.join(parts)
            if rph and s.endswith(rph):
                s = s[: -len(rph)]
            shared.append(s)
    styles = ET.fromstring(z.read('xl/styles.xml'))
    numfmts = {int(n.get('numFmtId')): n.get('formatCode') for n in styles.iter(M + 'numFmt')}
    xfs = [int(x.get('numFmtId', 0)) for x in styles.find(M + 'cellXfs').findall(M + 'xf')]

    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    relmap = {r.get('Id'): r.get('Target') for r in rels}
    sheets = []
    for s in wb.find(M + 'sheets'):
        rid = s.get('{%s}id' % NS['r'])
        target = relmap[rid]
        target = target.lstrip('/')
        if not target.startswith('xl/'):
            target = 'xl/' + target
        sh = Sheet(s.get('name'))
        sh.state = s.get('state', 'visible')
        root = ET.fromstring(z.read(target))
        cols = root.find(M + 'cols')
        if cols is not None:
            for c in cols:
                if c.get('hidden') in ('1', 'true'):
                    for i in range(int(c.get('min')), int(c.get('max')) + 1):
                        sh.hidden_cols.add(i)
        mc = root.find(M + 'mergeCells')
        if mc is not None:
            sh.merges = [m.get('ref') for m in mc]
        for row in root.find(M + 'sheetData'):
            rnum = int(row.get('r'))
            if row.get('hidden') in ('1', 'true'):
                sh.hidden_rows.add(rnum)
            for c in row.findall(M + 'c'):
                cell = Cell()
                cell.ref = c.get('r')
                letters, rr = split_ref(cell.ref)
                cell.col = col_to_num(letters)
                cell.row = rr
                cell.type = c.get('t', 'n')
                s = c.get('s')
                cell.style = numfmts.get(xfs[int(s)], xfs[int(s)]) if s is not None else None
                f = c.find(M + 'f')
                cell.formula = (f.text or '(shared)') if f is not None else None
                v = c.find(M + 'v')
                cell.raw = v.text if v is not None else None
                if cell.type == 's' and cell.raw is not None:
                    cell.value = shared[int(cell.raw)]
                elif cell.type == 'inlineStr':
                    cell.value = ''.join(t.text or '' for t in c.iter(M + 't'))
                elif cell.type in ('str', 'e'):
                    cell.value = cell.raw
                elif cell.type == 'b':
                    cell.value = bool(int(cell.raw)) if cell.raw is not None else None
                else:
                    cell.value = None if cell.raw is None else float(cell.raw)
                if cell.value is None and cell.formula is None:
                    continue  # style-only cell
                sh.cells[(rr, cell.col)] = cell
        sheets.append(sh)
    return sheets
