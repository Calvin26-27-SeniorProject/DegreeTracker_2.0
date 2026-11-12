/**
 * Major & minor page: Workday's requirements outside the core, by program.
 * parseProgressRows' `programs`, programRequirements(), the Major and Minor pages
 * (renderPrograms), and the Overview dashboard's progress (renderDashboard).
 * These are shown as Workday lists them; the tool doesn't check them.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { readXlsxRows } from '../src/xlsx.js';
import { parseProgressRows, parseProgress, programRequirements, analyze } from '../src/core.js';
import { renderApp, renderPrograms, renderDashboard, coreProgress, programProgress, isMinor } from '../src/app-render.js';
import { KNOWN_COURSE_CATEGORIES } from '../src/catalog-courses.js';
import { makeCourse } from './helpers.js';

const { DOMParser } = new JSDOM('').window;
const sample = () => parseProgressRows(readXlsxRows(
  fs.readFileSync(new URL('./fixtures/academic-progress-sample.xlsx', import.meta.url)), { DOMParser }));
const norm = s => (s || '').replace(/\s+/g, ' ').trim();

describe('programs in the .xlsx export', () => {
  it('names each requirement table from the Program of Study summary, in order', () => {
    const { programs } = sample();
    assert.deepEqual(programs.map(p => [p.name, p.satisfied, p.total]),
      [['Computer Science, BCS', 2, 35], ['Entrepreneurship Minor', 2, 4]]);
  });

  it('keeps Workday’s wording, status, remaining, and the courses applied, with their grades', () => {
    const cs = sample().programs[0];
    const req = cs.requirements.find(r => r.name === '10 hours from: CS 300, 312, 320, 326, 332, 336, 338, 339, 354, 360, 361, 363, 372, 374, 375, 376; ENGR 304, 325 (minimum grade of C-)');
    assert.deepEqual([req.status, req.remaining, req.items], ['Not Satisfied', 'Minimum 10 Hour(s)', []]);
    const lab = cs.requirements.find(r => r.name === 'CS 108 and 108L (minimum grade of C-)');
    assert.deepEqual(lab.items, [
      { text: 'CS 108 - Introduction to Computing (In Progress)', period: '2026 Fall', hours: 3, grade: null },
      { text: 'CS 108L - Intro to Computing Lab (In Progress)', period: '2026 Fall', hours: 1, grade: null },
    ]);
    for (const p of sample().programs) for (const r of p.requirements) for (const i of r.items) {
      assert.deepEqual(Object.keys(i), ['text', 'period', 'hours', 'grade']);
    }
  });

  it('leaves names off when the summary and the tables don’t line up', () => {
    const rows = [
      ['Requirement', 'Status', 'Remaining', 'Registrations Used', 'Academic Period', 'Hours', 'Grade'],
      ['MATH 251', 'Not Satisfied', 'Minimum 1 Course(s)', '', '', '', ''],
    ];
    assert.deepEqual(parseProgressRows(rows).programs.map(p => p.name), [null]);
  });

  it('stops the summary at the GPA and Unused Registrations rows, even when they hold values', () => {
    // Some exports put the GPA in the first cell of the row after the programs.
    const header = ['Requirement', 'Status', 'Remaining', 'Registrations Used', 'Academic Period', 'Hours', 'Grade'];
    const rows = [
      ['Program of Study', 'Display ID', 'Count of Instances in Set', 'Text Return Attribute', 'Total Count', 'A divided by B', 'Satisfied Academic Requirements Label'],
      ['1.0', 'Computer Science, BCS', '33.0', 'of 33 Requirements', '20.0', '0.6', '20 Satisfied'],
      ['1.0', 'Mathematics Minor', '3.0', 'of 3 Requirements', '1.0', '0.3', '1 Satisfied'],
      ['3.5', 'GPA Including Calvin Credit Exams'],
      ['Unused Registrations', '1.0'],
      header,
      ['MATH 251', 'Not Satisfied', 'Minimum 1 Course(s)', '', '', '', ''],
      ['Program of Study GPA'],
      header,
      ['MATH 256', 'Not Satisfied', 'Minimum 1 Course(s)', '', '', '', ''],
    ];
    assert.deepEqual(parseProgressRows(rows).programs.map(p => [p.name, p.satisfied, p.total]),
      [['Computer Science, BCS', 20, 33], ['Mathematics Minor', 1, 3]]);
  });
});

describe('programRequirements', () => {
  it('leaves out the core’s requirements (the Calvin Core tab covers them) and GPA requirements', () => {
    const groups = programRequirements(sample());
    const names = groups.flatMap(g => g.requirements.map(r => r.name));
    assert.equal(groups[0].requirements.length, 20);
    assert.equal(groups[1].requirements.length, 3);
    assert.ok(!names.some(n => /Core$|Knowledge and Understanding|Rhetoric in Disciplines|GPA/.test(n)), names.join('\n'));
    assert.ok(names.includes('MATH 161 or 162'));
    assert.ok(names.includes('12 hours from ENTR 210, 211, 301, 302, 303, 304'));
  });

  it('puts a pasted page’s requirements in one unnamed group', () => {
    const text = fs.readFileSync(new URL('./fixtures/progress-example.txt', import.meta.url), 'utf-8');
    const groups = programRequirements(parseProgress(text));
    assert.equal(groups.length, 1);
    assert.equal(groups[0].name, null);
    assert.ok(groups[0].requirements.some(r => r.name === 'Computer Science Major'));
  });

  it('is empty for Academic History, which lists no requirements', () => {
    assert.deepEqual(programRequirements({ courses: [] }), []);
  });
});

const newRoot = () => new JSDOM('<!doctype html><body><section id="p"></section></body>').window.document.getElementById('p');
const catalog = JSON.parse(fs.readFileSync(new URL('../catalog/catalog-categories-25.json', import.meta.url), 'utf-8'));

describe('progress counts', () => {
  it('programProgress counts requirements by Workday’s status', () => {
    const [cs, entr] = programRequirements(sample());
    assert.deepEqual(programProgress(cs), { done: 0, inProgress: 4, total: 20 });
    assert.deepEqual(programProgress(entr), { done: 1, inProgress: 2, total: 3 });
  });

  it('isMinor goes by Workday’s program name; unnamed groups count as the major', () => {
    assert.deepEqual(programRequirements(sample()).map(isMinor), [false, true]);
    assert.equal(isMinor({ name: null }), false);
  });

  it('coreProgress agrees with the summary’s “N of M requirements met”', () => {
    const transcripts = [
      [makeCourse('CORE 100', 2), makeCourse('REL 121', 4)],
      [makeCourse('CORE 100', 2), makeCourse('HIST 152', 4), makeCourse('ECON 221', 4, { status: 'in-progress' }), makeCourse('MATH 171', 4)],
    ];
    for (const transcript of transcripts) {
      const analysis = analyze(catalog.categories, transcript, { extraCourses: KNOWN_COURSE_CATEGORIES });
      const root = newRoot();
      renderApp(root, { catalog, analysis });
      const p = coreProgress(catalog, analysis);
      assert.equal(root.querySelector('.summary h2').textContent, `${p.done} of ${p.total} requirements met`);
      // The three columns hold the same requirements (K&U as one): satisfied, in progress, not satisfied.
      const counts = [...root.querySelectorAll('.summary .status-column')].map(c => c.querySelectorAll('.summary-chip').length);
      assert.deepEqual(counts, [p.done, p.inProgress, p.total - p.done - p.inProgress]);
    }
  });
});

describe('grades on the Calvin Core tab, behind “Show grades”', () => {
  const analysis = analyze(catalog.categories,
    [makeCourse('CORE 100', 2, { grade: 'B+' }), makeCourse('REL 121', 4, { grade: 'F' })], { extraCourses: KNOWN_COURSE_CATEGORIES });
  const root = newRoot();
  renderApp(root, { catalog, analysis });

  it('puts a taken course’s grade in a .grade element', () => {
    const chip = root.querySelector('[data-code="CORE 100"] .chip-taken');
    assert.equal(chip.querySelector('.grade').textContent, ' · B+');
    chip.querySelector('.grade').remove();
    assert.equal(chip.textContent, 'Taken · 2 hrs');
  });

  it('marks the courses table’s Grade column, and reads well with the grade hidden', () => {
    assert.ok([...root.querySelectorAll('th')].find(th => th.textContent === 'Grade').classList.contains('grade-col'));
    const warning = [...root.querySelectorAll('li')].find(li => /^REL 121.*isn’t counted toward any requirement/.test(li.textContent));
    warning.querySelector('.grade').remove();
    assert.match(warning.textContent, /isn’t counted toward any requirement: its grade doesn’t earn credit\.$/);
  });
});

describe('renderPrograms (Major and Minor pages)', () => {
  const groups = programRequirements(sample());

  it('opens with a summary box like the core’s, one chip per requirement linking to it', () => {
    const root = newRoot();
    renderPrograms(root, { groups: groups.filter(g => !isMinor(g)), hasInput: true, kind: 'major' });
    assert.equal(root.querySelector('.summary h2').textContent, '0 of 20 requirements satisfied');
    const chips = [...root.querySelectorAll('.summary-chip')];
    assert.equal(chips.length, 20);
    for (const a of chips) assert.ok(root.querySelector(a.getAttribute('href')), a.getAttribute('href'));
    assert.match(root.textContent, /this tool doesn’t check them/);
  });

  it('lists each requirement with Workday’s status, remaining, and the courses applied', () => {
    const root = newRoot();
    renderPrograms(root, { groups: groups.filter(isMinor), hasInput: true, kind: 'minor' });
    assert.equal(root.querySelector('.program h3').textContent, 'Entrepreneurship Minor');
    const entr = [...root.querySelectorAll('.program-req')].find(li => /^12 hours from ENTR/.test(li.querySelector('.program-req-name').textContent));
    assert.equal(entr.querySelector('.status-pill').textContent, 'In Progress');
    assert.equal(norm(entr.querySelector('.program-req-remaining').textContent), 'Remaining: Minimum 4 Hour(s)');
    assert.equal(entr.querySelectorAll('.program-items li').length, 3);
  });

  it('puts every grade in a .grade element, which the page hides until “Show grades” is on', () => {
    const graded = [{ name: 'Physics Minor', satisfied: null, total: null, requirements: [
      { name: 'PHYS 133', status: 'Satisfied', remaining: null, items: [{ text: 'PHYS 133 - Mechanics', period: '2025 Fall', hours: 3, grade: 'B+' }] },
    ] }];
    const root = newRoot();
    renderPrograms(root, { groups: graded, hasInput: true, kind: 'minor' });
    assert.deepEqual([...root.querySelectorAll('.grade')].map(e => e.textContent), [' · B+']);
    for (const e of root.querySelectorAll('.grade')) e.remove();
    assert.doesNotMatch(root.textContent, /B\+/);
  });

  it('says what to do when there’s nothing to show', () => {
    const empty = state => { const r = newRoot(); renderPrograms(r, state); return r.textContent; };
    assert.match(empty({ groups: [], hasInput: false, kind: 'minor' }), /Upload your Academic Progress export to see your minor/);
    assert.match(empty({ groups: [], hasInput: true, kind: 'minor' }), /doesn’t list a minor/);
  });
});

describe('renderDashboard (Overview)', () => {
  const groups = programRequirements(sample());
  const analysis = analyze(catalog.categories, sample().courses, { extraCourses: KNOWN_COURSE_CATEGORIES });

  it('has a donut for everything, the core, the major, and the minor, each with its percentage', () => {
    const root = newRoot();
    renderDashboard(root, { catalog, analysis, groups });
    const cards = [...root.querySelectorAll('.dash-card')].map(c => [c.querySelector('h3').textContent, c.querySelector('.donut-value')?.textContent]);
    const core = coreProgress(catalog, analysis);
    const all = { done: core.done + 0 + 1, total: core.total + 20 + 3 };
    assert.deepEqual(cards, [
      ['All requirements', `${Math.round(100 * all.done / all.total)}%`],
      ['Calvin Core', `${Math.round(100 * core.done / core.total)}%`],
      ['Computer Science, BCS', '0%'],
      ['Entrepreneurship Minor', '33%'],
    ]);
  });

  it('draws satisfied, in-progress, and remaining arcs, labeled for screen readers', () => {
    const root = newRoot();
    renderDashboard(root, { catalog, analysis, groups });
    const minor = [...root.querySelectorAll('.dash-card')].find(c => c.querySelector('h3').textContent === 'Entrepreneurship Minor');
    assert.deepEqual([...minor.querySelectorAll('circle')].map(c => c.getAttribute('class')), ['donut-done', 'donut-progress']); // 1 satisfied, 2 in progress, none remaining
    assert.equal(minor.querySelector('svg').getAttribute('aria-label'), 'Entrepreneurship Minor: 1 of 3 satisfied, 2 in progress');
    assert.equal(minor.querySelector('.dash-count').textContent, '1 of 3 requirements satisfied');
  });

  it('says when a record has no major or minor, and asks for a file when there’s none', () => {
    const root = newRoot();
    renderDashboard(root, { catalog, analysis, groups: [] });
    assert.match(root.textContent, /doesn’t list a major/);
    assert.match(root.textContent, /doesn’t list a minor/);
    const none = newRoot();
    renderDashboard(none, { catalog, analysis: null, groups: [] });
    assert.match(none.textContent, /Upload your Academic Progress export/);
  });
});
