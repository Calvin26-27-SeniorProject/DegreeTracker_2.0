"""Scrub a Workday "View Academic Progress for Student" .xlsx export into a fixture.

Usage: python3 -I test/scrub-progress-xlsx.py <export.xlsx> <out.xlsx> [edits.py]

Generic scrubbing (any export):
  - drops docProps/custom.xml (Workday "Common Request ID", traceable to the export session)
  - rounds "Last Evaluated" timestamps to 12:00:00 PM

Export-specific edits live in a separate edits file (default
test/fixtures/transcript-private-edits.py, gitignored because it names the original
values it replaces). It defines edit_rows(sheet), which gets a Sheet and swaps
courses/programs, fixing up dependent counts so the sheet stays self-consistent.
Rewrite it for each new export. With no edits file, only generic scrubbing runs.
"""
import os, re, runpy, sys, zipfile
from xml.sax.saxutils import escape


# ---------------------------------------------------------------- sheet helpers

class Sheet:
    def __init__(self, xml):
        head, rest = xml.split('<sheetData>', 1)
        body, self.tail = rest.split('</sheetData>', 1)
        self.head = head
        self.rows = {int(m.group(1)): m.group(0)
                     for m in re.finditer(r'<row r="(\d+)">.*?</row>', body, re.S)}

    def to_xml(self):
        last = max(self.rows)
        head = re.sub(r'<dimension ref="A1:([A-Z]+)\d+"/>', rf'<dimension ref="A1:\g<1>{last}"/>', self.head)
        return head + '<sheetData>' + ''.join(self.rows[k] for k in sorted(self.rows)) + '</sheetData>' + self.tail

    @staticmethod
    def cell(ref, v, style=4):
        if v is None or v == '':
            return f'<c r="{ref}" s="{style}"></c>'
        if isinstance(v, float):
            return f'<c r="{ref}" s="{style}" t="n"><v>{v}</v></c>'
        return f'<c r="{ref}" s="{style}" t="inlineStr"><is><t>{escape(v)}</t></is></c>'

    def req_row(self, n, req, status, remaining='', used='', period='', hours=''):
        """Replace row n with a requirement row (Requirement..Grade columns)."""
        vals = [req, status, remaining, used, period, hours, '']
        self.rows[n] = f'<row r="{n}">\n' + ''.join(
            self.cell(f'{c}{n}', v) for c, v in zip('ABCDEFG', vals)) + '</row>'

    def set_text(self, n, col, old, new):
        a = f'<c r="{col}{n}" s="4" t="inlineStr"><is><t>{escape(old)}</t></is></c>'
        assert a in self.rows[n], (n, col, old)
        self.rows[n] = self.rows[n].replace(a, self.cell(f'{col}{n}', new))

    def set_num(self, n, col, old, new):
        pat = re.compile(rf'(<c r="{col}{n}" s="\d+" t="n"><v>){re.escape(old)}(</v></c>)')
        assert pat.search(self.rows[n]), (n, col, old)
        self.rows[n] = pat.sub(rf'\g<1>{new}\g<2>', self.rows[n])

    def find_rows(self, *texts, exact=False):
        """Row numbers containing every text (exact=True: as a whole cell value)."""
        needles = [f'<t>{escape(x)}</t>' if exact else escape(x) for x in texts]
        return [n for n, r in sorted(self.rows.items()) if all(x in r for x in needles)]

    def find_row(self, *texts, exact=False):
        hits = self.find_rows(*texts, exact=exact)
        assert len(hits) == 1, (texts, hits)
        return hits[0]

    def find_req(self, req):
        """The single row with a cell whose value is exactly `req`."""
        return self.find_row(req, exact=True)

    def replace_section(self, first, rows):
        """Replace rows first..end with `rows` (tuples for req_row)."""
        for k in [k for k in self.rows if k >= first]:
            del self.rows[k]
        for i, vals in enumerate(rows):
            self.req_row(first + i, *vals)


# ---------------------------------------------------------------- generic scrubbing

def scrub(src, out, edit_rows=None):
    with zipfile.ZipFile(src) as z:
        parts = {name: z.read(name).decode('utf-8') for name in z.namelist()}

    parts.pop('docProps/custom.xml', None)
    parts['_rels/.rels'] = re.sub(r'<Relationship [^>]*Target="docProps/custom.xml"[^>]*/>', '', parts['_rels/.rels'])
    parts['[Content_Types].xml'] = re.sub(r'<Override [^>]*PartName="/docProps/custom.xml"/>', '', parts['[Content_Types].xml'])

    sh = Sheet(parts['xl/worksheets/sheet1.xml'])
    if edit_rows:
        edit_rows(sh)
    xml = sh.to_xml()
    xml = re.sub(r'(\d\d/\d\d/\d{4}) \d\d:\d\d:\d\d\.\d{3} [AP]M', r'\1 12:00:00.000 PM', xml)
    parts['xl/worksheets/sheet1.xml'] = xml

    leftovers = [k for k, v in parts.items() if 'custom.xml' in v or 'Request ID' in v]
    assert not leftovers, leftovers

    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, data in parts.items():
            z.writestr(name, data)
    print(f'wrote {out} ({max(sh.rows)} rows)')


DEFAULT_EDITS = os.path.join(os.path.dirname(__file__), 'fixtures', 'transcript-private-edits.py')

if __name__ == '__main__':
    src, out = sys.argv[1], sys.argv[2]
    edits = sys.argv[3] if len(sys.argv) > 3 else DEFAULT_EDITS
    edit_rows = None
    if os.path.exists(edits):
        edit_rows = runpy.run_path(edits)['edit_rows']
        print(f'applying edits from {edits}')
    else:
        print(f'no edits file at {edits}; generic scrubbing only')
    scrub(src, out, edit_rows)
