// A de-identified test case from a student's record, for an advisor to copy
// into test/fixtures/cases/ (test/test-advising-cases.js replays them).
//
// De-identification: grades become A (A–C), D, or F, keeping I/W/N/NR/CR;
// academic years shift so the earliest is 2000 (order kept); exemption dates
// likewise; Workday requirements that aren't core (majors, GPA) are dropped.
// The course list itself stays: the case needs it, so share only with the
// developer.

import { analyze, workdayRequirementCategory, resolvedGrade } from './core.js';

const KU_RE = /Knowledge and Understanding/i;
const isCoreRequirement = req => KU_RE.test(req) || workdayRequirementCategory(req) !== null;
const COARSE = { A: 'A', B: 'A', C: 'A', D: 'D', F: 'F' };

// "B+" → "A", "D-" → "D", "IC" → "IA", "W" → "W".
export function coarseGrade(grade) {
  if (!grade) return grade ?? null;
  const g = grade.toUpperCase();
  const letter = COARSE[resolvedGrade(g)[0]];
  if (!letter || !/^[A-F][+-]?$/.test(resolvedGrade(g))) return g;
  return (g !== resolvedGrade(g) ? 'I' : '') + letter;
}

function yearShifter(courses, workdayStatus) {
  const years = [];
  for (const c of courses) { const y = c.period?.match(/^(\d{4})\b/); if (y) years.push(+y[1]); }
  for (const [, { items }] of workdayStatus) {
    for (const i of items) { const y = i.match(/\d{2}\/\d{2}\/(\d{4})$/); if (y) years.push(+y[1]); }
  }
  const offset = years.length ? 2000 - Math.min(...years) : 0;
  return {
    period: p => p?.replace(/^(\d{4})\b/, (_, y) => String(+y + offset)) ?? null,
    item: i => i.replace(/\d{2}\/\d{2}\/(\d{4})$/, (_, y) => `01/01/${+y + offset}`),
  };
}

// input: { catoid, source, courses, workdayStatus?: Map, overrides?: Set }
// Returns the case object; expected = this tool's result on the de-identified
// record (the advisor corrects it where the tool is wrong).
export function buildTestCase(input, categories, extraCourses) {
  const workdayIn = [...(input.workdayStatus || [])].filter(([req]) => isCoreRequirement(req));
  const shift = yearShifter(input.courses, workdayIn);
  const courses = input.courses.map(c => {
    const out = { ...c, grade: coarseGrade(c.grade) };
    if ('period' in c) out.period = shift.period(c.period);
    if (c.requirements) out.requirements = c.requirements.filter(isCoreRequirement);
    return out;
  });
  const workdayStatus = workdayIn.map(([req, s]) => [req, { status: s.status, items: s.items.map(shift.item) }]);
  const overrides = [...(input.overrides || [])].filter(isCoreRequirement);
  const analysis = analyze(categories, courses, {
    workdayStatus: new Map(workdayStatus), overrides: new Set(overrides), extraCourses,
  });
  return {
    about: 'Describe the situation. Where the tool is wrong, correct "expected" and set "toolIsWrong" to say how.',
    toolIsWrong: null,
    catalog: input.catoid,
    source: input.source || null,
    courses, workdayStatus, overrides,
    expected: expectedFrom(analysis),
  };
}

export function expectedFrom(analysis) {
  const expected = {};
  for (const r of analysis.results) {
    if (!r.name || r.status === 'header' || r.status === 'info-only') continue;
    expected[r.name] = r.reqType === 'hour-range' ? `${r.status}, ${+r.hoursEarned.toFixed(2)} hrs` : r.status;
  }
  if (analysis.kuSummary.met !== null) expected['K&U'] = analysis.kuSummary.met ? 'met' : 'not met';
  expected.disagreesWithWorkday = analysis.workdayChecks.filter(c => c.kind === 'mismatch').map(c => c.requirement);
  return expected;
}

// JSON with one course / Workday entry per line, so a case reads and diffs well.
export function formatTestCase(testCase) {
  const lines = ['{'];
  const entries = Object.entries(testCase);
  entries.forEach(([key, value], i) => {
    const comma = i < entries.length - 1 ? ',' : '';
    if (Array.isArray(value) && value.length && typeof value[0] === 'object') {
      lines.push(`  ${JSON.stringify(key)}: [`);
      value.forEach((v, j) => lines.push(`    ${JSON.stringify(v)}${j < value.length - 1 ? ',' : ''}`));
      lines.push(`  ]${comma}`);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      lines.push(`  ${JSON.stringify(key)}: {`);
      const sub = Object.entries(value);
      sub.forEach(([k, v], j) => lines.push(`    ${JSON.stringify(k)}: ${JSON.stringify(v)}${j < sub.length - 1 ? ',' : ''}`));
      lines.push(`  }${comma}`);
    } else {
      lines.push(`  ${JSON.stringify(key)}: ${JSON.stringify(value)}${comma}`);
    }
  });
  lines.push('}');
  return lines.join('\n');
}
