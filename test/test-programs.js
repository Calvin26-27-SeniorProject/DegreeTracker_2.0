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
import { renderApp, renderPrograms, renderDashboard, programTabs, coreProgress, programProgress, isMinor } from '../src/app-render.js';
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

  it('keeps Workday’s wording, status, remaining, and the courses applied, with no grades', () => {
    const cs = sample().programs[0];
    const req = cs.requirements.find(r => r.name === '10 hours from: CS 300, 312, 320, 326, 332, 336, 338, 339, 354, 360, 361, 363, 372, 374, 375, 376; ENGR 304, 325 (minimum grade of C-)');
    assert.deepEqual([req.status, req.remaining, req.items], ['Not Satisfied', 'Minimum 10 Hour(s)', []]);
    const lab = cs.requirements.find(r => r.name === 'CS 108 and 108L (minimum grade of C-)');
    assert.deepEqual(lab.items, [
      { text: 'CS 108 - Introduction to Computing (In Progress)', period: '2026 Fall', hours: 3 },
      { text: 'CS 108L - Intro to Computing Lab (In Progress)', period: '2026 Fall', hours: 1 },
    ]);
    for (const p of sample().programs) for (const r of p.requirements) for (const i of r.items) {
      assert.deepEqual(Object.keys(i), ['text', 'period', 'hours']);
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
    }
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
    assert.equal(root.querySelector('.req-section-title').textContent, 'Entrepreneurship Minor');
    const entr = [...root.querySelectorAll('.req')].find(li => /^12 hours from ENTR/.test(li.querySelector('.req-name').textContent));
    assert.equal(entr.querySelector('.status-pill').textContent, 'In Progress');
    assert.equal(norm(entr.querySelector('.req-note').textContent), 'Remaining: Minimum 4 Hour(s)');
    // Every course the name lists; the three Workday applied are green.
    assert.deepEqual([...entr.querySelectorAll('.course-list li.course')].map(li => [li.dataset.code, li.classList.contains('is-active')]),
      [['ENTR 210', true], ['ENTR 211', true], ['ENTR 301', false], ['ENTR 302', true], ['ENTR 303', false], ['ENTR 304', false]]);
  });

  it('draws Workday’s listing with the Core page’s cards and rows', () => {
    const root = newRoot();
    renderPrograms(root, { groups: groups.filter(isMinor), hasInput: true, kind: 'minor' });
    const card = [...root.querySelectorAll('.req')].find(li => /^ENTR 201/.test(li.querySelector('.req-name').textContent));
    assert.ok(card.classList.contains('status-done'));
    assert.ok(card.querySelector('.req-header .status-pill.status-done'));
    assert.ok(card.querySelector('.req-collapse'));
    const row = card.querySelector('.course-list li.course.is-active');
    assert.equal(row.querySelector('.course-code').textContent, 'ENTR 201');
    assert.equal(row.querySelector('.course-title').textContent, 'Introduction to Entrepreneurship');
    assert.deepEqual([...row.querySelectorAll('.course-flags .chip')].map(c => [c.className, c.textContent]),
      [['chip chip-taken', 'Taken · 2 hrs']], 'no term chip');
    const progress = [...root.querySelectorAll('.req')].find(li => /^ENTR 202/.test(li.querySelector('.req-name').textContent));
    assert.equal(progress.querySelector('.chip-progress').textContent, 'In progress · 4 hrs');
    assert.equal(root.querySelector('.program, .program-req, .program-option'), null);
  });

  it('shows no grades', () => {
    const root = newRoot();
    renderPrograms(root, { groups, hasInput: true, kind: 'major' });
    assert.doesNotMatch(root.textContent, /Grade|\b[ABCDF][+-]?\s*\(\d\.\d+\)/);
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

  describe('with each page’s summary tiles under the donuts', () => {
    const pageRoots = () => {
      const core = newRoot();
      renderApp(core, { catalog, analysis });
      const major = newRoot();
      renderPrograms(major, { groups: groups.filter(g => !isMinor(g)), hasInput: true, kind: 'major' });
      const minor = newRoot();
      renderPrograms(minor, { groups: groups.filter(isMinor), hasInput: true, kind: 'minor' });
      return { core, major, minor };
    };
    const summaryOf = root => [...root.children].find(el => el.classList.contains('summary'));
    const blocksFrom = ({ core, major, minor }) => [
      { id: 'core', kind: 'core', title: 'Calvin Core', node: summaryOf(core) },
      ...[...major.children].filter(el => el.classList.contains('summary')).map(node => ({ id: `major:${node.dataset.program}`, kind: 'major', title: node.dataset.program, node })),
      ...[...minor.children].filter(el => el.classList.contains('summary')).map(node => ({ id: `minor:${node.dataset.program}`, kind: 'minor', title: node.dataset.program, node })),
    ];

    it('lists the core, then each major, then each minor, each in a panel headed by its name and kind', () => {
      const roots = pageRoots();
      const root = newRoot();
      renderDashboard(root, { catalog, analysis, groups, blocks: blocksFrom(roots) });
      const panels = [...root.querySelectorAll('.overview-blocks > .overview-block')];
      assert.deepEqual(panels.map(p => [p.querySelector('.overview-block-header h3').textContent, p.querySelector('.overview-block-kind').textContent]), [
        ['Calvin Core', 'Core'], ['Computer Science, BCS', 'Major'], ['Entrepreneurship Minor', 'Minor'],
      ]);
      assert.ok(root.querySelector('.dash-grid').compareDocumentPosition(root.querySelector('.overview-blocks')) & 4, 'the panels come after the donuts');
    });

    it('shows the same summary tiles as the page itself', () => {
      const roots = pageRoots();
      const root = newRoot();
      renderDashboard(root, { catalog, analysis, groups, blocks: blocksFrom(roots) });
      const [core, major, minor] = [...root.querySelectorAll('.overview-block-body')];
      for (const [body, page] of [[core, roots.core], [major, roots.major], [minor, roots.minor]]) {
        const source = summaryOf(page);
        assert.equal(body.querySelector('.summary h2').textContent, source.querySelector('h2').textContent);
        assert.equal(body.querySelectorAll('.summary-chip').length, source.querySelectorAll('.summary-chip').length);
        assert.deepEqual([...body.querySelectorAll('.summary-chip')].map(a => a.getAttribute('href')),
          [...source.querySelectorAll('.summary-chip')].map(a => a.getAttribute('href')));
        assert.ok(summaryOf(page), 'the page keeps its own summary');
      }
      assert.equal(major.querySelectorAll('.summary-chip').length, 20);
    });

    it('opens every panel by default, and an arrow on the right folds one up', () => {
      const roots = pageRoots();
      const root = newRoot();
      const toggled = [];
      renderDashboard(root, { catalog, analysis, groups, blocks: blocksFrom(roots), onListToggle: (key, open) => toggled.push([key, open]) });
      const panels = [...root.querySelectorAll('.overview-block')];
      assert.ok(panels.every(p => !p.classList.contains('is-collapsed')));
      assert.ok(panels.every(p => p.querySelector('.overview-block-header > .req-collapse').getAttribute('aria-expanded') === 'true'));
      assert.equal(panels[0].querySelector('.overview-block-header').lastElementChild.className, 'req-collapse');
      panels[1].querySelector('.req-collapse').click();
      assert.ok(panels[1].classList.contains('is-collapsed'));
      assert.equal(panels[1].querySelector('.req-collapse').getAttribute('aria-expanded'), 'false');
      assert.ok(!panels[0].classList.contains('is-collapsed'));
      panels[1].querySelector('.req-collapse').click();
      assert.ok(!panels[1].classList.contains('is-collapsed'));
      assert.deepEqual(toggled, [['overview:major:Computer Science, BCS', false], ['overview:major:Computer Science, BCS', true]]);
    });

    it('keeps a folded panel folded when the page is drawn again', () => {
      const roots = pageRoots();
      const root = newRoot();
      const openLists = new Map([['overview:core', false]]);
      renderDashboard(root, { catalog, analysis, groups, blocks: blocksFrom(roots), openLists });
      assert.deepEqual([...root.querySelectorAll('.overview-block')].map(p => p.classList.contains('is-collapsed')), [true, false, false]);
    });

    it('lists no panels when there’s nothing to show', () => {
      const root = newRoot();
      renderDashboard(root, { catalog, analysis, groups });
      assert.equal(root.querySelector('.overview-blocks'), null);
    });
  });
});

describe('programTabs (the Major and Minor tabs)', () => {
  const g = name => ({ name, requirements: [] });
  const shape = tabs => tabs.map(t => [t.id, t.label, t.title, t.groups.map(x => x.name)]);

  it('one major and no minor: a Major tab and no Minor tab', () => {
    assert.deepEqual(shape(programTabs([g('Computer Science, BCS')], true)), [
      ['major', 'Major', 'Computer Science, BCS', ['Computer Science, BCS']],
    ]);
  });

  it('two majors: Major 1 and Major 2, in Workday’s order, each with its own program', () => {
    assert.deepEqual(shape(programTabs([g('Computer Science, BCS'), g('Entrepreneurship Minor'), g('Nursing, BSN')], true)), [
      ['major-1', 'Major 1', 'Computer Science, BCS', ['Computer Science, BCS']],
      ['major-2', 'Major 2', 'Nursing, BSN', ['Nursing, BSN']],
      ['minor', 'Minor', 'Entrepreneurship Minor', ['Entrepreneurship Minor']],
    ]);
  });

  it('two minors: Minor 1 and Minor 2', () => {
    assert.deepEqual(programTabs([g('Computer Science, BCS'), g('Entrepreneurship Minor'), g('Data Science Minor')], true).map(t => t.label),
      ['Major', 'Minor 1', 'Minor 2']);
  });

  it('a pasted page’s unnamed group is the Major tab', () => {
    assert.deepEqual(shape(programTabs([g(null)], true)), [['major', 'Major', 'Major', [null]]]);
  });

  it('without a record (browsing the catalog), one empty Major and one empty Minor tab', () => {
    assert.deepEqual(shape(programTabs([], false)), [['major', 'Major', 'Major', []], ['minor', 'Minor', 'Minor', []]]);
  });

  it('with the sample export, each tab’s page draws only its program, with ids that don’t clash', () => {
    const { programs } = sample();
    const [cs, minor] = programs;
    const tabs = programTabs([cs, { ...cs, name: 'Second Major, BA' }, minor], true);
    assert.deepEqual(tabs.map(t => t.id), ['major-1', 'major-2', 'minor']);
    const ids = [];
    for (const t of tabs) {
      const root = newRoot();
      renderPrograms(root, { groups: t.groups, hasInput: true, kind: t.kind, idPrefix: t.id });
      assert.deepEqual([...root.querySelectorAll(':scope > .summary')].map(s => s.dataset.program), [t.groups[0].name]);
      const own = [...root.querySelectorAll('[id]')].map(el => el.id);
      assert.ok(own.length && own.every(id => id.startsWith(t.id + '-')), t.id);
      ids.push(...own);
    }
    assert.equal(new Set(ids).size, ids.length);
  });

  it('the Overview’s “See requirements” opens each program’s own tab', () => {
    const { programs } = sample();
    const [cs, minor] = programs;
    const second = { ...cs, name: 'Second Major, BA' };
    const groups = [cs, second, minor];
    const tabs = programTabs(groups, true);
    const tabOf = new Map(tabs.flatMap(t => t.groups.map(x => [x, t.id])));
    const analysis = analyze(catalog.categories, sample().courses, { extraCourses: KNOWN_COURSE_CATEGORIES });
    const root = newRoot();
    renderDashboard(root, { catalog, analysis, groups, tabOf: x => tabOf.get(x) });
    assert.deepEqual([...root.querySelectorAll('.dash-open')].map(b => b.dataset.openTab).filter(t => t !== 'core'),
      ['major-1', 'major-2', 'minor']);
  });
});

describe('Major and Minor summaries: Not satisfied, In progress, Satisfied', () => {
  const groups = programRequirements(sample());
  const majorPage = (state = {}) => {
    const root = newRoot();
    renderPrograms(root, { groups: groups.filter(g => !isMinor(g)), hasInput: true, kind: 'major', ...state });
    return root;
  };
  const sectionsOf = summary => [...summary.querySelectorAll('.summary-status > .summary-status-group')];
  const headerText = sec => norm(sec.querySelector('.summary-status-header h3').textContent);

  it('stacks the chips in sections in that order, each with its count, one chip per requirement', () => {
    const summary = majorPage().querySelector(':scope > .summary');
    const sections = sectionsOf(summary);
    const order = ['todo', 'min', 'done'];
    assert.deepEqual(sections.map(s => s.dataset.status), order.filter(st => sections.some(s => s.dataset.status === st)));
    assert.ok(sections.length >= 2);
    const cs = groups.find(g => !isMinor(g));
    const counts = { done: 0, min: 0, todo: 0 };
    for (const r of cs.requirements) counts[{ Satisfied: 'done', 'In Progress': 'min' }[r.status] || 'todo']++;
    for (const sec of sections) {
      const label = { done: 'Satisfied', min: 'In progress', todo: 'Not satisfied' }[sec.dataset.status];
      assert.equal(headerText(sec), `${label} (${counts[sec.dataset.status]})`);
      assert.equal(sec.querySelectorAll('.summary-chip').length, counts[sec.dataset.status]);
    }
    assert.equal(summary.querySelectorAll('.summary-chip').length, cs.requirements.length);
  });

  it('folds Satisfied and opens the others by default', () => {
    const root = newRoot();
    renderPrograms(root, { groups: groups.filter(isMinor), hasInput: true, kind: 'minor' });
    const sections = sectionsOf(root.querySelector(':scope > .summary'));
    assert.ok(sections.some(s => s.dataset.status === 'done'), 'the sample minor has a satisfied requirement');
    assert.deepEqual(sections.map(s => [s.dataset.status, s.classList.contains('is-collapsed')]),
      sections.map(s => [s.dataset.status, s.dataset.status === 'done']));
    const done = sections.find(s => s.dataset.status === 'done');
    assert.equal(done.querySelector('.req-collapse').getAttribute('aria-expanded'), 'false');
    done.querySelector('.req-collapse').click();
    assert.ok(!done.classList.contains('is-collapsed'));
  });

  it('its arrow folds and unfolds a section, and the fold is kept', () => {
    const toggled = [];
    const sections = sectionsOf(majorPage({ onListToggle: (k, open) => toggled.push([k, open]) }).querySelector(':scope > .summary'));
    assert.equal(sections[0].dataset.status, 'todo');
    assert.ok(!sections[0].classList.contains('is-collapsed'));
    const button = sections[0].querySelector('.summary-status-header > .req-collapse');
    button.click();
    assert.ok(sections[0].classList.contains('is-collapsed'));
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.ok(!sections[1].classList.contains('is-collapsed'));
    assert.deepEqual(toggled, [[`summary:major-0:${sections[0].dataset.status}`, false]]);
    const again = sectionsOf(majorPage({ openLists: new Map(toggled) }).querySelector(':scope > .summary'));
    assert.ok(again[0].classList.contains('is-collapsed'));
  });

  it('the Overview’s copy folds on its own, without touching the page', () => {
    const page = majorPage();
    const summary = page.querySelector(':scope > .summary');
    const catalog = JSON.parse(fs.readFileSync(new URL('../catalog/catalog-categories-25.json', import.meta.url), 'utf-8'));
    const analysis = analyze(catalog.categories, sample().courses, { extraCourses: KNOWN_COURSE_CATEGORIES });
    const toggled = [];
    const root = newRoot();
    renderDashboard(root, { catalog, analysis, groups, onListToggle: (k, open) => toggled.push([k, open]),
      blocks: [{ id: 'major:CS', kind: 'major', title: 'CS', node: summary }] });
    const copy = sectionsOf(root.querySelector('.overview-block-body .summary'));
    assert.deepEqual(copy.map(s => s.classList.contains('is-collapsed')), copy.map(s => s.dataset.status === 'done'));
    copy[0].querySelector('.req-collapse').click();
    assert.ok(copy[0].classList.contains('is-collapsed'));
    assert.ok(!sectionsOf(summary)[0].classList.contains('is-collapsed'));
    assert.deepEqual(toggled, [[`overview:major:CS:summary:major-0:${copy[0].dataset.status}`, false]]);
  });
});
