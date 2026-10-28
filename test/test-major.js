import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { analyzeMajor } from '../src/major.js';
import { nextSemesterCode, renderMajor } from '../src/major-app.js';
import { parseProgressRows } from '../src/core.js';

const major = JSON.parse(fs.readFileSync(new URL('../majors/bcs.json', import.meta.url), 'utf8'));
const courseOptions = JSON.parse(fs.readFileSync(new URL('../majors/bcs-course-options.json', import.meta.url), 'utf8'));
const catalog = JSON.parse(fs.readFileSync(new URL('../catalog/catalog-categories-25.json', import.meta.url), 'utf8'));
const catalog24 = JSON.parse(fs.readFileSync(new URL('../catalog/catalog-categories-24.json', import.meta.url), 'utf8'));
const schedule = JSON.parse(fs.readFileSync(new URL('../schedule/sections.json', import.meta.url), 'utf8'));

describe('BCS major requirements', () => {
  it('keeps the published course requirements in a structured major file', () => {
    assert.equal(major.id, 'bcs');
    assert.ok(major.requirements.some(r => r.codes.includes('CS 212')));
    assert.ok(major.requirements.some(r => r.codes.includes('ENGR 220')));
    assert.ok(major.courseGroups.some(r => /electives/i.test(r.label)));
    assert.deepEqual(major.requirements.filter(r => /^MATH 25[12]$/.test(r.label)).map(r => r.codes[0]),
      ['MATH 251', 'MATH 252']);
  });

  it('matches completed, in-progress, and non-passing Workday course records', () => {
    const requirementSubset = {
      requirements: [
        { id: 'cs-108', codes: ['CS 108', 'CS 106', 'CS 104'] },
        { id: 'cs-112', codes: ['CS 112'] },
        { id: 'cs-212', codes: ['CS 212'] },
      ],
    };
    const rows = [
      ['Requirement', 'Status', 'Remaining', 'Registrations Used', 'Academic Period', 'Hours', 'Grade'],
      ['Computer Science Major', 'Satisfied', '', 'CS 106 - Intro to Computing', '2025 Fall', '4', 'B'],
      ['Computer Science Major', 'In Progress', '', 'CS 112 - Data Structures (In Progress)', '2026 Fall', '4', ''],
      ['Computer Science Major', 'Satisfied', '', 'CS 212 - Course', '2025 Spring', '4', 'F'],
    ];
    const { courses } = parseProgressRows(rows);
    const results = analyzeMajor(requirementSubset, courses);
    assert.deepEqual(results.map(r => [r.status, r.matchedCode]), [
      ['complete', 'CS 106'],
      ['in-progress', 'CS 112'],
      ['incomplete', null],
    ]);
  });

  it('preserves unique course terms for repeated seminar requirements', () => {
    const rows = [
      ['Requirement', 'Status', 'Remaining', 'Registrations Used', 'Academic Period', 'Hours', 'Grade'],
      ['Computer Science Major', 'Satisfied', '', 'CS 195 - Introductory Computing Seminar', '2024 Spring', '0', 'CR'],
      ['Computer Science Major', 'Satisfied', '', 'CS 195 - Introductory Computing Seminar', '2024 Fall', '0', 'CR'],
      ['Computer Science Major', 'Satisfied', '', 'CS 195 - Introductory Computing Seminar', '2025 Fall', '0', 'CR'],
      ['Computer Science Major', 'Satisfied', '', 'CS 195 - Introductory Computing Seminar', '2025 Fall', '0', 'CR'],
    ];
    const { courses, courseAttempts } = parseProgressRows(rows);
    assert.equal(courses.filter(course => course.code === 'CS 195').length, 1);
    assert.equal(courseAttempts.filter(course => course.code === 'CS 195').length, 3);
    const result = analyzeMajor(major, courses, courseAttempts).find(course => course.id === 'cs-195');
    assert.equal(result.status, 'complete');
    assert.equal(result.occurrenceCount, 3);
  });

  it('does not claim ambiguous or repeated requirements are fully audited', () => {
    const requirementSubset = {
      requirements: [
        { id: 'cs-195', codes: ['CS 195'], manual: true },
        { id: 'stat-243', codes: ['STAT 243'], manualWhenMissing: true },
        { id: 'math-251', codes: ['MATH 251'] },
        { id: 'math-252', codes: ['MATH 252'] },
      ],
    };
    const results = analyzeMajor(requirementSubset, [
      { code: 'CS 195', status: 'completed', grade: 'CR' },
      { code: 'MATH 251', status: 'completed', grade: 'B' },
    ]);
    assert.deepEqual(results.map(r => r.status), ['manual-found', 'manual', 'complete', 'incomplete']);
  });

  it('uses the codes already extracted from a Workday Excel requirement table', () => {
    const rows = [
      ['Requirement', 'Status', 'Remaining', 'Registrations Used', 'Academic Period', 'Hours', 'Grade'],
      ['Computer Science Major', 'Satisfied', '', 'CS 212 - Course', '2025 Fall', '4', 'A'],
    ];
    const { courses } = parseProgressRows(rows);
    const results = analyzeMajor(major, courses);
    assert.equal(results.find(r => r.id === 'cs-212').status, 'complete');
  });

  it('renders the major overview and marks elective and science options from the same course list', () => {
    const root = new JSDOM('<div id="major"></div>').window.document.getElementById('major');
    renderMajor(root, major, courseOptions, [
      { code: 'CS 300', title: 'Advanced Computing', status: 'completed', grade: 'A', hours: 3 },
      { code: 'PHYS 221', title: 'General Physics', status: 'completed', grade: 'B', hours: 4 },
    ], catalog, schedule);
    assert.ok(root.querySelector('[aria-label="BCS major overview"]'));
    assert.match(root.textContent, /CS 300.*Taken/);
    assert.match(root.textContent, /PHYS 221.*Taken/);
    assert.match(root.textContent, /4 of 6 hrs/);
    assert.match(root.textContent, /Course options \(\d+\)/);
    assert.match(root.textContent, /General Physics/);
    assert.ok(root.querySelector('#bcs-math-251'));
    assert.ok(root.querySelector('#bcs-math-252'));
  });

  it('shows required course titles, credits, grades, and primary-first alternatives', () => {
    const root = new JSDOM('<div id="major"></div>').window.document.getElementById('major');
    renderMajor(root, major, courseOptions, [
      { code: 'CS 106', title: 'Intro to Computing', status: 'completed', grade: 'B+', hours: 4 },
    ], catalog, schedule);
    const requirement = root.querySelector('#bcs-cs-108');
    assert.match(requirement.querySelector('.req-name').textContent, /^CS 106 - Intro to Computing$/);
    assert.equal(requirement.querySelector('.chip-taken').textContent, 'Taken · B+ · 4 hrs');
    assert.ok(requirement.querySelector('summary').textContent.includes('Other accepted courses'));
    assert.ok(requirement.textContent.indexOf('CS 106') < requirement.textContent.indexOf('CS 104'));
  });

  it('renders all saved CS course options and compact upcoming-term statuses', () => {
    assert.deepEqual(courseOptions.csCourses.map(course => course.code), [
      'CS 300', 'CS 312', 'CS 320', 'CS 326', 'CS 332', 'CS 336',
      'CS 338', 'CS 339', 'CS 354', 'CS 360', 'CS 361', 'CS 363',
      'CS 372', 'CS 374', 'CS 375', 'CS 376', 'ENGR 304', 'ENGR 325',
    ]);
    const root = new JSDOM('<div id="major"></div>').window.document.getElementById('major');
    const fall2026 = new Date(2026, 9, 28);
    renderMajor(root, major, courseOptions, [], catalog, schedule, [], fall2026);
    const cs336 = [...root.querySelectorAll('#bcs-cs-electives .course')]
      .find(row => row.querySelector('.course-code').textContent === 'CS 336');
    const cs326 = [...root.querySelectorAll('#bcs-cs-electives .course')]
      .find(row => row.querySelector('.course-code').textContent === 'CS 326');
    assert.equal(cs336.querySelector('.course-flags .chip').textContent, 'Not listed');
    assert.equal(cs326.querySelector('.course-flags .chip').textContent, 'Open');
    assert.equal(cs326.querySelector('.course-flags .chip').getAttribute('title'), 'Next semester (27SP): Open');
    const cs312 = [...root.querySelectorAll('#bcs-cs-electives .course')]
      .find(row => row.querySelector('.course-code').textContent === 'CS 312');
    assert.equal(cs312.querySelector('.course-flags .chip').textContent, 'Not listed');
    assert.doesNotMatch(root.textContent, /Offered:/);
    assert.doesNotMatch(root.textContent, /FA 26|SP 27|SU 27/);
    assert.equal(cs326.querySelector('.offered'), null);
    assert.equal(cs326.querySelector('.section-list'), null);
    assert.equal(root.querySelector('#bcs-cs-electives .course-list').children.length, 18);
  });

  it('identifies only the next standard semester', () => {
    assert.equal(nextSemesterCode(new Date(2026, 9, 28)), '27SP');
    assert.equal(nextSemesterCode(new Date(2027, 2, 1)), '27FA');
    assert.equal(nextSemesterCode(new Date(2027, 6, 1)), '27FA');
  });

  it('uses the core Taken, grade, hours badge for completed elective courses', () => {
    const root = new JSDOM('<div id="major"></div>').window.document.getElementById('major');
    renderMajor(root, major, courseOptions, [
      { code: 'CS 326', title: 'Embedded Systems and the Internet of Things', status: 'completed', grade: 'A', hours: 4 },
    ], catalog, schedule);
    const course = [...root.querySelectorAll('#bcs-cs-electives .course')]
      .find(row => row.querySelector('.course-code').textContent === 'CS 326');
    assert.equal(course.querySelector('.chip-taken').textContent, 'Taken · A · 4 hrs');
  });

  it('lists completed seminar occurrences from oldest term and completes after three', () => {
    const root = new JSDOM('<div id="major"></div>').window.document.getElementById('major');
    const attempts = [
      { code: 'CS 195', title: 'Introductory Computing Seminar', status: 'completed', period: '2025 Fall', grade: 'CR', hours: 0 },
      { code: 'CS 195', title: 'Introductory Computing Seminar', status: 'completed', period: '2024 Fall', grade: 'CR', hours: 0 },
      { code: 'CS 195', title: 'Introductory Computing Seminar', status: 'completed', period: '2024 Spring', grade: 'CR', hours: 0 },
    ];
    renderMajor(root, major, courseOptions, [attempts[0]], catalog, schedule, attempts);
    const requirement = root.querySelector('#bcs-cs-195');
    assert.match(requirement.querySelector('.status-pill').textContent, /Complete/);
    assert.deepEqual([...requirement.querySelectorAll('.course .chip-taken')].map(chip => chip.textContent), [
      'Taken · 24SP', 'Taken · 24FA', 'Taken · 25FA',
    ]);
  });

  it('limits Lab Science options to the selected catalog and identified lab courses', () => {
    const science = courseOptions.labScience;
    const categoryCodes = catalog.categories.find(category => category.name === 'Natural Sciences')
      .courses.map(course => course.code);
    const category24Codes = catalog24.categories.find(category => category.name === 'Natural Sciences')
      .courses.map(course => course.code);
    assert.deepEqual(category24Codes, categoryCodes);
    for (const [selectedCatalog, catoid] of [[catalog, '25'], [catalog24, '24']]) {
      const allowed = new Set(selectedCatalog.categories
        .find(category => category.name === 'Natural Sciences').courses.map(course => course.code));
      const options = science.filter(course => course.catalogs.includes(catoid) && allowed.has(course.code));
      assert.ok(options.length > 0);
      assert.ok(options.every(course => course.evidence && course.catalogs.includes(catoid)));
    }
    assert.deepEqual(
      science.filter(course => course.catalogs.includes('24')).map(course => course.code),
      science.filter(course => course.catalogs.includes('25')).map(course => course.code),
    );
  });

  it('uses one shared Workday input with tab panels in the standalone app', () => {
    const html = fs.readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');
    assert.equal((html.match(/id="workday-file"/g) || []).length, 1);
    assert.equal((html.match(/role="tab"/g) || []).length, 2);
    assert.match(html, /id="core-panel" role="tabpanel"/);
    assert.match(html, /id="major-panel" role="tabpanel"/);
  });
});
