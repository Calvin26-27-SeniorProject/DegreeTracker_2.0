/**
 * analyze() for tests, recording each call when CORE_TEST_REPORT names a
 * directory: which test made it, the courses that went in, and what the tool
 * concluded. test/build-test-report.js turns the recordings into
 * docs/test-cases.html, a plain-language list of every case for the registrar.
 * Without CORE_TEST_REPORT this is just analyze().
 */

import { beforeEach, afterEach } from 'node:test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { analyze as coreAnalyze, KU_NAMES } from '../src/core.js';

const REPORT_DIR = process.env.CORE_TEST_REPORT;
const ROOT = join(new URL('.', import.meta.url).pathname, '..');

// The running test's full name ("describe > it > subtest"), innermost last.
const running = [];
if (REPORT_DIR) {
  beforeEach(t => { running.push(t.fullName); });
  afterEach(() => { running.pop(); });
}

const records = [];
if (REPORT_DIR) {
  process.on('exit', () => {
    if (records.length === 0) return;
    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(join(REPORT_DIR, randomUUID() + '.json'), JSON.stringify(records));
  });
}

// The test file and line that called analyze().
function caller() {
  for (const line of new Error().stack.split('\n').slice(2)) {
    const m = line.match(/\((?:file:\/\/)?(.+?\/test\/[^/]+\.js):(\d+):\d+\)$|at (?:file:\/\/)?(.+?\/test\/[^/]+\.js):(\d+):\d+$/);
    if (!m) continue;
    const file = m[1] || m[3];
    if (file.endsWith('/recorder.js') || file.endsWith('/helpers.js')) continue;
    return { file: relative(ROOT, file), line: +(m[2] || m[4]) };
  }
  return null;
}

const plain = c => ({
  code: c.code, title: c.title, hours: c.hours, grade: c.grade ?? null, status: c.status,
  exemptionTarget: c.exemptionTarget, period: c.period, requirements: c.requirements,
});

function summarize(analysis) {
  return {
    results: analysis.results.filter(r => r.name && r.status !== 'header' && r.status !== 'info-only').map(r => ({
      name: r.name, status: r.status, reqType: r.reqType, hours: r.hoursEarned, effective: r.hoursEffective,
      minHours: r.minHours, maxHours: r.maxHours, isExempt: !!r.isExempt, workdaySatisfied: r.workdaySatisfied || null,
      // Each counted course, with why it counts when that's an assumption.
      counted: (r.courseAnnotations || []).filter(a => (a.isTaken || a.isInProgress) && !a.isExcludedTransfer).map(a => ({
        code: a.code, via: a.isAssumed ? 'assumed' : a.isFromOtherCatalog ? 'other-catalog' : a.isFromWorkday ? 'workday' : null })),
      excluded: (r.courseAnnotations || []).filter(a => a.isExcludedTransfer).map(a => a.code),
      maxed: [...(r.maxedDisciplines || [])],
    })),
    ku: analysis.kuSummary,
    workdayChecks: analysis.workdayChecks,
    notCounted: analysis.notCounted.map(c => c.code),
    warnings: analysis.warnings.map(w => ({ code: w.code, requirement: w.requirement, reason: w.reason })),
  };
}

export function analyze(categories, transcript, options = {}) {
  const analysis = coreAnalyze(categories, transcript, options);
  if (REPORT_DIR) {
    records.push({
      test: running.at(-1) ?? null,
      at: caller(),
      catalog: categories.some(c => c.name === 'Rhetoric in Disciplines') ? '2026–27' : '2025–26',
      courses: transcript.map(plain),
      workdayStatus: options.workdayStatus ? [...options.workdayStatus] : null,
      planned: options.plannedCourses || [],
      otherCatalogs: !!options.extraCourses,
      outcome: summarize(analysis),
      kuNames: KU_NAMES,
    });
  }
  return analysis;
}
