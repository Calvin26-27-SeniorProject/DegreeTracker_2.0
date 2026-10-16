/**
 * schedule/CourseSchedule-<term>.json (Workday course-search exports) →
 * schedule/sections.json: hours for every core course, and the listed
 * sections of the terms SCHEDULE_INFO marks as shown.
 *
 * Usage:
 *   node test/generate-schedule-json.js
 *
 * To add a term: save its export as schedule/CourseSchedule-<term>.json, add
 * it to SCHEDULE_INFO in schedule-json.js, and re-run. Re-run after
 * re-downloading a term (updating its savedAt) or regenerating a catalog.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScheduleJson, coreCourseTitles, SCHEDULE_INFO } from './schedule-json.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

export function loadScheduleInputs() {
  const scheduleDir = join(ROOT, 'schedule');
  const catalogDir = join(ROOT, 'catalog');
  const raw = {};
  for (const f of readdirSync(scheduleDir)) {
    const term = f.match(/^CourseSchedule-(\w+)\.json$/)?.[1];
    if (!term) continue;
    if (!SCHEDULE_INFO[term]) throw new Error(`${f}: add ${term} to SCHEDULE_INFO in test/schedule-json.js`);
    raw[term] = JSON.parse(readFileSync(join(scheduleDir, f), 'utf-8')).report;
  }
  const catalogs = readdirSync(catalogDir)
    .map(f => f.match(/^catalog-categories-(\d+)\.json$/))
    .filter(Boolean)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .map(([file]) => JSON.parse(readFileSync(join(catalogDir, file), 'utf-8')));
  return { raw, titles: coreCourseTitles(catalogs) };
}

export const SECTIONS_OUTPUT = join(ROOT, 'schedule', 'sections.json');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { raw, titles } = loadScheduleInputs();
  const output = buildScheduleJson(raw, titles);
  writeFileSync(SECTIONS_OUTPUT, JSON.stringify(output, null, 1) + '\n', 'utf-8');
  const codes = Object.keys(titles);
  console.log(`Wrote ${SECTIONS_OUTPUT}`);
  console.log(`  hours for ${Object.keys(output.hours).length} of ${codes.length} core courses`);
  for (const { term, label, shown } of output._meta.terms.filter(t => t.shown)) {
    const offered = Object.values(output.offerings).filter(o => o[term]);
    const n = offered.reduce((s, o) => s + o[term].length, 0);
    console.log(`  ${label}: ${offered.length} core courses, ${n} listed sections`);
  }
}
