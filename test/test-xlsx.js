/**
 * Workday Academic Progress .xlsx export: readXlsxRows + parseProgressRows.
 * Fixture: test/fixtures/academic-progress-sample.xlsx (scrubbed with
 * test/scrub-progress-xlsx.py).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { JSDOM } from 'jsdom';
import { readXlsxRows } from '../src/xlsx.js';
import { parseProgressRows, workdayRequirementCategory, hasCoreRequirements } from '../src/core.js';
import { analyze } from './recorder.js';
import { KNOWN_COURSE_CATEGORIES } from '../src/catalog-courses.js';
import { loadCategories, getResult } from './helpers.js';

const { DOMParser } = new JSDOM('').window;
const read = data => readXlsxRows(data, { DOMParser });
const sample = () => read(fs.readFileSync(new URL('./fixtures/academic-progress-sample.xlsx', import.meta.url)));

// A one-sheet workbook. cells: rows of strings; shared strings when `shared`.
function makeXlsx(cells, { shared = false } = {}) {
  const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const strings = [];
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const cellXml = (v, ref) => {
    if (v === '') return '';
    if (typeof v === 'number') return `<c r="${ref}" t="n"><v>${v}</v></c>`;
    if (!shared) return `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
    strings.push(v);
    return `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>`;
  };
  const rows = cells.map((row, i) => `<row r="${i + 1}">`
    + row.map((v, j) => cellXml(v, String.fromCharCode(65 + j) + (i + 1))).join('') + '</row>').join('');
  const files = {
    'xl/workbook.xml': strToU8(`<workbook ${NS} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8(`<worksheet ${NS}><sheetData>${rows}</sheetData></worksheet>`),
  };
  if (shared) {
    files['xl/sharedStrings.xml'] = strToU8(`<sst ${NS}>`
      + strings.map(s => `<si><t>${esc(s)}</t></si>`).join('') + '</sst>');
  }
  return zipSync(files);
}

const HEADER = ['Requirement', 'Status', 'Remaining', 'Registrations Used', 'Academic Period', 'Hours', 'Grade'];

describe('readXlsxRows', () => {
  it('reads inline strings and numbers from the sample export', () => {
    const rows = sample();
    assert.equal(rows[0][0], 'View Academic Progress for Student');
    assert.deepEqual(rows[14], HEADER);
    assert.deepEqual(rows[15].slice(0, 6), ['Foundations: CORE 100/HNRS 110 - Communities & Commitments',
      'In Progress', '', 'CORE 100 - Community and Commitments (In Progress)', '2026 Fall', '2']);
  });

  it('reads shared strings and keeps column positions for skipped cells', () => {
    const rows = read(makeXlsx([['a', '', 'c'], ['x & y', 3]], { shared: true }));
    assert.deepEqual(rows, [['a', '', 'c'], ['x & y', '3']]);
  });

  it('rejects a file that is not an .xlsx', () => {
    assert.throws(() => read(strToU8('Requirement\tStatus')), /Not an \.xlsx file/);
  });
});

describe('parseProgressRows', () => {
  it('parses the sample export', () => {
    const { courses, exemptions, overrides } = parseProgressRows(sample());
    assert.deepEqual(courses.map(c => c.code), ['CORE 100', null, 'COMM 101', 'MATH 161', 'CS 108', 'CS 108L',
      'CS 195', 'ENTR 201', 'ENTR 202', 'ENTR 210', 'ENTR 302', 'ENTR 211']);
    assert.deepEqual(courses.find(c => c.code === 'MATH 161'), {
      code: 'MATH 161', title: 'Calculus: Modeling and Computation', grade: null, hours: 4,
      status: 'in-progress', period: '2026 Fall',
      requirements: ['Knowledge and Understanding - minimum 26 hours', 'MATH 161 or 162'],
    });
    assert.equal(courses.find(c => c.code === 'ENTR 201').status, 'completed');
    assert.deepEqual(exemptions, [{ name: 'High School Exemption', date: '08/01/2025', target: 'World Languages I' }]);
    assert.equal(overrides.size, 0);
  });

  it('analyzes the sample export end to end', () => {
    const { courses, overrides } = parseProgressRows(sample());
    const analysis = analyze(loadCategories('25'), courses, { overrides, extraCourses: KNOWN_COURSE_CATEGORIES });
    assert.equal(getResult(analysis, 'World Languages I').status, 'complete');
    assert.equal(analysis.kuSummary.totalHours, 8);
    assert.deepEqual(analysis.warnings, []);
  });

  it('every core requirement in the sample maps to a catalog requirement', () => {
    const names = loadCategories('25').map(c => c.name);
    const reqs = sample().map(r => r[0]);
    const core = reqs.slice(reqs.indexOf('Requirement') + 1, reqs.findIndex(r => /^Earn a /.test(r)));
    assert.ok(core.length >= 12, core.join('; '));
    for (const req of core) {
      if (/Knowledge and Understanding/.test(req)) continue;
      assert.ok(names.includes(workdayRequirementCategory(req.replace(/\s*\(Click for more details\)/, ''))), req);
    }
  });

  it('counts a course Workday lists under a tag the catalog does not list it for', () => {
    const rows = [
      ['Requirement', 'Status', 'Remaining', 'Registrations Used', 'Academic Period', 'Hours'],
      ['Global Regions and Cultures Core', 'Satisfied', '', 'ENGR 202 - Statics and Dynamics', '2025 Summer 2', '4'],
    ];
    const { courses } = parseProgressRows(rows);
    const analysis = analyze(loadCategories('24'), courses, { extraCourses: KNOWN_COURSE_CATEGORIES });
    assert.equal(getResult(analysis, 'Global Regions and Cultures (Tag)').status, 'complete');
  });

  it('maps columns by header name, reads grades, transfer credit, and overrides', () => {
    const rows = [
      ['Status', 'Requirement', 'Hours', 'Grade', 'Registrations Used', 'Academic Period'],
      ['In Progress', 'Knowledge and Understanding - minimum 26 hours (Click for more details) (Override Assigned)',
        '4', 'CR', 'PHYS 221 - General Physics (Transfer Credit)', '2024 Fall'],
      ['Satisfied', 'Knowledge and Understanding - minimum 26 hours (Click for more details) (Override Assigned)',
        '1.5', 'B+', 'HIST CORE - AP/Transfer History Core', '2024 Fall'],
    ];
    const { courses, overrides } = parseProgressRows(rows);
    assert.deepEqual(courses.map(c => [c.code, c.status, c.hours, c.grade]),
      [['PHYS 221', 'transfer', 4, 'CR'], ['HIST CORE', 'completed', 1.5, 'B+']]);
    assert.ok(courses[1].isPlaceholder);
    assert.deepEqual([...overrides], ['Knowledge and Understanding - minimum 26 hours']);
  });

  it('ignores rows outside requirement tables', () => {
    const rows = [
      ['Overall Academic Progress'],
      ['Total Academic Requirement', 'Not Satisfied', 'CS 999 - Not a requirement row'],
      HEADER,
      ['COMM 101', 'In Progress', '', 'COMM 101 - Oral Rhetoric (In Progress)', '2026 Fall', '4'],
      ['Program of Study GPA'],
      ['Last Evaluated', 'CS 998 - after the table'],
    ];
    assert.deepEqual(parseProgressRows(rows).courses.map(c => c.code), ['COMM 101']);
  });

  it('finds no courses in a sheet without a requirement table', () => {
    assert.deepEqual(parseProgressRows([['Course', 'Grade'], ['CS 108 - Intro', 'A']]).courses, []);
  });
});

describe('hasCoreRequirements', () => {
  it('is true for the whole-page export', () => {
    assert.ok(hasCoreRequirements(parseProgressRows(sample()).workdayStatus));
  });

  it('is false for one table exported on its own', () => {
    const majorTable = [
      HEADER,
      ['Data Structures', 'Satisfied', '', 'CS 112 - Data Structures', '2026 Spring', '4', 'A'],
      ['Earn a 2.000 or better Program of Study GPA', 'Satisfied'],
    ];
    assert.equal(hasCoreRequirements(parseProgressRows(majorTable).workdayStatus), false);
    const overall = [
      ['Hours Defined', 'Hours in Progress', 'Hours Satisfying', 'Remaining', 'Status'],
      ['120', '14', '83', 'Minimum 37 Hour(s)', 'Not Satisfied'],
    ];
    assert.equal(hasCoreRequirements(parseProgressRows(overall).workdayStatus), false);
  });
});
