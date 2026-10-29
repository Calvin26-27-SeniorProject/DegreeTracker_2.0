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

// Grades that earn no credit toward a requirement (catalog: F; I, incomplete;
// W, authorized withdrawal; N, unauthorized withdrawal; NR, no report). A
// completed incomplete keeps the I before its new grade ("IA-"), which counts
// as that grade, so "IF" earns no credit. Transfer CR counts.
export const NON_PASSING_GRADES = new Set(['F', 'I', 'W', 'N', 'NR']);
export function isNonPassingGrade(grade) {
  return NON_PASSING_GRADES.has(resolvedGrade(grade));
}
// "IA-" → "A-"; other grades unchanged (uppercased).
export function resolvedGrade(grade) {
  return (grade || '').toUpperCase().replace(/^I(?=[A-F])/, '');
}

// "2025 Spring" → sortable number; null when absent or unrecognized.
const TERM_ORDER = { winter: 0, interim: 0, spring: 1, summer: 2, fall: 3 };
function periodRank(period) {
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
const PROGRESS_COURSE_RE = /^([A-Z]{2,5})\s+(\d{3}[A-Z]?L?|CORE)\s*-\s*(.+)$/;
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
  const courseAttempts = [];
  const seenAttempts = new Set();
  for (const course of raw) {
    const key = `${course.code}\u0000${course.period || ''}`;
    if (course.code && !seenAttempts.has(key)) {
      seenAttempts.add(key);
      courseAttempts.push(course);
    }
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
// both a requirement and a status.
export function parseProgressRows(rows) {
  const records = [];
  const programs = [];
  let programCol = -1;
  let cols = null;
  for (const row of rows) {
    const cells = row.map(v => (v == null ? '' : String(v).replace(/ /g, ' ').trim()));
    if (cells.includes('Program of Study') && cells.includes('Display ID')) {
      programCol = cells.indexOf('Display ID');
      continue;
    }
    if (programCol !== -1) {
      if (cells[programCol] && cells.some(cell => /^\d+(\.\d+)?$/.test(cell))) {
        if (!programs.includes(cells[programCol])) programs.push(cells[programCol]);
        continue;
      }
      programCol = -1;
    }
    const requirementCol = cells.indexOf('Requirement');
    if (requirementCol !== -1 && cells.includes('Status')) {
      const col = name => cells.indexOf(name);
      cols = { requirement: requirementCol, status: col('Status'), item: col('Registrations Used'),
        period: col('Academic Period'), hours: col('Hours'), grade: col('Grade') };
      continue;
    }
    if (!cols) continue;
    const get = key => (cols[key] === -1 ? '' : cells[cols[key]] || '');
    if (!get('requirement') || !get('status')) { cols = null; continue; }
    const hours = parseFloat(get('hours'));
    records.push({
      requirement: get('requirement'),
      item: get('item') || null,
      period: get('period') || null,
      hours: Number.isFinite(hours) ? hours : 0,
      grade: get('grade') || null,
      status: get('status'),
    });
  }
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

// ========== UTILITIES ==========
export function slugify(name) {
  return 'ca-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

// ========== DOM PARSER ==========
// List items that join courses rather than name a sub-discipline.
const CONNECTORS = ['Or', 'One from', 'And'];
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };

export function normalizeText(s) {
  return (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

// "Complete coursework totaling at least 26 semester hours from at least five of
// the six Knowledge and Understanding categories, ..." → { minHours, minCategories, ofCategories }
export const KU_AGGREGATE_RE = /Complete coursework totaling at least (\d+) semester hours from at least (\w+) of the (\w+) Knowledge and Understanding categories/;
export function parseKuAggregate(instructions) {
  const m = (instructions || '').match(KU_AGGREGATE_RE);
  if (!m) return null;
  const num = w => /^\d+$/.test(w) ? parseInt(w) : (NUMBER_WORDS[w.toLowerCase()] ?? null);
  return { minHours: parseInt(m[1]), minCategories: num(m[2]), ofCategories: num(m[3]) };
}

// Accepts a root element (defaults to document in browser).
// In tests, pass a jsdom document or a container element with querySelectorAll.
export function parseCoreProgram(root) {
  if (!root) root = document;
  const blocks = root.querySelectorAll('div.acalog-core');
  const cats = [];
  let section = '';
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const h2 = b.querySelector('h2'), h3 = b.querySelector('h3'), h4 = b.querySelector('h4');
    // Only the block's own paragraphs: list items (e.g. the "Or" connector) contain <p>s too.
    const inst = normalizeText(Array.from(b.children).filter(el => el.tagName === 'P')
      .map(p => p.textContent).join(' '));
    const heading = h2 || h3 || h4;
    const coreId = heading?.querySelector('a[id^="core_"]')?.id || null;

    if (h2 && !h3 && !h4) {
      section = normalizeText(h2.textContent);
      if (heading) heading.id = slugify(section);
      const header = { type: 'section-header', section, instructions: inst, element: b, coreIndex: i, slug: slugify(section), coreId };
      const kuAggregate = parseKuAggregate(inst);
      if (kuAggregate) header.kuAggregate = kuAggregate;
      cats.push(header);
      continue;
    }

    let name = '';
    if (heading) {
      name = Array.from(heading.childNodes)
        .filter(n => n.nodeType === 3 || (n.nodeType === 1 && n.tagName === 'A'))
        .map(n => n.textContent.trim()).join('').trim();
      heading.id = slugify(name);
    }

    const isTag = h4 !== null;
    const rng = inst.match(/(\d+)[–-](\d+)\s+semester hours/);
    const disc = inst.match(/up to (\d+)\s+semester hours in any one discipline/);
    const minH = rng ? parseInt(rng[1]) : null;
    const maxH = rng ? parseInt(rng[2]) : null;
    const maxPD = disc ? parseInt(disc[1]) : null;
    const reqType = minH !== null ? 'hour-range' : 'pick-one';

    const ul = b.querySelector('ul');
    const courses = [];
    const subDisciplineElements = [];
    let curSub = null;
    let connector = null;
    // "A Or B C": each Or starts a new alternative; courses within one are all required.
    const alternatives = [[]];
    if (ul) {
      for (const li of ul.children) {
        if (li.classList.contains('acalog-adhoc')) {
          const t = normalizeText(li.textContent);
          if (CONNECTORS.includes(t)) {
            connector = t;
            if (t === 'Or') alternatives.push([]);
          } else {
            curSub = t;
            subDisciplineElements.push({ name: t, element: li });
          }
        } else if (li.classList.contains('acalog-course')) {
          const link = li.querySelector('a');
          const lt = link ? normalizeText(link.textContent) : '';
          const cm = lt.match(/^([A-Z]{2,5})\s+(\d{3}[A-Z]?)\s*-\s*(.+)$/);
          if (!cm) continue;
          const coid = (link.getAttribute('onclick') || '').match(/showCourse\('\d+',\s*'(\d+)'/)?.[1] || null;
          const course = { code: cm[1] + ' ' + cm[2], title: cm[3].trim(), subDiscipline: curSub, coid, element: li };
          if (connector) { course.connectorBefore = connector; connector = null; }
          courses.push(course);
          alternatives[alternatives.length - 1].push(course.code);
        }
      }
    }

    const cat = {
      type: isTag ? 'tag' : 'category', section, name, instructions: inst,
      reqType, minHours: minH, maxHours: maxH, maxPerDiscipline: maxPD,
      courses, subDisciplineElements, element: b, coreIndex: i, slug: slugify(name), coreId
    };
    if (alternatives.length > 1) cat.alternatives = alternatives;
    cats.push(cat);
  }
  return cats;
}

// ========== CATALOG INSTRUCTION RULES ==========
// Every sentence of catalog instructions must match exactly one rule here
// (test/test-catalog-claims.js enforces this for each saved catalog). A rule is
// either `checked` (analyze() enforces it, and `verify` confirms the parsed
// fields agree with the wording) or not, in which case the app shows the
// sentence as not checked (or as advice), with `note` explaining what that means.
export const INSTRUCTION_RULES = [
  {
    id: 'pick-one', checked: true,
    re: /^Complete one of the following courses\.$/,
    verify: cat => cat.reqType === 'pick-one' || 'expected a pick-one requirement',
  },
  {
    id: 'hour-range', checked: true,
    re: /^Complete coursework totaling (\d+)–(\d+) semester hours(?:, with up to (\d+) semester hours in any one discipline)?\.$/,
    verify: (cat, m) => (cat.reqType === 'hour-range' && cat.minHours === +m[1] && cat.maxHours === +m[2]
      && cat.maxPerDiscipline === (m[3] ? +m[3] : null)) || 'parsed hours disagree with the wording',
  },
  {
    id: 'discipline-headings', checked: true,
    re: /^Headings below designate the disciplines\.$/,
    verify: cat => (cat.courses.length > 0 && cat.courses.every(c => c.subDiscipline)) || 'every course should sit under a discipline heading',
  },
  {
    id: 'no-transfer', checked: true,
    re: /^(?:Transfer credit not accepted|This requirement must be completed at Calvin)\.$/,
    verify: cat => isTransferExcluded(cat) || 'transfer exclusion not detected',
  },
  {
    id: 'may-overlap', checked: true,
    re: /^(?:Engaged Citizenship Commitment courses may|May) overlap with other core requirements\.$/,
    // analyze() counts every course toward every requirement that lists it.
  },
  {
    id: 'three-tags', checked: true,
    re: /^Complete at least one tagged course in all three areas\.$/,
    verify: (cat, m, cats) => cats.filter(c => c.type === 'tag' && c.section === cat.section).length === 3
      || 'expected three tag requirements in this section',
  },
  {
    id: 'ku-aggregate', checked: true,
    re: /^Complete coursework totaling at least (\d+) semester hours from at least (\w+) of the (\w+) Knowledge and Understanding categories, including at least (\d+) semester hours from each of the following categories: (.+)\.$/,
    verify: (cat, m, cats) => {
      const agg = cat.kuAggregate;
      if (!agg || agg.minHours !== +m[1] || agg.ofCategories !== KU_NAMES.length) return 'K&U aggregate not parsed from the wording';
      for (const name of m[5].split(';').map(s => s.trim())) {
        const c = cats.find(x => x.name === name);
        if (!c || c.minHours !== +m[4]) return `"${name}" should require at least ${m[4]} hours`;
      }
      return true;
    },
  },
  {
    id: 'world-languages-ii', checked: false, partial: true,
    re: /^Complete (\d+)–(\d+) semester hours of coursework numbered 201 or higher in a language other than English OR complete 101-102 \(8 semester hours\) in a different language from coursework completed for World Languages I\.$/,
    verify: (cat, m) => (cat.minHours === +m[1] && cat.maxHours === +m[2]) || 'parsed hours disagree with the wording',
    note: 'Hours from the listed courses are checked; the 101–102 option in a second language is not.',
  },
  {
    id: 'calvin-foundations', checked: false,
    re: /^One Foundations of Christianity course must be completed at Calvin University\.$/,
    note: 'Transfer credit still counts here.',
  },
  {
    id: 'no-test-credit', checked: false,
    re: /^Test credit, including Advanced Placement, CLEP, and International Baccalaureate, may not satisfy Engaged Citizenship Commitment requirements\.$/,
    note: 'Workday transfer credit isn’t distinguished from test credit.',
  },
  {
    id: 'exemption', checked: false,
    re: /^(?:A student participating at Calvin in a varsity sport for two full seasons is exempt|Completion of ROTC or other military training exempts a student from both Health and Movement requirements|High school exemption from World Languages I is possible|To obtain a high school exemption, .+|\(Near\) native speakers of a language other than English are exempt from World Languages I)\.$/,
    note: 'Exemptions are recognized only when Academic Progress lists them.',
  },
  {
    id: 'advice', checked: false, advice: true,
    re: /^(?:\d+ courses have a prerequisite of \d+|Students are encouraged to take 4 semester hour courses when possible)\.$/,
    note: 'Advice, nothing to check.',
  },
];

// Split on sentence-ending periods, including ones the catalog runs together
// ("courses.Transfer credit not accepted.").
export function splitSentences(text) {
  return normalizeText(text).split(/(?<=\.)\s+|(?<=[a-z]\.)(?=[A-Z])/).filter(Boolean);
}

// → [{ text, rule, match }]; rule is null for wording no rule recognizes.
export function classifyInstructions(text) {
  return splitSentences(text).map(sentence => {
    for (const rule of INSTRUCTION_RULES) {
      const match = sentence.match(rule.re);
      if (match) return { text: sentence, rule, match };
    }
    return { text: sentence, rule: null, match: null };
  });
}

// Requirements whose courses may also count toward any other requirement.
// The tags say so in the catalog ("May overlap with other core requirements.");
// Rhetoric in Disciplines doesn't, but was confirmed 2026-10-15.
const OVERLAP_CONFIRMED_NAMES = ['Rhetoric in Disciplines'];
export function overlapConfirmed(cat) {
  return cat?.type === 'tag' || OVERLAP_CONFIRMED_NAMES.includes(cat?.name);
}

// Can one course count toward both requirements? Confirmed when either one allows overlap.
export function doubleCountConfirmed(catA, catB) {
  return overlapConfirmed(catA) || overlapConfirmed(catB);
}

export function isTransferExcluded(cat) {
  return classifyInstructions(cat.instructions).some(s => s.rule?.id === 'no-transfer');
}

// ========== ANALYSIS ==========
export const KU_NAMES = [
  'World Languages II', 'Arts, Oral Rhetoric, Visual Rhetoric', 'Humanities',
  'Mathematical Sciences', 'Natural Sciences', 'Social and Behavioral Sciences'
];

function normalizeCourseCode(code) {
  return (code || '').toUpperCase().replace(/\s+/g, ' ').trim();
}

function mergeLabHoursForAnalysis(transcript) {
  const byCode = new Map();
  const labs = [];
  const nonCourseEntries = [];

  for (const c of transcript) {
    if (!c.code) {
      nonCourseEntries.push(c);
      continue;
    }
    const labMatch = c.code.match(/^([A-Z]{2,5}\s+\d{3})L$/);
    if (labMatch) labs.push({ parentCode: labMatch[1], ...c });
    else if (!byCode.has(c.code)) byCode.set(c.code, { ...c, labCodes: [] });
  }

  for (const lab of labs) {
    if (byCode.has(lab.parentCode)) {
      const parent = byCode.get(lab.parentCode);
      parent.hours += lab.hours;
      parent.labCodes.push(lab.code);
    } else if (!byCode.has(lab.code)) byCode.set(lab.code, { ...lab, labCodes: [] });
  }

  return [...Array.from(byCode.values()), ...nonCourseEntries];
}

const KU_REQUIREMENT_RE = /Knowledge and Understanding/i;
// Workday Academic Progress requirement names → catalog requirement names.
// (K&U is one Workday requirement covering all six K&U categories.)
const WORKDAY_REQUIREMENTS = [
  [/Communities & Commitments/i, 'Community and Commitments'],
  [/^Foundations of Christianity I Core$/i, 'Foundations of Christianity I'],
  [/^Foundations of Christianity II Core$/i, 'Foundations of Christianity II'],
  [/Foundational Writing/i, 'Foundational Writing'],
  [/Health & Movement - Fitness/i, 'Health and Movement (Personal Fitness)'],
  [/Health & Movement - Recreation/i, 'Health and Movement (Leisure, Sport, and Skills)'],
  [/^World Languages I Core$/i, 'World Languages I'],
  [/Diversity & Difference/i, 'Diversity and Difference (Tag)'],
  [/Environmental Sustainability/i, 'Environmental Sustainability (Tag)'],
  [/Global Regions and Cultures/i, 'Global Regions and Cultures (Tag)'],
  [/^Rhetoric in Disciplines$/i, 'Rhetoric in Disciplines'],
  [/Contemporary Challenges and Enduring Questions/i, 'Contemporary Challenges and Enduring Questions'],
];
export function workdayRequirementCategory(requirement) {
  return WORKDAY_REQUIREMENTS.find(([re]) => re.test(requirement))?.[1] ?? null;
}

// Whether a progress parse (its workdayStatus) lists any core requirement.
// The whole-page export always does; a single table's Excel export (e.g. a
// major's requirements, or Overall Academic Progress) doesn't.
export function hasCoreRequirements(workdayStatus) {
  return [...workdayStatus.keys()].some(req => workdayRequirementCategory(req));
}
export const ONE_TABLE_EXPORT_MESSAGE = 'it doesn’t list any core requirements, so it’s probably the export of just one table. '
  + 'Use the Excel button at the very top right of the page, next to PDF, not the ones above each table';
// A placeholder counts where its subject's K&U courses do, if at least this
// share of them sit in one (category, sub-discipline).
const PLACEHOLDER_MIN_SHARE = 0.75;

// Guess the K&U category for a placeholder like "HIST CORE" from the subject
// prefix, using every course listed on the page or in extraCourses. Returns
// { category, subDiscipline } or null when no single home clearly dominates.
export function inferPlaceholderCategory(subject, cats, extraCourses = {}) {
  const counts = new Map();
  for (const cat of cats) {
    if (!KU_NAMES.includes(cat.name) || !cat.courses) continue;
    const codes = new Map(cat.courses.map(c => [c.code, c.subDiscipline]));
    for (const [code, sub] of Object.entries(extraCourses[cat.name] || {})) if (!codes.has(code)) codes.set(code, sub);
    for (const [code, sub] of codes) {
      if (code.split(' ')[0] !== subject) continue;
      const key = JSON.stringify([cat.name, sub ?? null]);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total < 2) return null;
  const [bestKey, best] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best / total < PLACEHOLDER_MIN_SHARE) return null;
  const [category, subDiscipline] = JSON.parse(bestKey);
  return { category, subDiscipline };
}

// Planned courses as transcript entries, for a projected analyze() run that
// counts them as if in progress. hoursOf(code) → { min, max } or undefined
// (hours from the course schedule); variable hours count their minimum, and
// unknown hours count 0 (still enough for a pick-one requirement).
export function plannedEntries(codes, hoursOf) {
  return codes.map(code => {
    const h = hoursOf(code);
    return { code, title: '', grade: '', hours: h ? h.min : 0, status: 'in-progress', isPlannedEntry: true,
      hoursKnown: !!h };
  });
}

// options.extraCourses: { [category name]: { [course code]: sub-discipline or null } }
// Additional course→requirement mappings (e.g. KNOWN_COURSE_CATEGORIES, the union
// of all known catalogs). Additive only: a taken course listed here counts toward
// the named requirement even if the page's own list omits it.
// options.workdayStatus: Map from parseProgress/parseProgressRows. Where Workday
// says Satisfied or Not Satisfied, analyze() compares it with its own result
// (analysis.workdayChecks).
export function analyze(cats, transcript, options = {}) {
  // Failed, withdrawn, incomplete, and audited courses count toward nothing.
  const notCounted = transcript.filter(c => c.code && isNonPassingGrade(c.grade));
  const mergedTranscript = mergeLabHoursForAnalysis(transcript.filter(c => !notCounted.includes(c)));
  const completedOrTransfer = mergedTranscript.filter(c => c.status !== 'in-progress' && c.status !== 'exemption');
  const inProgressCourses = mergedTranscript.filter(c => c.status === 'in-progress');
  const exemptionEntries = mergedTranscript.filter(c => c.status === 'exemption');
  const exemptedCategories = new Set(exemptionEntries.map(e => e.exemptionTarget).filter(Boolean));

  const takenSet = new Set(completedOrTransfer.map(c => c.code).filter(Boolean));
  const inProgressSet = new Set(inProgressCourses.map(c => c.code).filter(Boolean));
  // Combined set: courses that contribute hours (completed + transfer + in-progress)
  const allActiveSet = new Set([...takenSet, ...inProgressSet]);
  const takenMap = {};
  for (const c of mergedTranscript) { if (c.code) takenMap[c.code] = c; }
  // A merged lab still satisfies requirements that list the lab code itself
  // (e.g. ENGR 303L in the 2025-26 Environmental Sustainability tag).
  for (const c of mergedTranscript) {
    for (const lab of c.labCodes || []) {
      takenMap[lab] = c;
      (inProgressSet.has(c.code) ? inProgressSet : takenSet).add(lab);
      allActiveSet.add(lab);
    }
  }
  const extraCourses = options.extraCourses || {};
  const plannedSet = new Set(
    (options.plannedCourses || [])
      .map(code => normalizeCourseCode(code))
      .filter(code => code.length > 0 && !allActiveSet.has(code))
  );
  const c2c = {};
  for (const cat of cats) {
    if (!cat.courses || !cat.name) continue;
    for (const c of cat.courses) { if (!c2c[c.code]) c2c[c.code] = []; c2c[c.code].push(cat.name); }
  }
  const pageCatNames = new Set(cats.map(c => c.name).filter(Boolean));
  // Placeholder transfer credit: assumed category from its subject prefix.
  const assumedCourses = {};
  for (const c of mergedTranscript) {
    if (!c.isPlaceholder || c.status === 'exemption') continue;
    const guess = inferPlaceholderCategory(c.subject, cats, extraCourses);
    if (!guess) continue;
    (assumedCourses[guess.category] ??= {})[c.code] = guess.subDiscipline;
  }
  for (const [name, codes] of [...Object.entries(extraCourses), ...Object.entries(assumedCourses)]) {
    if (!pageCatNames.has(name)) continue;
    for (const code of Object.keys(codes)) {
      if (!c2c[code]) c2c[code] = [];
      if (!c2c[code].includes(name)) c2c[code].push(name);
    }
  }
  // Courses Workday's Academic Progress lists under a requirement: { [category]: Set(code) }.
  const workdayCourses = {};
  for (const c of mergedTranscript) {
    if (!c.code) continue;
    for (const req of c.requirements || []) {
      const name = workdayRequirementCategory(req);
      if (name) (workdayCourses[name] ??= new Set()).add(c.code);
    }
  }
  const kuAggregate = cats.find(c => c.kuAggregate)?.kuAggregate;
  const kuH = {}; let kuTotal = 0, kuCount = 0;
  const results = [];

  for (const cat of cats) {
    if (cat.type === 'section-header') { results.push({ ...cat, status: 'header' }); continue; }
    if (!cat.courses || cat.courses.length === 0) {
      // Check if this category is exempted even without courses
      if (exemptedCategories.has(cat.name)) {
        results.push({ ...cat, status: 'complete', hoursEarned: 0, hoursEffective: 0,
          hoursByDiscipline: {}, maxedDisciplines: new Set(), subDisciplines: null,
          takenCount: 0, inProgressCount: 0, plannedCount: 0, courseAnnotations: [], isExempt: true });
        continue;
      }
      results.push({ ...cat, status: 'info-only' }); continue;
    }
    // Check exemption first
    if (exemptedCategories.has(cat.name)) {
      const courseAnnotations = cat.courses.map(c => ({
        ...c, isTaken: allActiveSet.has(c.code), isInProgress: inProgressSet.has(c.code),
        isPlanned: false, isMultiSection: false, otherCategories: [],
        isMaxedDiscipline: false, grade: '', hours: 0
      }));
      results.push({ ...cat, status: 'complete', hoursEarned: 0, hoursEffective: 0,
        hoursByDiscipline: {}, maxedDisciplines: new Set(), subDisciplines: null,
        takenCount: 0, inProgressCount: 0, plannedCount: 0, courseAnnotations, isExempt: true });
      continue;
    }
    // Taken courses this page doesn't list here but another known catalog does.
    // They have no element on the page; render lists them in a note.
    const pageCodes = new Set(cat.courses.map(c => c.code));
    // "Transfer credit not accepted" / "must be completed at Calvin".
    const transferExcluded = isTransferExcluded(cat);
    const isExcludedTransfer = code => transferExcluded && takenMap[code]?.status === 'transfer';
    const countsHere = code => allActiveSet.has(code) && !isExcludedTransfer(code);
    const extraHere = Object.entries(extraCourses[cat.name] || {})
      .filter(([code]) => !pageCodes.has(code) && allActiveSet.has(code))
      .map(([code, subDiscipline]) => ({ code, title: takenMap[code]?.title || '', subDiscipline, element: null, isFromOtherCatalog: true }));
    for (const [code, subDiscipline] of Object.entries(assumedCourses[cat.name] || {})) {
      if (allActiveSet.has(code)) extraHere.push({ code, title: takenMap[code]?.title || '', subDiscipline, element: null, isAssumed: true });
    }
    // Pick-one: Workday is the official record, so a course it lists here counts
    // (overrides, section-specific tags). Not for hour-range (needs a sub-discipline); warned below.
    if (cat.reqType === 'pick-one') {
      for (const code of workdayCourses[cat.name] || []) {
        if (pageCodes.has(code) || extraHere.some(e => e.code === code) || !allActiveSet.has(code)) continue;
        extraHere.push({ code, title: takenMap[code]?.title || '', subDiscipline: null, element: null, isFromWorkday: true });
      }
    }
    const takenHere = [...cat.courses, ...extraHere].filter(c => countsHere(c.code));
    let hrsRaw = 0; const hByD = {};
    const counted = new Set();  // a lecture and its merged lab share one transcript entry
    for (const c of takenHere) {
      const tc = takenMap[c.code];
      if (!tc || counted.has(tc)) continue;
      counted.add(tc);
      hrsRaw += tc.hours; const d = c.subDiscipline || 'General'; hByD[d] = (hByD[d] || 0) + tc.hours;
    }
    // Hours that count: each discipline capped at maxPerDiscipline, then the total at maxHours.
    // Courses with no known discipline ('General') aren't capped together.
    const hrsCapped = cat.maxPerDiscipline
      ? Object.entries(hByD).reduce((s, [d, h]) => s + (d === 'General' ? h : Math.min(h, cat.maxPerDiscipline)), 0)
      : hrsRaw;
    const hrsEffective = (cat.maxHours !== null) ? Math.min(hrsCapped, cat.maxHours) : hrsCapped;
    const maxedD = new Set();
    if (cat.maxPerDiscipline) for (const [d, h] of Object.entries(hByD)) if (h >= cat.maxPerDiscipline) maxedD.add(d);
    const hasRemainingCourseOptions = cat.courses.some(c => !allActiveSet.has(c.code) && !maxedD.has(c.subDiscipline || 'General'));
    let status;
    if (cat.reqType === 'pick-one') {
      // With alternatives (ENGL 101 Or ENGL 100 + ENGL 102), one whole alternative is needed.
      const done = cat.alternatives
        ? cat.alternatives.some(alt => alt.every(countsHere)) || takenHere.some(c => c.isFromWorkday)
        : takenHere.length > 0;
      status = done ? 'complete' : 'incomplete';
    }
    else {
      const minReq = cat.minHours || 0;
      if (hrsCapped < minReq) status = 'incomplete';
      else if (hrsRaw === 0 && minReq === 0) status = 'optional-available';
      else if (cat.maxPerDiscipline && cat.maxHours !== null && hrsEffective < cat.maxHours && hasRemainingCourseOptions) status = 'satisfied';
      else status = 'complete';
    }
    if (KU_NAMES.includes(cat.name)) {
      kuH[cat.name] = { raw: hrsRaw, effective: hrsEffective, max: cat.maxHours };
      kuTotal += hrsEffective; if (hrsRaw > 0) kuCount++;
    }
    // Build sub-discipline details for categories with per-discipline limits
    let subDisciplines = null;
    if (cat.maxPerDiscipline && takenHere.length > 0) {
      subDisciplines = {};
      const allSubNames = new Set(cat.courses.map(c => c.subDiscipline).filter(Boolean));
      for (const dName of allSubNames) {
        const earned = hByD[dName] || 0;
        const isMaxed = maxedD.has(dName);
        const untakenCount = cat.courses.filter(c => c.subDiscipline === dName && !allActiveSet.has(c.code)).length;
        subDisciplines[dName] = { hoursEarned: earned, cap: cat.maxPerDiscipline, isMaxed, untakenCount };
      }
    }
    const courseAnnotations = [...cat.courses, ...extraHere].map(c => {
      const isTaken = takenSet.has(c.code);
      const isInProgress = inProgressSet.has(c.code);
      const isActive = isTaken || isInProgress;
      const isPlanned = !isActive && plannedSet.has(c.code);
      const allCats = c2c[c.code] || [];
      const otherCats = allCats.filter(n => n !== cat.name);
      const tc = takenMap[c.code];
      return { ...c, isTaken, isInProgress, isMultiSection: allCats.length > 1, otherCategories: otherCats,
        isPlanned, isExcludedTransfer: isExcludedTransfer(c.code),
        isMaxedDiscipline: maxedD.has(c.subDiscipline || 'General') && !isActive,
        grade: isActive ? (tc?.grade || '') : '', hours: isActive ? (tc?.hours || 0) : 0,
        isTransfer: tc?.status === 'transfer' };
    });
    // Hours more that could still count here: up to maxHours, and only in disciplines
    // below their cap that still have courses to take. null when there's no maximum.
    let roomHours = null;
    if (cat.reqType === 'hour-range' && cat.maxHours !== null) {
      roomHours = hasRemainingCourseOptions ? cat.maxHours - hrsEffective : 0;
      if (subDisciplines) {
        const disciplineRoom = Object.values(subDisciplines)
          .filter(d => d.untakenCount > 0).reduce((s, d) => s + Math.max(0, d.cap - d.hoursEarned), 0);
        roomHours = Math.min(roomHours, disciplineRoom);
      }
      roomHours = Math.max(0, roomHours);
    }
    const plannedCount = courseAnnotations.filter(c => c.isPlanned).length;
    const inProgressCount = courseAnnotations.filter(c => c.isInProgress).length;
    results.push({ ...cat, status, hoursEarned: hrsRaw, hoursEffective: hrsEffective,
      hoursByDiscipline: hByD, maxedDisciplines: maxedD, subDisciplines, takenCount: takenHere.length, roomHours,
      inProgressCount, plannedCount, courseAnnotations });
  }
  // Courses Workday counts toward a requirement (or placeholder core credit) that
  // don't count toward it here: the student's results may be understated.
  // `requirement` is a catalog requirement name, or 'K&U' for the K&U categories as a whole.
  const countedIn = {};
  for (const r of results) {
    const key = KU_NAMES.includes(r.name) ? 'K&U' : r.name;
    for (const c of r.courseAnnotations || []) {
      if (allActiveSet.has(c.code) && !c.isExcludedTransfer) (countedIn[key] ??= new Set()).add(c.code);
    }
  }
  const warnings = [];
  for (const c of mergedTranscript) {
    if (!c.code) continue;
    const warn = (requirement, reason) => {
      if (!countedIn[requirement]?.has(c.code)) warnings.push({ code: c.code, title: c.title, hours: c.hours, requirement, reason });
    };
    if (c.isPlaceholder) {
      warn('K&U', 'placeholder credit whose K&U category can\'t be inferred from "' + c.subject + '"');
      continue;
    }
    const claimed = new Set();
    for (const req of c.requirements || []) {
      const name = KU_REQUIREMENT_RE.test(req) ? 'K&U' : workdayRequirementCategory(req);
      if (name === 'K&U' || pageCatNames.has(name)) claimed.add(name);
    }
    for (const name of claimed) {
      // Transfer credit a requirement doesn't accept is flagged on its own.
      if (c.status === 'transfer' && name !== 'K&U' && isTransferExcluded(cats.find(x => x.name === name))) continue;
      if (exemptedCategories.has(name)) continue;
      warn(name, name === 'K&U'
        ? 'Workday counts it toward Knowledge and Understanding, but no known catalog lists it in a K&U category'
        : `Workday counts it toward ${name}, but no known catalog lists it there`);
    }
  }

  const kuResults = results.filter(r => KU_NAMES.includes(r.name));
  const kuMet = kuAggregate ? kuTotal >= kuAggregate.minHours && kuCount >= kuAggregate.minCategories
    && kuResults.every(r => r.status !== 'incomplete') : null;
  const kuSummary = { totalHours: kuTotal, requiredHours: kuAggregate?.minHours ?? null, categoriesUsed: kuCount,
    requiredCategories: kuAggregate?.minCategories ?? null, hoursByCategory: kuH, met: kuMet };

  // Workday's Status vs ours. Workday "Satisfied" by something that isn't a
  // course ("Military - 05/01/2025", an override with nothing listed) is taken
  // at its word ('accepted'). Any other disagreement is a 'mismatch': one of
  // us is wrong, and the app asks for a bug report. "In Progress" isn't
  // compared: Workday uses it for both partly done and done-once-courses-finish.
  const workdayChecks = [];
  for (const [workdayRequirement, { status: workdayStatus, items }] of options.workdayStatus || []) {
    if (workdayStatus !== 'Satisfied' && workdayStatus !== 'Not Satisfied') continue;
    const isKu = KU_REQUIREMENT_RE.test(workdayRequirement);
    const name = isKu ? 'K&U' : workdayRequirementCategory(workdayRequirement);
    const r = !isKu && results.find(x => x.name === name && x.status !== 'header' && x.status !== 'info-only');
    if (isKu ? kuMet === null : !r) continue;
    const ourStatus = isKu ? (kuMet ? 'met' : 'not met') : r.isExempt ? 'exempt' : r.status;
    const oursDone = isKu ? kuMet : r.isExempt || r.status === 'complete';
    if (oursDone === (workdayStatus === 'Satisfied')) continue;
    const accepted = workdayStatus === 'Satisfied'
      && (items.length === 0 || items.some(i => !PROGRESS_COURSE_RE.test(i)));
    workdayChecks.push({ requirement: name, workdayRequirement, workdayStatus, ourStatus, items,
      kind: accepted ? 'accepted' : 'mismatch' });
    if (accepted) {
      const workdaySatisfied = { workdayRequirement, items };
      if (isKu) { kuSummary.met = true; kuSummary.workdaySatisfied = workdaySatisfied; }
      else { r.status = 'complete'; r.workdaySatisfied = workdaySatisfied; }
    }
  }

  return {
    results,
    transcript,
    notCounted,
    workdayChecks,
    warnings,
    plannedCourses: Array.from(plannedSet),
    overrides: options.overrides || new Set(),
    exemptions: exemptionEntries,
    // Read from the catalog's K&U section wording; null if it couldn't be parsed.
    kuSummary,
  };
}
