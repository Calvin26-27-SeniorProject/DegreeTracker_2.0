import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { analyzeMajor } from '../src/major.js';
import { currentAndNextSemesterCodes, renderMajor, renderMajorNotice, renderMajorMessage } from '../src/major-app.js';
import { detectMajors, findProgramNamesInText } from '../src/major-detect.js';
import { parseProgressRows } from '../src/core.js';

const major = JSON.parse(fs.readFileSync(new URL('../majors/bcs/bcs.json', import.meta.url), 'utf8'));
const nursing = JSON.parse(fs.readFileSync(new URL('../majors/nursing/nursing.json', import.meta.url), 'utf8'));
const nursingOptions = JSON.parse(fs.readFileSync(new URL('../majors/nursing/nursing-course-options.json', import.meta.url), 'utf8'));
const courseOptions = JSON.parse(fs.readFileSync(new URL('../majors/bcs/bcs-course-options.json', import.meta.url), 'utf8'));
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

  it('keeps Computer Science Plus requirements from the 2026-27 catalog in its own folder', () => {
    const csPlus = JSON.parse(fs.readFileSync(new URL('../majors/cs+/cs-plus.json', import.meta.url), 'utf8'));
    const csPlusOptions = JSON.parse(fs.readFileSync(new URL('../majors/cs+/cs-plus-course-options.json', import.meta.url), 'utf8'));
    assert.equal(csPlus.id, 'cs-plus');
    assert.equal(csPlus.catalogId, '25');
    const byId = id => csPlus.requirements.find(requirement => requirement.id === id);
    assert.deepEqual(byId('cs-108').codes.slice(0, 2), ['CS 108', 'CS 106']);
    assert.equal(byId('cs-195').requiredOccurrences, 3);
    assert.equal(byId('cs-295').requiredOccurrences, 3);
    assert.deepEqual(byId('cs-capstone').codes, ['CS 383', 'CS 396']);
    assert.deepEqual(byId('stat-243').codes, ['STAT 243', 'STAT 143', 'STAT 145', 'PSYC 255']);
    const electives = csPlus.courseGroups.find(group => group.id === 'cs-electives');
    assert.equal(electives.minHours, 6);
    assert.equal(electives.courses.length, 18);
    assert.deepEqual(csPlusOptions.csCourses.map(course => course.code), electives.courses.map(course => course.code).sort());
    assert.ok(csPlus.manualRequirements.some(item => item.label === 'Plus Domain Study'));
    const results = analyzeMajor(csPlus, [{ code: 'CS 106', status: 'completed', grade: 'B', hours: 4 }]);
    assert.equal(results.find(result => result.id === 'cs-108').status, 'complete');
  });

  it('keeps Nursing requirements from the 2026-27 catalog in their own folder', () => {
    assert.equal(nursing.id, 'nursing');
    assert.equal(nursing.programName, 'Nursing, BSN');
    const preNursing = nursing.requirements.filter(item => item.section === 'Pre-nursing curriculum');
    const program = nursing.requirements.filter(item => item.section === 'Program requirements');
    assert.deepEqual(preNursing.map(item => item.codes[0]), [
      'BIOL 141', 'BIOL 205', 'BIOL 206', 'BIOL 207', 'CHEM 160', 'HE 254', 'PSYC 151', 'PSYC 201', 'SOC 151',
    ]);
    assert.equal(program.length, 23);
    assert.equal(program.filter(item => item.codes[0].startsWith('NURS')).length, 22);
    assert.equal(nursing.requirements.find(item => item.id === 'idis-108').manualWhenMissing, true);
    assert.deepEqual(nursing.courseGroups, []);
    assert.deepEqual(nursingOptions.csCourses, []);
    assert.deepEqual(nursingOptions.labScience, []);
  });

  it('picks the major from the programs listed in the Workday input', () => {
    const majors = [major, nursing];
    assert.deepEqual(detectMajors(['Computer Science, BCS', 'Entrepreneurship Minor'], majors).map(item => item.id), ['bcs']);
    assert.deepEqual(detectMajors(['Nursing, BSN'], majors).map(item => item.id), ['nursing']);
    assert.deepEqual(detectMajors([' nursing,  bsn '], majors).map(item => item.id), ['nursing']);
    assert.deepEqual(detectMajors(['Nursing, BSN', 'Computer Science, BCS'], majors).map(item => item.id), ['nursing', 'bcs']);
    assert.deepEqual(detectMajors(['Biology, BS'], majors), []);
    assert.deepEqual(detectMajors([], majors), []);
    assert.deepEqual(findProgramNamesInText('Program of Study\nNursing, BSN\n1 of 56 Requirements', majors), ['Nursing, BSN']);
    assert.deepEqual(findProgramNamesInText('Biology, BS', majors), []);
    const rows = [
      ['Program of Study', 'Display ID', 'Count of Instances in Set'],
      ['1.0', 'Nursing, BSN', '56.0'],
      ['1.0', 'Spanish Minor', '4.0'],
      ['Overall Academic Progress'],
    ];
    assert.deepEqual(parseProgressRows(rows).programs, ['Nursing, BSN', 'Spanish Minor']);
  });

  it('renders Nursing with the same major layout, split into its two requirement sections', () => {
    const root = new JSDOM('<div id="major"></div>').window.document.getElementById('major');
    renderMajor(root, nursing, nursingOptions, [
      { code: 'BIOL 205', title: 'Human Anatomy', status: 'completed', grade: 'A-', hours: 3 },
      { code: 'NURS 201', title: 'Theory: Introduction to Professional Nursing', status: 'in-progress', grade: null, hours: 2 },
    ], catalog, schedule);
    assert.ok(root.querySelector('[aria-label="Nursing (BSN) major overview"]'));
    assert.match(root.querySelector('.summary h2').textContent, /^1 of 32 listed courses complete$/);
    assert.deepEqual([...root.querySelectorAll('.summary-group h3')].map(item => item.textContent),
      ['Pre-nursing curriculum', 'Program requirements']);
    assert.deepEqual([...root.querySelectorAll('.req-section-title')].map(item => item.textContent),
      ['Pre-nursing curriculum', 'Program requirements']);
    assert.equal(root.querySelectorAll('article.req').length, 32);
    assert.equal(root.querySelector('#major-electives'), null);
    const anatomy = root.querySelector('#major-biol-205');
    assert.equal(anatomy.querySelector('.req-name').textContent, 'BIOL 205 - Human Anatomy');
    assert.equal(anatomy.querySelector('.chip-taken').textContent, 'Taken · A- · 3 hrs');
    assert.ok(anatomy.classList.contains('status-done'));
    const nurs201 = root.querySelector('#major-nurs-201');
    assert.equal(nurs201.querySelector('.req-name').textContent, 'NURS 201 - Theory: Introduction to Professional Nursing');
    assert.match(nurs201.querySelector('.status-pill').textContent, /In progress/);
    const patientCare = root.querySelector('#major-idis-108');
    assert.match(patientCare.querySelector('.req-note').textContent, /waives IDIS 108/);
    assert.ok(patientCare.querySelector('.status-pill').classList.contains('status-todo'));
    assert.match(root.querySelector('.callout').textContent, /admission/i);
  });

  it('explains which major is shown and when none is supported', () => {
    const doc = new JSDOM('<div id="notice"></div><div id="results"></div>').window.document;
    const notice = doc.getElementById('notice');
    const results = doc.getElementById('results');
    renderMajorNotice(notice, nursing, 'detected');
    assert.match(notice.textContent, /Showing Nursing \(BSN\), detected from your Workday export/);
    assert.equal(notice.querySelector('a').getAttribute('href'), nursing.sourceUrl);
    renderMajorNotice(notice, major, 'default');
    assert.match(notice.textContent, /Showing Computer Science \(BCS\) until you add your Workday export/);
    renderMajorNotice(notice, nursing, 'chosen');
    assert.match(notice.textContent, /Showing Nursing \(BSN\), as you chose/);
    results.append(doc.createElement('p'));
    renderMajorMessage(notice, results, [major, nursing], ['Biology, BS']);
    assert.match(notice.textContent, /Your export lists Biology, BS/);
    assert.match(notice.textContent, /Computer Science \(BCS\) and Nursing \(BSN\)/);
    assert.equal(results.children.length, 0);
  });

  it('checks a chosen major against the same courses, so each major gets its own completion count', () => {
    const csPlus = JSON.parse(fs.readFileSync(new URL('../majors/cs+/cs-plus.json', import.meta.url), 'utf8'));
    const csPlusOptions = JSON.parse(fs.readFileSync(new URL('../majors/cs+/cs-plus-course-options.json', import.meta.url), 'utf8'));
    const courses = [
      { code: 'CS 112', title: 'Introduction to Data Structures', status: 'completed', grade: 'A', hours: 4 },
      { code: 'BIOL 205', title: 'Human Anatomy', status: 'completed', grade: 'B', hours: 3 },
    ];
    const render = (chosen, options) => {
      const root = new JSDOM('<div id="major"></div>').window.document.getElementById('major');
      renderMajor(root, chosen, options, courses, catalog, schedule);
      return root;
    };
    assert.match(render(major, courseOptions).querySelector('.summary h2').textContent, /^1 of 18 /);
    const plus = render(csPlus, csPlusOptions);
    assert.match(plus.querySelector('.summary h2').textContent, /^1 of 16 /);
    assert.equal(plus.querySelector('#major-cs-112 .chip-taken').textContent, 'Taken · A · 4 hrs');
    assert.equal(plus.querySelector('#major-biol-205'), null);
    assert.ok(plus.querySelector('#major-cs-electives').textContent.includes('6 hrs'));
    const nursingRoot = render(nursing, nursingOptions);
    assert.match(nursingRoot.querySelector('.summary h2').textContent, /^1 of 32 /);
    assert.equal(nursingRoot.querySelector('#major-biol-205 .chip-taken').textContent, 'Taken · B · 3 hrs');
    assert.equal(nursingRoot.querySelector('#major-cs-112'), null);
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
      { code: 'CS 300', title: 'Advanced Computing', status: 'completed', grade: 'A', hours: 2 },
      { code: 'PHYS 133', title: 'Introductory Physics: Mechanics and Gravity', status: 'completed', grade: 'B', hours: 4 },
    ], catalog, schedule);
    assert.ok(root.querySelector('[aria-label="Computer Science (BCS) major overview"]'));
    assert.match(root.textContent, /CS 300.*Taken/);
    assert.match(root.textContent, /PHYS 133.*Taken/);
    assert.match(root.textContent, /4 of 6 hrs/);
    assert.match(root.textContent, /2 of 10 hrs/);
    assert.match(root.textContent, /Course options \(\d+\)/);
    assert.match(root.textContent, /Introductory Physics: Mechanics and Gravity/);
    assert.ok(root.querySelector('#major-math-251'));
    assert.ok(root.querySelector('#major-math-252'));
    assert.ok(root.querySelector('#major-cs-electives').classList.contains('status-todo'));
    assert.ok(root.querySelector('#major-natural-science').classList.contains('status-todo'));
  });

  it('shows required course titles, credits, grades, and primary-first alternatives', () => {
    const root = new JSDOM('<div id="major"></div>').window.document.getElementById('major');
    renderMajor(root, major, courseOptions, [
      { code: 'CS 106', title: 'Intro to Computing', status: 'completed', grade: 'B+', hours: 4 },
    ], catalog, schedule);
    const requirement = root.querySelector('#major-cs-108');
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
    const cs336 = [...root.querySelectorAll('#major-cs-electives .course')]
      .find(row => row.querySelector('.course-code').textContent === 'CS 336');
    const cs326 = [...root.querySelectorAll('#major-cs-electives .course')]
      .find(row => row.querySelector('.course-code').textContent === 'CS 326');
    assert.deepEqual([...cs336.querySelectorAll('.course-flags > *')].map(item => item.textContent), ['26FA', 'Not yet']);
    assert.deepEqual([...cs326.querySelectorAll('.course-flags > *')].map(item => item.textContent), ['27SP', 'Not yet']);
    assert.equal(cs336.querySelector('.status-pill').getAttribute('class'), 'status-pill status-todo');
    assert.ok(root.querySelector('#major-cs-electives').classList.contains('status-todo'));
    const cs312 = [...root.querySelectorAll('#major-cs-electives .course')]
      .find(row => row.querySelector('.course-code').textContent === 'CS 312');
    assert.deepEqual([...cs312.querySelectorAll('.course-flags > *')].map(item => item.textContent), ['Not yet']);
    assert.equal(cs312.querySelector('.status-pill').getAttribute('class'), 'status-pill status-todo');
    const cs112 = root.querySelector('#major-cs-112');
    assert.equal(cs112.querySelector('.course-term-label').textContent, '26FA, 27SP');
    assert.doesNotMatch(root.textContent, /Offered:/);
    assert.doesNotMatch(root.textContent, /FA 26|SP 27|SU 27/);
    assert.equal(cs326.querySelector('.offered'), null);
    assert.equal(cs326.querySelector('.section-list'), null);
    assert.equal(root.querySelector('#major-cs-electives .course-list').children.length, 18);
  });

  it('identifies current and next standard semesters', () => {
    assert.deepEqual([...currentAndNextSemesterCodes(new Date(2026, 9, 28))], ['26FA', '27SP']);
    assert.deepEqual([...currentAndNextSemesterCodes(new Date(2027, 2, 1))], ['27SP', '27SU']);
    assert.deepEqual([...currentAndNextSemesterCodes(new Date(2027, 4, 1))], ['27SU', '27FA']);
    assert.deepEqual([...currentAndNextSemesterCodes(new Date(2027, 6, 1))], ['27SU', '27FA']);
  });

  it('uses the core Taken, grade, hours badge for completed elective courses', () => {
    const root = new JSDOM('<div id="major"></div>').window.document.getElementById('major');
    renderMajor(root, major, courseOptions, [
      { code: 'CS 326', title: 'Embedded Systems and the Internet of Things', status: 'completed', grade: 'A', hours: 4 },
    ], catalog, schedule);
    const course = [...root.querySelectorAll('#major-cs-electives .course')]
      .find(row => row.querySelector('.course-code').textContent === 'CS 326');
    assert.equal(course.querySelector('.chip-taken').textContent, 'Taken · A · 4 hrs');
  });

  it('uses not-yet badges for uncompleted Lab Science choices without showing evidence text', () => {
    const root = new JSDOM('<div id="major"></div>').window.document.getElementById('major');
    renderMajor(root, major, courseOptions, [], catalog, schedule);
    const science = root.querySelector('#major-natural-science');
    assert.ok(science.querySelector('.course-flags .status-pill.status-todo'));
    assert.doesNotMatch(science.textContent, /Lab evidence:/);
    assert.ok(science.classList.contains('status-todo'));
    const phys131 = [...science.querySelectorAll('.course')]
      .find(row => row.querySelector('.course-code').textContent === 'PHYS 131');
    assert.equal(phys131.querySelector('.course-term-label').textContent, '26FA');
  });

  it('lists completed seminar occurrences from oldest term and completes after three', () => {
    const root = new JSDOM('<div id="major"></div>').window.document.getElementById('major');
    const attempts = [
      { code: 'CS 195', title: 'Introductory Computing Seminar', status: 'completed', period: '2025 Fall', grade: 'CR', hours: 0 },
      { code: 'CS 195', title: 'Introductory Computing Seminar', status: 'completed', period: '2024 Fall', grade: 'CR', hours: 0 },
      { code: 'CS 195', title: 'Introductory Computing Seminar', status: 'completed', period: '2024 Spring', grade: 'CR', hours: 0 },
    ];
    renderMajor(root, major, courseOptions, [attempts[0]], catalog, schedule, attempts);
    const requirement = root.querySelector('#major-cs-195');
    assert.match(requirement.querySelector('.status-pill').textContent, /Complete/);
    assert.deepEqual([...requirement.querySelectorAll('.course .chip-taken')].map(chip => chip.textContent), [
      'Taken · 24SP', 'Taken · 24FA', 'Taken · 25FA',
    ]);
  });

  it('lists the BCS Laboratory Science courses published in each selected catalog', () => {
    const group = major.courseGroups.find(item => item.type === 'lab-science-options');
    assert.equal(group.catalogCourses['25'].length, 17);
    assert.equal(group.catalogCourses['24'].length, 16);
    for (const [selectedCatalog, catoid] of [[catalog, '25'], [catalog24, '24']]) {
      const root = new JSDOM('<div id="major"></div>').window.document.getElementById('major');
      renderMajor(root, major, courseOptions, [], selectedCatalog, schedule);
      const codes = [...root.querySelectorAll('#major-natural-science .course-code')].map(item => item.textContent);
      assert.deepEqual(codes, group.catalogCourses[catoid].map(course => course.code));
    }
    const rendered = year => {
      const root = new JSDOM('<div id="major"></div>').window.document.getElementById('major');
      renderMajor(root, major, courseOptions, [], year, schedule);
      return root.querySelector('#major-natural-science').textContent;
    };
    assert.match(rendered(catalog), /GEO 120.*Earth Systems/);
    assert.doesNotMatch(rendered(catalog24), /GEO 120/);
    assert.doesNotMatch(rendered(catalog), /PHYS 221|CHEM 100|BIOL 113/);
  });

  it('uses one shared Workday input with tab panels in the standalone app', () => {
    const html = fs.readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');
    assert.equal((html.match(/id="workday-file"/g) || []).length, 1);
    assert.equal((html.match(/role="tab"/g) || []).length, 2);
    assert.match(html, /id="core-panel" role="tabpanel"/);
    assert.match(html, /id="major-panel" role="tabpanel"/);
    assert.match(html, /id="major-notice"/);
    assert.match(html, /<select id="major-select"/);
    assert.doesNotMatch(html, /BCS major/);
  });
});
