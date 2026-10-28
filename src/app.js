// Standalone app entry (index.html). Everything runs in the browser:
// pasted Workday text and chosen .xlsx exports are parsed here and never sent
// anywhere.

import { parseTranscript, parseProgress, parseProgressRows, detectInputFormat, analyze, plannedEntries, hasCoreRequirements, ONE_TABLE_EXPORT_MESSAGE } from './core.js';
import { readXlsxRows } from './xlsx.js';
import { KNOWN_COURSE_CATEGORIES } from './catalog-courses.js';
import { renderApp, catalogLabel } from './app-render.js';
import { renderMajor } from './major-app.js';
import { buildTestCase, formatTestCase } from './test-case.js';
import catalog25 from '../catalog/catalog-categories-25.json';
import catalog24 from '../catalog/catalog-categories-24.json';
import schedule from '../schedule/sections.json';
import major from '../majors/bcs.json';
import majorCourseOptions from '../majors/bcs-course-options.json';

// Newest first.
const CATALOGS = [catalog25, catalog24];
const YEAR_KEY = 'calvin-core:catalog';

const state = {
  catoid: CATALOGS[0]._meta.catoid,
  activeTab: location.hash === '#major' || location.hash.startsWith('#bcs-') ? 'major' : 'core',
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

function setStatus(message, kind) {
  const el = $('status');
  el.textContent = message;
  el.className = 'status' + (kind ? ' status-' + kind : '');
}

function parseInput(text) {
  const format = detectInputFormat(text);
  if (format === 'progress') {
    const { courses, courseAttempts, overrides, workdayStatus } = parseProgress(text);
    return { format, courses, courseAttempts, overrides, workdayStatus };
  }
  return { format, courses: parseTranscript(text), courseAttempts: [], overrides: undefined };
}

async function readExport(file) {
  try {
    const rows = readXlsxRows(await file.arrayBuffer());
    const { courses, courseAttempts, overrides, workdayStatus } = parseProgressRows(rows);
    if (!hasCoreRequirements(workdayStatus)) throw new Error(ONE_TABLE_EXPORT_MESSAGE);
    return { name: file.name, format: 'progress-xlsx', courses, courseAttempts, overrides, workdayStatus };
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
  let courses = [];
  let courseAttempts = [];
  try {
    ({ analysis, projection, courses, courseAttempts } = analyzeInput(catalog));
  } catch (err) {
    // Never fail silently: whatever the input, say what went wrong.
    console.error('[Core Planner]', err);
    analysis = null;
    projection = null;
    setStatus(`Something went wrong reading your courses (${err.message}). `
      + 'Please report this, with the file or text you used if you can share it.', 'error');
  }
  renderResults(catalog, analysis, projection, courses, courseAttempts);
}

// Parses the current input and analyzes it, setting the status line.
// Returns { analysis, projection }: the analysis (null when there's nothing to
// show), and when courses are planned, the same counting them as in progress
// (hours from the course schedule).
function analyzeInput(catalog) {
  let analysis = null;
  let projection = null;
  let courses = [];
  let courseAttempts = [];
  const text = state.text.trim();
  const input = state.file ?? (text ? parseInput(text) : null);
  state.format = input && !input.error ? input.format : null;
  if (input?.error) {
    setStatus(`Couldn’t read ${input.name}: ${input.error}. Choose the .xlsx file Workday exports from Academic Progress.`, 'error');
  } else if (input) {
    const { format, overrides, workdayStatus } = input;
    courses = input.courses;
    courseAttempts = input.courseAttempts || [];
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
        + (mismatches ? ` Workday disagrees on ${mismatches} requirement${mismatches === 1 ? '' : 's'} (see below).` : '')
        + (analysis.warnings.length ? ` ${analysis.warnings.length} need checking (see below).` : ''),
        mismatches ? 'error' : format === 'transcript' ? 'warn' : 'ok');
    }
  } else {
    setStatus('', null);
  }
  return { analysis, projection, courses, courseAttempts };
}

function renderResults(catalog, analysis, projection, courses, courseAttempts) {
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
  renderMajor($('major-results'), major, majorCourseOptions, courses, catalog, schedule, courseAttempts);
  highlightToc();
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

function activateTab(tabName) {
  state.activeTab = tabName === 'major' ? 'major' : 'core';
  document.body.dataset.activeTab = state.activeTab;
  document.querySelectorAll('[role="tab"][data-tab]').forEach(tab => {
    const selected = tab.dataset.tab === state.activeTab;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  $('core-panel').hidden = state.activeTab !== 'core';
  $('major-panel').hidden = state.activeTab !== 'major';
  $('app-layout').classList.toggle('is-major', state.activeTab === 'major');
}

function switchTab(tabName) {
  const selected = tabName === 'major' ? 'major' : 'core';
  activateTab(selected);
  const hash = selected === 'major' ? '#major' : '#core';
  if (location.hash !== hash) location.hash = hash;
}

function tabFromHash() {
  return /^#(?:major|bcs(?:-|$))/.test(location.hash) ? 'major' : 'core';
}

function init() {
  loadYear();
  initToc();
  document.querySelectorAll('[role="tab"][data-tab]').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    tab.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const next = event.key === 'ArrowRight' ? 'major' : 'core';
      switchTab(next);
      document.querySelector(`[role="tab"][data-tab="${next}"]`).focus();
    });
  });
  window.addEventListener('hashchange', () => activateTab(tabFromHash()));
  window.addEventListener('popstate', () => activateTab(tabFromHash()));
  activateTab(state.activeTab);
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
  input.addEventListener('input', () => {
    state.text = input.value;
    state.file = null;
    fileInput.value = '';
    update();
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
    update();
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

  $('clear-button').addEventListener('click', () => {
    input.value = '';
    state.text = '';
    state.file = null;
    fileInput.value = '';
    state.plannedCourses.clear();
    state.openLists.clear();
    update();
    input.focus();
  });
  update();
}

init();
