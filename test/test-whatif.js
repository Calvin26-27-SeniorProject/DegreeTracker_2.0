/**
 * The What if tab: estimates read from a program's catalog page
 * (programFromCatalog, checkProgram's minCount and unchecked blocks), the
 * generated programs/whatif-programs.json, and renderWhatIf.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { readXlsxRows } from '../src/xlsx.js';
import { parseProgressRows, programRequirements, programFromCatalog, checkProgram, findProgram, programForStudent } from '../src/core.js';
import { renderWhatIf, isMinor } from '../src/app-render.js';
import { buildWhatIfPrograms, WHATIF_PATH } from './whatif-programs.js';
import { readCheckedPrograms } from './program-files.js';

const DATA = JSON.parse(fs.readFileSync(WHATIF_PATH, 'utf-8'));
const META = catoid => ({ catoid, catalogYear: DATA.catalogs[catoid].catalogYear });
const entry = (catoid, name) => DATA.catalogs[catoid].programs.find(p => p.name === name);
const course = (code, fields = {}) => ({ code, title: '', hours: 4, status: 'completed', grade: 'A', ...fields });
const statusOf = (result, label) => result.items.filter(i => i.label === label).map(i => i.status);
const { DOMParser } = new JSDOM('').window;
const sample = () => parseProgressRows(readXlsxRows(
  fs.readFileSync(new URL('./fixtures/academic-progress-sample.xlsx', import.meta.url)), { DOMParser }));

describe('an estimate from a catalog page', () => {
  const psych = programFromCatalog(entry('25', 'Psychology Major, BS'), META('25'));

  it('requires each course listed directly under a section, and reads “Take One” and “Take N Hours” headings', () => {
    assert.ok(psych.estimate);
    assert.deepEqual(psych.requirements.filter(r => r.codes.length === 1).map(r => r.label), ['PSYC 151', 'PSYC 201', 'PSYC 255', 'PSYC 256', 'PSYC 399']);
    assert.deepEqual(psych.requirements.filter(r => r.codes.length > 1).map(r => r.codes),
      [['PSYC 343', 'PSYC 244'], ['PSYC 334', 'PSYC 335'], ['PSYC 356', 'PSYC 380', 'PSYC 390']]);
    assert.deepEqual(psych.courseGroups.map(g => [g.label, g.minHours]), [['Take 10 Hours from the Following', 10]]);
    assert.match(psych.sourceUrl, /^https:\/\/catalog\.calvin\.edu\/preview_program\.php\?catoid=25&poid=\d+$/);
  });

  it('leaves blocks it can’t read unchecked: listed with your courses, not counted', () => {
    // Cognates and everything nested in it (a "Take One" two levels down may be one area of several).
    assert.deepEqual(psych.unchecked.map(u => u.label), ['Cognates', 'Take One from the Following', 'Biology', 'Chemistry', 'Physics', 'Computer Science']);
    const result = checkProgram(psych, [course('PSYC 151'), course('PSYC 244', { hours: 2 }), course('BIOL 161', { status: 'in-progress' })]);
    assert.equal(result.total, 9);
    assert.equal(result.unchecked, 6);
    assert.equal(result.done, 2);
    const cognates = result.items.find(i => i.label === 'Cognates');
    assert.equal(cognates.status, 'unknown');
    assert.deepEqual(cognates.matched.map(m => [m.code, m.status]), [['BIOL 161', 'progress']]);
  });

  it('counts hours for “Take N Hours” and courses for “Take Two”', () => {
    const ten = checkProgram(psych, [course('PSYC 212'), course('PSYC 220'), course('PSYC 222', { hours: 2 })]);
    assert.deepEqual(statusOf(ten, 'Take 10 Hours from the Following'), ['done']);
    const program = { requirements: [], courseGroups: [{ id: 'g', section: 'S', label: 'Take Two from the Following', minCount: 2, courses: [{ code: 'A 101' }, { code: 'A 102' }, { code: 'A 103' }] }] };
    const one = checkProgram(program, [course('A 101')]).items[0];
    assert.deepEqual([one.status, one.count, one.minCount], ['todo', 1, 2]);
    assert.equal(checkProgram(program, [course('A 101'), course('A 103', { status: 'in-progress' })]).items[0].status, 'progress');
    assert.equal(checkProgram(program, [course('A 101'), course('A 103'), course('A 102')]).items[0].status, 'done');
  });

  it('doesn’t require one of several concentrations, tracks, or sequences to choose from', () => {
    for (const [name, choices] of [['Urban Studies Minor', /^Track \d/], ['Social Work Minor', /^Track \d/], ['Integrative Biotechnology Minor', /^Sequence [AB]$/],
      ['Social Studies Education 7-12 Major', /Education Concentration$/], ['Special Education Studies Minor', /Concentration/]]) {
      const program = programFromCatalog(entry('25', name), META('25'));
      for (const r of [...program.requirements, ...program.courseGroups]) {
        assert.doesNotMatch(r.section, choices, `${name}: ${r.label} in ${r.section}`);
        assert.doesNotMatch(r.label, choices, `${name}: ${r.label}`);
      }
      assert.ok(program.unchecked.some(u => choices.test(u.label) || choices.test(u.section)), name);
    }
  });

  it('requires a program’s own one concentration, and an AA’s two certificates', () => {
    const ling = checkProgram(programFromCatalog(entry('25', 'English Major: Linguistics Concentration, BA'), META('25')), []);
    assert.equal(ling.unchecked, 0);
    assert.ok(ling.items.some(i => i.section === 'Linguistics Concentration'));
    const chem = programFromCatalog(entry('25', 'Engineering: Chemical Engineering Concentration'), META('25'));
    assert.ok(chem.requirements.some(r => r.section === 'Chemical Engineering Concentration Requirements'));
    const aa = checkProgram(programFromCatalog(entry('25', 'Faith and Community Leadership Major, AA'), META('25')), []);
    assert.ok(aa.total > 10);
    assert.equal(aa.unchecked, 0);
  });

  it('only three programs have nothing it can check, and they say so', () => {
    const none = Object.entries(DATA.catalogs).flatMap(([catoid, c]) => c.programs
      .filter(p => !checkProgram(programFromCatalog(p, META(catoid)), []).total).map(p => `${catoid}: ${p.name}`));
    assert.deepEqual(none.sort(), ['24: Engineering Minor', '24: Music Education PK-12, BME', '24: Occupational Therapy',
      '25: Engineering Minor', '25: Music Education PK-12, BME', '25: Occupational Therapy']);
  });

  it('reads every major and minor in both catalogs without losing a course', () => {
    for (const [catoid, cat] of Object.entries(DATA.catalogs)) {
      for (const p of cat.programs) {
        const program = programFromCatalog(p, META(catoid));
        const listed = new Set(p.blocks.flatMap(b => b[2]));
        const kept = new Set([...program.requirements.flatMap(r => r.codes), ...program.courseGroups.flatMap(g => g.courses.map(c => c.code)),
          ...program.unchecked.flatMap(u => u.courses.map(c => c.code))]);
        assert.deepEqual([...listed].filter(c => !kept.has(c)), [], p.name);
        const result = checkProgram(program, []);
        assert.equal(result.done, 0, p.name);
        assert.equal(result.total + result.unchecked, result.items.length, p.name);
      }
    }
  });

  it('programs/whatif-programs.json is up to date (npm run generate-whatif-programs)', () => {
    assert.deepEqual(DATA, buildWhatIfPrograms());
  });

  it('lists every hand-checked program under its own name, so What if can use the checked file', () => {
    for (const p of readCheckedPrograms()) assert.ok(entry(p.catoid, p.programName), `${p.programName} (${p.catoid})`);
  });
});

describe('renderWhatIf', () => {
  const groups = programRequirements(sample());
  const programs = readCheckedPrograms();
  const bcsCheck = (() => {
    const base = findProgram(programs, 'Computer Science, BCS', '25');
    const program = programForStudent(base, [base]);
    return { program, result: checkProgram(program, sample().courses) };
  })();
  const psychCheck = (() => {
    const program = programFromCatalog(entry('25', 'Psychology Major, BS'), META('25'));
    return { program, result: checkProgram(program, sample().courses) };
  })();
  const scenario = ({ removed = [], added = true } = {}) => [
    ...groups.map((g, i) => ({ key: `current:${i}`, name: g.name, kind: isMinor(g) ? 'minor' : 'major', source: 'current',
      removed: removed.includes(i), group: g, check: g.name === 'Computer Science, BCS' ? bcsCheck : null })),
    ...(added ? [{ key: 'added:Psychology Major, BS', name: 'Psychology Major, BS', kind: 'major', source: 'added', removed: false,
      group: { name: 'Psychology Major, BS', requirements: [] }, check: psychCheck }] : []),
  ];
  const draw = (state = {}) => {
    const root = new JSDOM('<!doctype html><body><section id="p"></section></body>').window.document.getElementById('p');
    renderWhatIf(root, { hasInput: true, catalogLabel: '2026–27', programs: scenario(), options: [{ name: 'History Major, BA', type: 'Major' }], ...state });
    return root;
  };
  const norm = s => s.replace(/\s+/g, ' ').trim();

  it('asks for a record first', () => {
    assert.match(draw({ hasInput: false }).textContent, /Upload your Academic Progress export to try a what-if/);
  });

  it('shows a chip per program: current ones removable, added ones marked, removed ones crossed out with a way back', () => {
    const calls = [];
    const root = draw({ programs: scenario({ removed: [1] }), onRemove: k => calls.push(['remove', k]), onRestore: k => calls.push(['restore', k]) });
    const chips = [...root.querySelectorAll('.whatif-chip')];
    assert.deepEqual(chips.map(c => [norm(c.querySelector('.whatif-chip-name').textContent), c.className]), [
      ['Computer Science, BCS', 'whatif-chip'],
      ['Entrepreneurship Minor', 'whatif-chip is-removed'],
      ['Psychology Major, BS', 'whatif-chip is-added'],
    ]);
    chips[0].querySelector('button').click();
    chips[1].querySelector('button').click();
    chips[2].querySelector('button').click();
    assert.deepEqual(calls, [['remove', 'current:0'], ['restore', 'current:1'], ['remove', 'added:Psychology Major, BS']]);
  });

  it('adds a program by name, and shows the message when it can’t', () => {
    const asked = [];
    const root = draw({ onAdd: name => { asked.push(name); return name === 'History Major, BA' ? null : 'Pick one from the list.'; } });
    const input = root.querySelector('.whatif-input');
    assert.deepEqual([...root.querySelectorAll('datalist option')].map(o => o.value), ['History Major, BA']);
    input.value = 'Nope';
    root.querySelector('.whatif-add-button').click();
    assert.equal(root.querySelector('.whatif-error').textContent, 'Pick one from the list.');
    input.value = ' History Major, BA ';
    input.dispatchEvent(new input.ownerDocument.defaultView.KeyboardEvent('keydown', { key: 'Enter' }));
    assert.deepEqual(asked, ['Nope', 'History Major, BA']);
  });

  it('compares requirements met now and in the scenario, and the courses that count', () => {
    const value = (root, i) => norm(root.querySelectorAll('.whatif-metric-value')[i].textContent);
    const cs = bcsCheck.result;
    const entr = groups[1];
    const entrDone = entr.requirements.filter(r => r.status === 'Satisfied').length;
    const root = draw({ programs: scenario({ removed: [1] }) });
    assert.equal(value(root, 0), `${cs.done + entrDone} of ${cs.total + entr.requirements.length}`);
    assert.equal(value(root, 1), `${cs.done + psychCheck.result.done} of ${cs.total + psychCheck.result.total}`);
    assert.equal(norm(root.querySelectorAll('.whatif-metric-sub')[1].textContent), '2 programs');
  });

  it('draws each program in the scenario like its own tab, with a badge saying how it was checked', () => {
    const root = draw({ programs: scenario({ removed: [1] }) });
    const panels = [...root.querySelectorAll('.whatif-program')];
    assert.deepEqual(panels.map(p => [norm(p.querySelector('h3').textContent), p.querySelector('.whatif-badge').textContent]),
      [['Computer Science, BCS', 'Checked'], ['Psychology Major, BS', 'Estimate']]);
    const psych = panels[1];
    assert.match(norm(psych.querySelector('.summary-sub').textContent), /an estimate from its 2026–27 catalog page.*6 blocks aren’t checked here/);
    assert.ok(psych.querySelector('.summary-status-group.status-optional'), 'a Check the catalog section');
    assert.equal(psych.querySelector('.program-workday'), null, 'no Workday listing in What if');
    const ids = [...root.querySelectorAll('[id]')].map(el => el.id);
    assert.equal(new Set(ids).size, ids.length, 'ids are unique across the programs');
    for (const a of root.querySelectorAll('.summary-chip')) assert.ok(root.querySelector(a.getAttribute('href')), a.getAttribute('href'));
  });

  it('folds a program by clicking anywhere on its header, not only the arrow', () => {
    const toggled = [];
    const root = draw({ onListToggle: (k, open) => toggled.push([k, open]) });
    const panel = root.querySelector('.whatif-program');
    panel.querySelector('.overview-block-header h3').click();
    assert.ok(panel.classList.contains('is-collapsed'));
    panel.querySelector('.overview-block-header').click();
    assert.ok(!panel.classList.contains('is-collapsed'));
    assert.deepEqual(toggled, [['whatif:current:0', false], ['whatif:current:0', true]]);
    const section = panel.querySelector('.summary-status-group');
    section.querySelector('.summary-status-header h3').click();
    assert.ok(section.classList.contains('is-collapsed'), 'a summary section folds from its header too');
  });

  it('keeps the requirement cards in a Details fold, closed at first; a chip opens it and goes there', () => {
    const root = draw();
    const panel = root.querySelector('.whatif-program');
    const details = panel.querySelector(':scope .whatif-details');
    assert.equal(details.open, false);
    assert.equal(details.querySelector('summary').textContent, `Details (${bcsCheck.result.items.length} requirements)`);
    assert.ok(details.querySelector('.req-section'), 'the cards are inside it');
    assert.equal(panel.querySelector('.summary').closest('details'), null, 'the summary stays outside it');
    const chip = panel.querySelector('a.summary-chip');
    chip.click();
    assert.equal(details.open, true);
    assert.equal(draw({ openLists: new Map([['details:whatif-0', true]]) }).querySelector('.whatif-details').open, true);
  });

  it('labels its buttons: × to remove, Undo to put back, + Add', () => {
    const root = draw({ programs: scenario({ removed: [1] }) });
    assert.equal(root.querySelector('.whatif-chip:not(.is-removed) .is-remove').getAttribute('aria-label'), 'Remove Computer Science, BCS');
    assert.equal(root.querySelector('.whatif-chip.is-removed .is-undo').textContent, '↺ Undo');
    assert.equal(root.querySelector('.whatif-add-button').textContent, '+ Add');
    assert.equal(root.querySelector('label[for="whatif-add-input"]').textContent, 'Add a major or minor');
  });

  it('says so when a program’s page has nothing it can check, rather than “0 of 0”', () => {
    const program = programFromCatalog(entry('25', 'Engineering Minor'), META('25'));
    const added = { key: 'added:Engineering Minor', name: 'Engineering Minor', kind: 'minor', source: 'added', removed: false,
      group: { name: 'Engineering Minor', requirements: [] }, check: { program, result: checkProgram(program, []) } };
    const root = draw({ programs: [added] });
    assert.equal(root.querySelector('.whatif-program .summary h2').textContent, 'Nothing on this program’s catalog page that this tool can check');
  });

  it('says so when the scenario is empty', () => {
    assert.match(draw({ programs: scenario({ removed: [0, 1], added: false }) }).textContent, /Add a major or minor to see where you stand/);
  });
});
