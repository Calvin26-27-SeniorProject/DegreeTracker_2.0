import { parseTranscript, parseProgress, parseProgressRows, detectInputFormat, parseCoreProgram, analyze,
  hasCoreRequirements, ONE_TABLE_EXPORT_MESSAGE } from './core.js';
import { readXlsxRows } from './xlsx.js';
import { clearRenderedState, render } from './render.js';
import { KNOWN_COURSE_CATEGORIES } from './catalog-courses.js';
import { buildTestCase, formatTestCase } from './test-case.js';

// Core Program pages, newest first. Requirements are read from whichever page
// is open, so a student should use the catalog for their entry year.
const CATALOG_PAGES = [
  { catoid: '25', navoid: '803', label: '2026–27' },
  { catoid: '24', navoid: '780', label: '2025–26' },
];
const UI_IDS = {
  panel: 'ca-launcher-panel',
  details: 'ca-launcher-details',
  textarea: 'ca-transcript-input',
  file: 'ca-export-input',
  status: 'ca-launcher-status',
  styles: 'ca-launcher-styles',
};

const plannedCourses = new Set();

function ensureLauncherStyles() {
  if (document.getElementById(UI_IDS.styles)) return;
  const style = document.createElement('style');
  style.id = UI_IDS.styles;
  style.textContent = `
    #${UI_IDS.panel} {
      margin: 16px 0;
      padding: 14px 16px;
      border: 1px solid #cfd8dc;
      border-radius: 10px;
      background: linear-gradient(180deg, #f8fbfc, #eef5f6);
      box-shadow: 0 1px 6px rgba(0, 0, 0, 0.06);
      font-family: system-ui, -apple-system, sans-serif;
    }
    #${UI_IDS.panel} details {
      margin: 0;
    }
    #${UI_IDS.panel} summary {
      cursor: pointer;
      font-weight: 700;
      color: #163642;
      list-style: none;
    }
    #${UI_IDS.panel} summary::-webkit-details-marker {
      display: none;
    }
    #${UI_IDS.panel} summary::before {
      content: '▸';
      display: inline-block;
      margin-right: 8px;
      transition: transform 0.15s ease;
    }
    #${UI_IDS.panel} details[open] summary::before {
      transform: rotate(90deg);
    }
    #${UI_IDS.panel} p {
      margin: 10px 0 0;
      color: #35515a;
      line-height: 1.45;
      font-size: 13px;
    }
    #${UI_IDS.textarea} {
      width: 100%;
      min-height: 140px;
      margin-top: 12px;
      padding: 10px 12px;
      border: 1px solid #aabcc3;
      border-radius: 8px;
      resize: vertical;
      box-sizing: border-box;
      font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
      background: #fff;
    }
    .ca-launcher-actions {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
      margin-top: 10px;
    }
    .ca-launcher-button {
      border: 1px solid #244b57;
      background: #244b57;
      color: #fff;
      border-radius: 999px;
      padding: 7px 14px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }
    .ca-launcher-button:hover {
      background: #1d3e48;
    }
    .ca-launcher-button-secondary {
      background: #fff;
      color: #244b57;
    }
    .ca-launcher-button-secondary:hover {
      background: #f3f7f8;
    }
    .ca-launcher-file {
      position: relative;
    }
    .ca-launcher-file input {
      position: absolute;
      inset: 0;
      width: 100%;
      opacity: 0;
      cursor: pointer;
    }
    .ca-launcher-file:focus-within {
      outline: 2px solid #244b57;
      outline-offset: 2px;
    }
    #${UI_IDS.status} {
      font-size: 12px;
      color: #35515a;
    }
    #${UI_IDS.status}.ca-status-success {
      color: #2d8a4e;
    }
    #${UI_IDS.status}.ca-status-error {
      color: #9f2d2d;
    }
  `;
  document.head.appendChild(style);
}

function setStatus(message, kind) {
  const status = document.getElementById(UI_IDS.status);
  if (!status) return;
  status.textContent = message;
  status.className = '';
  if (kind === 'success') status.classList.add('ca-status-success');
  if (kind === 'error') status.classList.add('ca-status-error');
}

function catalogPageUrl(page) {
  return `/content.php?catoid=${page.catoid}&navoid=${page.navoid}`;
}

function currentCatalogPage() {
  const url = new URL(window.location.href);
  if (url.pathname !== '/content.php') return null;
  return CATALOG_PAGES.find(page => url.searchParams.get('catoid') === page.catoid
    && url.searchParams.get('navoid') === page.navoid) || null;
}

function catalogNoteHtml(current) {
  const others = CATALOG_PAGES.filter(page => page !== current)
    .map(page => `<a href="${catalogPageUrl(page)}">${page.label}</a>`);
  return `Checking against the <strong>${current.label}</strong> core requirements. `
    + `Use the catalog for the year you entered Calvin`
    + (others.length > 0 ? ` (switch to ${others.join(', ')})` : '') + '.';
}

function runAnnotation(text) {
  const normalized = (text || '').trim();
  if (normalized.length === 0) {
    setStatus('Paste your Workday Academic Progress to see your core opportunities.', null);
    return;
  }

  const format = detectInputFormat(normalized);
  if (format === 'progress') {
    const { courses, overrides, workdayStatus } = parseProgress(normalized);
    showAnalysis({ format, courses, overrides, workdayStatus });
  } else {
    showAnalysis({ format, courses: parseTranscript(normalized) });
  }
}

// Reads a Workday Academic Progress .xlsx export locally.
async function runExport(file) {
  setStatus(`Reading ${file.name}…`, null);
  let input;
  try {
    const { courses, overrides, workdayStatus } = parseProgressRows(readXlsxRows(await file.arrayBuffer()));
    if (!hasCoreRequirements(workdayStatus)) throw new Error(ONE_TABLE_EXPORT_MESSAGE);
    input ={ format: 'progress-xlsx', name: file.name, courses, overrides, workdayStatus };
  } catch (err) {
    clearRenderedState();
    setStatus(`Couldn’t read ${file.name}: ${err.message}. Choose the .xlsx file Workday exports from Academic Progress.`, 'error');
    return;
  }
  plannedCourses.clear();
  showAnalysis(input);
}

function showAnalysis(input) {
  const { format, courses, overrides, workdayStatus } = input;
  if (courses.length === 0) {
    clearRenderedState();
    setStatus(input.name
      ? `No courses found in ${input.name}. Choose the .xlsx file Workday exports from Academic Progress.`
      : 'Could not parse any courses. Copy from Workday Academic Record (Academic History or Academic Progress) and paste the full content here.', 'error');
    return;
  }

  const categories = parseCoreProgram();
  const analysis = analyze(categories, courses, {
    plannedCourses: Array.from(plannedCourses), overrides, workdayStatus, extraCourses: KNOWN_COURSE_CATEGORIES,
  });
  const testCase = formatTestCase(buildTestCase({ catoid: currentCatalogPage()?.catoid, source: 'catalog page, ' + format,
    courses, workdayStatus, overrides }, categories, KNOWN_COURSE_CATEGORIES));
  const appliedPlanned = new Set(analysis.plannedCourses || []);
  plannedCourses.clear();
  for (const code of appliedPlanned) plannedCourses.add(code);
  render(analysis, {
    testCase,
    source: { progress: 'Academic Progress (pasted, catalog page)', 'progress-xlsx': 'Academic Progress export (catalog page)',
      transcript: 'Academic History (pasted, catalog page)' }[format],
    onTogglePlanned: (courseCode) => {
      if (plannedCourses.has(courseCode)) plannedCourses.delete(courseCode);
      else plannedCourses.add(courseCode);
      showAnalysis(input);
    }
  });
  const inProgressCount = courses.filter(c => c.status === 'in-progress').length;
  const statusParts = [
    'Progress updated: ' + courses.filter(c => c.code).length + ' courses',
    analysis.kuSummary.totalHours + '/' + analysis.kuSummary.requiredHours + ' K&U hours',
    analysis.kuSummary.categoriesUsed + '/' + analysis.kuSummary.requiredCategories + ' K&U categories',
  ];
  if (inProgressCount > 0) statusParts.push(inProgressCount + ' in-progress');
  if (plannedCourses.size > 0) statusParts.push(plannedCourses.size + ' planned');
  const mismatches = analysis.workdayChecks.filter(c => c.kind === 'mismatch').length;
  if (mismatches > 0) statusParts.push('Workday disagrees on ' + mismatches + ' requirement(s): see the red box below');
  if (format === 'transcript') statusParts.push('Academic History isn\u2019t fully supported; use Academic Progress if you can');
  if (analysis.warnings.length > 0) statusParts.push(analysis.warnings.length + ' course(s) Workday counts that we couldn\u2019t match (see warning below)');
  setStatus(statusParts.join(', ') + '.', mismatches > 0 ? 'error' : 'success');
  console.log('[Core Annotator]', courses.length, 'courses (' + format + '):', courses.filter(c => c.code).map(c => c.code + '(' + c.hours + 'h)'));
  console.log('[Core Annotator] K&U:', analysis.kuSummary);
  if (inProgressCount > 0) console.log('[Core Annotator] In-progress:', courses.filter(c => c.status === 'in-progress').map(c => c.code));
  if (plannedCourses.size > 0) console.log('[Core Annotator] Planned:', Array.from(plannedCourses));
}

function mountLauncher(catalogPage) {
  if (document.getElementById(UI_IDS.panel)) return;
  const firstCore = document.querySelector('div.acalog-core');
  if (!firstCore || !firstCore.parentElement) return;

  ensureLauncherStyles();

  const panel = document.createElement('section');
  panel.id = UI_IDS.panel;
  panel.innerHTML = `
    <details id="${UI_IDS.details}">
      <summary>Calvin Core Annotator</summary>
      <p>${catalogNoteHtml(catalogPage)}</p>
      <p>Open Workday, go to Academic Record, open Academic History (or Academic Progress), select all, copy, then paste here. Pasting shows opportunities immediately. (If any tables have multiple pages, make sure you set them to show all rows.) Or export Academic Progress to Excel (the Excel button at the very top right of the Academic Progress page, left of PDF, not the ones above each table) and choose the .xlsx file.</p>
      <textarea id="${UI_IDS.textarea}" spellcheck="false" placeholder="Paste Workday Academic History or Academic Progress here"></textarea>
      <div class="ca-launcher-actions">
        <button type="button" class="ca-launcher-button" data-action="analyze">Show core opportunities</button>
        <label class="ca-launcher-button ca-launcher-button-secondary ca-launcher-file">Choose Workday export (.xlsx)
          <input type="file" id="${UI_IDS.file}" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
        </label>
        <button type="button" class="ca-launcher-button ca-launcher-button-secondary" data-action="reset">Reset annotations</button>
        <span id="${UI_IDS.status}">Paste your Workday Academic History or Academic Progress to see your core opportunities.</span>
      </div>
    </details>`;
  firstCore.parentElement.insertBefore(panel, firstCore);

  const details = panel.querySelector('details');
  const textarea = panel.querySelector('textarea');
  const fileInput = panel.querySelector('input[type=file]');
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    textarea.value = '';
    try {
      await runExport(file);
      details.open = false;
    } catch (err) {
      // Never fail silently: keep the panel open so the error shows.
      console.error('[Core Annotator]', err);
      setStatus(`Something went wrong reading ${file.name} (${err.message}). Please report this.`, 'error');
    }
    fileInput.value = '';
  });
  panel.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    if (button.dataset.action === 'analyze') runAnnotation(textarea.value);
    if (button.dataset.action === 'reset') {
      textarea.value = '';
      fileInput.value = '';
      plannedCourses.clear();
      clearRenderedState();
      setStatus('Annotations cleared.', null);
      details.open = false;
    }
  });
  textarea.addEventListener('paste', (event) => {
    const pasted = event.clipboardData?.getData('text/plain');
    if (typeof pasted === 'string' && pasted.length > 0) {
      event.preventDefault();
      textarea.value = pasted;
      runAnnotation(pasted);
      details.open = false;
      return;
    }
    window.setTimeout(() => {
      runAnnotation(textarea.value);
      details.open = false;
    }, 0);
  });
}

export function main() {
  console.log("v0.0.3");
  const catalogPage = currentCatalogPage();
  if (!catalogPage) return;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => mountLauncher(catalogPage), { once: true });
    return;
  }
  mountLauncher(catalogPage);
}
