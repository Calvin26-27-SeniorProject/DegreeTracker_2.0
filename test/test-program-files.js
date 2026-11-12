/**
 * Program files (programs/<year>/<department>/<type>/<program>/<id>-<catoid>.json): their course lists
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
import { courseIndex } from '../src/program-courses.js';
import { readCheckedPrograms } from './program-files.js';

const programs = readCheckedPrograms();
const byKey = key => programs.find(p => `${p.id}-${p.catoid}` === key);
const course = (code, fields = {}) => ({ code, title: '', hours: 4, status: 'completed', grade: 'A', ...fields });
// A row's cells (code, title, details), joined with " | ".
const cells = li => [...li.children].map(c => c.textContent.trim()).join(' | ');
const statusOf = (result, id) => result.items.find(i => i.id === id).status;

// Course codes each program page lists, in order, per section heading.
const CATALOG = {
  'bcs-25': {
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
  'cs-plus-25': {
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
  'nursing-25': {
    poid: '13698',
    requirements: ['BIOL 141', 'BIOL 205', 'BIOL 206', 'BIOL 207', 'CHEM 160', 'HE 254', 'PSYC 151', 'PSYC 201', 'SOC 151',
      'IDIS 108', 'NURS 201', 'NURS 205', 'NURS 301', 'NURS 302', 'NURS 303', 'NURS 304', 'NURS 305', 'NURS 321', 'NURS 322',
      'NURS 323', 'NURS 324', 'NURS 325', 'NURS 351', 'NURS 352', 'NURS 353', 'NURS 355', 'NURS 371', 'NURS 372', 'NURS 373',
      'NURS 374', 'NURS 375', 'NURS 380'],
    groups: {},
    minHours: {},
    labs: ['BIOL 141', 'BIOL 205', 'BIOL 206', 'BIOL 207', 'CHEM 160'],
  },
  // 2025–26: the same programs, as that year's catalog pages list them.
  'bcs-24': {
    poid: '13127',
    requirements: ['CS 108', 'CS 112', 'CS 195', 'CS 212', 'CS 214', 'CS 232', 'CS 262', 'CS 295', 'CS 384', 'CS 396', 'CS 398',
      'COMM 101', 'ENGR 220', 'MATH 171', 'MATH 251', 'MATH 252', 'STAT 243', 'STAT 343'],
    groups: {
      'cs-electives': ['CS 300', 'CS 312', 'CS 320', 'CS 326', 'CS 332', 'CS 336', 'CS 338', 'CS 339', 'CS 354', 'CS 375', 'CS 376',
        'CS 372', 'CS 364', 'CS 374', 'ENGR 304', 'ENGR 325'],
      'math-stat': ['MATH 172', 'MATH 255', 'STAT 245', 'STAT 341', 'STAT 344'],
      'lab-science': ['ASTR 201', 'ASTR 211', 'BIOL 160', 'BIOL 161', 'BIOL 231', 'BIOL 232', 'CHEM 101', 'CHEM 102', 'CHEM 103',
        'GEO 151', 'GEO 152', 'GEO 153', 'PHYS 130', 'PHYS 131', 'PHYS 133', 'PHYS 235'],
    },
    minHours: { 'cs-electives': 10, 'math-stat': 4, 'lab-science': 6 },
    labs: ['CS 108', 'CS 112', 'ENGR 220', 'ENGR 304', 'ENGR 325', 'ASTR 201', 'ASTR 211', 'BIOL 160', 'BIOL 161', 'BIOL 231',
      'BIOL 232', 'CHEM 101', 'CHEM 102', 'CHEM 103', 'GEO 151', 'GEO 152', 'PHYS 130', 'PHYS 131', 'PHYS 133'],
  },
  'cs-plus-24': {
    poid: '13212',
    requirements: ['CS 108', 'CS 106', 'CS 112', 'CS 195', 'CS 212', 'CS 214', 'CS 232', 'CS 262', 'CS 295', 'CS 384',
      'CS 383', 'CS 396', 'CS 398', 'ENGR 220', 'MATH 171', 'MATH 132', 'MATH 251', 'MATH 252',
      'STAT 143', 'STAT 145', 'STAT 243', 'PSYC 255'],
    groups: {
      'cs-electives': ['CS 300', 'CS 312', 'CS 320', 'CS 326', 'CS 332', 'CS 336', 'CS 338', 'CS 339', 'CS 354', 'CS 375', 'CS 376',
        'CS 372', 'CS 364', 'CS 374', 'ENGR 304', 'ENGR 325'],
    },
    minHours: { 'cs-electives': 6 },
    labs: ['CS 108', 'CS 112', 'ENGR 220', 'ENGR 304', 'ENGR 325'],
  },
  'nursing-24': {
    poid: '13184',
    requirements: ['IDIS 108', 'NURS 201', 'NURS 205', 'NURS 301', 'NURS 302', 'NURS 303', 'NURS 304', 'NURS 305', 'NURS 321',
      'NURS 322', 'NURS 323', 'NURS 324', 'NURS 325', 'NURS 351', 'NURS 352', 'NURS 353', 'NURS 355', 'NURS 371', 'NURS 372',
      'NURS 373', 'NURS 374', 'NURS 375', 'NURS 380'],
    groups: {},
    minHours: {},
    labs: [],
  },
};

describe('program files match the catalog program pages', () => {
  it('there is a file for each checked program and catalog year, named <id>-<catoid>.json', () => {
    assert.deepEqual(programs.map(p => `${p.id}-${p.catoid}`).sort(), Object.keys(CATALOG).sort());
    for (const p of programs) assert.equal(p.file, `${p.id}-${p.catoid}.json`);
  });

  it('has every checked program in both catalog years, so its page looks the same whichever is selected', () => {
    const years = id => programs.filter(p => p.id === id).map(p => p.catoid).sort();
    for (const id of new Set(programs.map(p => p.id))) assert.deepEqual(years(id), ['24', '25'], id);
  });

  for (const [key, expected] of Object.entries(CATALOG)) {
    describe(key, () => {
      const p = byKey(key);

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
  const bcs = byKey('bcs-25');
  const csPlus = byKey('cs-plus-25');

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

  it('counts the semesters a seminar was taken, oldest first, and is done at three', () => {
    const attempt = (period, fields = {}) => course('CS 195', { hours: 0, grade: 'CR', period, ...fields });
    const attempts = [attempt('2026 Spring'), attempt('2025 Fall'), attempt('2025 Fall'), attempt('2026 Fall', { status: 'in-progress', grade: null })];
    const some = checkProgram(bcs, [attempts[0]], attempts).items.find(i => i.id === 'cs-195');
    assert.deepEqual(some.occurrences.terms.map(t => [t.period, t.status]), [['2025 Fall', 'done'], ['2026 Spring', 'done'], ['2026 Fall', 'progress']]);
    assert.deepEqual([some.status, some.occurrences.completed, some.occurrences.inProgress, some.occurrences.required], ['progress', 2, 1, 3]);
    const all = checkProgram(bcs, [attempts[0]], [...attempts.slice(0, 3), attempt('2026 Fall')]).items.find(i => i.id === 'cs-195');
    assert.deepEqual([all.status, all.occurrences.completed], ['done', 3]);
    assert.equal(statusOf(checkProgram(bcs, []), 'cs-195'), 'todo');
    assert.equal(statusOf(checkProgram(bcs, [attempt('2025 Fall', { grade: 'F' })]), 'cs-195'), 'todo');
    assert.equal(statusOf(checkProgram(bcs, [course('CS 195', { hours: 0 })]), 'cs-195'), 'progress');
  });

  it('doesn’t count failing grades or withdrawals', () => {
    assert.equal(statusOf(checkProgram(bcs, [course('CS 212', { grade: 'F' })]), 'cs-212'), 'todo');
    assert.equal(statusOf(checkProgram(bcs, [course('CS 212', { grade: 'W' })]), 'cs-212'), 'todo');
  });

  it('findProgram matches Workday’s program name and the catalog year', () => {
    assert.equal(findProgram(programs, 'Computer Science, BCS', '25'), bcs);
    assert.equal(findProgram(programs, 'Computer Science, BCS', '24'), byKey('bcs-24'));
    assert.equal(findProgram(programs, 'Entrepreneurship Minor', '25'), null);
  });
});

describe('a checked program looks the same in every catalog year', () => {
  const { DOMParser } = new JSDOM('').window;
  const input = parseProgressRows(readXlsxRows(
    fs.readFileSync(new URL('./fixtures/academic-progress-sample.xlsx', import.meta.url)), { DOMParser }));
  const bcsGroup = programRequirements(input)[0];
  const newRoot = () => new JSDOM('<!doctype html><body><section id="p"></section></body>').window.document.getElementById('p');
  const attempt = (period, fields = {}) => course('CS 195', { hours: 0, grade: 'CR', title: 'Introductory Computing Seminar', period, ...fields });
  const attempts = [attempt('2026 Spring'), attempt('2025 Fall'), attempt('2026 Fall', { status: 'in-progress', grade: null })];
  const taken = [
    ...attempts.slice(0, 1), course('CS 326', { hours: 4 }), course('CS 336', { hours: 4 }), course('CS 354', { hours: 2, status: 'in-progress', grade: null }),
    course('CS 108', { hours: 3 }), course('CS 108L', { hours: 1 }), course('CHEM 101', { hours: 3 }), course('CHEM 101L', { hours: 1 }),
  ];
  const render = (key, groups = [bcsGroup], courses = taken, attemptList = attempts) => {
    const program = byKey(key);
    const root = newRoot();
    renderPrograms(root, { groups, hasInput: true, kind: 'major', checks: new Map([[groups[0].name, { program, result: checkProgram(program, courses, attemptList) }]]) });
    return root;
  };
  // The classes a page is built from, without the ones that say what the student has done.
  const shape = root => new Set([...root.querySelectorAll('*')].flatMap(el => [...el.classList])
    .filter(c => !/^(status-|is-)/.test(c) && !/^chip-(taken|progress|hours|excluded)$/.test(c)));

  for (const [id, name] of [['bcs', 'Computer Science, BCS'], ['cs-plus', 'Computer Science Plus, BS'], ['nursing', 'Nursing, BSN']]) {
    it(`${name} is built from the same pieces in 2025–26 and 2026–27`, () => {
      const group = { ...bcsGroup, name };
      const a = shape(render(`${id}-25`, [group]));
      const b = shape(render(`${id}-24`, [group]));
      assert.deepEqual([...a].sort(), [...b].sort());
      assert.ok(a.has('req-section-title') && a.has('req') && a.has('course-list') && a.has('summary-chip'));
    });
  }

  it('shows the whole elective list in 2025–26 too, marking the courses you took or are taking', () => {
    const root = render('bcs-24');
    const group = root.querySelector('#major-bcs-cs-electives');
    assert.equal(group.querySelector('.req-name').textContent, 'Take 10 hours from the following');
    assert.equal(group.querySelector('summary').textContent, 'Course options (16)');
    assert.equal(group.querySelectorAll('li.course:not(.is-lab)').length, 16);
    assert.deepEqual([...group.querySelectorAll('li.course.is-active')].map(li => [li.querySelector('.course-code').textContent, li.querySelector('.chip').textContent]),
      [['CS 326', 'Taken · A · 4 hrs'], ['CS 336', 'Taken · A · 4 hrs'], ['CS 354', 'In progress · 2 hrs']]);
    assert.equal(group.querySelector('.status-pill').textContent, '8 of 10 hrs');
    assert.match(root.querySelector('.summary-sub').textContent, /2025–26 catalog/);
  });

  it('uses each year’s own requirements', () => {
    const y24 = render('bcs-24');
    const y25 = render('bcs-25');
    assert.ok(y24.querySelector('#major-bcs-math-171') && !y24.querySelector('#major-bcs-data-202'));
    assert.ok(y25.querySelector('#major-bcs-data-202') && !y25.querySelector('#major-bcs-math-171'));
    assert.ok(y24.querySelector('#major-bcs-math-stat') && !y25.querySelector('#major-bcs-math-stat'));
    assert.deepEqual([...y24.querySelectorAll('#major-bcs-cs-electives .course-code')].map(c => c.textContent).filter(c => /^CS 36/.test(c)), ['CS 364']);
    assert.deepEqual([...y25.querySelectorAll('#major-bcs-cs-electives .course-code')].map(c => c.textContent).filter(c => /^CS 36/.test(c)), ['CS 360', 'CS 361', 'CS 363']);
    const nursing24 = render('nursing-24', [{ ...bcsGroup, name: 'Nursing, BSN' }], []);
    assert.deepEqual([...nursing24.querySelectorAll('.req-section-title')].map(t => t.textContent), ['Program Requirements']);
  });

  it('lists a seminar’s semesters oldest first, as green rows with the grade and the semester', () => {
    for (const key of ['bcs-24', 'bcs-25']) {
      const card = render(key).querySelector('#major-bcs-cs-195');
      assert.equal(card.querySelector('.status-pill').textContent, '2 of 3 semesters', key);
      assert.ok(card.classList.contains('status-min'));
      assert.equal(card.querySelector('.req-hours').textContent, '1 more semester in progress.');
      const rows = [...card.querySelectorAll('.course-list > li.course')];
      assert.deepEqual(rows.map(li => [li.classList.contains('is-active'), li.querySelector('.course-code').textContent,
        [...li.querySelectorAll('.chip')].map(c => c.textContent).join(' | ')]), [
        [true, 'CS 195', 'Taken · CR · 0 hrs | 2025 Fall'],
        [true, 'CS 195', 'Taken · CR · 0 hrs | 2026 Spring'],
        [true, 'CS 195', 'In progress · 0 hrs | 2026 Fall'],
        [false, 'CS 195', '0 hrs'],
      ], key);
    }
  });

  it('marks a seminar complete at three finished semesters, with no row left to take', () => {
    const three = [attempt('2025 Fall'), attempt('2026 Spring'), attempt('2026 Fall')];
    const card = render('bcs-24', [bcsGroup], [three[0]], three).querySelector('#major-bcs-cs-195');
    assert.equal(card.querySelector('.status-pill').textContent, 'Complete');
    assert.ok(card.classList.contains('status-done'));
    assert.equal(card.querySelectorAll('.course-list > li.course').length, 3);
    assert.equal(card.querySelectorAll('.course-list > li.course.is-active').length, 3);
  });
});

describe('the Major tab and Overview with a checked program', () => {
  const { DOMParser } = new JSDOM('').window;
  const input = parseProgressRows(readXlsxRows(
    fs.readFileSync(new URL('./fixtures/academic-progress-sample.xlsx', import.meta.url)), { DOMParser }));
  const groups = programRequirements(input);
  const bcs = findProgram(programs, groups[0].name, '25');
  const checks = new Map([[groups[0].name, { program: bcs, result: checkProgram(bcs, input.courses, input.courseAttempts) }]]);
  const newRoot = () => new JSDOM('<!doctype html><body><section id="p"></section></body>').window.document.getElementById('p');

  it('the sample export’s BCS courses (CS 108 with its lab, in progress) are read correctly', () => {
    const result = checks.get('Computer Science, BCS').result;
    assert.equal(statusOf(result, 'cs-108'), 'progress');
    assert.equal(statusOf(result, 'math-calculus'), 'progress');
    assert.equal(statusOf(result, 'comm-101'), 'progress');
    assert.equal(statusOf(result, 'cs-195'), 'progress');
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
    assert.ok(root.querySelector('.program-workday .req'));
    assert.match(root.querySelector('.program-unchecked').textContent, /C- or higher/);
  });

  it('warns when a lab is missing', () => {
    const root = newRoot();
    const only = new Map([[groups[0].name, { program: bcs, result: checkProgram(bcs, [course('ENGR 220', { hours: 3 })]) }]]);
    renderPrograms(root, { groups: [groups[0]], hasInput: true, kind: 'major', checks: only });
    assert.match(root.querySelector('#major-bcs-engr-220 .req-note.is-mismatch').textContent, /ENGR 220L isn’t on your record/);
    const lab = root.querySelector('#major-bcs-engr-220 .course.is-lab');
    assert.ok(lab.classList.contains('is-excluded'));
    assert.equal(cells(lab), 'ENGR 220L | Lab for ENGR 220 | Not on your record');
  });

  it('lists a lab as its own row under its lecture, with its title and hours from the record', () => {
    const root = newRoot();
    renderPrograms(root, { groups: [groups[0]], hasInput: true, kind: 'major', checks });
    const rows = [...root.querySelectorAll('#major-bcs-cs-108 .course')].map(cells);
    assert.deepEqual(rows, [
      'CS 108 | Introduction to Computing | In progress · 3 hrs',
      'CS 108L | Intro to Computing Lab | In progress · 1 hrs',
    ]);
    assert.doesNotMatch(root.textContent, /with CS 108L/);
  });

  describe('with the Core page’s cards and rows', () => {
    const catalogProgram = JSON.parse(fs.readFileSync(
      new URL('../programs/2025/computer-science/major/computer-science-bcs/program.json', import.meta.url), 'utf-8'));
    const catalogCourses = new Map([['bcs-25', courseIndex(catalogProgram)]]);
    const completed = [
      course('CS 108', { hours: 3, grade: 'A' }), course('CS 108L', { hours: 1, grade: 'A' }),
      course('CS 326', { title: 'Embedded Systems and the Internet of Things', hours: 4, grade: 'A' }),
      course('CS 336', { hours: 4, grade: 'B+' }), course('CS 354', { hours: 2, grade: 'A' }),
      course('CS 214', { hours: 4, status: 'in-progress', grade: null }),
    ];
    const render = (courses, extra = {}) => {
      const root = newRoot();
      const only = new Map([[groups[0].name, { program: bcs, result: checkProgram(bcs, courses) }]]);
      renderPrograms(root, { groups: [groups[0]], hasInput: true, kind: 'major', checks: only, catalogCourses, ...extra });
      return root;
    };

    it('uses the Core page’s section titles, cards, headers, and callout', () => {
      const root = render(completed);
      assert.deepEqual([...root.querySelectorAll('.req-section-title')].map(t => t.textContent), ['Program Requirements', 'Cognates']);
      const card = root.querySelector('#major-bcs-cs-212');
      assert.ok(card.matches('article.req.status-todo'));
      assert.deepEqual([...card.querySelector('.req-header').children].map(c => c.className),
        ['req-name', 'status-pill status-todo', 'req-collapse']);
      assert.ok(root.querySelector('.callout.program-unchecked h2'));
      assert.equal(root.querySelector('.program, .program-req, .program-option, .program-reqs'), null);
    });

    it('turns every course you took into a full green row with the Core page’s chip', () => {
      const root = render(completed);
      const group = root.querySelector('#major-bcs-cs-electives');
      assert.ok(group.matches('.req.status-done'));
      assert.equal(group.querySelector('.status-pill').textContent, '10 of 10 hrs');
      assert.equal(group.querySelector('details.course-options').open, true);
      assert.equal(group.querySelectorAll('.course-list > li.course').length, 20);
      const active = [...group.querySelectorAll('li.course.is-active')];
      assert.deepEqual(active.map(li => li.querySelector('.course-code').textContent), ['CS 326', 'CS 336', 'CS 354']);
      assert.deepEqual(active.map(li => li.querySelector('.chip-taken').textContent),
        ['Taken · A · 4 hrs', 'Taken · B+ · 4 hrs', 'Taken · A · 2 hrs']);
      assert.equal(active.some(li => li.querySelector('.offered')), false);
      const other = group.querySelector('li.course:not(.is-active)');
      assert.ok(other.querySelector('.chip-hours'));
    });

    it('shows a course you’re taking as a row with the in-progress chip', () => {
      const root = render(completed);
      const row = root.querySelector('#major-bcs-cs-214 li.course');
      assert.ok(row.classList.contains('is-active'));
      assert.equal(row.querySelector('.chip-progress').textContent, 'In progress · 4 hrs');
    });

    it('shows a taken lecture and its lab as two green rows', () => {
      const root = render(completed);
      const rows = [...root.querySelectorAll('#major-bcs-cs-108 li.course')];
      assert.deepEqual(rows.map(li => [li.classList.contains('is-active'), li.classList.contains('is-lab'), li.querySelector('.chip').textContent]), [
        [true, false, 'Taken · A · 3 hrs'],
        [true, true, 'Taken · A · 1 hrs'],
      ]);
    });

    it('joins alternatives with Or, and shows a lone required course without an options list', () => {
      const root = render(completed);
      const calculus = root.querySelector('#major-bcs-math-calculus');
      assert.deepEqual([...calculus.querySelectorAll('.course-list > li')].map(li => li.className.split(' ')[0] + ':' + (li.querySelector('.course-code')?.textContent || li.textContent)),
        ['course:MATH 161', 'course-connector:Or', 'course:MATH 162']);
      const single = root.querySelector('#major-bcs-cs-212');
      assert.equal(single.querySelector('details'), null);
      assert.equal(single.querySelectorAll('.course-list > li.course').length, 1);
    });

    it('titles and links every option from the catalog', () => {
      const root = render(completed);
      const row = [...root.querySelectorAll('#major-bcs-cs-electives li.course')].find(li => li.querySelector('.course-code').textContent === 'CS 312');
      assert.equal(row.querySelector('.course-title').textContent, 'Logic, Computability, and Complexity');
      const link = row.querySelector('a.course-code');
      assert.match(link.getAttribute('href'), /^https:\/\/catalog\.calvin\.edu\/preview_course_nopop\.php\?catoid=25&coid=\d+$/);
      assert.equal(link.getAttribute('target'), '_blank');
    });

    it('lists a closed group’s courses it holds only when it has taken ones, and keeps card state across renders', () => {
      const empty = render([]);
      assert.equal(empty.querySelector('#major-bcs-cs-electives details').open, true);
      const openLists = new Map([['major-bcs-cs-electives', false], ['card:major-bcs-cs-214', false]]);
      const root = render(completed, { openLists });
      assert.equal(root.querySelector('#major-bcs-cs-electives details').open, false);
      assert.equal(root.querySelector('#major-bcs-cs-electives .req-taken').textContent, 'Counted: CS 326, CS 336, CS 354');
      assert.ok(root.querySelector('#major-bcs-cs-214').classList.contains('is-collapsed'));
      const toggled = [];
      const wired = render(completed, { onListToggle: (key, open) => toggled.push([key, open]) });
      wired.querySelector('#major-bcs-cs-214 .req-collapse').click();
      assert.deepEqual(toggled, [['card:major-bcs-cs-214', false]]);
      assert.ok(wired.querySelector('#major-bcs-cs-214').classList.contains('is-collapsed'));
    });
  });

  it('checkProgram hands back the grade of each matched course', () => {
    const result = checkProgram(bcs, [course('CS 212', { grade: 'B+', hours: 4 }), course('CS 108', { grade: 'A' }), course('CS 108L', { grade: 'A-' })]);
    assert.deepEqual(result.items.find(i => i.id === 'cs-212').matched.map(m => m.grade), ['B+']);
    assert.deepEqual(result.items.find(i => i.id === 'cs-108').matched.map(m => [m.code, m.grade]), [['CS 108', 'A'], ['CS 108L', 'A-']]);
  });

  it('courseIndex maps every course in a generated program.json to its title and catalog link', () => {
    const index = courseIndex({ requirements: [{ courses: [{ code: 'CS 108', title: 'Introduction to Computing', url: 'u1' }],
      children: [{ courses: [{ code: 'CS 112', title: 'Data Structures', url: null }, { code: 'CS 108', title: 'dup', url: 'u2' }], children: [] }] }] });
    assert.deepEqual([...index], [['CS 108', { title: 'Introduction to Computing', url: 'u1' }], ['CS 112', { title: 'Data Structures', url: null }]]);
    assert.equal(courseIndex(undefined).size, 0);
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
