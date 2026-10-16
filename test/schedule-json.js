/**
 * Workday course-search exports (schedule/CourseSchedule-<term>.json) → the
 * section and hours data the app bundles (schedule/sections.json). Shared by
 * generate-schedule-json.js (which writes it) and test-schedule.js (which
 * checks the committed output still matches the saved exports).
 *
 * The exports come from the course search page's API
 * (https://sites.calvin.edu/courses/course-search.js); fetch each term once,
 * by hand, and add it to SCHEDULE_INFO.
 */

// shown: list this term's sections in the app. Terms not shown only supply
// course hours (a 26FA section says nothing about 27FA offerings, but hours
// rarely change). Update savedAt when re-downloading a term.
export const SCHEDULE_INFO = {
  '26FA': { label: 'Fall 2026', savedAt: '2026-10-16', shown: false },
  '27SP': { label: 'Spring 2027', savedAt: '2026-10-14', shown: true },
  '27SU': { label: 'Summer 2027', savedAt: '2026-10-16', shown: true },
};

// Chronological order of term ids like '26FA', '27SP', '27SU'.
const SEASON_ORDER = { SP: 0, SU: 1, FA: 2 };
export const termOrder = (a, b) => a.slice(0, 2) - b.slice(0, 2) || SEASON_ORDER[a.slice(2)] - SEASON_ORDER[b.slice(2)];

// "4" → [4, 4]; "1 - 4" → [1, 4].
function parseHours(s) {
  const nums = String(s ?? '').split('-').map(x => x.trim()).filter(Boolean).map(Number).filter(n => !Number.isNaN(n));
  return nums.length ? [Math.min(...nums), Math.max(...nums)] : null;
}

// "MWF | 9:15 AM - 10:20 AM | 08/31/2026 - 12/17/2026; T | ..." → "MWF 9:15–10:20 AM, T ..."
function meetingText(pattern) {
  const parts = [];
  for (const seg of (pattern || '').split(';')) {
    const [days, times] = seg.split('|').map(f => f.trim());
    if (!days) continue;
    const t = (times || '').replace(/\s*-\s*/, '–').replace(/ (AM|PM)–(.*) \1$/, '–$2 $1');
    parts.push(t ? `${days} ${t}` : days);
  }
  return parts.join(', ');
}

// "2027 Spring 1 (01/18/2027-03/13/2027)" → { name: 'Spring 1', start: '01/18', end: '03/13' }
function parsePeriod(acadPeriod) {
  const m = (acadPeriod || '').match(/^\d{4} (.+?) \((\d\d\/\d\d)\/\d{4}-(\d\d\/\d\d)\/\d{4}\)$/);
  return m ? { name: m[1], start: m[2], end: m[3] } : { name: acadPeriod || '', start: '', end: '' };
}

// Part of a term a section meets in, when that isn't the whole term.
function periodLabel(period, termLabel) {
  if (period.name === termLabel.replace(/ \d{4}$/, '')) return null;
  const half = period.name.match(/^(?:Fall|Spring) ([12])$/);
  const name = half ? (half[1] === '1' ? '1st half' : '2nd half') : period.name;
  return `${name}, ${period.start}–${period.end}`;
}

const sectionCode = r => `${r.Subject_RefID} ${r.Crs_Number}`;
// Not closed, and not Calvin Prison Initiative (CPI sections; Handlon Campus).
const isListed = r => r.Status !== 'Closed' && r.Sec_Number !== 'CPI' && !/Handlon/i.test(r.Campus || '');

// raw: { [term]: report rows }; titles: { [course code]: catalog title }, the
// core courses to keep (and their labs).
export function buildScheduleJson(raw, titles) {
  const terms = Object.keys(raw).sort(termOrder);
  const keep = code => code in titles || (code.endsWith('L') && code.slice(0, -1) in titles);
  const hours = {};
  const offerings = {};
  for (const term of terms) {
    const info = SCHEDULE_INFO[term];
    const rows = raw[term].filter(r => keep(sectionCode(r)));
    // Hours: any section (closed or not) says what the course is worth; a
    // lecture's hours include its lab's, as merged transcript labs do.
    const range = {};
    for (const r of rows) {
      const h = parseHours(r.Hours);
      if (!h) continue;
      const code = sectionCode(r);
      range[code] = range[code] ? [Math.min(range[code][0], h[0]), Math.max(range[code][1], h[1])] : h;
    }
    for (const [code, [min, max]] of Object.entries(range)) {
      if (!(code in titles)) continue;
      const lab = !code.endsWith('L') && range[code + 'L'];
      hours[code] = { min: min + (lab ? lab[0] : 0), max: max + (lab ? lab[1] : 0), term };
    }
    if (!info?.shown) continue;
    for (const r of rows.filter(isListed)) {
      const code = sectionCode(r);
      const isLab = code.endsWith('L') && !(code in titles);
      const parent = isLab ? code.slice(0, -1) : code;
      const period = parsePeriod(r.AcadPeriod);
      // A section's own hours, when the course's vary (e.g. a 0- or 1-hour ensemble).
      const varies = range[code] && range[code][0] !== range[code][1];
      const section = {
        section: r.Sec_Number,
        ...(isLab && { lab: true }),
        ...(varies && { hours: r.Hours }),
        meets: meetingText(r.MtgPattern) || null,
        instructors: r.Instructors || null,
        ...(r.Delivery && r.Delivery !== 'In-Person' && { delivery: r.Delivery }),
        ...(/^Off Campus$/.test(r.Campus || '') && { offCampus: true }),
        ...(periodLabel(period, info.label) && { period: periodLabel(period, info.label) }),
        ...(!isLab && r.Section_Title && r.Section_Title !== titles[parent] && { title: r.Section_Title }),
      };
      offerings[parent] ??= {};
      (offerings[parent][term] ??= []).push(section);
    }
  }
  const sortSections = list => list.sort((a, b) => !!a.lab - !!b.lab || a.section.localeCompare(b.section));
  const sorted = Object.fromEntries(Object.keys(offerings).sort().map(code =>
    [code, Object.fromEntries(Object.entries(offerings[code]).map(([t, list]) => [t, sortSections(list)]))]));
  return {
    _meta: {
      terms: terms.map(term => ({ term, ...SCHEDULE_INFO[term] })),
      note: 'Auto-generated by test/generate-schedule-json.js from schedule/CourseSchedule-*.json. Closed, CPI, and Handlon Campus sections are left out.',
    },
    hours: Object.fromEntries(Object.keys(hours).sort().map(c => [c, hours[c]])),
    offerings: sorted,
  };
}

// Every core course code in the given catalogs, with its title (newest catalog first wins).
export function coreCourseTitles(catalogs) {
  const titles = {};
  for (const data of catalogs) {
    for (const cat of data.categories) for (const c of cat.courses || []) titles[c.code] ??= c.title;
  }
  return titles;
}
