/**
 * programs/<year>/<department>/<type>/<program>/: the pure helpers that name the
 * folders and read the catalog's HTML, and the generated tree (program.json per
 * program, index.json), including that each hand-checked program file sits next
 * to the program.json of the same catalog program.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  CATALOGS, slugify, htmlToText, parseCourseTitle, parseCredits,
  typeFolder, departmentFolder, totalHoursOf,
} from './programs-json.js';
import { PROGRAMS_DIR, checkedProgramFiles } from './program-files.js';

const readJson = path => JSON.parse(fs.readFileSync(path, 'utf-8'));

describe('programs-json helpers', () => {
  it('slugifies names to lowercase kebab-case', () => {
    assert.equal(slugify('Computer Science, BCS'), 'computer-science-bcs');
    assert.equal(slugify('Computer Science Plus, BS'), 'computer-science-plus-bs');
    assert.equal(slugify("Master's"), 'masters');
    assert.equal(slugify('Certificate: Undergraduate'), 'certificate-undergraduate');
    assert.equal(slugify('Adult Degree Completion (Knollcrest Campus)'), 'adult-degree-completion-knollcrest-campus');
    assert.equal(slugify('Health & Movement'), 'health-and-movement');
    assert.equal(slugify('Español'), 'espanol');
    assert.equal(slugify(''), '');
  });

  it('turns catalog HTML into plain text', () => {
    assert.equal(htmlToText('<p>Take <strong>one</strong>&nbsp;of&nbsp;the following.</p><p>A &amp; B</p>'), 'Take one of the following. A & B');
    assert.equal(htmlToText('a<br/>b &#8211; c &ndash; d'), 'a b – c – d');
    assert.equal(htmlToText(null), '');
  });

  it('splits "CODE - Title" course names', () => {
    assert.deepEqual(parseCourseTitle('CS 108 - Introduction to Computing '), { code: 'CS 108', title: 'Introduction to Computing' });
    assert.deepEqual(parseCourseTitle('NURS 305 - Lab, Sim, and Clinical Reasoning Sem: Comm & Mental Health'),
      { code: 'NURS 305', title: 'Lab, Sim, and Clinical Reasoning Sem: Comm & Mental Health' });
    assert.deepEqual(parseCourseTitle('Special topic'), { code: null, title: 'Special topic' });
  });

  it('reads credits', () => {
    assert.equal(parseCredits('<p>(3)</p>'), '3');
    assert.equal(parseCredits('(2, 4)'), '2, 4');
    assert.equal(parseCredits(''), null);
    assert.equal(parseCredits(undefined), null);
  });

  it('names the type and department folders, with fallbacks', () => {
    assert.equal(typeFolder([{ name: 'Major' }]), 'major');
    assert.equal(typeFolder([{ name: 'Certificate: Undergraduate' }]), 'certificate-undergraduate');
    assert.equal(typeFolder([]), 'other');
    assert.equal(departmentFolder({ name: 'Computer Science', hierarchy_type: 'Department' }), 'computer-science');
    assert.equal(departmentFolder([{ name: 'Engineering', hierarchy_type: 'School' }, { name: 'Physics', hierarchy_type: 'Department' }]), 'physics');
    assert.equal(departmentFolder(undefined), 'unassigned');
  });

  it('reads the total hours from a core named "Total Semester Hours: …"', () => {
    assert.equal(totalHoursOf([{ name: 'Program Requirements' }, { name: 'Total Semester Hours: 76' }]), '76');
    assert.equal(totalHoursOf([{ name: 'Total Semester Hours: 67-70' }]), '67-70');
    assert.equal(totalHoursOf([{ name: 'Program Requirements' }]), null);
  });
});

describe('programs/ tree', () => {
  const index = readJson(join(PROGRAMS_DIR, 'index.json'));

  it('has a year folder for each catalog, matching the catalog table', () => {
    assert.deepEqual(index.catalogs.map(c => c.year).sort(), CATALOGS.map(c => c.folder).sort());
    for (const catalog of CATALOGS) {
      const entry = index.catalogs.find(c => c.year === catalog.folder);
      assert.equal(entry.catoid, catalog.catoid);
      assert.equal(entry.catalogYear, catalog.label);
    }
  });

  for (const catalog of index.catalogs) {
    describe(`${catalog.year} (${catalog.catalogYear})`, () => {
      it('lists each program once, with a program.json in year/department/type/program', () => {
        assert.ok(catalog.programs.length > 100);
        assert.equal(new Set(catalog.programs.map(p => p.path)).size, catalog.programs.length);
        for (const entry of catalog.programs) {
          const parts = entry.path.split('/');
          assert.equal(parts.length, 5, entry.path);
          assert.equal(parts[0], catalog.year);
          assert.equal(parts[4], 'program.json');
          assert.ok(fs.existsSync(join(PROGRAMS_DIR, ...parts)), `${entry.path} exists`);
        }
      });

      it('has program.json content that agrees with its folder', () => {
        for (const entry of catalog.programs) {
          const [year, department, type, program] = entry.path.split('/');
          const p = readJson(join(PROGRAMS_DIR, ...entry.path.split('/')));
          assert.equal(p.name, entry.name, entry.path);
          assert.equal(p.code, entry.code, entry.path);
          assert.equal(p.catalog.catoid, catalog.catoid);
          assert.equal(p.catalog.year, catalog.catalogYear);
          assert.equal(year, catalog.year);
          assert.equal(slugify(p.department?.name) || 'unassigned', department, entry.path);
          assert.equal(slugify(p.type) || 'other', type, entry.path);
          assert.ok(program.length > 0 && p.id === program, entry.path);
          assert.ok(p.sourceUrl.includes(`catoid=${catalog.catoid}`), entry.path);
          assert.ok(Array.isArray(p.requirements), entry.path);
        }
      });

      it('keeps majors and minors in separate folders', () => {
        for (const entry of catalog.programs) {
          const type = entry.path.split('/')[2];
          if (entry.type === 'Major') assert.equal(type, 'major', entry.path);
          if (entry.type === 'Minor') assert.equal(type, 'minor', entry.path);
        }
        assert.ok(catalog.programs.some(p => p.path.split('/')[2] === 'major'));
        assert.ok(catalog.programs.some(p => p.path.split('/')[2] === 'minor'));
      });
    });
  }

  it('has every course with a code, title and credits', () => {
    const missing = [];
    for (const catalog of index.catalogs) {
      for (const entry of catalog.programs) {
        const walk = core => {
          for (const course of core.courses) {
            if (!course.title || course.credits === null) missing.push(`${entry.path}: ${course.code}`);
          }
          core.children.forEach(walk);
        };
        readJson(join(PROGRAMS_DIR, ...entry.path.split('/'))).requirements.forEach(walk);
      }
    }
    assert.deepEqual(missing.slice(0, 5), []);
  });

  it('keeps the computer science programs under computer-science, split into major and minor', () => {
    const paths = index.catalogs.find(c => c.year === '2025').programs.map(p => p.path);
    assert.ok(paths.includes('2025/computer-science/major/computer-science-bcs/program.json'));
    assert.ok(paths.includes('2025/computer-science/major/computer-science-plus-bs/program.json'));
    assert.ok(paths.includes('2025/computer-science/minor/computer-science-minor/program.json'));
    assert.ok(paths.includes('2025/nursing/major/nursing-bsn/program.json'));
  });

  it('records the BCS requirements as the catalog lists them', () => {
    const bcs = readJson(join(PROGRAMS_DIR, '2025', 'computer-science', 'major', 'computer-science-bcs', 'program.json'));
    assert.equal(bcs.code, 'CPSC.BCS.MAJ');
    assert.equal(bcs.department.name, 'Computer Science');
    assert.equal(bcs.totalHours, '76');
    const top = bcs.requirements[0];
    assert.equal(top.courses.find(c => c.code === 'CS 108').credits, '3');
    assert.ok(top.notes.some(note => note.course === 'CS 195' && /3 semesters/.test(note.text)));
    assert.ok(!top.notes.some(note => note.course === 'CS 108'));
    const labScience = bcs.requirements[0].children.find(c => c.name === 'Cognates').children[0];
    assert.equal(labScience.name, 'Take 6 Hours from the Following');
    assert.equal(labScience.description, 'Laboratory Science');
    assert.equal(labScience.courses.length, 17);
  });

  it('records the OR alternatives the catalog lists next to a course', () => {
    const plus = readJson(join(PROGRAMS_DIR, '2025', 'computer-science', 'major', 'computer-science-plus-bs', 'program.json'));
    assert.ok(plus.requirements[0].notes.some(note => note.course === 'CS 108' && /OR CS 106/.test(note.text)));
  });

  it('puts each hand-checked program file in the folder of its own catalog program', () => {
    const files = checkedProgramFiles();
    assert.equal(files.length, 6);
    for (const { file, path } of files) {
      const checked = readJson(path);
      assert.equal(file, `${checked.id}-${checked.catoid}.json`);
      const dir = relative(PROGRAMS_DIR, path).split(sep);
      assert.equal(dir.length, 5, path);
      assert.equal(dir[0], `20${checked.catoid}`);
      const generated = readJson(join(path, '..', 'program.json'));
      assert.equal(generated.name, checked.programName, path);
      assert.equal(generated.catalog.catoid, checked.catoid);
      assert.equal(String(generated.sourceUrl), checked.sourceUrl);
      assert.equal(generated.catalog.year, checked.catalogYear, path);
      assert.equal(generated.sourceUrl.split('poid=')[1], checked.poid, path);
    }
  });

  it('keeps the titles in each hand-checked file the same as its catalog page', () => {
    const wrong = [];
    for (const { path } of checkedProgramFiles()) {
      const checked = readJson(path);
      const catalog = new Map();
      const walk = core => { core.courses.forEach(c => catalog.set(c.code, c.title)); core.children.forEach(walk); };
      readJson(join(path, '..', 'program.json')).requirements.forEach(walk);
      const titles = [...Object.entries(checked.titles || {}), ...(checked.courseGroups || []).flatMap(g => g.courses.map(c => [c.code, c.title]))];
      for (const [code, title] of titles) if (catalog.has(code) && catalog.get(code) !== title) wrong.push(`${checked.id}-${checked.catoid} ${code}: ${title}`);
    }
    assert.deepEqual(wrong, []);
  });
});
