// Where each course is listed: the Calvin Core requirements (and tags) the
// catalog lists it under, and the requirements of the student's majors and
// minors that list it. Each course row shows the others ("Also listed for"),
// so a student can see at a glance what one course would also fill.
//
// A use: { area: 'core' | 'major' | 'minor', program, label, href }, where href
// is "#<id>" of the requirement's card on its own tab.
import { workdayRequirementCourses } from './core.js';

const WORKDAY_ITEM_RE = /^([A-Z]{2,5} \d{3}[A-Z]?) - /;

function addUse(uses, code, use) {
  if (!code) return;
  if (!uses.has(code)) uses.set(code, []);
  const list = uses.get(code);
  if (!list.some(u => u.href === use.href)) list.push(use);
}

// The core requirements on the selected catalog's page that list each course,
// counting the other catalog years' lists for the same requirement
// (extraCourses: KNOWN_COURSE_CATEGORIES, { [name]: { [code]: sub-discipline } }),
// as the Core page counts them.
export function coreCourseUses(catalog, extraCourses = {}) {
  const uses = new Map();
  for (const cat of catalog.categories) {
    if (!cat.name || !cat.slug) continue;
    const codes = new Set((cat.courses || []).map(c => c.code));
    for (const code of Object.keys(extraCourses[cat.name] || {})) codes.add(code);
    for (const code of codes) addUse(uses, code, { area: 'core', program: 'Core', label: cat.name, href: '#' + cat.slug });
  }
  return uses;
}

// The requirements of each program page that list each course. entries:
// [{ idPrefix, kind, group, groupIndex, check }], one per program as a tab (or
// a What if panel) draws it with renderPrograms: a checked program's
// requirements (check: { program, result }) by their options, else Workday's
// requirements by the courses their names list and the courses Workday applied.
// The hrefs are the ids renderPrograms gives the cards.
export function programCourseUses(entries) {
  const uses = new Map();
  for (const { idPrefix, kind, group, groupIndex = 0, check } of entries) {
    if (check) {
      const { program, result } = check;
      const name = program.programName || program.name || group.name;
      for (const item of result.items) {
        const codes = item.kind === 'group' || item.kind === 'list'
          ? item.courses.map(c => c.code) : (item.options || []).flat();
        const use = { area: kind, program: name, label: item.label, href: `#${idPrefix}-${program.id}-${item.id}` };
        for (const code of codes) addUse(uses, code, use);
      }
      continue;
    }
    (group.requirements || []).forEach((r, i) => {
      const parsed = workdayRequirementCourses(r.name);
      const codes = [...(parsed?.codes || []), ...(r.items || []).map(it => WORKDAY_ITEM_RE.exec(it.text)?.[1])];
      const use = { area: kind, program: group.name || 'Your program', label: r.name, href: `#${idPrefix}-${groupIndex}-req-${i}` };
      for (const code of codes) addUse(uses, code, use);
    });
  }
  return uses;
}

export function mergeUses(...maps) {
  const out = new Map();
  for (const m of maps) for (const [code, list] of m || []) for (const u of list) addUse(out, code, u);
  return out;
}
