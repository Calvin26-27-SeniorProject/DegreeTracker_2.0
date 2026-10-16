// Minimal .xlsx reader: the first worksheet's cell values as rows of strings.
// Runs entirely in the browser (no network); DOMParser is passed in so tests
// can use jsdom's.
import { unzipSync, strFromU8 } from 'fflate';

const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

function elements(parent, name) {
  return Array.from(parent.getElementsByTagNameNS(MAIN_NS, name));
}

// Text of an <si> or <is>: its <t> runs, skipping phonetic (<rPh>) text.
function richText(el) {
  return elements(el, 't')
    .filter(t => t.parentNode.localName !== 'rPh')
    .map(t => t.textContent).join('');
}

// "C12" -> 2
function columnIndex(ref) {
  const letters = /^[A-Z]+/.exec(ref)[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseXml(DOMParser, text, path) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) throw new Error(`Malformed XML in ${path}`);
  return doc;
}

// Path of the workbook's first sheet, via xl/workbook.xml and its rels.
function firstSheetPath(files, DOMParser) {
  const workbook = files['xl/workbook.xml'];
  const rels = files['xl/_rels/workbook.xml.rels'];
  if (workbook && rels) {
    const sheet = elements(parseXml(DOMParser, strFromU8(workbook), 'workbook.xml'), 'sheet')[0];
    const relId = sheet && sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const relsDoc = parseXml(DOMParser, strFromU8(rels), 'workbook.xml.rels');
    const rel = Array.from(relsDoc.getElementsByTagName('Relationship')).find(r => r.getAttribute('Id') === relId);
    if (rel) {
      const target = rel.getAttribute('Target');
      const path = target.startsWith('/') ? target.slice(1) : 'xl/' + target;
      if (files[path]) return path;
    }
  }
  return Object.keys(files).filter(p => /^xl\/worksheets\/[^/]+\.xml$/.test(p)).sort()[0];
}

export function readXlsxRows(data, { DOMParser = globalThis.DOMParser } = {}) {
  let files;
  try {
    files = unzipSync(data instanceof Uint8Array ? data : new Uint8Array(data));
  } catch {
    throw new Error('Not an .xlsx file');
  }
  const sheetPath = firstSheetPath(files, DOMParser);
  if (!sheetPath) throw new Error('No worksheet in the .xlsx file');

  const shared = files['xl/sharedStrings.xml']
    ? elements(parseXml(DOMParser, strFromU8(files['xl/sharedStrings.xml']), 'sharedStrings.xml'), 'si').map(richText)
    : [];

  const sheet = parseXml(DOMParser, strFromU8(files[sheetPath]), sheetPath);
  const rows = [];
  for (const rowEl of elements(sheet, 'row')) {
    const r = parseInt(rowEl.getAttribute('r'), 10);
    const rowIndex = Number.isFinite(r) ? r - 1 : rows.length;
    const row = [];
    for (const c of Array.from(rowEl.children).filter(el => el.localName === 'c')) {
      const ref = c.getAttribute('r');
      const col = ref ? columnIndex(ref) : row.length;
      const type = c.getAttribute('t');
      const v = elements(c, 'v')[0];
      let value = '';
      if (type === 'inlineStr') {
        const is = elements(c, 'is')[0];
        value = is ? richText(is) : '';
      } else if (type === 's') {
        value = v ? shared[parseInt(v.textContent, 10)] ?? '' : '';
      } else if (v) {
        value = v.textContent;
      }
      row[col] = value;
    }
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = '';
    rows[rowIndex] = row;
  }
  for (let i = 0; i < rows.length; i++) if (rows[i] === undefined) rows[i] = [];
  return rows;
}
