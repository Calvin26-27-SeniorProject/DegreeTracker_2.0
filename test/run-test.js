/**
 * Test harness for Calvin Core Annotator.
 *
 * Usage:
 *   node test/run-test.js [test/fixtures/transcript-*.txt ...]
 *
 * If no arguments, runs all transcript-*.txt files found in test/fixtures/.
 *
 * Each transcript file can have a companion .expected.json with the expected
 * topline outputs. If present, the test asserts they match; if absent, the
 * actual output is printed so you can review and snapshot it:
 *
 *   node test/run-test.js test/fixtures/transcript-alice.txt > test/fixtures/transcript-alice.expected.json
 *
 * Snapshots were taken against the 2025-26 catalog, saved at
 * test/fixtures/catalog-24.html.  catalog.calvin.edu sits behind a bot
 * challenge, so the HTML must be saved from a browser (not fetched here).
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { KNOWN_COURSE_CATEGORIES } from '../src/catalog-courses.js';
import { parseTranscript, parseProgress, detectInputFormat, parseCoreProgram, analyze, KU_NAMES } from '../src/core.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');
const CATALOG_PATH = join(__dirname, '..', 'catalog', 'catalog-24.html');
const CATALOG_URL = 'https://catalog.calvin.edu/content.php?catoid=24&navoid=780';

// ---- Catalog HTML ----

function ensureCatalog() {
  if (existsSync(CATALOG_PATH)) return;
  throw new Error(`Missing ${CATALOG_PATH}. Open ${CATALOG_URL} in a browser and save the page HTML there.`);
}

function loadCatalogDOM() {
  const html = readFileSync(CATALOG_PATH, 'utf-8');
  const dom = new JSDOM(html);
  return dom.window.document;
}

// ---- Summarize analysis for comparison ----

function summarize(analysis) {
  const { kuSummary, results } = analysis;
  const categories = {};
  for (const r of results) {
    if (r.status === 'header' || r.status === 'info-only') continue;
    const entry = {
      status: r.status,
      hoursEarned: r.hoursEarned ?? null,
      hoursEffective: r.hoursEffective ?? null,
      takenCount: r.takenCount ?? 0,
    };
    if (r.subDisciplines) entry.subDisciplines = r.subDisciplines;
    categories[r.name] = entry;
  }
  return {
    kuSummary: {
      totalHours: kuSummary.totalHours,
      categoriesUsed: kuSummary.categoriesUsed,
      hoursByCategory: kuSummary.hoursByCategory,
    },
    categories,
  };
}

// ---- Test runner ----

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function diffSummaries(expected, actual) {
  const diffs = [];
  // K&U top-level
  for (const key of ['totalHours', 'categoriesUsed']) {
    if (expected.kuSummary[key] !== actual.kuSummary[key]) {
      diffs.push(`kuSummary.${key}: expected ${expected.kuSummary[key]}, got ${actual.kuSummary[key]}`);
    }
  }
  // Per-category
  const allCats = new Set([...Object.keys(expected.categories), ...Object.keys(actual.categories)]);
  for (const cat of allCats) {
    const e = expected.categories[cat];
    const a = actual.categories[cat];
    if (!e) { diffs.push(`category "${cat}": unexpected (not in expected)`); continue; }
    if (!a) { diffs.push(`category "${cat}": missing (expected ${e.status})`); continue; }
    for (const key of ['status', 'hoursEarned', 'takenCount']) {
      if (e[key] !== a[key]) {
        diffs.push(`category "${cat}".${key}: expected ${e[key]}, got ${a[key]}`);
      }
    }
  }
  return diffs;
}

async function main() {
  const args = process.argv.slice(2);
  const files = args.filter(a => !a.startsWith('--'));

  ensureCatalog();
  const doc = loadCatalogDOM();
  const categories = parseCoreProgram(doc);

  // Discover test transcripts
  let transcriptFiles = files.filter(f => basename(f).startsWith('transcript-'));
  let progressFiles = files.filter(f => basename(f).startsWith('progress-'));
  if (files.length === 0) {
    if (!existsSync(FIXTURES)) {
      console.error(`No fixtures directory. Create test/fixtures/ and add transcript-*.txt files.`);
      process.exit(1);
    }
    const allFiles = readdirSync(FIXTURES);
    transcriptFiles = allFiles
      .filter(f => f.startsWith('transcript-') && f.endsWith('.txt'))
      .map(f => join(FIXTURES, f));
    progressFiles = allFiles
      .filter(f => f.startsWith('progress-') && f.endsWith('.txt'))
      .map(f => join(FIXTURES, f));
  }

  if (transcriptFiles.length === 0 && progressFiles.length === 0) {
    console.error('No test files found. Add .txt files to test/fixtures/ or pass paths as arguments.');
    process.exit(1);
  }

  let passed = 0, failed = 0, unsnapshotted = 0;

  function checkSnapshot(file, name, courses) {
    const analysis = analyze(categories, courses, { extraCourses: KNOWN_COURSE_CATEGORIES });
    const actual = summarize(analysis);
    const expectedPath = file.replace(/\.txt$/, '.expected.json');

    // Empty = just created by the shell redirect in the snapshot command.
    if (existsSync(expectedPath) && statSync(expectedPath).size > 0) {
      const expected = JSON.parse(readFileSync(expectedPath, 'utf-8'));
      if (deepEqual(expected, actual)) {
        console.error(`✓ ${name} (${courses.length} courses, ${analysis.kuSummary.totalHours}/${analysis.kuSummary.requiredHours} K&U hrs)`);
        passed++;
      } else {
        const diffs = diffSummaries(expected, actual);
        console.error(`✗ ${name}`);
        for (const d of diffs) console.error(`    ${d}`);
        failed++;
      }
    } else {
      console.error(`? ${name} — no expected file, printing actual output:`);
      console.log(JSON.stringify(actual, null, 2));
      console.error(`  To snapshot: node test/run-test.js ${file} > ${expectedPath}`);
      unsnapshotted++;
    }
  }

  // ---- Transcript tests ----
  for (const file of transcriptFiles) {
    const name = basename(file, '.txt');
    checkSnapshot(file, name, parseTranscript(readFileSync(file, 'utf-8')));
  }

  function check(actual, expected, label) {
    if (actual === expected) {
      console.error(`  ✓ ${label}`);
      passed++;
    } else {
      console.error(`  ✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      failed++;
    }
  }

  // ---- Progress format tests ----
  for (const file of progressFiles) {
    const name = basename(file, '.txt');
    const text = readFileSync(file, 'utf-8');

    const fmt = detectInputFormat(text);
    if (fmt !== 'progress') {
      console.error(`✗ ${name} detectInputFormat: expected 'progress', got '${fmt}'`);
      failed++;
    } else {
      console.error(`✓ ${name} detectInputFormat → 'progress'`);
      passed++;
    }

    const { courses, exemptions, overrides } = parseProgress(text);
    checkSnapshot(file, name, courses);

    if (name === 'progress-example') checkProgressExample(courses, exemptions, overrides);
  }

  // Field-level checks for progress-example.txt, which exercises every
  // entry kind: in-progress, transfer, exemption, override, labs, and a
  // course repeated under two requirements.
  function checkProgressExample(courses, exemptions, overrides) {
    const realCourses = courses.filter(c => c.code !== null);
    const byCode = {};
    for (const c of realCourses) byCode[c.code] = c;

    check(byCode['REL 212']?.status, 'in-progress', 'REL 212 should be in-progress');
    check(byCode['ECON 221']?.status, 'in-progress', 'ECON 221 should be in-progress');
    check(byCode['CS 384']?.status, 'in-progress', 'CS 384 should be in-progress');
    check(byCode['PHYS 221']?.status, 'transfer', 'PHYS 221 should be transfer');
    check(byCode['PHYS 221']?.hours, 4, 'PHYS 221 should have 4 hours');
    check(byCode['PHYS 221']?.grade, 'CR', 'PHYS 221 grade should be CR');
    check(byCode['CORE 100']?.status, 'completed', 'CORE 100 should be completed');
    check(byCode['CORE 100']?.hours, 2, 'CORE 100 should have 2 hours');
    // Labs stay separate rows at parse time; analyze() merges them.
    check(byCode['CS 108']?.hours, 3, 'CS 108 should parse as lecture-only (3 hours)');
    check(byCode['CS 108L']?.hours, 1, 'CS 108L should parse as its own row');
    check(realCourses.filter(c => c.code === 'CS 108').length, 1, 'CS 108 should appear only once (deduplicated)');
    check(exemptions.length >= 1, true, 'Should have at least 1 exemption');
    check(exemptions[0]?.target, 'World Languages I', 'Language Exemption should target World Languages I');
    check(overrides.has('Knowledge and Understanding - minimum 26 hours'), true, 'Should detect K&U override');

    const analysis = analyze(categories, courses, { extraCourses: KNOWN_COURSE_CATEGORIES });
    const annotation = code => analysis.results
      .flatMap(r => r.courseAnnotations || [])
      .find(a => a.code === code && (a.isTaken || a.isInProgress));

    const wl1 = analysis.results.find(r => r.name === 'World Languages I');
    check(wl1?.status, 'complete', 'World Languages I should be complete');
    check(wl1?.isExempt, true, 'World Languages I should be marked exempt');
    check(annotation('CS 108')?.hours, 4, 'CS 108 should count 4 hours in analysis (3 + 1 lab)');
    check(annotation('CHEM 101')?.hours, 4, 'CHEM 101 should count 4 hours in analysis (3 + 1 lab)');
    check(annotation('CS 384')?.isInProgress, true, 'CS 384 should be annotated as in-progress');
    check(analysis.warnings.length, 0, 'Should have no K&U warnings');
  }

  console.error(`\n${passed} passed, ${failed} failed, ${unsnapshotted} unsnapshotted`);
  if (failed > 0) process.exit(1);
}

main();
