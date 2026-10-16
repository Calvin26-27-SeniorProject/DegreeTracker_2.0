/**
 * Course schedule data (schedule/sections.json) and how the app uses it:
 * section lists under courses, and hours for planned courses.
 * If the snapshot test fails, re-run `npm run generate-schedule`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { analyze, plannedEntries } from '../src/core.js';
import { KNOWN_COURSE_CATEGORIES } from '../src/catalog-courses.js';
import { renderApp } from '../src/app-render.js';
import { buildScheduleJson } from './schedule-json.js';
import { loadScheduleInputs, SECTIONS_OUTPUT } from './generate-schedule-json.js';
import { loadCategories, makeCourse } from './helpers.js';

const schedule = JSON.parse(readFileSync(SECTIONS_OUTPUT, 'utf-8'));
const { raw, titles } = loadScheduleInputs();
const norm = s => (s || '').replace(/\s+/g, ' ').trim();

describe('schedule snapshot', () => {
  it('schedule/sections.json matches the saved exports', () => {
    assert.deepEqual(schedule, buildScheduleJson(raw, titles));
  });

  it('lists no closed, CPI, or Handlon sections, and nothing from hours-only terms', () => {
    const shown = new Set(schedule._meta.terms.filter(t => t.shown).map(t => t.term));
    let n = 0;
    for (const [code, byTerm] of Object.entries(schedule.offerings)) {
      for (const [term, sections] of Object.entries(byTerm)) {
        assert.ok(shown.has(term), `${code}: sections from ${term}`);
        for (const s of sections) {
          const sectionCode = s.lab && !(code + 'L' in titles) ? code + 'L' : code;
          const rows = raw[term].filter(r => `${r.Subject_RefID} ${r.Crs_Number}` === sectionCode && r.Sec_Number === s.section);
          assert.ok(rows.length, `${sectionCode}-${s.section} in ${term}`);
          assert.ok(rows.some(r => r.Status !== 'Closed'), `${sectionCode}-${s.section} is closed`);
          assert.ok(rows.some(r => !/Handlon/.test(r.Campus || '')), `${sectionCode}-${s.section} is at Handlon`);
          assert.notEqual(s.section, 'CPI');
          n++;
        }
      }
    }
    assert.ok(n > 100, `only ${n} sections`);
    // Status itself never reaches the app.
    assert.doesNotMatch(readFileSync(SECTIONS_OUTPUT, 'utf-8'), /Waitlist|"Open"|"Closed"|EnrollCap/);
  });

  it('a course’s hours include its lab’s', () => {
    assert.deepEqual(schedule.hours['CHEM 101'], { min: 4, max: 4, term: '27SP' });
    const labs = schedule.offerings['CHEM 101']['27SP'].filter(s => s.lab);
    assert.ok(labs.length > 0);
  });

  it('variable hours are a range, and each section says its own', () => {
    assert.equal(schedule.hours['MUSC 171'].min, 0);
    assert.equal(schedule.hours['MUSC 171'].max, 1);
    assert.ok(schedule.offerings['MUSC 171']['27SP'].every(s => s.hours != null));
  });

  it('hours come from hours-only terms too', () => {
    const fallOnly = Object.entries(schedule.hours).filter(([, h]) => h.term === '26FA').map(([c]) => c);
    assert.ok(fallOnly.length > 0);
    for (const code of fallOnly) assert.ok(!schedule.offerings[code]?.['26FA'], code);
  });
});

describe('planned courses with schedule hours', () => {
  const cats = loadCategories('25');
  const transcript = [makeCourse('HIST 152', 4)];
  const options = { extraCourses: KNOWN_COURSE_CATEGORIES };
  const hoursOf = code => schedule.hours[code];

  it('count as in progress in the projection, with their scheduled hours', () => {
    const planned = plannedEntries(['SOC 250', 'NOPE 999'], hoursOf);
    assert.deepEqual(planned.map(p => [p.code, p.hours, p.hoursKnown]), [['SOC 250', 4, true], ['NOPE 999', 0, false]]);
    const projection = analyze(cats, [...transcript, ...planned], options);
    const sbs = projection.results.find(r => r.name === 'Social and Behavioral Sciences');
    assert.equal(sbs.hoursEarned, 4);
    assert.notEqual(sbs.status, 'incomplete');
  });

  it('a variable-hours course counts its minimum', () => {
    assert.equal(plannedEntries(['MUSC 171'], hoursOf)[0].hours, 0);
  });

  function render(plannedCodes) {
    const doc = new JSDOM('<!doctype html><main id="results"></main>').window.document;
    const root = doc.getElementById('results');
    const analysis = analyze(cats, transcript, { ...options, plannedCourses: plannedCodes });
    const projection = plannedCodes.length
      ? analyze(cats, [...transcript, ...plannedEntries(analysis.plannedCourses, hoursOf)], options) : null;
    renderApp(root, { catalog: JSON.parse(readFileSync(new URL('../catalog/catalog-categories-25.json', import.meta.url), 'utf-8')),
      analysis, projection, schedule, onTogglePlanned: () => {} });
    return root;
  }
  const card = (root, name) => Array.from(root.querySelectorAll('article.req'))
    .find(a => norm(a.querySelector('.req-name').textContent) === name);
  const row = (el, code) => el.querySelector(`.course[data-code="${code}"]`);

  it('the app shows the actual status and, separately, the status with the plan', () => {
    const root = render(['SOC 250']);
    const sbs = card(root, 'Social and Behavioral Sciences');
    const pills = Array.from(sbs.querySelectorAll('.status-pill')).map(p => norm(p.textContent));
    assert.equal(pills[0], '0 of 2+ hrs');
    assert.match(pills[1], /^With plan: /);
    assert.match(norm(row(sbs, 'SOC 250').textContent), /Planned · 4 hrs/);
    assert.match(norm(root.querySelector('.summary-plan').textContent), /With your planned courses: \d+ of \d+ met/);
    assert.match(norm(root.querySelector('.callout').textContent), /count only in the “With plan” results/);
  });

  it('no plan, no projection', () => {
    const root = render([]);
    assert.equal(root.querySelector('.status-plan'), null);
    assert.equal(root.querySelector('.summary-plan'), null);
  });

  it('course rows show hours and the listed sections, without status', () => {
    const root = render([]);
    const phil = row(card(root, 'Humanities'), 'PHIL 153');
    assert.equal(norm(phil.querySelector('.chip-hours').textContent), '4 hrs');
    const offered = phil.querySelector('details.offered');
    assert.match(norm(offered.querySelector('summary').textContent), /^Spring 2027: \d+ sections?$/);
    const sections = Array.from(offered.querySelectorAll('.section')).map(li => norm(li.textContent));
    assert.equal(sections.length, schedule.offerings['PHIL 153']['27SP'].length);
    assert.ok(sections.every(s => !/CPI|Open|Closed|Waitlist/.test(s)), sections.join('\n'));
    const chem = row(card(root, 'Natural Sciences'), 'CHEM 101');
    if (chem) assert.match(norm(chem.querySelector('.offered').textContent), /Lab/);
    assert.match(norm(root.querySelector('.schedule-note').textContent), /Spring 2027 \(as of Oct 14, 2026\) and Summer 2027 \(as of Oct 16, 2026\)/);
  });

  it('taken courses don’t list sections', () => {
    const root = render([]);
    const hist = row(card(root, 'Humanities'), 'HIST 152');
    assert.ok(schedule.offerings['HIST 152']['27SP'].length > 0);
    assert.equal(hist.querySelector('.offered'), null);
    assert.equal(hist.querySelector('.chip-hours'), null);
  });

  it('courses not offered still appear, just without sections', () => {
    const root = render([]);
    const listed = root.querySelectorAll('.course').length;
    const offered = root.querySelectorAll('.course details.offered').length;
    assert.ok(offered > 0 && offered < listed, `${offered} of ${listed}`);
  });
});
