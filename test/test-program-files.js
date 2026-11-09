/**
 * Program files (catalog/programs/<id>-<catoid>.json): their course lists
 * against the catalog program pages, and checkProgram() against a student's
 * courses. The catalog lists below were read from catalog.calvin.edu on
 * 2026-11-08 (each file's poid and checkedAt); when the catalog changes,
 * update both the file and the list here.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { readXlsxRows } from '../src/xlsx.js';
import { parseProgressRows, programRequirements, findProgram, checkProgram } from '../src/core.js';
import { renderPrograms, renderDashboard } from '../src/app-render.js';

const PROGRAM_DIR = new URL('../catalog/programs/', import.meta.url);
const programs = fs.readdirSync(PROGRAM_DIR).filter(f => f.endsWith('.json'))
  .map(f => ({ file: f, ...JSON.parse(fs.readFileSync(new URL(f, PROGRAM_DIR), 'utf-8')) }));
const byId = id => programs.find(p => p.id === id);
const course = (code, fields = {}) => ({ code, title: '', hours: 4, status: 'completed', grade: 'A', ...fields });
// A row's cells (code, title, details), joined with " | ".
const cells = li => [...li.children].map(c => c.textContent.trim()).join(' | ');
const statusOf = (result, id) => result.items.find(i => i.id === id).status;

// Course codes each program page lists, in order, per section heading.
const CATALOG = {
  bcs: {
    poid: '13641',
    requirements: ['CS 108', 'CS 112', 'CS 195', 'CS 212', 'CS 214', 'CS 232', 'CS 262', 'CS 295', 'CS 384', 'CS 396', 'CS 398',
      'COMM 101', 'DATA 202', 'ENGR 220', 'MATH 161', 'MATH 162', 'MATH 251', 'MATH 252', 'MATH 255', 'STAT 243', 'STAT 343'],
    groups: {
      'cs-electives': ['CS 300', 'CS 312', 'CS 320', 'CS 326', 'CS 332', 'CS 336', 'CS 338', 'CS 339', 'CS 354', 'CS 360', 'CS 361',
        'CS 363', 'CS 372', 'CS 374', 'CS 375', 'CS 376', 'ENGR 304', 'ENGR 325'],
      'lab-science': ['ASTR 201', 'ASTR 211', 'BIOL 160', 'BIOL 161', 'BIOL 231', 'BIOL 232', 'CHEM 101', 'CHEM 102', 'CHEM 103',
        'GEO 120', 'GEO 151', 'GEO 152', 'GEO 153', 'PHYS 130', 'PHYS 131', 'PHYS 133', 'PHYS 235'],
    },
    minHours: { 'cs-electives': 10, 'lab-science': 6 },
    // Corequisite labs, from each course's catalog entry.
    labs: ['CS 108', 'CS 112', 'ENGR 220', 'ENGR 304', 'ENGR 325', 'ASTR 201', 'ASTR 211', 'BIOL 160', 'BIOL 161', 'BIOL 231',
      'BIOL 232', 'CHEM 101', 'CHEM 102', 'CHEM 103', 'GEO 120', 'GEO 151', 'GEO 152', 'PHYS 130', 'PHYS 131', 'PHYS 133'],
  },
  'cs-plus': {
    poid: '13726',
    requirements: ['CS 108', 'CS 106', 'CS 112', 'CS 195', 'CS 212', 'CS 214', 'CS 232', 'CS 262', 'CS 295', 'CS 384',
      'CS 383', 'CS 396', 'CS 398', 'DATA 202', 'ENGR 220', 'MATH 251', 'MATH 252',
      'STAT 143', 'STAT 145', 'STAT 243', 'PSYC 255', 'MATH 132', 'MATH 161', 'MATH 162'],
    groups: {
      'cs-electives': ['CS 300', 'CS 312', 'CS 320', 'CS 326', 'CS 332', 'CS 336', 'CS 338', 'CS 339', 'CS 354', 'CS 360', 'CS 361',
        'CS 363', 'CS 375', 'CS 376', 'CS 372', 'CS 374', 'ENGR 304', 'ENGR 325'],
    },
    minHours: { 'cs-electives': 6 },
    labs: ['CS 108', 'CS 112', 'ENGR 220', 'ENGR 304', 'ENGR 325'],
  },
  nursing: {
    poid: '13698',
    requirements: ['BIOL 141', 'BIOL 205', 'BIOL 206', 'BIOL 207', 'CHEM 160', 'HE 254', 'PSYC 151', 'PSYC 201', 'SOC 151',
      'IDIS 108', 'NURS 201', 'NURS 205', 'NURS 301', 'NURS 302', 'NURS 303', 'NURS 304', 'NURS 305', 'NURS 321', 'NURS 322',
      'NURS 323', 'NURS 324', 'NURS 325', 'NURS 351', 'NURS 352', 'NURS 353', 'NURS 355', 'NURS 371', 'NURS 372', 'NURS 373',
      'NURS 374', 'NURS 375', 'NURS 380'],
    groups: {},
    minHours: {},
    labs: ['BIOL 141', 'BIOL 205', 'BIOL 206', 'BIOL 207', 'CHEM 160'],
  },
};

describe('program files match the catalog program pages', () => {
  it('there is a file for each checked program, named <id>-<catoid>.json', () => {
    assert.deepEqual(programs.map(p => p.id).sort(), Object.keys(CATALOG).sort());
    for (const p of programs) assert.equal(p.file, `${p.id}-${p.catoid}.json`);
  });

  for (const [id, expected] of Object.entries(CATALOG)) {
    describe(id, () => {
      const p = byId(id);

      it('points at its catalog page', () => {
        assert.equal(p.poid, expected.poid);
        assert.equal(p.sourceUrl, `https://catalog.calvin.edu/preview_program.php?catoid=${p.catoid}&poid=${p.poid}`);
      });

      it('lists every course the page lists, and no others', () => {
        const codes = p.requirements.flatMap(r => r.alternatives ? r.alternatives.flat() : r.codes);
        assert.deepEqual(codes, expected.requirements);
        assert.deepEqual(Object.fromEntries((p.courseGroups || []).map(g => [g.id, g.courses.map(c => c.code)])), expected.groups);
        assert.deepEqual(Object.fromEntries((p.courseGroups || []).map(g => [g.id, g.minHours])), expected.minHours);
      });

      it('pairs each lecture with the lab its catalog entry requires', () => {
        assert.deepEqual(Object.keys(p.labs), expected.labs);
        for (const [lecture, lab] of Object.entries(p.labs)) assert.equal(lab, lecture + 'L');
      });

      it('has a title for every course', () => {
        const titled = new Set([...Object.keys(p.titles || {}), ...(p.courseGroups || []).flatMap(g => g.courses.map(c => c.code))]);
        for (const code of expected.requirements) assert.ok(titled.has(code), code);
      });
    });
  }
});

describe('checkProgram', () => {
  const bcs = byId('bcs');
  const csPlus = byId('cs-plus');

  it('counts a lecture only with its corequisite lab, and says which lab is missing', () => {
    const without = checkProgram(bcs, [course('CS 108', { hours: 3 })]);
    const item = without.items.find(i => i.id === 'cs-108');
    assert.equal(item.status, 'todo');
    assert.deepEqual(item.missingLabs, ['CS 108L']);
    assert.equal(statusOf(checkProgram(bcs, [course('CS 108', { hours: 3 }), course('CS 108L', { hours: 1 })]), 'cs-108'), 'done');
    assert.equal(statusOf(checkProgram(bcs, [course('CS 108', { hours: 3, status: 'in-progress' }), course('CS 108L', { hours: 1, status: 'in-progress' })]), 'cs-108'), 'progress');
  });

  it('needs a whole alternative: CS 383, or both CS 396 and CS 398', () => {
    assert.equal(statusOf(checkProgram(csPlus, [course('CS 396')]), 'cs-capstone'), 'todo');
    assert.equal(statusOf(checkProgram(csPlus, [course('CS 396'), course('CS 398')]), 'cs-capstone'), 'done');
    assert.equal(statusOf(checkProgram(csPlus, [course('CS 383', { hours: 1 })]), 'cs-capstone'), 'done');
  });

  it('accepts any listed option (STAT 243 or STAT 343) and nothing else (CS 106 isn’t a BCS option)', () => {
    assert.equal(statusOf(checkProgram(bcs, [course('STAT 343')]), 'stat'), 'done');
    assert.equal(statusOf(checkProgram(bcs, [course('CS 106')]), 'cs-108'), 'todo');
  });

  it('counts a group’s hours with their labs', () => {
    const r = checkProgram(bcs, [course('CHEM 101', { hours: 3 }), course('CHEM 101L', { hours: 1 }), course('GEO 153', { hours: 4 })]);
    const lab = r.items.find(i => i.id === 'lab-science');
    assert.deepEqual([lab.status, lab.hours], ['done', 8]);
    const short = checkProgram(bcs, [course('CS 320', { hours: 2 }), course('CS 312', { hours: 4, status: 'in-progress' })]).items.find(i => i.id === 'cs-electives');
    assert.deepEqual([short.status, short.hours, short.inProgressHours], ['todo', 2, 4]);
  });

  it('leaves seminar semesters to Workday', () => {
    assert.equal(statusOf(checkProgram(bcs, [course('CS 195', { hours: 0 })]), 'cs-195'), 'check');
    assert.equal(statusOf(checkProgram(bcs, []), 'cs-195'), 'todo');
  });

  it('doesn’t count failing grades or withdrawals', () => {
    assert.equal(statusOf(checkProgram(bcs, [course('CS 212', { grade: 'F' })]), 'cs-212'), 'todo');
    assert.equal(statusOf(checkProgram(bcs, [course('CS 212', { grade: 'W' })]), 'cs-212'), 'todo');
  });

  it('findProgram matches Workday’s program name and the catalog year', () => {
    assert.equal(findProgram(programs, 'Computer Science, BCS', '25'), bcs);
    assert.equal(findProgram(programs, 'Computer Science, BCS', '24'), null);
    assert.equal(findProgram(programs, 'Entrepreneurship Minor', '25'), null);
  });
});

describe('the Major tab and Overview with a checked program', () => {
  const { DOMParser } = new JSDOM('').window;
  const input = parseProgressRows(readXlsxRows(
    fs.readFileSync(new URL('./fixtures/academic-progress-sample.xlsx', import.meta.url)), { DOMParser }));
  const groups = programRequirements(input);
  const bcs = findProgram(programs, groups[0].name, '25');
  const checks = new Map([[groups[0].name, { program: bcs, result: checkProgram(bcs, input.courses) }]]);
  const newRoot = () => new JSDOM('<!doctype html><body><section id="p"></section></body>').window.document.getElementById('p');

  it('the sample export’s BCS courses (CS 108 with its lab, in progress) are read correctly', () => {
    const result = checks.get('Computer Science, BCS').result;
    assert.equal(statusOf(result, 'cs-108'), 'progress');
    assert.equal(statusOf(result, 'math-calculus'), 'progress');
    assert.equal(statusOf(result, 'comm-101'), 'progress');
    assert.equal(statusOf(result, 'cs-195'), 'check');
    assert.equal(statusOf(result, 'cs-212'), 'todo');
  });

  it('shows this tool’s check, says where it comes from, and keeps Workday’s listing below', () => {
    const root = newRoot();
    renderPrograms(root, { groups: [groups[0]], hasInput: true, kind: 'major', checks });
    const result = checks.get('Computer Science, BCS').result;
    assert.equal(root.querySelector('.summary h2').textContent, `${result.done} of ${result.total} requirements met`);
    assert.match(root.querySelector('.summary-sub').textContent, /this tool’s reading of the 2026–27 catalog/);
    assert.equal(root.querySelector('.summary-sub a').getAttribute('href'), bcs.sourceUrl);
    assert.equal(root.querySelectorAll('.summary-chip').length, bcs.requirements.length + bcs.courseGroups.length);
    assert.match(root.querySelector('.program-workday summary').textContent, /Workday’s listing/);
    assert.ok(root.querySelector('.program-workday .program-req'));
    assert.match(root.querySelector('.program-unchecked').textContent, /C- or higher/);
  });

  it('warns when a lab is missing', () => {
    const root = newRoot();
    const only = new Map([[groups[0].name, { program: bcs, result: checkProgram(bcs, [course('ENGR 220', { hours: 3 })]) }]]);
    renderPrograms(root, { groups: [groups[0]], hasInput: true, kind: 'major', checks: only });
    assert.match(root.querySelector('#major-bcs-engr-220 .program-req-warn').textContent, /ENGR 220L isn’t on your record/);
    const lab = root.querySelector('#major-bcs-engr-220 .program-option.is-lab');
    assert.ok(lab.classList.contains('is-missing'));
    assert.equal(cells(lab), 'ENGR 220L | Lab for ENGR 220 | Not on your record');
  });

  it('lists a lab as its own row under its lecture, with its title and hours from the record', () => {
    const root = newRoot();
    renderPrograms(root, { groups: [groups[0]], hasInput: true, kind: 'major', checks });
    const rows = [...root.querySelectorAll('#major-bcs-cs-108 .program-option')].map(cells);
    assert.deepEqual(rows, [
      'CS 108 | Introduction to Computing | 3 hrs · In progress',
      'CS 108L | Intro to Computing Lab | 1 hrs · In progress',
    ]);
    assert.doesNotMatch(root.textContent, /with CS 108L/);
  });

  it('the Overview uses the check for a checked program and Workday’s status for the rest', () => {
    const root = newRoot();
    const catalog = JSON.parse(fs.readFileSync(new URL('../catalog/catalog-categories-25.json', import.meta.url), 'utf-8'));
    renderDashboard(root, { catalog, analysis: { results: [], kuSummary: {} }, groups, checks });
    const card = name => [...root.querySelectorAll('.dash-card')].find(c => c.querySelector('h3').textContent === name);
    const result = checks.get('Computer Science, BCS').result;
    assert.equal(card('Computer Science, BCS').querySelector('.dash-count').textContent, `${result.done} of ${result.total} requirements satisfied`);
    assert.match(card('Computer Science, BCS').querySelector('.dash-source').textContent, /this tool’s reading/);
    assert.match(card('Entrepreneurship Minor').querySelector('.dash-source').textContent, /Workday’s status/);
  });
});
