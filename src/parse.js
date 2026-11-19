// Parsers for what a student gives the app: Workday's Academic Progress
// (the .xlsx export or pasted text) and Academic History (pasted text).
// Each turns its input into plain course and requirement records; the rest
// of the app (core.js) works only from those. No DOM globals.

// ========== TRANSCRIPT PARSER ==========
// Transfer/AP core credit can come in as a placeholder with no course number,
// e.g. "HIST CORE - AP/Transfer History Core". analyze() infers its category.
const PLACEHOLDER_NUMBER = 'CORE';

function courseEntry(subject, number, fields) {
  const entry = { code: subject + ' ' + number, ...fields };
  if (number === PLACEHOLDER_NUMBER) { entry.isPlaceholder = true; entry.subject = subject; }
  return entry;
}

export function parseTranscript(text) {
  const normalized = text
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
  const rowRe = /\b([A-Z]{2,5})\s+(\d{3}[A-Z]?|CORE)\s*-\s*(.+?)\s+([A-Z]{1,2}[+-]?)\s+\d+(?:\.\d+)?\s+(\d+(?:\.\d+)?)\s+\d+(?:\.\d+)?\b/g;
  const raw = [];
  let match = rowRe.exec(normalized);
  while (match !== null) {
    const [, subject, courseNumber, rawTitle, grade, hoursText] = match;
    raw.push(courseEntry(subject, courseNumber, {
      title: rawTitle.replace(/\s+/g, ' ').trim(),
      grade,
      hours: parseFloat(hoursText),
      status: 'completed',
    }));
    match = rowRe.exec(normalized);
  }

  // Deduplicate by course code. A repeated course's later attempt wins
  // (assumes the page lists attempts oldest first).
  const byCode = new Map();
  for (const c of raw) byCode.set(c.code, { ...c });
  return Array.from(byCode.values());
}

// "2025 Spring" → sortable number; null when absent or unrecognized.
export const TERM_ORDER = { winter: 0, interim: 0, spring: 1, summer: 2, fall: 3 };
export function periodRank(period) {
  const m = (period || '').match(/^(\d{4})\s+(\w+)$/);
  if (!m || !(m[2].toLowerCase() in TERM_ORDER)) return null;
  return +m[1] * 10 + TERM_ORDER[m[2].toLowerCase()];
}

// Category an exemption satisfies, from its name ("Language Exemption") or the
// requirement Workday lists it under ("World Languages I Core" for a
// "High School Exemption").
function exemptionTarget(name, requirement) {
  if (/language/i.test(name) || /\bWorld Languages I\b/.test(requirement || '')) return 'World Languages I';
  return null;
}

// ========== PROGRESS PARSER ==========
// Both Academic Progress inputs (pasted text, .xlsx export) become records
//   { requirement, item, period, hours, grade }
// one per "Satisfied With" entry (item null for a requirement with none),
// which progressFromRecords turns into courses.
export const PROGRESS_COURSE_RE = /^([A-Z]{2,5})\s+(\d{3}[A-Z]?L?|CORE)\s*-\s*(.+)$/;
const PROGRESS_EXEMPTION_RE = /^(.+?\bExemption)\s*-\s*(\d{2}\/\d{2}\/\d{4})$/;
// Any other dated registration ("Military - 05/01/2025"): not a course, but
// Workday may count it toward a requirement.
const PROGRESS_DATED_ITEM_RE = /^(.+?)\s*-\s*(\d{2}\/\d{2}\/\d{4})$/;
const WORKDAY_STATUS_RE = /^(Satisfied|Not Satisfied|In Progress)$/;

function cleanRequirementName(name) {
  return name.replace(/\s*\(Click for more details\)/g, '').replace(/\s*\(Override Assigned\)/g, '').trim();
}

// Returns { courses: [...], exemptions: [...], overrides: Set, workdayStatus: Map }
// Each course records the Workday requirement(s) it was listed under in
// `requirements`, so analyze() can flag K&U claims it can't match.
// workdayStatus: requirement name → { status, items } (Workday's Status and its
// "Registrations Used" entries, verbatim), for analyze() to compare with its own.
function progressFromRecords(records) {
  const raw = [];
  const exemptions = [];
  const overrides = new Set();
  const workdayStatus = new Map();

  for (const { requirement: rawRequirement, item, period, hours, grade, status: reqStatus } of records) {
    const requirement = rawRequirement ? cleanRequirementName(rawRequirement) : null;
    if (rawRequirement && /\(Override Assigned\)/.test(rawRequirement)) overrides.add(requirement);
    if (requirement) {
      if (!workdayStatus.has(requirement)) workdayStatus.set(requirement, { status: null, items: [] });
      const ws = workdayStatus.get(requirement);
      if (reqStatus && !ws.status) ws.status = reqStatus;
      if (item && !ws.items.includes(item)) ws.items.push(item);
    }
    if (!item) continue;

    // Exemptions (e.g., "Language Exemption - 07/01/2023")
    const exMatch = item.match(PROGRESS_EXEMPTION_RE);
    if (exMatch) {
      const exName = exMatch[1].trim();
      const target = exemptionTarget(exName, requirement);
      exemptions.push({ name: exName, date: exMatch[2], target });
      if (target) {
        raw.push({
          code: null, title: exName, grade: null, hours,
          status: 'exemption', exemptionTarget: target,
        });
      }
      continue;
    }

    const cm = item.match(PROGRESS_COURSE_RE);
    if (!cm) {
      const dated = item.match(PROGRESS_DATED_ITEM_RE);
      if (dated) exemptions.push({ name: dated[1].trim(), date: dated[2], target: null });
      continue;
    }
    let title = cm[3].trim();
    let status = 'completed';
    if (/\(In Progress\)/.test(title)) {
      status = 'in-progress';
      title = title.replace(/\s*\(In Progress\)/, '').trim();
    } else if (/\(Transfer Credit\)/.test(title)) {
      status = 'transfer';
      title = title.replace(/\s*\(Transfer Credit\)/, '').trim();
    }
    raw.push(courseEntry(cm[1], cm[2], { title, grade, hours, status, period,
      requirements: requirement ? [requirement] : [] }));
  }

  // Deduplicate by code/title, remembering every requirement the course was
  // listed under. A repeated course's later attempt wins: by academic period
  // when both have one, else the later listing.
  const byCode = new Map();
  for (const c of raw) {
    if (c.code === null) {
      if (!byCode.has(c.title)) byCode.set(c.title, c);
      continue;
    }
    const kept = byCode.get(c.code);
    if (!kept) { byCode.set(c.code, { ...c, requirements: [...c.requirements] }); continue; }
    const requirements = [...kept.requirements];
    for (const r of c.requirements) if (!requirements.includes(r)) requirements.push(r);
    const [a, b] = [periodRank(kept.period), periodRank(c.period)];
    const later = a !== null && b !== null ? b > a : kept.period !== c.period;
    byCode.set(c.code, later ? { ...c, requirements } : { ...kept, requirements });
  }
  const courses = Array.from(byCode.values());
  // Every semester a course was taken, for requirements that count them
  // ("CS 195 (3 semesters)"): one entry per course and period, in record order.
  const courseAttempts = [];
  const seenAttempts = new Set();
  for (const c of raw) {
    const key = `${c.code}\u0000${c.period || ''}`;
    if (!c.code || seenAttempts.has(key)) continue;
    seenAttempts.add(key);
    courseAttempts.push(c);
  }
  return { courses, courseAttempts, exemptions, overrides, workdayStatus };
}

// Parses copy-paste from Workday Academic Progress page: one field per line.
export function parseProgress(text) {
  const lines = text
    .replace(/ /g, ' ')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  const periodRe = /^\d{4}\s+(Fall|Spring|Summer|Winter|Interim)$/i;
  const hoursRe = /^\d+(?:\.\d+)?$/;
  const gradeRe = /^[A-Z]{1,2}[+-]?$/;
  // Status/remaining lines and page chrome that aren't requirement names.
  const notRequirementRe = /^(Satisfied|Not Satisfied|In Progress|Satisfied With|Minimum\b.*|.*Sort and filter column)$/;
  const isItem = line => PROGRESS_COURSE_RE.test(line) || PROGRESS_DATED_ITEM_RE.test(line);
  const records = [];
  let requirement = null;
  let requirementRecord = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // The status line right after a requirement name is Workday's Status for it.
    if (WORKDAY_STATUS_RE.test(line) && requirementRecord && !requirementRecord.status) {
      requirementRecord.status = line;
      continue;
    }
    if (PROGRESS_DATED_ITEM_RE.test(line)) {
      // Look ahead for hours
      let hours = 0;
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        if (hoursRe.test(lines[j])) { hours = parseFloat(lines[j]); break; }
        if (PROGRESS_COURSE_RE.test(lines[j])) break;
      }
      records.push({ requirement, item: line, period: null, hours, grade: null });
      requirementRecord = null;
      continue;
    }

    if (!PROGRESS_COURSE_RE.test(line)) {
      // Any other line that isn't a field value names the requirement that
      // following courses are listed under.
      if (!periodRe.test(line) && !hoursRe.test(line) && !gradeRe.test(line) && !notRequirementRe.test(line)) {
        requirement = line;
        requirementRecord = { requirement, item: null, status: null };
        records.push(requirementRecord);
      }
      continue;
    }

    // Look ahead for academic period, hours, grade
    let hours = 0;
    let grade = null;
    let period = null;
    for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
      const next = lines[j];
      if (isItem(next)) break;
      if (periodRe.test(next)) {
        period = next;
      } else if (hoursRe.test(next) && hours === 0) {
        hours = parseFloat(next);
      } else if (gradeRe.test(next) || next === 'CR') {
        grade = next;
      }
    }
    records.push({ requirement, item: line, period, hours, grade });
    requirementRecord = null;
  }
  return progressFromRecords(records);
}

// Parses the rows of a Workday "View Academic Progress for Student" .xlsx
// export (cell values as strings; see src/xlsx.js). Each program's table
// starts at a header row with "Requirement" and "Status" columns, and each
// row under it is one requirement with at most one "Registrations Used"
// entry, so no lookahead is needed. A table ends at the first row without
// both a requirement and a Workday status (Satisfied, Not Satisfied, In
// Progress): some exports put lines under it in the same columns, like
// "4 | Program of Study GPA", "Requirements Effective | 46104" (a date), or
// "Last Evaluated | 11/12/2026 …", which aren't requirements.
// Also returns `programs`, for the Major & minor page: one per requirement table, in
// order, named from the export's "Program of Study" summary (the tables follow it
// in the same order; names stay null if the counts differ):
//   [{ name, satisfied, total, requirements: [{ name, status, remaining, items: [{ text, period, hours, grade }] }] }]
// Workday's wording, verbatim (the app shows grades only when its "Show grades"
// toggle is on). Courses and workdayStatus don't depend on it.
// A status cell starts with one of Workday's statuses (allowing a suffix).
const TABLE_STATUS_RE = /^(Satisfied|Not Satisfied|In Progress)\b/i;
export function parseProgressRows(rows) {
  const records = [];
  let cols = null;
  const summary = [];
  let summaryCols = null;
  const tables = [];
  let table = null;
  for (const row of rows) {
    const cells = row.map(v => (v == null ? '' : String(v).replace(/ /g, ' ').trim()));
    const requirementCol = cells.indexOf('Requirement');
    if (requirementCol !== -1 && cells.includes('Status')) {
      const col = name => cells.indexOf(name);
      cols = { requirement: requirementCol, status: col('Status'), item: col('Registrations Used'),
        period: col('Academic Period'), hours: col('Hours'), grade: col('Grade'), remaining: col('Remaining') };
      table = new Map();
      tables.push(table);
      continue;
    }
    if (!cols) {
      if (cells[0] === 'Program of Study' && cells.includes('Display ID')) {
        summaryCols = { name: cells.indexOf('Display ID'), total: cells.indexOf('Count of Instances in Set'),
          satisfied: cells.indexOf('Satisfied Academic Requirements Label') };
      } else if (summaryCols && cells[summaryCols.name] && Number.isFinite(parseFloat(cells[summaryCols.total]))) {
        // A program row has its requirement count; the rows after the table
        // ("GPA Including Calvin Credit Exams", "Unused Registrations") don't,
        // even when their first cell holds a value.
        const num = i => { const n = parseFloat(cells[i]); return i !== -1 && Number.isFinite(n) ? n : null; };
        summary.push({ name: cells[summaryCols.name], total: num(summaryCols.total), satisfied: num(summaryCols.satisfied) });
      } else {
        summaryCols = null;
      }
      continue;
    }
    const get = key => (cols[key] === -1 ? '' : cells[cols[key]] || '');
    if (!get('requirement') || !TABLE_STATUS_RE.test(get('status'))) { cols = null; continue; }
    const hours = parseFloat(get('hours'));
    records.push({
      requirement: get('requirement'),
      item: get('item') || null,
      period: get('period') || null,
      hours: Number.isFinite(hours) ? hours : 0,
      grade: get('grade') || null,
      status: get('status'),
    });
    const name = cleanRequirementName(get('requirement'));
    if (!table.has(name)) table.set(name, { name, status: get('status'), remaining: get('remaining') || null, items: [] });
    if (get('item')) table.get(name).items.push({ text: get('item'), period: get('period') || null, hours: Number.isFinite(hours) ? hours : null, grade: get('grade') || null });
  }
  const named = summary.length === tables.length;
  const programs = tables.map((t, i) => ({ name: named ? summary[i].name : null,
    satisfied: named ? summary[i].satisfied : null, total: named ? summary[i].total : null, requirements: [...t.values()] }));
  return { ...progressFromRecords(records), programs };
}

// ========== FORMAT DETECTION ==========
export function detectInputFormat(text) {
  if (/RequirementSort and filter column|StatusSort and filter column|Satisfied With/.test(text)) {
    return 'progress';
  }
  if (/Opens in new window/.test(text)) {
    return 'transcript';
  }
  // Fallback: try both parsers, use whichever returns more courses
  const tCount = parseTranscript(text).length;
  const pCount = parseProgress(text).courses.filter(c => c.code !== null).length;
  return pCount > tCount ? 'progress' : 'transcript';
}
