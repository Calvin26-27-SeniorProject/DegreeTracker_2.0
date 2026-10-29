import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { SCHEDULE_INFO } from './schedule-json.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const MAJORS = [
  { dir: 'bcs', file: 'bcs' },
  { dir: 'cs+', file: 'cs-plus' },
  { dir: 'nursing', file: 'nursing' },
];
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

export function buildMajorCourseOptions(raw, major) {
  const requiredCodes = new Set(major.requirements.flatMap(r => r.codes || []).map(code => code.toUpperCase()));
  const courseRows = uniqueTermRows(raw);
  const electiveMap = new Map();
  const programElectives = major.courseGroups.find(group => group.id === 'cs-electives')?.courses || [];
  const scienceMap = new Map();
  const requiredCourseMap = new Map();

  const labGroup = major.courseGroups.find(group => group.type === 'lab-science-options');
  for (const [catoid, courses] of Object.entries(labGroup?.catalogCourses || {})) {
    for (const course of courses) {
      const science = scienceMap.get(course.code) || {
        code: course.code,
        title: course.title,
        credits: null,
        catalogs: new Set(),
        terms: new Map(),
      };
      science.catalogs.add(catoid);
      scienceMap.set(course.code, science);
    }
  }

  for (const { term, row } of courseRows) {
    const code = courseCode(row);
    const number = COURSE_NUMBER_RE.exec(String(row.Crs_Number || ''));
    const credits = numericHours(row.Hours);

    if (requiredCodes.has(code.toUpperCase())) {
      const requiredCourse = requiredCourseMap.get(code) || {
        code,
        title: row.Section_Title || '',
        credits: displayHours(row.Hours),
        terms: new Map(),
      };
      if (!requiredCourse.title && row.Section_Title) requiredCourse.title = row.Section_Title;
      if (!requiredCourse.credits && credits != null) requiredCourse.credits = displayHours(row.Hours);
      const termInfo = requiredCourse.terms.get(term) || {
        term,
        label: SCHEDULE_INFO[term]?.label || term,
        statuses: new Set(),
      };
      if (row.Status) termInfo.statuses.add(row.Status);
      requiredCourse.terms.set(term, termInfo);
      requiredCourseMap.set(code, requiredCourse);
    }

    if (programElectives.some(course => course.code === code)
      && number && !String(row.Crs_Number).endsWith('L')
      && row.Sec_Number !== 'CPI' && !/Handlon/i.test(row.Campus || '')) {
      const elective = electiveMap.get(code) || {
        ...programElectives.find(course => course.code === code),
        terms: new Map(),
      };
      if (credits != null) elective.credits = displayHours(row.Hours);
      const termInfo = elective.terms.get(term) || { term, label: SCHEDULE_INFO[term]?.label || term, statuses: new Set() };
      if (row.Status) termInfo.statuses.add(row.Status);
      elective.terms.set(term, termInfo);
      electiveMap.set(code, elective);
    }

    if (!scienceMap.has(code)) continue;
    const science = scienceMap.get(code);
    if (!science.credits && credits != null) science.credits = displayHours(row.Hours);
    const termInfo = science.terms.get(term) || {
      term,
      label: SCHEDULE_INFO[term]?.label || term,
      statuses: new Set(),
    };
    if (row.Status) termInfo.statuses.add(row.Status);
    science.terms.set(term, termInfo);
  }

  const termInfo = terms => [...terms.values()]
    .sort((a, b) => a.term.localeCompare(b.term))
    .map(item => ({ term: item.term, label: item.label, statuses: [...item.statuses].sort() }));
  for (const course of programElectives) {
    if (!electiveMap.has(course.code)) electiveMap.set(course.code, { ...course, terms: new Map() });
  }
  return {
    source: 'Calvin Workday Course Search exports',
    terms: Object.entries(SCHEDULE_INFO).map(([term, info]) => ({ term, ...info })),
    requiredCourses: [...requiredCourseMap.values()]
      .sort((a, b) => a.code.localeCompare(b.code))
      .map(course => ({ ...course, terms: termInfo(course.terms) })),
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
        terms: termInfo(course.terms),
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
  const generated = {};
  for (const { dir, file } of MAJORS) {
    const majorDir = join(ROOT, 'majors', dir);
    const major = JSON.parse(readFileSync(join(majorDir, `${file}.json`), 'utf8'));
    const options = buildMajorCourseOptions(raw, major);
    writeFileSync(join(majorDir, `${file}-course-options.json`), `${JSON.stringify(options, null, 2)}\n`, 'utf8');
    generated[file] = options;
  }
  return generated;
}
