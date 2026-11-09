// Standalone app entry (index.html). Everything runs in the browser:
// pasted Workday text and chosen .xlsx exports are parsed here and never sent
// anywhere.

import { parseTranscript, parseProgress, parseProgressRows, detectInputFormat, analyze, plannedEntries, hasCoreRequirements, programRequirements, findProgram, checkProgram, ONE_TABLE_EXPORT_MESSAGE } from './core.js';
import { readXlsxRows } from './xlsx.js';
import { KNOWN_COURSE_CATEGORIES } from './catalog-courses.js';
import { renderApp, renderPrograms, renderDashboard, isMinor, catalogLabel } from './app-render.js';
import { buildTestCase, formatTestCase } from './test-case.js';
import catalog25 from '../catalog/catalog-categories-25.json';
import catalog24 from '../catalog/catalog-categories-24.json';
import schedule from '../schedule/sections.json';
import bcs25 from '../catalog/programs/bcs-25.json';
import csPlus25 from '../catalog/programs/cs-plus-25.json';
import nursing25 from '../catalog/programs/nursing-25.json';

// Program files (majors, minors) checked against the catalog; see findProgram.
const PROGRAMS = [bcs25, csPlus25, nursing25];

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
// index.html's CSS shows the panel for body[data-tab].
const TABS = ['dashboard', 'core', 'major', 'minor'];
function setTab(tab) {
  document.body.dataset.tab = tab;
  for (const t of TABS) {
    const on = t === tab;
    $('tab-' + t).setAttribute('aria-selected', String(on));
    $('tab-' + t).tabIndex = on ? 0 : -1;
  }
  if (tab === 'core') highlightToc();
}

function parseInput(text) {
  const format = detectInputFormat(text);
  if (format === 'progress') {
    const { courses, overrides, workdayStatus } = parseProgress(text);
    return { format, courses, overrides, workdayStatus };
  }
  return { format, courses: parseTranscript(text), overrides: undefined };
}

async function readExport(file) {
  try {
    const rows = readXlsxRows(await file.arrayBuffer());
    const { courses, overrides, workdayStatus, programs } = parseProgressRows(rows);
    if (!hasCoreRequirements(workdayStatus)) throw new Error(ONE_TABLE_EXPORT_MESSAGE);
    return { name: file.name, format: 'progress-xlsx', courses, overrides, workdayStatus, programs };
  } catch (err) {
    return { name: file.name, error: err.message };
  }
}

const SOURCE_LABELS = {
  progress: 'Academic Progress',
  transcript: 'Academic History',
  'progress-xlsx': 'Academic Progress export',
};

function update() {
  const catalog = CATALOGS.find(c => c._meta.catoid === state.catoid);
  const meta = catalog._meta;
  document.querySelectorAll('[data-catalog-year]').forEach(el => { el.textContent = catalogLabel(meta); });
  document.querySelectorAll('[data-catalog-saved]').forEach(el => { el.textContent = meta.savedAt; });
  document.querySelectorAll('a[data-catalog-link]').forEach(el => { el.href = meta.sourceUrl; });

  let analysis = null;
  let projection = null;
  try {
    ({ analysis, projection } = analyzeInput(catalog));
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
function analyzeInput(catalog) {
  let analysis = null;
  let projection = null;
  const text = state.text.trim();
  const input = state.file ?? (text ? parseInput(text) : null);
  state.format = input && !input.error ? input.format : null;
  state.programs = input && !input.error ? programRequirements(input) : null;
  state.programChecks = new Map();
  for (const g of state.programs || []) {
    const program = g.name && findProgram(PROGRAMS, g.name, catalog._meta.catoid);
    if (program) state.programChecks.set(g.name, { program, result: checkProgram(program, input.courses) });
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
  renderApp($('results'), {
    catalog, catalogs: CATALOGS, analysis, projection, schedule, openLists: state.openLists, tocRoot: $('toc'),
    format: state.format, source: state.format && SOURCE_LABELS[state.format], testCase: state.testCase,
    onTogglePlanned: code => {
      if (state.plannedCourses.has(code)) state.plannedCourses.delete(code);
      else state.plannedCourses.add(code);
      update();
    },
    onListToggle: (slug, open) => state.openLists.set(slug, open),
  });
  const groups = state.programs || [];
  const hasInput = state.programs !== null;
  const checks = state.programChecks;
  renderDashboard($('dashboard'), { catalog, analysis, groups, checks });
  renderPrograms($('major'), { groups: groups.filter(g => !isMinor(g)), hasInput, kind: 'major', checks, schedule });
  renderPrograms($('minor'), { groups: groups.filter(isMinor), hasInput, kind: 'minor', checks, schedule });
  highlightToc();
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
  for (const t of TABS) $('tab-' + t).addEventListener('click', () => setTab(t));
  // The Overview cards' "See requirements" links open their tab.
  $('dashboard').addEventListener('click', e => {
    const tab = e.target.closest('[data-open-tab]')?.dataset.openTab;
    if (tab) { setTab(tab); window.scrollTo(0, 0); }
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
    update();
    setTab('core');
    setView('upload');
  }
  $('clear-button').addEventListener('click', clearInput);
  $('clear-results').addEventListener('click', clearInput);
  update();
}

init();
