/**
 * "Also listed for" on every course row: the core requirements and the
 * student's majors' and minors' requirements a course is listed under
 * (src/course-uses.js), linking to that requirement's card on its own tab.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { readXlsxRows } from '../src/xlsx.js';
import { parseProgressRows } from '../src/parse.js';
import { programRequirements, checkProgram, findProgram, programForStudent, programFromCatalog, analyze } from '../src/core.js';
import { renderApp, renderPrograms, renderWhatIf, programTabs, isMinor } from '../src/app-render.js';
import { coreCourseUses, programCourseUses, mergeUses } from '../src/course-uses.js';
import { KNOWN_COURSE_CATEGORIES } from '../src/catalog-courses.js';
import { readCheckedPrograms } from './program-files.js';

const catalog = JSON.parse(fs.readFileSync(new URL('../catalog/catalog-categories-25.json', import.meta.url), 'utf-8'));
const WHATIF = JSON.parse(fs.readFileSync(new URL('../programs/whatif-programs.json', import.meta.url), 'utf-8'));
const { DOMParser } = new JSDOM('').window;
const sample = parseProgressRows(readXlsxRows(
  fs.readFileSync(new URL('./fixtures/academic-progress-sample.xlsx', import.meta.url)), { DOMParser }));
const groups = programRequirements(sample);
const bcs = (() => {
  const base = findProgram(readCheckedPrograms(), 'Computer Science, BCS', '25');
  const program = programForStudent(base, [base]);
  return { program, result: checkProgram(program, sample.courses) };
})();
const checks = new Map([['Computer Science, BCS', bcs]]);
const coreUses = coreCourseUses(catalog, KNOWN_COURSE_CATEGORIES);

// The app's pages in one document, as app.js draws them: Core, then a tab per program.
function drawApp() {
  const tabs = programTabs(groups, true);
  const doc = new JSDOM(`<!doctype html><body><main id="results"></main>${tabs.map(t => `<section id="${t.id}"></section>`).join('')}</body>`).window.document;
  const courseUses = mergeUses(coreUses, programCourseUses(tabs.flatMap(t => t.groups.map((g, i) =>
    ({ idPrefix: t.id, kind: t.kind, group: g, groupIndex: i, check: checks.get(g.name) })))));
  const analysis = analyze(catalog.categories, sample.courses, { extraCourses: KNOWN_COURSE_CATEGORIES, workdayStatus: sample.workdayStatus });
  renderApp(doc.getElementById('results'), { catalog, analysis, courseUses });
  for (const t of tabs) {
    renderPrograms(doc.getElementById(t.id), { groups: t.groups, hasInput: true, kind: t.kind, idPrefix: t.id, checks, records: sample.courses, courseUses });
  }
  return { doc, tabs, courseUses };
}
const linksOf = row => [...(row?.querySelectorAll('a.use-link') || [])].map(a => a.getAttribute('href'));
const chipsOf = row => [...(row?.querySelectorAll('.use-chip') || [])].map(a => a.textContent);
const moreOf = row => [...(row?.querySelectorAll('.use-more-list li') || [])].map(li => [li.querySelector('.use-kind').textContent, li.querySelector('a').textContent]);
const kindsOf = root => [...root.querySelectorAll('.use-kind')].map(s => s.textContent);

describe('where each course is listed', () => {
  it('lists every core requirement a course is under, other catalog years’ lists included', () => {
    const math = catalog.categories.find(c => c.name === 'Mathematical Sciences');
    assert.ok(coreUses.get('CS 108').some(u => u.href === '#' + math.slug && u.area === 'core' && u.program === 'Core'));
    for (const [code, uses] of coreUses) {
      for (const u of uses) {
        const cat = catalog.categories.find(c => '#' + c.slug === u.href);
        assert.ok(cat.courses?.some(c => c.code === code) || KNOWN_COURSE_CATEGORIES[cat.name]?.[code] !== undefined, `${code} in ${cat.name}`);
      }
    }
    const fromOtherYear = Object.entries(KNOWN_COURSE_CATEGORIES).flatMap(([name, codes]) => Object.keys(codes).map(code => [name, code]))
      .find(([name, code]) => catalog.categories.some(c => c.name === name && c.courses && !c.courses.some(x => x.code === code)));
    assert.ok(fromOtherYear, 'some course only an older catalog lists');
    assert.ok(coreUses.get(fromOtherYear[1]).some(u => u.label === fromOtherYear[0]));
  });

  it('lists a checked program’s requirements by their options, and Workday’s by the courses their names list', () => {
    const uses = programCourseUses([
      { idPrefix: 'major', kind: 'major', group: groups[0], check: bcs },
      { idPrefix: 'minor', kind: 'minor', group: groups[1] },
    ]);
    const cs108 = bcs.result.items.find(i => i.options?.flat().includes('CS 108'));
    assert.deepEqual(uses.get('CS 108'), [{ area: 'major', program: 'Computer Science, BCS', label: cs108.label, href: `#major-${bcs.program.id}-${cs108.id}` }]);
    assert.ok(uses.get('CS 300').some(u => u.label === 'Take 10 hours from the following'));
    const entr = groups[1].requirements.findIndex(r => r.name.startsWith('ENTR 201'));
    assert.deepEqual(uses.get('ENTR 201'), [{ area: 'minor', program: 'Entrepreneurship Minor', label: groups[1].requirements[entr].name, href: `#minor-0-req-${entr}` }]);
  });
});

describe('“Also listed for” on course rows', () => {
  it('links every listing to a requirement card that’s on the page', () => {
    const { doc } = drawApp();
    const hrefs = [...doc.querySelectorAll('a.use-link')].map(a => a.getAttribute('href'));
    assert.ok(hrefs.length > 50);
    for (const href of new Set(hrefs)) assert.ok(doc.getElementById(href.slice(1)), href);
  });

  it('shows a major’s course where else it’s listed: the core and the other programs, not its own requirement', () => {
    const { doc } = drawApp();
    const card = doc.getElementById(`major-${bcs.program.id}-${bcs.result.items.find(i => i.options?.flat().includes('CS 108')).id}`);
    const row = card.querySelector('.course[data-code="CS 108"]');
    assert.deepEqual(chipsOf(row), ['Mathematical Sciences']);
    assert.ok(!linksOf(row).includes('#' + card.id), 'not its own requirement');
    assert.deepEqual(linksOf(row), coreUses.get('CS 108').map(u => u.href));
  });

  it('shows on the Core page which of your majors’ and minors’ requirements also list a course', () => {
    const { doc } = drawApp();
    const math = catalog.categories.find(c => c.name === 'Mathematical Sciences');
    const row = doc.getElementById(math.slug).querySelector('.course[data-code="CS 108"]');
    assert.deepEqual(moreOf(row), [['Computer Science, BCS', 'CS 108 and CS 108L']]);
    assert.equal(row.querySelector('.use-more summary').textContent, '+1 Major');
  });

  it('shows the core ones first as chips (two at most) and the rest behind “+N”', () => {
    const uses = new Map([['X 101', [
      { area: 'major', program: 'P', label: 'One', href: '#b' },
      { area: 'core', program: 'Core', label: 'Natural Sciences', href: '#a' },
      { area: 'core', program: 'Core', label: 'Humanities', href: '#d' },
      { area: 'core', program: 'Core', label: 'Global Regions and Cultures (Tag)', href: '#e' },
      { area: 'minor', program: 'M', label: '6 hours from: ASTR 201, 211', href: '#c' },
    ]]]);
    const program = { id: 'p', programName: 'P', catalogYear: '2026-27', sourceUrl: '#', titles: {}, labs: {}, requirements: [{ id: 'own', section: 'S', label: 'Own', codes: ['X 101'] }], courseGroups: [] };
    const doc = new JSDOM('<!doctype html><body><section id="p"></section></body>').window.document;
    renderPrograms(doc.getElementById('p'), { groups: [{ name: 'P', requirements: [] }], hasInput: true, idPrefix: 'major',
      checks: new Map([['P', { program, result: checkProgram(program, []) }]]), courseUses: uses });
    const row = doc.querySelector('.course[data-code="X 101"]');
    assert.deepEqual(chipsOf(row), ['Natural Sciences', 'Humanities']);
    assert.equal(row.querySelector('.use-more summary').textContent, '+3');
    assert.deepEqual(moreOf(row), [['Core', 'Global Regions and Cultures (Tag)'], ['P', 'One'], ['M', '6 hours from: ASTR 201, 211']]);
    assert.equal(row.querySelector('.use-more').open, false, 'the rest wait for a click');
    assert.equal(row.querySelector('.use-chip').title, 'Core: Natural Sciences');
  });

  it('in What if, lists the scenario’s programs (not a removed one) and links to their panels', () => {
    const psych = (() => {
      const cat = WHATIF.catalogs['25'];
      const program = programFromCatalog(cat.programs.find(p => p.name === 'Psychology Major, BS'), { catoid: '25', catalogYear: cat.catalogYear });
      return { program, result: checkProgram(program, sample.courses) };
    })();
    const draw = removed => {
      const root = new JSDOM('<!doctype html><body><section id="p"></section></body>').window.document.getElementById('p');
      renderWhatIf(root, { hasInput: true, catalogLabel: '2026–27', coreUses, options: [], programs: [
        ...groups.map((g, i) => ({ key: `current:${i}`, name: g.name, kind: isMinor(g) ? 'minor' : 'major', source: 'current',
          removed: removed.includes(i), group: g, check: checks.get(g.name) || null })),
        { key: 'added:Psychology Major, BS', name: 'Psychology Major, BS', kind: 'major', source: 'added', removed: false,
          group: { name: 'Psychology Major, BS', requirements: [] }, check: psych },
      ] });
      return root;
    };
    const root = draw([]);
    const programHrefs = [...root.querySelectorAll('a.use-link')].map(a => a.getAttribute('href')).filter(h => h.startsWith('#whatif-'));
    assert.ok(programHrefs.length > 0);
    for (const href of programHrefs) assert.ok(root.querySelector(href), href);
    assert.ok(kindsOf(root).includes('Psychology Major, BS'));
    assert.ok(kindsOf(root).includes('Computer Science, BCS'), 'listed while it’s in the scenario');
    assert.ok(!kindsOf(draw([0])).includes('Computer Science, BCS'));
  });
});

describe('Workday’s listing under a checked program', () => {
  it('doesn’t point back to the same program’s own requirements', () => {
    const { doc } = drawApp();
    const listing = doc.querySelector('#major .program-workday');
    assert.ok(listing.querySelector('.course[data-code="CS 108"]'));
    assert.ok(!kindsOf(listing).includes('Computer Science, BCS'));
  });
});

describe('a program’s course rows, laid out like the Core page’s', () => {
  const program = { id: 'p', programName: 'P', catalogYear: '2026-27', sourceUrl: '#', titles: {}, labs: { 'X 102': 'X 102L' },
    requirements: [{ id: 'a', section: 'S', label: 'X 101', codes: ['X 101'] }, { id: 'b', section: 'S', label: 'X 102', codes: ['X 102'] }], courseGroups: [] };
  const uses = new Map([['X 101', [{ area: 'core', program: 'Core', label: 'Humanities', href: '#h' }]],
    ['X 102', [{ area: 'core', program: 'Core', label: 'Humanities', href: '#h' }]]]);
  const taken = [{ code: 'X 101', title: 'One', hours: 4, grade: 'A', status: 'completed', period: '2025 Fall' }];
  const draw = (state = {}) => {
    const doc = new JSDOM('<!doctype html><body><section id="p"></section></body>').window.document;
    renderPrograms(doc.getElementById('p'), { groups: [{ name: 'P', requirements: [] }], hasInput: true, idPrefix: 'major', courseUses: uses,
      checks: new Map([['P', { program, result: checkProgram(program, taken), ...state.check }]]), records: taken, ...state });
    return doc;
  };
  const order = row => [...row.querySelector('.course-flags').children].map(el => el.className.split(' ')[0]);

  it('puts what else it’s listed for first, then taken and grade; no semester', () => {
    const row = draw().querySelector('#major-p-a .course[data-code="X 101"]');
    assert.deepEqual(order(row), ['also-chips', 'chip']);
    assert.equal(row.querySelector('.chip-taken').textContent, 'Taken · A · 4 hrs');
    assert.doesNotMatch(row.textContent, /2025 Fall/);
    assert.equal(row.querySelector('.plan-toggle'), null, 'nothing to plan');
  });

  it('gives a course not yet taken “+ Plan”, and a planned one the Core page’s planned look', () => {
    const toggled = [];
    let row = draw({ onTogglePlanned: c => toggled.push(c) }).querySelector('#major-p-b .course[data-code="X 102"]');
    assert.equal(row.querySelector('.plan-toggle').textContent, '+ Plan');
    row.querySelector('.plan-toggle').click();
    assert.deepEqual(toggled, ['X 102']);
    assert.equal(row.parentElement.querySelector('.course[data-code="X 102L"] .plan-toggle'), null, 'a lab comes with its lecture');
    row = draw({ onTogglePlanned: () => {}, planned: new Set(['X 102']) }).querySelector('#major-p-b .course[data-code="X 102"]');
    assert.ok(row.classList.contains('is-planned'));
    assert.deepEqual(order(row), ['also-chips', 'chip']);
    assert.equal(row.querySelector('.chip-planned').textContent, 'Planned · hours unknown');
    assert.equal(row.querySelector('.plan-toggle').textContent, 'Planned ✓');
    assert.equal(draw().querySelector('.plan-toggle'), null, 'no plan without a record');
  });

  it('says what a requirement’s status would be with the plan, when it differs', () => {
    const withPlan = checkProgram(program, [...taken, { code: 'X 102', hours: 4, status: 'in-progress' }, { code: 'X 102L', hours: 0, status: 'in-progress' }]);
    const doc = draw({ check: { withPlan } });
    assert.equal(doc.querySelector('#major-p-b .status-plan').textContent, 'With plan: In progress');
    assert.equal(doc.querySelector('#major-p-a .status-plan'), null);
  });
});
