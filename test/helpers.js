/**
 * Test helpers and fluent scenario API for Calvin Core tests.
 *
 * Usage:
 *   import { scenario, loadCategories, makeCourse } from './helpers.js';
 *
 *   scenario('Humanities progression')
 *     .taken('HIST 152', 4)
 *     .expect('Humanities', { status: 'satisfied', hours: 4 })
 *     .add('PHIL 153', 4)
 *     .expect('Humanities', { status: 'complete', hours: 8, effective: 6 })
 *     .run(t)   // t is a node:test context
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { analyze } from './recorder.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
// ---- Catalog loader (cached per catoid) ----

const _cached = new Map();

/** catoid '25' = 2026-27 catalog (default), '24' = 2025-26. */
export function loadCategories(catoid = '25') {
  if (!_cached.has(catoid)) {
    const path = join(__dirname, '..', 'catalog', `catalog-categories-${catoid}.json`);
    _cached.set(catoid, JSON.parse(readFileSync(path, 'utf-8')).categories);
  }
  return _cached.get(catoid);
}

// ---- Course lookup ----

/** Find a course in the catalog by code. Returns { code, title, subDiscipline, categoryName } or null. */
export function findCourse(code) {
  const categories = loadCategories();
  for (const cat of categories) {
    if (!cat.courses) continue;
    for (const c of cat.courses) {
      if (c.code === code) {
        return { ...c, categoryName: cat.name };
      }
    }
  }
  return null;
}

/** Find all categories that contain a given course code. */
export function findCourseCategories(code) {
  const categories = loadCategories();
  const result = [];
  for (const cat of categories) {
    if (!cat.courses) continue;
    if (cat.courses.some(c => c.code === code)) {
      result.push(cat.name);
    }
  }
  return result;
}

// ---- Transcript entry builders ----

/**
 * Build a transcript entry. Auto-fills title from catalog if not provided.
 * @param {string} code - Course code, e.g. 'HIST 152'
 * @param {number} hours - Credit hours
 * @param {object} [opts] - Override fields: status, grade, title, exemptionTarget
 */
export function makeCourse(code, hours, opts = {}) {
  const info = findCourse(code);
  return {
    code,
    title: opts.title || info?.title || code,
    hours,
    grade: opts.grade || 'A',
    status: opts.status || 'completed',
    ...(opts.exemptionTarget && { exemptionTarget: opts.exemptionTarget }),
  };
}

/** Build an exemption entry (e.g., World Languages I Exemption). */
export function makeExemption(target, hours = 0) {
  return {
    code: null,
    title: `${target} Exemption`,
    hours,
    grade: null,
    status: 'exemption',
    exemptionTarget: target,
  };
}

// ---- Assertion helpers ----

/** Get a category result by name from analyze() output. */
export function getResult(analysis, catName) {
  const r = analysis.results.find(r => r.name === catName);
  if (!r) throw new Error(`Category "${catName}" not found in results. Available: ${analysis.results.map(r => r.name).filter(Boolean).join(', ')}`);
  return r;
}

/** Assert fields on a category result. */
export function assertStatus(analysis, catName, expected) {
  const r = getResult(analysis, catName);
  if ('status' in expected) {
    assert.equal(r.status, expected.status, `${catName} status`);
  }
  if ('hours' in expected) {
    assert.equal(r.hoursEarned, expected.hours, `${catName} hoursEarned`);
  }
  if ('effective' in expected) {
    assert.equal(r.hoursEffective, expected.effective, `${catName} hoursEffective`);
  }
  if ('takenCount' in expected) {
    assert.equal(r.takenCount, expected.takenCount, `${catName} takenCount`);
  }
  if ('isExempt' in expected) {
    assert.equal(r.isExempt, expected.isExempt, `${catName} isExempt`);
  }
}

/** Assert subdiscipline state within a category. */
export function assertDiscipline(analysis, catName, discName, expected) {
  const r = getResult(analysis, catName);
  assert.ok(r.subDisciplines, `${catName} should have subDisciplines`);
  const disc = r.subDisciplines[discName];
  assert.ok(disc, `${catName} should have subdiscipline "${discName}"`);
  if ('maxed' in expected) {
    assert.equal(disc.isMaxed, expected.maxed, `${catName}/${discName} isMaxed`);
  }
  if ('hours' in expected) {
    assert.equal(disc.hoursEarned, expected.hours, `${catName}/${discName} hoursEarned`);
  }
}

/** Assert K&U aggregate summary. */
export function assertKU(analysis, expected) {
  const ku = analysis.kuSummary;
  if ('total' in expected) {
    assert.equal(ku.totalHours, expected.total, `K&U totalHours`);
  }
  if ('categories' in expected) {
    assert.equal(ku.categoriesUsed, expected.categories, `K&U categoriesUsed`);
  }
}

// ---- Fluent scenario builder ----

class Scenario {
  constructor(name, { catoid } = {}) {
    this.name = name;
    this._categories = loadCategories(catoid);
    this._steps = [];        // array of { type, ... }
    this._transcript = [];   // accumulates transcript entries
  }

  /** Add a completed course to the transcript. */
  taken(code, hours, opts = {}) {
    this._steps.push({ type: 'taken', code, hours, opts });
    return this;
  }

  /** Add an in-progress course. */
  inProgress(code, hours) {
    return this.taken(code, hours, { status: 'in-progress' });
  }

  /** Add a transfer credit course. */
  transfer(code, hours) {
    return this.taken(code, hours, { status: 'transfer', grade: 'CR' });
  }

  /** Add an exemption. */
  exempt(target, hours = 0) {
    this._steps.push({ type: 'exempt', target, hours });
    return this;
  }

  /**
   * Assert category status. If catName contains '/', asserts subdiscipline.
   * @param {string} catName - Category name, or 'Category/Discipline' for subdiscipline
   * @param {object} expected - { status, hours, effective, takenCount, maxed }
   */
  expect(catName, expected) {
    this._steps.push({ type: 'expect', catName, expected });
    return this;
  }

  /** Assert K&U aggregate. */
  expectKU(expected) {
    this._steps.push({ type: 'expectKU', expected });
    return this;
  }

  /**
   * Add a new course (simulates "what if the student takes this next?").
   * Subsequent expects will reflect the added course.
   */
  add(code, hours, opts = {}) {
    this._steps.push({ type: 'add', code, hours, opts });
    return this;
  }

  /**
   * Execute the scenario. Each step builds state; expects run assertions.
   * @param {import('node:test').TestContext} t - node:test context for subtests
   */
  async run(t) {
    const transcript = [];
    let analysis = null;
    let needsReanalyze = true;

    const reanalyze = () => {
      if (needsReanalyze) {
        analysis = analyze(this._categories, transcript);
        needsReanalyze = false;
      }
    };

    for (const step of this._steps) {
      switch (step.type) {
        case 'taken':
          transcript.push(makeCourse(step.code, step.hours, step.opts));
          needsReanalyze = true;
          break;

        case 'exempt':
          transcript.push(makeExemption(step.target, step.hours));
          needsReanalyze = true;
          break;

        case 'add':
          transcript.push(makeCourse(step.code, step.hours, step.opts));
          needsReanalyze = true;
          break;

        case 'expect': {
          reanalyze();
          const { catName, expected } = step;
          if (catName.includes('/')) {
            const [cat, disc] = catName.split('/');
            await t.test(`${cat}/${disc}: ${JSON.stringify(expected)}`, () => {
              assertDiscipline(analysis, cat, disc, expected);
            });
          } else {
            await t.test(`${catName}: ${JSON.stringify(expected)}`, () => {
              assertStatus(analysis, catName, expected);
            });
          }
          break;
        }

        case 'expectKU': {
          reanalyze();
          await t.test(`K&U: ${JSON.stringify(step.expected)}`, () => {
            assertKU(analysis, step.expected);
          });
          break;
        }
      }
    }
  }
}

/**
 * Create a new test scenario.
 * @param {string} name - Human-readable scenario description
 * @param {{catoid?: string}} [opts] - catalog to analyze against (default: latest)
 * @returns {Scenario}
 */
export function scenario(name, opts) {
  return new Scenario(name, opts);
}

// ---- Generic opportunity verifier ----

/**
 * For every "satisfied" category in an analysis, verify that adding an untaken course
 * in a non-maxed discipline actually improves the outcome.
 *
 * Tries both 4h and 2h to cover typical and minimum credit loads.
 *
 * @param {object} analysis - Output from analyze()
 * @param {Array} categories - Catalog categories (from loadCategories())
 * @param {Array} transcript - The transcript used to produce the analysis
 * @param {import('node:test').TestContext} t - node:test context
 */
export async function verifyOpportunities(analysis, categories, transcript, t) {
  for (const r of analysis.results) {
    if (r.status !== 'satisfied') continue;

    // Find an untaken course in a non-maxed discipline
    const takenCodes = new Set(transcript.map(c => c.code).filter(Boolean));
    const maxedDiscs = r.maxedDisciplines || new Set();
    const candidate = (r.courses || []).find(c =>
      !takenCodes.has(c.code) && !maxedDiscs.has(c.subDiscipline || 'General')
    );

    if (!candidate) {
      await t.test(`${r.name}: satisfied but no untaken course in non-maxed discipline (BUG?)`, () => {
        assert.fail(`${r.name} is "satisfied" but has no actionable opportunity`);
      });
      continue;
    }

    for (const testHours of [4, 2]) {
      await t.test(`${r.name}: adding ${candidate.code} (${testHours}h) should improve`, () => {
        const newTranscript = [...transcript, makeCourse(candidate.code, testHours)];
        const newAnalysis = analyze(categories, newTranscript);
        const newR = newAnalysis.results.find(x => x.name === r.name);
        assert.ok(newR, `Category ${r.name} should still exist`);

        const improved = newR.hoursEarned > r.hoursEarned || newR.status !== r.status;
        assert.ok(improved,
          `Adding ${candidate.code} (${testHours}h) to ${r.name} should improve: ` +
          `hours ${r.hoursEarned}→${newR.hoursEarned}, status ${r.status}→${newR.status}`
        );
      });
    }
  }
}
