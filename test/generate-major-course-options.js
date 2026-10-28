import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { SCHEDULE_INFO } from './schedule-json.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const OUTPUT = join(ROOT, 'majors', 'bcs-course-options.json');
const LAB_EVIDENCE_RE = /\b(?:laborator(?:y|ies)|lab\s+fee)\b/i;
const COURSE_NUMBER_RE = /^(\d{3})[A-Z]?$/;

function courseCode(row) {
  return `${row.Subject_RefID} ${row.Crs_Number}`;
}

function numericHours(value) {
  const parsed = Number.parseFloat(String(value || '').split('-')[0].trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function displayHours(value) {
  const hours = String(value || '').trim().replace(/\s*-\s*/, '-');
  return hours || null;
}

function uniqueTermRows(raw) {
  return Object.entries(raw).flatMap(([term, rows]) => rows.map(row => ({ term, row })));
}

export function buildMajorCourseOptions(raw, catalogs, major) {
  const requiredCodes = new Set(major.requirements.flatMap(r => r.codes || []).map(code => code.toUpperCase()));
  const naturalScienceCodes = new Map(catalogs.map(catalog => {
    const category = catalog.categories.find(item => item.name === 'Natural Sciences');
    return [catalog._meta.catoid, new Set((category?.courses || []).map(course => course.code))];
  }));
  const courseRows = uniqueTermRows(raw);
  const electiveMap = new Map();
  const bcsElectives = major.courseGroups.find(group => group.id === 'cs-electives')?.courses || [];
  const scienceMap = new Map();
  const requiredCourseMap = new Map();

  for (const { term, row } of courseRows) {
    const code = courseCode(row);
    const number = COURSE_NUMBER_RE.exec(String(row.Crs_Number || ''));
    const credits = numericHours(row.Hours);

    if (requiredCodes.has(code.toUpperCase())) {
      const requiredCourse = requiredCourseMap.get(code) || {
        code,
        title: row.Section_Title || '',
        credits: displayHours(row.Hours),
      };
      if (!requiredCourse.title && row.Section_Title) requiredCourse.title = row.Section_Title;
      if (!requiredCourse.credits && credits != null) requiredCourse.credits = displayHours(row.Hours);
      requiredCourseMap.set(code, requiredCourse);
    }

    if (bcsElectives.some(course => course.code === code)
      && number && !String(row.Crs_Number).endsWith('L')
      && row.Sec_Number !== 'CPI' && !/Handlon/i.test(row.Campus || '')) {
      const elective = electiveMap.get(code) || {
        ...bcsElectives.find(course => course.code === code),
        terms: new Map(),
      };
      if (credits != null) elective.credits = displayHours(row.Hours);
      const termInfo = elective.terms.get(term) || { term, label: SCHEDULE_INFO[term]?.label || term, statuses: new Set() };
      if (row.Status) termInfo.statuses.add(row.Status);
      elective.terms.set(term, termInfo);
      electiveMap.set(code, elective);
    }

    if (!LAB_EVIDENCE_RE.test(row.Desc || '')) continue;
    const allowedCatalogs = [...naturalScienceCodes]
      .filter(([, codes]) => codes.has(code))
      .map(([catoid]) => catoid);
    if (!allowedCatalogs.length) continue;

    if (!scienceMap.has(code)) {
      const evidence = LAB_EVIDENCE_RE.exec(row.Desc || '')?.[0] || 'Laboratory';
      scienceMap.set(code, {
        code,
        title: row.Section_Title || '',
        credits: displayHours(row.Hours),
        evidence,
        catalogs: new Set(),
        terms: new Set(),
      });
    }
    const science = scienceMap.get(code);
    if (!science.title && row.Section_Title) science.title = row.Section_Title;
    if (!science.credits && credits != null) science.credits = displayHours(row.Hours);
    allowedCatalogs.forEach(catoid => science.catalogs.add(catoid));
    science.terms.add(SCHEDULE_INFO[term]?.label || term);
  }

  const termInfo = terms => [...terms.values()]
    .sort((a, b) => a.term.localeCompare(b.term))
    .map(item => ({ term: item.term, label: item.label, statuses: [...item.statuses].sort() }));
  for (const course of bcsElectives) {
    if (!electiveMap.has(course.code)) electiveMap.set(course.code, { ...course, terms: new Map() });
  }
  return {
    source: 'Calvin Workday Course Search exports',
    terms: Object.entries(SCHEDULE_INFO).map(([term, info]) => ({ term, ...info })),
    requiredCourses: [...requiredCourseMap.values()].sort((a, b) => a.code.localeCompare(b.code)),
    csCourses: [...electiveMap.values()]
      .sort((a, b) => a.code.localeCompare(b.code))
      .map(course => ({
        ...course,
        terms: termInfo(course.terms),
      })),
    labScience: [...scienceMap.values()]
      .sort((a, b) => a.code.localeCompare(b.code))
      .map(course => ({
        ...course,
        catalogs: [...course.catalogs].sort(),
        terms: [...course.terms].sort(),
      })),
  };
}

export function generateMajorCourseOptions() {
  const scheduleDir = join(ROOT, 'schedule');
  const raw = {};
  for (const term of Object.keys(SCHEDULE_INFO)) {
    const path = join(scheduleDir, `CourseSchedule-${term}.json`);
    raw[term] = JSON.parse(readFileSync(path, 'utf8')).report;
  }
  const catalogs = ['25', '24'].map(catoid => JSON.parse(readFileSync(
    join(ROOT, 'catalog', `catalog-categories-${catoid}.json`), 'utf8')));
  const major = JSON.parse(readFileSync(join(ROOT, 'majors', 'bcs.json'), 'utf8'));
  const options = buildMajorCourseOptions(raw, catalogs, major);
  writeFileSync(OUTPUT, `${JSON.stringify(options, null, 2)}\n`, 'utf8');
  return options;
}
