// Standalone app entry (index.html). Everything runs in the browser:
// pasted Workday text and chosen .xlsx exports are parsed here and never sent
// anywhere.

import { parseTranscript, parseProgress, parseProgressRows, detectInputFormat, analyze, plannedEntries, hasCoreRequirements, programRequirements, findProgram, programForStudent, programFromCatalog, checkProgram, startPeriod, academicYearOf, catalogForStart, ONE_TABLE_EXPORT_MESSAGE } from './core.js';
import { readXlsxRows } from './xlsx.js';
import { KNOWN_COURSE_CATEGORIES } from './catalog-courses.js';
import { renderApp, renderPrograms, renderDashboard, renderWhatIf, programTabs, catalogLabel, isMinor } from './app-render.js';
import { buildTestCase, formatTestCase } from './test-case.js';
import { coreCourseUses, programCourseUses, mergeUses } from './course-uses.js';
import catalog25 from '../catalog/catalog-categories-25.json';
import catalog24 from '../catalog/catalog-categories-24.json';
import schedule from '../schedule/sections.json';
import bcs25 from '../programs/2025/computer-science/major/computer-science-bcs/bcs-25.json';
import csPlus25 from '../programs/2025/computer-science/major/computer-science-plus-bs/cs-plus-25.json';
import nursing25 from '../programs/2025/nursing/major/nursing-bsn/nursing-25.json';
import bcs24 from '../programs/2024/computer-science/major/computer-science-bcs/bcs-24.json';
import csPlus24 from '../programs/2024/computer-science/major/computer-science-plus-bs/cs-plus-24.json';
import nursing24 from '../programs/2024/nursing/major/nursing-bsn/nursing-24.json';
import bcs25Catalog from '../programs/2025/computer-science/major/computer-science-bcs/program.json';
import csPlus25Catalog from '../programs/2025/computer-science/major/computer-science-plus-bs/program.json';
import nursing25Catalog from '../programs/2025/nursing/major/nursing-bsn/program.json';
import bcs24Catalog from '../programs/2024/computer-science/major/computer-science-bcs/program.json';
import csPlus24Catalog from '../programs/2024/computer-science/major/computer-science-plus-bs/program.json';
import nursing24Catalog from '../programs/2024/nursing/major/nursing-bsn/program.json';
import { courseIndex, catalogCourseIndex } from './program-courses.js';
import courseIndexJson from '../programs/course-index.json';
import whatIfJson from '../programs/whatif-programs.json';

// Program files (majors, minors) checked against the catalog; see findProgram.
// Every checked program has a file for each catalog year the app offers, so its
// page looks the same whichever year is selected.
const PROGRAMS = [bcs25, csPlus25, nursing25, bcs24, csPlus24, nursing24];
// Titles and catalog links for each program file's courses, by "<id>-<catoid>".
const CATALOG_COURSES = new Map([
  [bcs25, bcs25Catalog], [csPlus25, csPlus25Catalog], [nursing25, nursing25Catalog],
  [bcs24, bcs24Catalog], [csPlus24, csPlus24Catalog], [nursing24, nursing24Catalog],
].map(([program, catalogProgram]) => [`${program.id}-${program.catoid}`, courseIndex(catalogProgram)]));

// Titles, hours, and catalog links for every course a program page lists, for
// programs without a checked file.
const COURSE_INDEX = catalogCourseIndex(courseIndexJson);

// Newest first.
const CATALOGS = [catalog25, catalog24];
const YEAR_KEY = 'calvin-core:catalog';

const state = {
  catoid: CATALOGS[0]._meta.catoid,
  text: '',
  // Parsed .xlsx export: { name, format, courses, overrides } or { name, error }.
  // Replaces the pasted text while set.
  file: null,
  plannedCourses: new Set(),
  // Format of the input last analyzed ('progress', 'progress-xlsx', 'transcript').
  format: null,
  // De-identified test case text for the current input (src/test-case.js).
  testCase: null,
  openLists: new Map(),
  // Workday's requirements outside the core, by program (programRequirements),
  // for the Major & minor tab; null when nothing has been read.
  programs: null,
  // Workday program name → { program, result }: this tool's check of each
  // program with a program file for the selected catalog year.
  programChecks: new Map(),
  // The student's courses as read, for the Major and Minor pages' course rows,
  // and every semester of each (for seminars counted by semester).
  records: [],
  attempts: [],
  // The What if tab's scenario: current programs taken out (by key) and
  // programs added (by name). A new record starts a new scenario.
  whatIf: { removed: new Set(), added: [] },
  // The input (file, or pasted text) the catalog year was last chosen for, and
  // the period that student started in (startPeriod), for the status line.
  yearChosenFor: null,
  startPeriod: null,
  // The catalog chosen for that period (catoid), and why when it isn't that
  // year's (none here is that old, or that new).
  chosenCatoid: null,
  chosenNote: '',
};

const $ = id => document.getElementById(id);

function loadYear() {
  try {
    const saved = localStorage.getItem(YEAR_KEY);
    if (CATALOGS.some(c => c._meta.catoid === saved)) state.catoid = saved;
  } catch { /* storage unavailable: use the newest catalog */ }
}

function saveYear() {
  try { localStorage.setItem(YEAR_KEY, state.catoid); } catch { /* ignore */ }
}

// The status line shows on both pages: under the drop zone and above the requirements.
function setStatus(message, kind) {
  for (const el of [$('status'), $('results-status')]) {
    el.textContent = message;
    el.className = 'status' + (kind ? ' status-' + kind : '');
  }
}

// Page 1 ("upload") or page 2 ("results"). Both are in index.html, since the
// courses live only in memory; index.html's CSS shows one by body[data-view].
function setView(view) {
  if (document.body.dataset.view === view) return;
  document.body.dataset.view = view;
  window.scrollTo(0, 0);
  if (view === 'results') highlightToc();
}

// Page 2's tabs, in order. Each tab button (#tab-<name>) controls one panel;
// index.html's CSS shows the panel for body[data-tab]. Overview and Calvin Core
// come first and What if last, always; between them the Major and Minor tabs
// follow the record (programTabs) and are rebuilt by syncProgramTabs, each one's
// panel being #<name>.
const FIXED_TABS = ['dashboard', 'core'];
const END_TABS = ['whatif'];
let TABS = [...FIXED_TABS, ...END_TABS];
const programTabIds = () => TABS.filter(t => !FIXED_TABS.includes(t) && !END_TABS.includes(t));
function setTab(tab) {
  // A tab that's gone (another record has fewer programs): back to Overview.
  if (!TABS.includes(tab)) tab = 'dashboard';
  document.body.dataset.tab = tab;
  for (const t of TABS) {
    const on = t === tab;
    $('tab-' + t).setAttribute('aria-selected', String(on));
    $('tab-' + t).tabIndex = on ? 0 : -1;
    if (!FIXED_TABS.includes(t) && !END_TABS.includes(t)) $(t).hidden = !on;
  }
  if (tab === 'core') highlightToc();
}

// One tab button and one panel per Major / Minor tab, after Calvin Core's.
function syncProgramTabs(tabs) {
  if (programTabIds().join(' ') !== tabs.map(t => t.id).join(' ')) {
    for (const t of programTabIds()) { $('tab-' + t)?.remove(); $(t)?.remove(); }
    const tablist = document.querySelector('.view-tabs');
    let panelAfter = $('results');
    for (const t of tabs) {
      const button = document.createElement('button');
      Object.assign(button, { type: 'button', id: 'tab-' + t.id, className: 'view-tab', tabIndex: -1 });
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', 'false');
      button.setAttribute('aria-controls', t.id);
      button.dataset.tab = t.id;
      button.addEventListener('click', () => setTab(t.id));
      tablist.insertBefore(button, $('tab-' + END_TABS[0]));
      const panel = document.createElement('section');
      Object.assign(panel, { id: t.id, className: 'tab-panel programs', hidden: true });
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', 'tab-' + t.id);
      panelAfter.after(panel);
      panelAfter = panel;
    }
    TABS = [...FIXED_TABS, ...tabs.map(t => t.id), ...END_TABS];
    setTab(document.body.dataset.tab);
  }
  // "Major 1" etc. say which program on hover.
  for (const t of tabs) {
    const button = $('tab-' + t.id);
    button.textContent = t.label;
    if (t.title !== t.label) button.title = t.title; else button.removeAttribute('title');
  }
}

function parseInput(text) {
  const format = detectInputFormat(text);
  if (format === 'progress') {
    const { courses, courseAttempts, overrides, workdayStatus } = parseProgress(text);
    return { format, courses, courseAttempts, overrides, workdayStatus };
  }
  return { format, courses: parseTranscript(text), overrides: undefined };
}

async function readExport(file) {
  try {
    const rows = readXlsxRows(await file.arrayBuffer());
    const { courses, courseAttempts, overrides, workdayStatus, programs } = parseProgressRows(rows);
    if (!hasCoreRequirements(workdayStatus)) throw new Error(ONE_TABLE_EXPORT_MESSAGE);
    return { name: file.name, format: 'progress-xlsx', courses, courseAttempts, overrides, workdayStatus, programs };
  } catch (err) {
    return { name: file.name, error: err.message };
  }
}

const SOURCE_LABELS = {
  progress: 'Academic Progress',
  transcript: 'Academic History',
  'progress-xlsx': 'Academic Progress export',
};

// The current input, parsed: the read .xlsx file or the pasted text; null when
// there's neither.
function currentInput() {
  const text = state.text.trim();
  return state.file ?? (text ? parseInput(text) : null);
}

// A new record selects the catalog of the year its student started in (the
// earliest period of a course taken here; transfer credit doesn't count). The
// year can still be changed by hand until another record is read.
function chooseYearFor(input) {
  const key = state.file ?? state.text.trim();
  if (!input || input.error || !key || key === state.yearChosenFor) return;
  state.yearChosenFor = key;
  state.whatIf = { removed: new Set(), added: [] };
  state.startPeriod = startPeriod(input.courseAttempts?.length ? input.courseAttempts : input.courses);
  const meta = catalogForStart(CATALOGS.map(c => c._meta), state.startPeriod);
  state.chosenCatoid = meta?.catoid ?? null;
  const gap = meta ? academicYearOf(state.startPeriod) - parseInt(meta.catalogYear, 10) : 0;
  state.chosenNote = gap < 0 ? ', the oldest one here' : gap > 0 ? ', the newest one here' : '';
  if (!meta || meta.catoid === state.catoid) return;
  state.catoid = meta.catoid;
  state.openLists.clear();
  $('catalog-select').value = meta.catoid;
}

function update() {
  const input = currentInput();
  chooseYearFor(input);
  const catalog = CATALOGS.find(c => c._meta.catoid === state.catoid);
  const meta = catalog._meta;
  document.querySelectorAll('[data-catalog-year]').forEach(el => { el.textContent = catalogLabel(meta); });
  document.querySelectorAll('[data-catalog-saved]').forEach(el => { el.textContent = meta.savedAt; });
  document.querySelectorAll('a[data-catalog-link]').forEach(el => { el.href = meta.sourceUrl; });

  let analysis = null;
  let projection = null;
  try {
    ({ analysis, projection } = analyzeInput(catalog, input));
  } catch (err) {
    // Never fail silently: whatever the input, say what went wrong.
    console.error('[Degree Tracker]', err);
    analysis = null;
    projection = null;
    setStatus(`Something went wrong reading your courses (${err.message}). `
      + 'Please report this, with the file or text you used if you can share it.', 'error');
  }
  renderResults(catalog, analysis, projection);
  $('show-results').hidden = !analysis;
  const backLabel = analysis ? 'Upload a different file' : 'Back to upload';
  $('back-button').setAttribute('aria-label', backLabel);
  $('back-button').title = backLabel;
  $('clear-results').hidden = !analysis;
  return analysis;
}

// Parses the current input and analyzes it, setting the status line.
// Returns { analysis, projection }: the analysis (null when there's nothing to
// show), and when courses are planned, the same counting them as in progress
// (hours from the course schedule).
function analyzeInput(catalog, input) {
  let analysis = null;
  let projection = null;
  state.format = input && !input.error ? input.format : null;
  state.programs = input && !input.error ? programRequirements(input) : null;
  state.programChecks = new Map();
  state.records = input && !input.error ? input.courses || [] : [];
  state.attempts = input && !input.error ? input.courseAttempts || [] : [];
  for (const g of state.programs || []) {
    // Requirements from the selected year's file; course options from the
    // newest year's; courses any year lists count (programForStudent).
    const base = g.name && findProgram(PROGRAMS, g.name, catalog._meta.catoid);
    if (!base) continue;
    const years = CATALOGS.map(c => findProgram(PROGRAMS, g.name, c._meta.catoid)).filter(Boolean);
    const program = programForStudent(base, years);
    state.programChecks.set(g.name, { program, result: checkProgram(program, input.courses, input.courseAttempts || []) });
  }
  if (input?.error) {
    setStatus(`Couldn’t read ${input.name}: ${input.error}. Choose the .xlsx file Workday exports from Academic Progress.`, 'error');
  } else if (input) {
    const { format, courses, overrides, workdayStatus } = input;
    if (courses.length === 0) {
      setStatus(state.file
        ? `No courses found in ${state.file.name}. Choose the .xlsx file Workday exports from Academic Progress.`
        : 'No courses found. Copy the whole Academic History or Academic Progress page from Workday and paste again.', 'error');
    } else {
      const options = { overrides, workdayStatus, extraCourses: KNOWN_COURSE_CATEGORIES };
      analysis = analyze(catalog.categories, courses, { ...options, plannedCourses: Array.from(state.plannedCourses) });
      state.plannedCourses = new Set(analysis.plannedCourses);
      // Each checked program again with the plan, for its cards' "With plan".
      for (const c of state.programChecks.values()) c.withPlan = withPlan(c.program);
      if (analysis.plannedCourses.length) {
        projection = analyze(catalog.categories,
          [...courses, ...plannedEntries(analysis.plannedCourses, code => schedule.hours[code])], options);
      }
      state.testCase = formatTestCase(buildTestCase({ catoid: catalog._meta.catoid, source: SOURCE_LABELS[format],
        courses, workdayStatus, overrides }, catalog.categories, KNOWN_COURSE_CATEGORIES));
      const n = courses.filter(c => c.code).length;
      const mismatches = analysis.workdayChecks.filter(c => c.kind === 'mismatch').length;
      setStatus(`Read ${n} course${n === 1 ? '' : 's'} from ${SOURCE_LABELS[format]}`
        + (state.file ? ` (${state.file.name}).` : '.')
        + (state.chosenCatoid === catalog._meta.catoid
          ? ` You started in ${state.startPeriod}, so requirements are from the ${catalogLabel(catalog._meta)} catalog`
            + state.chosenNote + '.' : '')
        + (format === 'transcript' ? ' Academic History isn’t fully supported; use Academic Progress if you can.' : '')
        + (mismatches ? ` Workday disagrees on ${mismatches} requirement${mismatches === 1 ? '' : 's'} (see the Calvin Core tab).` : '')
        + (analysis.warnings.length ? ` ${analysis.warnings.length} need checking (see the Calvin Core tab).` : ''),
        mismatches ? 'error' : format === 'transcript' ? 'warn' : 'ok');
    }
  } else {
    setStatus('', null);
  }
  return { analysis, projection };
}

function renderResults(catalog, analysis, projection) {
  const groups = state.programs || [];
  const hasInput = state.programs !== null;
  const checks = state.programChecks;
  const tabs = programTabs(groups, hasInput);
  // What else each course is listed for (each course row says): the core
  // requirements, and each major's and minor's, linking to its tab.
  state.coreUses = coreCourseUses(catalog, KNOWN_COURSE_CATEGORIES);
  const courseUses = mergeUses(state.coreUses, programCourseUses(tabs.flatMap(t => t.groups.map((g, i) =>
    ({ idPrefix: t.id, kind: t.kind, group: g, groupIndex: i, check: checks.get(g.name) })))));
  renderApp($('results'), {
    catalog, catalogs: CATALOGS, analysis, projection, schedule, openLists: state.openLists, tocRoot: $('toc'), courseUses,
    format: state.format, source: state.format && SOURCE_LABELS[state.format], testCase: state.testCase,
    onTogglePlanned: togglePlanned,
    onListToggle: (slug, open) => state.openLists.set(slug, open),
  });
  const programState = { hasInput, checks, schedule, openLists: state.openLists,
    onListToggle: (key, open) => state.openLists.set(key, open), catalogCourses: CATALOG_COURSES,
    courseIndex: COURSE_INDEX, records: state.records, courseUses,
    planned: state.plannedCourses, onTogglePlanned: hasInput ? togglePlanned : null };
  syncProgramTabs(tabs);
  for (const t of tabs) renderPrograms($(t.id), { ...programState, groups: t.groups, kind: t.kind, idPrefix: t.id });
  // The Overview shows each page's summary tiles, so it's drawn after them.
  const tabOf = new Map(tabs.flatMap(t => t.groups.map(g => [g, t.id])));
  renderDashboard($('dashboard'), { catalog, analysis, groups, checks, blocks: overviewBlocks(tabs),
    openLists: state.openLists, onListToggle: (key, open) => state.openLists.set(key, open), tabOf: g => tabOf.get(g) });
  state.lastCatalog = catalog;
  renderWhatIfTab();
  highlightToc();
}

// The majors and minors the What if tab can add, from the selected catalog
// year (programs/whatif-programs.json), and the check of one: the checked
// file's, as on its own tab, when there is one, else an estimate from its
// catalog page (programFromCatalog).
function whatIfCatalog() {
  return whatIfJson.catalogs[state.catoid] || Object.values(whatIfJson.catalogs)[0] || { programs: [] };
}
// A program's catalog entry: the selected year's, else (it was renamed, e.g.
// "History Major" in 2025–26 is "History, BA" in 2026–27) the newest year
// that has one by that name. { catoid, catalogYear, entry } or null.
function whatIfEntry(name) {
  const order = [state.catoid, ...CATALOGS.map(c => c._meta.catoid).filter(c => c !== state.catoid)];
  for (const catoid of order) {
    const cat = whatIfJson.catalogs[catoid];
    const entry = cat?.programs.find(p => p.name === name);
    if (entry) return { catoid, catalogYear: cat.catalogYear, entry };
  }
  return null;
}
function whatIfCheck(name) {
  const base = findProgram(PROGRAMS, name, state.catoid);
  let program = null;
  if (base) {
    const years = CATALOGS.map(c => findProgram(PROGRAMS, name, c._meta.catoid)).filter(Boolean);
    program = programForStudent(base, years);
  } else {
    const found = whatIfEntry(name);
    if (!found) return null;
    program = programFromCatalog(found.entry, found);
  }
  return { program, result: checkProgram(program, state.records, state.attempts), withPlan: withPlan(program) };
}

// A program checked with the planned courses counted as in progress (hours
// from the course schedule, else the catalog's credits), or null with no plan.
// A planned lecture's lab comes with it (a lecture counts only with its lab).
// The actual check never includes them.
function withPlan(program) {
  const codes = [...state.plannedCourses];
  if (!codes.length || !state.records.length) return null;
  const hoursOf = code => {
    if (schedule.hours[code]) return schedule.hours[code];
    const credits = parseFloat(COURSE_INDEX.get(code)?.credits);
    return Number.isFinite(credits) ? { min: credits, max: credits } : undefined;
  };
  // A planned lecture brings its corequisite lab, as registering for it would.
  const withLabs = [...new Set(codes.flatMap(c => [c, program.labs?.[c]].filter(Boolean)))]
    .filter(c => !state.records.some(r => r.code === c));
  return checkProgram(program, [...state.records, ...plannedEntries(withLabs, hoursOf)], state.attempts);
}

// Places an open "+N" list (position: fixed) under its chip, right edges
// lined up, kept inside the window; above the chip when there's no room below.
function placeUseList(d) {
  const list = d.querySelector('.use-more-list');
  if (!list) return;
  const chip = d.querySelector('summary').getBoundingClientRect();
  const { width, height } = list.getBoundingClientRect();
  const gap = 4;
  const margin = 8;
  const left = Math.min(Math.max(margin, chip.right - width), window.innerWidth - width - margin);
  const below = chip.bottom + gap;
  const top = below + height <= window.innerHeight - margin || chip.top - gap - height < margin ? below : chip.top - gap - height;
  list.style.left = `${Math.max(margin, left)}px`;
  list.style.top = `${top}px`;
}

// + Plan / Planned ✓ on any course row, Core or a program's: one plan for the whole page.
function togglePlanned(code) {
  if (state.plannedCourses.has(code)) state.plannedCourses.delete(code);
  else state.plannedCourses.add(code);
  update();
}

function renderWhatIfTab() {
  const groups = state.programs || [];
  const { removed, added } = state.whatIf;
  const cat = whatIfCatalog();
  const typeOf = name => whatIfEntry(name)?.entry.type;
  const current = groups.map((g, i) => ({ key: `current:${i}`, name: g.name, kind: isMinor(g) ? 'minor' : 'major',
    source: 'current', removed: removed.has(`current:${i}`), group: g, check: state.programChecks.get(g.name) || null }));
  const extra = added.map(name => ({ key: `added:${name}`, name, kind: typeOf(name) === 'Minor' || /\bMinor\b/.test(name) ? 'minor' : 'major',
    source: 'added', removed: false, group: { name, requirements: [] }, check: whatIfCheck(name) }));
  const inScenario = new Set([...current.filter(x => !x.removed), ...extra].map(x => x.name));
  renderWhatIf($('whatif'), {
    hasInput: state.programs !== null,
    catalogLabel: cat.catalogYear ? catalogLabel({ catalogYear: cat.catalogYear }) : '',
    programs: [...current, ...extra],
    options: cat.programs.filter(p => !inScenario.has(p.name)).map(p => ({ name: p.name, type: p.type })),
    schedule, openLists: state.openLists, onListToggle: (key, open) => state.openLists.set(key, open),
    catalogCourses: CATALOG_COURSES, courseIndex: COURSE_INDEX, records: state.records, coreUses: state.coreUses,
    planned: state.plannedCourses, onTogglePlanned: togglePlanned,
    onRemove: key => {
      if (key.startsWith('added:')) state.whatIf.added = added.filter(n => `added:${n}` !== key);
      else removed.add(key);
      renderWhatIfTab();
    },
    onRestore: key => { removed.delete(key); renderWhatIfTab(); },
    onAdd: name => {
      if (!name) return 'Type a major or minor first.';
      const match = cat.programs.find(p => p.name.toLowerCase() === name.toLowerCase());
      if (!match) return `No major or minor named “${name}” in this catalog. Pick one from the list.`;
      if (inScenario.has(match.name)) return `${match.name} is already in your scenario.`;
      const removedCurrent = current.find(x => x.removed && x.name === match.name);
      if (removedCurrent) removed.delete(removedCurrent.key);
      else state.whatIf.added = [...added, match.name];
      renderWhatIfTab();
      $('whatif').querySelector('.whatif-input')?.focus();
      return null;
    },
  });
}

// The summary block of the Core page and of each Major and Minor page, in that
// order, for the Overview to list under its donuts.
function overviewBlocks(tabs) {
  const blocks = [];
  const core = $('results').querySelector(':scope > .summary');
  if (core) blocks.push({ id: 'core', kind: 'core', title: 'Calvin Core', node: core });
  for (const t of tabs) {
    for (const node of $(t.id).querySelectorAll(':scope > .summary')) {
      const title = node.dataset.program || t.title;
      blocks.push({ id: `${t.kind}:${title}`, kind: t.kind, title, node });
    }
  }
  return blocks;
}

// After a file or paste reads: the Overview tab on page 2.
function showResults() {
  setTab('dashboard');
  setView('results');
}

// Marks the contents entry for the section or requirement at the top of the
// window.
function highlightToc() {
  let current = null;
  for (const el of $('results').querySelectorAll('.req-section, .req')) {
    if (el.getBoundingClientRect().top > 80) break;
    current = el.id;
  }
  for (const a of $('toc').querySelectorAll('.toc-link')) {
    const active = a.dataset.slug === current;
    a.classList.toggle('is-active', active);
    if (active) a.setAttribute('aria-current', 'location');
    else a.removeAttribute('aria-current');
  }
}

function initToc() {
  const toc = $('toc');
  const toggle = $('toc-toggle');
  const setOpen = open => {
    toc.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? 'Close contents' : 'Contents';
  };
  toggle.addEventListener('click', () => setOpen(!toc.classList.contains('is-open')));
  toc.addEventListener('click', e => { if (e.target.closest('a')) setOpen(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') setOpen(false); });

  let pending = false;
  window.addEventListener('scroll', () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      highlightToc();
      // Keep the active entry visible in the sidebar (scrolling only the
      // sidebar; scrollIntoView could scroll the page too).
      const active = toc.querySelector('.is-active');
      if (!active) return;
      const box = toc.getBoundingClientRect();
      const item = active.getBoundingClientRect();
      if (item.top < box.top) toc.scrollTop -= box.top - item.top + 24;
      else if (item.bottom > box.bottom) toc.scrollTop += item.bottom - box.bottom + 24;
    });
  }, { passive: true });
}

function init() {
  loadYear();
  initToc();
  const select = $('catalog-select');
  select.replaceChildren(...CATALOGS.map(c => {
    const opt = document.createElement('option');
    opt.value = c._meta.catoid;
    opt.textContent = catalogLabel(c._meta) + ' catalog';
    return opt;
  }));
  select.value = state.catoid;
  select.addEventListener('change', () => {
    state.catoid = select.value;
    state.openLists.clear();
    saveYear();
    update();
  });

  const input = $('workday-input');
  const fileInput = $('workday-file');
  // A paste that reads goes straight to the requirements; typing or editing
  // stays here (the "See my requirements" button appears instead).
  input.addEventListener('input', e => {
    state.text = input.value;
    state.file = null;
    fileInput.value = '';
    if (update() && e.inputType === 'insertFromPaste') showResults();
  });
  // "Paste text instead" opens the paste box.
  const pasteRoute = $('paste-route');
  const pasteButton = $('paste-button');
  pasteButton.addEventListener('click', () => {
    pasteRoute.open = !pasteRoute.open;
    if (pasteRoute.open) input.focus();
  });
  pasteRoute.addEventListener('toggle', () => pasteButton.setAttribute('aria-expanded', String(pasteRoute.open)));
  $('show-results').addEventListener('click', showResults);
  // Browsing without courses: the catalog's requirements, on the Calvin Core tab.
  $('browse-button').addEventListener('click', () => { setTab('core'); setView('results'); });
  $('back-button').addEventListener('click', () => setView('upload'));
  for (const t of [...FIXED_TABS, ...END_TABS]) $('tab-' + t).addEventListener('click', () => setTab(t));
  // The Overview cards' "See requirements" links open their tab; a tile in its
  // blocks opens the tab it came from, at that requirement.
  $('dashboard').addEventListener('click', e => {
    const tab = e.target.closest('[data-open-tab]')?.dataset.openTab;
    if (tab) { setTab(tab); window.scrollTo(0, 0); return; }
    const link = e.target.closest('.overview-block a[href^="#"]');
    const target = link && document.getElementById(link.getAttribute('href').slice(1));
    const panel = target?.closest('#results, .tab-panel.programs');
    const owner = panel && (panel.id === 'results' ? 'core' : panel.id);
    if (!owner) return;
    e.preventDefault();
    setTab(owner);
    target.scrollIntoView();
  });
  // An "Also listed for" link goes to that requirement on its own tab,
  // opening whatever it's folded in.
  // "+N" opens its list on hover (a mouse) or on a click or tap, floating above
  // whatever section it's in. Only one is open at a time.
  const canHover = window.matchMedia?.('(hover: hover)').matches;
  let closeTimer = null;
  const openUses = d => {
    clearTimeout(closeTimer);
    for (const o of document.querySelectorAll('details.use-more[open]')) if (o !== d) o.open = false;
    if (!d.open) d.open = true;
    placeUseList(d);
  };
  document.addEventListener('toggle', e => {
    if (e.target.matches?.('details.use-more') && e.target.open) openUses(e.target);
  }, true);
  if (canHover) {
    document.addEventListener('mouseover', e => {
      const d = e.target.closest?.('details.use-more');
      if (d) openUses(d);
    });
    document.addEventListener('mouseout', e => {
      const d = e.target.closest?.('details.use-more');
      if (!d || d.contains(e.relatedTarget)) return;
      // A moment to cross the gap between the chip and its list.
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => { d.open = false; }, 200);
    });
  }
  // The list is placed for where the chip is; scrolling or resizing closes it.
  const closeAllUses = () => { for (const d of document.querySelectorAll('details.use-more[open]')) d.open = false; };
  window.addEventListener('scroll', closeAllUses, { passive: true });
  window.addEventListener('resize', closeAllUses);
  document.addEventListener('click', e => {
    // With a mouse, hovering already opened it: a click on the chip keeps it open.
    const chip = canHover && e.target.closest('details.use-more > summary');
    if (chip) { e.preventDefault(); openUses(chip.parentElement); return; }
    // An open "+N" list closes on a click outside it or on one of its links.
    for (const d of document.querySelectorAll('details.use-more[open]')) {
      if (!d.contains(e.target) || e.target.closest('.use-more-list a')) d.open = false;
    }
    const link = e.target.closest('a.use-link[href^="#"]');
    const target = link && document.getElementById(link.getAttribute('href').slice(1));
    const panel = target?.closest('#results, .tab-panel.programs, #whatif');
    if (!panel) return;
    e.preventDefault();
    setTab(panel.id === 'results' ? 'core' : panel.id);
    for (let el = target; el && el !== panel; el = el.parentElement) {
      if (el.tagName === 'DETAILS' && !el.open) el.open = true;
      if (el.classList.contains('is-collapsed')) el.querySelector(':scope > header .req-collapse')?.click();
    }
    target.scrollIntoView();
  });
  // Arrow keys move between tabs (WAI-ARIA tabs pattern).
  document.querySelector('.view-tabs').addEventListener('keydown', e => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = TABS[(TABS.indexOf(document.body.dataset.tab) + step + TABS.length) % TABS.length];
    setTab(next);
    $('tab-' + next).focus();
  });

  const dropZone = $('drop-zone');
  async function loadFile(file) {
    if (!file) return;
    input.value = '';
    state.text = '';
    state.plannedCourses.clear();
    setStatus(`Reading ${file.name}…`, null);
    state.file = await readExport(file);
    // Let the same file be chosen again (e.g. after re-exporting).
    fileInput.value = '';
    // Read: on to the requirements. Not read: stay here, where the status says why.
    if (update()) showResults();
  }
  fileInput.addEventListener('change', () => loadFile(fileInput.files[0]));
  // Dropping a file anywhere on the input card reads it instead of opening
  // it; the drop zone lights up while a file is over the card.
  const card = $('input-card');
  let dragDepth = 0;
  const hasFiles = e => Array.from(e.dataTransfer?.types || []).includes('Files');
  card.addEventListener('dragenter', e => {
    if (!hasFiles(e)) return;
    dragDepth++;
    dropZone.classList.add('dragging');
  });
  card.addEventListener('dragover', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  card.addEventListener('dragleave', e => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropZone.classList.remove('dragging');
  });
  card.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    dropZone.classList.remove('dragging');
    loadFile(e.dataTransfer.files[0]);
  });

  // Clear (on either page) forgets the courses and returns to the upload page.
  function clearInput() {
    input.value = '';
    state.text = '';
    state.file = null;
    fileInput.value = '';
    state.plannedCourses.clear();
    state.openLists.clear();
    state.yearChosenFor = null;
    state.startPeriod = null;
    state.chosenCatoid = null;
    state.whatIf = { removed: new Set(), added: [] };
    update();
    setTab('core');
    setView('upload');
  }
  $('clear-button').addEventListener('click', clearInput);
  $('clear-results').addEventListener('click', clearInput);
  update();
}

init();
