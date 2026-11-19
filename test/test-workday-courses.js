/**
 * A program with no checked file shows Workday's requirements; each one whose
 * name lists courses gets a row per course like a checked program's (title,
 * catalog hours and link, offered sections, green when taken), joined by Or /
 * And as the name reads. workdayRequirementCourses (core.js), the Workday cards
 * in renderPrograms, and programs/course-index.json.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { readXlsxRows } from '../src/xlsx.js';
import { parseProgressRows } from '../src/parse.js';
import { programRequirements, workdayRequirementCourses as parse } from '../src/core.js';
import { renderPrograms } from '../src/app-render.js';
import { catalogCourseIndex } from '../src/program-courses.js';
import { buildCourseIndex, COURSE_INDEX_PATH } from './course-index.js';

const { DOMParser } = new JSDOM('').window;
const sample = () => parseProgressRows(readXlsxRows(
  fs.readFileSync(new URL('./fixtures/academic-progress-sample.xlsx', import.meta.url)), { DOMParser }));
const INDEX_JSON = JSON.parse(fs.readFileSync(COURSE_INDEX_PATH, 'utf-8'));
const INDEX = catalogCourseIndex(INDEX_JSON);
const newRoot = () => new JSDOM('<!doctype html><body><section id="p"></section></body>').window.document.getElementById('p');
const read = name => { const p = parse(name); return p && [p.kind, p.options]; };

describe('reading a Workday requirement’s name', () => {
  it('reads every name in the sample export', () => {
    const got = programRequirements(sample()).flatMap(g => g.requirements.map(r => [r.name, read(r.name)]));
    assert.deepEqual(got, [
      ['CS 108 and 108L (minimum grade of C-)', ['all', [['CS 108', 'CS 108L']]]],
      ['CS 112 and 112L (minimum grade of C-)', ['all', [['CS 112', 'CS 112L']]]],
      ['CS 195 (3 semesters)', ['single', [['CS 195']]]],
      ['CS 212 (minimum grade C-)', ['single', [['CS 212']]]],
      ['CS 214 (minimum grade C-)', ['single', [['CS 214']]]],
      ['CS 232 (minimum grade C-)', ['single', [['CS 232']]]],
      ['CS 262 (minimum grade C-)', ['single', [['CS 262']]]],
      ['CS 295 (3 semesters)', ['single', [['CS 295']]]],
      ['CS 384 (minimum grade of C-)', ['single', [['CS 384']]]],
      ['CS 396 and 398 (minimum grade of C-)', ['all', [['CS 396', 'CS 398']]]],
      ['10 hours from: CS 300, 312, 320, 326, 332, 336, 338, 339, 354, 360, 361, 363, 372, 374, 375, 376; ENGR 304, 325 (minimum grade of C-)',
        ['list', ['CS 300', 'CS 312', 'CS 320', 'CS 326', 'CS 332', 'CS 336', 'CS 338', 'CS 339', 'CS 354', 'CS 360', 'CS 361', 'CS 363',
          'CS 372', 'CS 374', 'CS 375', 'CS 376', 'ENGR 304', 'ENGR 325'].map(c => [c])]],
      ['COMM 101', ['single', [['COMM 101']]]],
      ['DATA 202', ['single', [['DATA 202']]]],
      ['ENGR 220 and 220L', ['all', [['ENGR 220', 'ENGR 220L']]]],
      ['MATH 161 or 162', ['any', [['MATH 161'], ['MATH 162']]]],
      ['MATH 251', ['single', [['MATH 251']]]],
      ['MATH 252', ['single', [['MATH 252']]]],
      ['MATH 255', ['single', [['MATH 255']]]],
      ['STAT 243 or 343', ['any', [['STAT 243'], ['STAT 343']]]],
      ['6 hours from: ASTR 201, 211; BIOL 160, 161, 231, 232; CHEM 101, 102, 103; GEO 120, 151, 152, 153; PHYS 130, 131, 133, 235',
        ['list', ['ASTR 201', 'ASTR 211', 'BIOL 160', 'BIOL 161', 'BIOL 231', 'BIOL 232', 'CHEM 101', 'CHEM 102', 'CHEM 103',
          'GEO 120', 'GEO 151', 'GEO 152', 'GEO 153', 'PHYS 130', 'PHYS 131', 'PHYS 133', 'PHYS 235'].map(c => [c])]],
      ['ENTR 201 (Introduction to Entrepreneurship)', ['single', [['ENTR 201']]]],
      ['ENTR 202 (Design Thinking)', ['single', [['ENTR 202']]]],
      ['12 hours from ENTR 210, 211, 301, 302, 303, 304', ['list', ['ENTR 210', 'ENTR 211', 'ENTR 301', 'ENTR 302', 'ENTR 303', 'ENTR 304'].map(c => [c])]],
    ]);
  });

  it('reads “or” cases as alternatives, with “and” inside one only where it can’t be misread', () => {
    assert.deepEqual(read('PSYC 244'), ['single', [['PSYC 244']]]);
    assert.deepEqual(read('BIOL 123 or both BIOL 160 and 161'), ['any', [['BIOL 123'], ['BIOL 160', 'BIOL 161']]]);
    assert.deepEqual(read('Either PHIL 101 or PHIL 102'), ['any', [['PHIL 101'], ['PHIL 102']]]);
    assert.deepEqual(read('MATH 161, 162, or 171'), ['any', [['MATH 161'], ['MATH 162'], ['MATH 171']]]);
    assert.deepEqual(read('MATH 161, 162 or 171'), ['any', [['MATH 161'], ['MATH 162'], ['MATH 171']]]);
    assert.deepEqual(read('CORE 100/HNRS 110'), ['any', [['CORE 100'], ['HNRS 110']]]);
    assert.deepEqual(read('CHEM 101, 102, and 103'), ['all', [['CHEM 101', 'CHEM 102', 'CHEM 103']]]);
    assert.deepEqual(read('CS 108 and 108L or CS 106 and 106L'), ['any', [['CS 108', 'CS 108L'], ['CS 106', 'CS 106L']]]);
  });

  it('claims no Or / And reading it can’t be sure of, but still lists the courses', () => {
    for (const name of [
      'MATH 161 or 171 and MATH 251', // (161 or 171) and 251, or 161 or (171 and 251)?
      'BIOL 160 and BIOL 161 or BIOL 123',
      'PSYC 151 and 201, or PSYC 202',
      'both BIOL 160, 161 and 162 or BIOL 123',
      '4 hours from MATH 172, 255; STAT 245 or any 300-level STAT course',
      'CS 212 or permission of the instructor',
      'MATH 161 or, 162',
    ]) {
      const p = parse(name);
      assert.equal(p.kind, 'mentioned', name);
      assert.ok(p.options.every(o => o.length === 1), name);
    }
    assert.deepEqual(parse('MATH 161 or 171 and MATH 251').codes, ['MATH 161', 'MATH 171', 'MATH 251']);
  });

  it('lists nothing for a name without a course, or with a course level rather than a course', () => {
    for (const name of ['Electives', 'Major GPA 2.0', 'Any CS 300-level course', 'Minimum 3 Course(s)', '']) assert.equal(parse(name), null, name);
  });

  it('carries a subject only to the bare numbers after it', () => {
    assert.deepEqual(parse('ENGR 304, 325; CS 300').codes, ['ENGR 304', 'ENGR 325', 'CS 300']);
    assert.equal(parse('3 hours from 101, 102'), null);
  });
});

describe('Workday cards with course rows', () => {
  const g = (...reqs) => ({ name: 'Psychology Major, BS', requirements: reqs.map(([name, status, items = [], remaining = null]) => ({ name, status, remaining, items })) });
  const draw = (group, records = []) => {
    const root = newRoot();
    renderPrograms(root, { groups: [group], hasInput: true, kind: 'major', courseIndex: INDEX, records });
    return root;
  };
  const card = (root, name) => [...root.querySelectorAll('.req')].find(a => a.querySelector('.req-name').textContent === name);
  const rows = el => [...el.querySelectorAll('.course-list > li')].map(li => li.classList.contains('course-connector')
    ? li.textContent : [li.dataset.code, li.classList.contains('is-active')]);

  it('a single course: its row with title, catalog hours, and link, like a checked program', () => {
    const c = card(draw(g(['PSYC 244', 'Not Satisfied', [], 'Minimum 1 Course(s)'])), 'PSYC 244');
    assert.equal(c.querySelector('.req-note').textContent, 'Remaining: Minimum 1 Course(s)');
    assert.equal(c.querySelector('details'), null, 'one course is listed directly');
    const row = c.querySelector('.course-list > li.course');
    assert.equal(row.querySelector('.course-code').getAttribute('href'), INDEX.get('PSYC 244').url);
    assert.match(row.querySelector('.course-code').getAttribute('href'), /^https:\/\/catalog\.calvin\.edu\/preview_course_nopop\.php\?catoid=\d+&coid=\d+$/);
    assert.equal(row.querySelector('.course-title').textContent, 'Introduction to Biological Psychology');
    assert.equal(row.querySelector('.chip-hours').textContent, `${INDEX.get('PSYC 244').credits} hrs`);
  });

  it('“BIOL 123 or both BIOL 160 and 161”: Or between the ways to meet it, BIOL 160 and 161 side by side with no joiner', () => {
    const c = card(draw(g(['BIOL 123 or both BIOL 160 and 161', 'Not Satisfied', [], 'Minimum Combination Required'])), 'BIOL 123 or both BIOL 160 and 161');
    assert.equal(c.querySelector('details summary').textContent, 'Course options (3)');
    assert.ok(c.querySelector('details').open);
    assert.deepEqual(rows(c), [['BIOL 123', false], 'Or', ['BIOL 160', false], ['BIOL 161', false]]);
    for (const li of c.querySelectorAll('li.course')) assert.ok(li.querySelector('.course-title').textContent, li.dataset.code);
    assert.equal(c.textContent.includes('And'), false);
  });

  it('a course you took is green, with your grade, wherever it is on your record', () => {
    const records = [{ code: 'BIOL 160', title: 'Investigating Biological Systems', hours: 4, grade: 'A-', status: 'completed', period: '2025 Fall' }];
    const c = card(draw(g(['BIOL 123 or both BIOL 160 and 161', 'Not Satisfied']), records), 'BIOL 123 or both BIOL 160 and 161');
    assert.deepEqual(rows(c), [['BIOL 123', false], 'Or', ['BIOL 160', true], ['BIOL 161', false]]);
    const taken = c.querySelector('li.course.is-active');
    assert.deepEqual([...taken.querySelectorAll('.chip')].map(x => x.textContent), ['Taken · A- · 4 hrs'], 'no term chip');
  });

  it('a lab next to its lecture is its own row under it, “Not on your record” when only the lecture is', () => {
    const records = [{ code: 'CS 108', title: 'Introduction to Computing', hours: 3, grade: 'A', status: 'completed' }];
    const c = card(draw(g(['CS 108 and 108L (minimum grade of C-)', 'Not Satisfied']), records), 'CS 108 and 108L (minimum grade of C-)');
    assert.deepEqual(rows(c), [['CS 108', true], ['CS 108L', false]]);
    const lab = c.querySelector('li[data-code="CS 108L"]');
    assert.ok(lab.classList.contains('is-lab'));
    assert.equal(lab.querySelector('.course-title').textContent, 'Lab for CS 108');
    assert.equal(lab.querySelector('.chip-excluded').textContent, 'Not on your record');
  });

  it('a failing grade or an exemption isn’t green', () => {
    const records = [{ code: 'PSYC 244', hours: 2, grade: 'F', status: 'completed' }, { code: null, title: 'Exemption', status: 'exemption' }];
    assert.deepEqual(rows(card(draw(g(['PSYC 244', 'Not Satisfied']), records), 'PSYC 244')), [['PSYC 244', false]]);
  });

  it('a course Workday applied is green even when it isn’t on the record read, and what else Workday applied follows', () => {
    const c = card(draw(g(['MATH 161 or 162', 'Satisfied', [
      { text: 'MATH 162 - Differential and Integral Calculus', period: '2025 Fall', hours: 4 },
      { text: 'Transfer Calculus - 06/01/2024', period: null, hours: 4 },
    ]])), 'MATH 161 or 162');
    assert.deepEqual(rows(c), [['MATH 161', false], 'Or', ['MATH 162', true], 'Also applied in Workday', [undefined, true]]);
    assert.equal(c.querySelector('details').open, true, 'open: it holds a course you took');
  });

  it('a satisfied list without courses you took starts closed', () => {
    const c = card(draw(g(['MATH 161 or 162', 'Satisfied'])), 'MATH 161 or 162');
    assert.equal(c.querySelector('details').open, false);
  });

  it('a name read only for its courses says so and lists them without Or / And', () => {
    const c = card(draw(g(['MATH 161 or 171 and MATH 251', 'Not Satisfied'])), 'MATH 161 or 171 and MATH 251');
    assert.match(c.textContent, /see Workday for how they combine/);
    assert.deepEqual(rows(c), [['MATH 161', false], ['MATH 171', false], ['MATH 251', false]]);
  });

  it('a name without courses shows Workday’s items as before', () => {
    const c = card(draw(g(['Electives', 'In Progress', [{ text: 'PSYC 151 - Introductory Psychology (In Progress)', period: '2026 Fall', hours: 4 }]])), 'Electives');
    assert.deepEqual(rows(c), [[undefined, true]]);
    assert.match(c.textContent, /In progress · 4 hrs/);
  });
});

describe('programs/course-index.json', () => {
  it('is up to date with the program pages (npm run generate-course-index)', () => {
    assert.deepEqual(INDEX_JSON, buildCourseIndex());
  });

  it('has a title and catalog link for every course the sample’s requirements name (labs are shown with their lecture)', () => {
    for (const g of programRequirements(sample())) for (const r of g.requirements) for (const code of parse(r.name)?.codes || []) {
      if (/\d{3}L$/.test(code)) continue;
      assert.ok(INDEX.get(code)?.title, code);
      assert.ok(INDEX.get(code)?.url, code);
    }
  });
});
