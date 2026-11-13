/**
 * Which catalog a student follows, and which catalog's course options they see.
 * Requirements come from the catalog of the year the student started in (the
 * earliest period of a course taken here; transfer credit and exemptions don't
 * count). Course options come from the newest catalog, so a course since
 * renamed or dropped isn't offered. A course any year lists still counts.
 * startPeriod, academicYearOf, catalogForStart, programForStudent (core.js).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { startPeriod, academicYearOf, catalogForStart, programForStudent, checkProgram } from '../src/core.js';
import { renderPrograms } from '../src/app-render.js';
import { courseIndex } from '../src/program-courses.js';
import { readCheckedPrograms, PROGRAMS_DIR } from './program-files.js';

const programs = readCheckedPrograms();
const byKey = key => programs.find(p => `${p.id}-${p.catoid}` === key);
const course = (code, fields = {}) => ({ code, title: '', hours: 4, status: 'completed', grade: 'A', period: '2025 Fall', ...fields });
const METAS = [{ catoid: '25', catalogYear: '2026-27' }, { catoid: '24', catalogYear: '2025-26' }];
// Every file of a program, newest catalog first, as app.js passes them.
const yearsOf = p => METAS.map(m => programs.find(x => x.programName === p.programName && x.catoid === m.catoid)).filter(Boolean);
const forStudent = key => programForStudent(byKey(key), yearsOf(byKey(key)));
const item = (result, id) => result.items.find(i => i.id === id);
const shownCodes = it => (it.kind === 'group' ? it.courses.map(c => c.code) : it.options.flat());

describe('the year a student started', () => {
  it('is the earliest period of a course taken here, leaving out transfer credit and exemptions', () => {
    assert.equal(startPeriod([
      course('CS 108', { period: '2025 Fall' }),
      course('PHYS 221', { period: '2023 Fall', status: 'transfer' }),
      course('REL 121', { period: '2025 Summer' }),
      course('CS 112', { period: '2026 Spring', status: 'in-progress' }),
      { code: null, title: 'Language Exemption', status: 'exemption', period: '2022 Fall' },
    ]), '2025 Summer');
    assert.equal(startPeriod([course('PHYS 221', { status: 'transfer' })]), null);
    assert.equal(startPeriod([course('CS 108', { period: null })]), null);
  });

  it('belongs to the academic year of its fall: summer before it, interim and spring after', () => {
    assert.deepEqual(['2025 Summer', '2025 Fall', '2026 Interim', '2026 Spring', 'someday'].map(academicYearOf), [2025, 2025, 2025, 2025, null]);
  });

  it('picks that year’s catalog; before every catalog here, the oldest; after, the newest', () => {
    assert.equal(catalogForStart(METAS, '2026 Fall').catoid, '25');
    assert.equal(catalogForStart(METAS, '2025 Fall').catoid, '24');
    assert.equal(catalogForStart(METAS, '2026 Spring').catoid, '24');
    assert.equal(catalogForStart(METAS, '2024 Fall').catoid, '24');
    assert.equal(catalogForStart(METAS, '2028 Fall').catoid, '25');
    assert.equal(catalogForStart(METAS, null), null);
  });
});

describe('course options from the newest catalog (BCS, 2025–26 requirements)', () => {
  const program = forStudent('bcs-24');

  it('keeps the 2025–26 requirements, hours, and catalog', () => {
    const result = checkProgram(program, []);
    assert.equal(program.catalogYear, '2025-26');
    assert.equal(program.optionsCatalogYear, '2026-27');
    assert.deepEqual(result.items.map(i => i.id), checkProgram(byKey('bcs-24'), []).items.map(i => i.id));
    assert.equal(item(result, 'cs-electives').minHours, 10);
  });

  it('offers CS 360, 361, 363 as electives and not CS 364, which the newest catalog dropped', () => {
    const electives = item(checkProgram(program, []), 'cs-electives');
    assert.ok(['CS 360', 'CS 361', 'CS 363'].every(c => shownCodes(electives).includes(c)));
    assert.ok(!shownCodes(electives).includes('CS 364'));
    assert.deepEqual(electives.retired, []);
  });

  it('still counts CS 364 taken, and lists it, marked as an earlier catalog’s', () => {
    const courses = [course('CS 364'), course('CS 312'), course('CS 320', { hours: 2 })];
    const electives = item(checkProgram(program, courses), 'cs-electives');
    assert.equal(electives.status, 'done');
    assert.equal(electives.hours, 10);
    assert.ok(shownCodes(electives).includes('CS 364'));
    assert.deepEqual(electives.retired, ['CS 364']);
    assert.ok(electives.matched.some(m => m.code === 'CS 364'));
  });

  it('counts the newest catalog’s courses too (CS 360 toward the 2025–26 electives)', () => {
    const electives = item(checkProgram(program, [course('CS 360'), course('CS 361'), course('CS 363', { hours: 2 })]), 'cs-electives');
    assert.equal(electives.status, 'done');
  });

  it('offers MATH 161 or 162 for MATH 171, which the newest catalog replaced; MATH 171 taken still counts', () => {
    const before = item(checkProgram(program, []), 'math-171');
    assert.deepEqual(before.options, [['MATH 161'], ['MATH 162']]);
    const after = item(checkProgram(program, [course('MATH 171')]), 'math-171');
    assert.equal(after.status, 'done');
    assert.deepEqual(after.retired, ['MATH 171']);
    assert.equal(item(checkProgram(program, [course('MATH 161')]), 'math-171').status, 'done');
  });

  it('a requirement only the older catalog has keeps its options, less the courses no longer offered', () => {
    const mathStat = item(checkProgram(program, []), 'math-stat');
    assert.ok(!shownCodes(mathStat).includes('MATH 172'));
    assert.ok(shownCodes(mathStat).includes('STAT 245'));
    const taken = item(checkProgram(program, [course('MATH 172')]), 'math-stat');
    assert.equal(taken.status, 'done');
    assert.deepEqual(taken.retired, ['MATH 172']);
  });

  it('a student on the newest catalog sees the same options as before', () => {
    const newest = checkProgram(forStudent('bcs-25'), []);
    const plain = checkProgram(byKey('bcs-25'), []);
    assert.deepEqual(newest.items.map(shownCodes), plain.items.map(shownCodes));
  });

  it('the page shows the newest options, says where they come from, and marks CS 364 taken', () => {
    const root = new JSDOM('<!doctype html><body><section id="p"></section></body>').window.document.getElementById('p');
    const courses = [course('CS 364')];
    const g = { name: 'Computer Science, BCS', requirements: [] };
    renderPrograms(root, { groups: [g], hasInput: true, kind: 'major',
      checks: new Map([[g.name, { program, result: checkProgram(program, courses) }]]) });
    assert.match(root.querySelector('.summary-sub').textContent, /2025–26 catalog, with course options from the 2026–27 catalog/);
    const rows = [...root.querySelectorAll('[id$="-cs-electives"] .course')];
    const cs364 = rows.find(li => li.dataset.code === 'CS 364');
    assert.ok(cs364.classList.contains('is-active'));
    assert.match(cs364.textContent, /Earlier catalog/);
    assert.ok(rows.some(li => li.dataset.code === 'CS 360'));
    assert.ok(!rows.find(li => li.dataset.code === 'CS 360').textContent.includes('Earlier catalog'));
  });
});

describe('every program', () => {
  // Every course the newest catalog year's program pages list (their generated program.json).
  const newestYear = readdirSync(PROGRAMS_DIR).filter(d => /^\d{4}$/.test(d)).sort().at(-1);
  const newestCodes = new Set();
  const walk = dir => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, e.name);
      if (e.isDirectory()) walk(path);
      else if (e.name === 'program.json') for (const code of courseIndex(JSON.parse(readFileSync(path, 'utf-8'))).keys()) newestCodes.add(code);
    }
  };
  walk(join(PROGRAMS_DIR, newestYear));

  for (const p of programs) {
    it(`${p.file}: offers only courses the newest catalog lists, unless the file says why`, () => {
      const result = checkProgram(programForStudent(p, yearsOf(p)), []);
      const stale = result.items.flatMap(shownCodes).filter(code => !newestCodes.has(code));
      assert.deepEqual(stale, [], `${p.file} offers ${stale.join(', ')}, which no ${newestYear} program lists. `
        + 'Point its requirement at the newest one (currentId) or list the course in retiredCourses.');
    });
  }

  it('retiredCourses and currentId name real courses and requirements', () => {
    for (const p of programs) {
      const newest = yearsOf(p)[0];
      for (const code of p.retiredCourses || []) assert.ok(!newestCodes.has(code), `${p.file}: ${code} is still in the newest catalog`);
      for (const r of [...p.requirements, ...(p.courseGroups || [])]) {
        if (r.currentId) assert.ok([...newest.requirements, ...(newest.courseGroups || [])].some(x => x.id === r.currentId), `${p.file}: ${r.id} → ${r.currentId}`);
      }
    }
  });
});
