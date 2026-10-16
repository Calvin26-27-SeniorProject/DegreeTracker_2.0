import { slugify, KU_NAMES } from './core.js';
import { bugReport } from './app-render.js';

const COLORS = {
  taken: '#2d8a4e', takenBg: '#e6f7ed',
  opportunity: '#b8860b', opportunityBg: '#fff8dc',
  doubleCount: '#1a73e8', doubleCountBg: '#e8f0fe',
  inProgress: '#5b21b6', inProgressBg: '#ede9fe',
  transfer: '#0e7490', transferBg: '#ecfeff',
};

export function clearRenderedState() {
  ['ca-styles', 'ca-toc-styles'].forEach(id => {
    document.getElementById(id)?.remove();
  });
  document.querySelectorAll('.ca-legend,.ca-summary-panel,.ca-badge,.ca-hours-note,#ca-toc,.ca-disclaimer,.ca-ku-warning,.ca-mismatch,.ca-transcript-section').forEach(e => {
    e.remove();
  });
  document.querySelectorAll('[class*="ca-course-"],[class*="ca-category-"]').forEach(e => {
    e.className = e.className.replace(/ca-[\w-]+/g, '').trim();
    e.removeAttribute('data-ca-note');
  });
}

function attachPlanToggle(li, courseCode, isPlanned, onTogglePlanned) {
  if (typeof onTogglePlanned !== 'function') return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ca-plan-toggle' + (isPlanned ? ' ca-plan-toggle-on' : '');
  btn.textContent = isPlanned ? 'Planned' : '+ Plan';
  btn.title = isPlanned ? 'Remove planned course' : 'Mark as planned course';
  btn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onTogglePlanned(courseCode);
  });
  li.appendChild(btn);
}

export function render(analysis, options = {}) {
  const { results, kuSummary, transcript, plannedCourses, warnings = [], workdayChecks = [] } = analysis;
  const onTogglePlanned = options.onTogglePlanned;
  clearRenderedState();

  // ===== STYLES =====
  const style = document.createElement('style');
  style.id = 'ca-styles';
  style.textContent = `
    .ca-badge { display:inline-block; padding:2px 8px; border-radius:12px; font-size:11px;
      font-weight:bold; margin-left:8px; vertical-align:middle; letter-spacing:0.3px; white-space:nowrap; }
    .ca-badge-complete { background:${COLORS.takenBg}; color:${COLORS.taken}; border:1px solid ${COLORS.taken}; }
    .ca-badge-incomplete { background:${COLORS.opportunityBg}; color:${COLORS.opportunity}; border:1px solid ${COLORS.opportunity}; }
    .ca-badge-satisfied { background:#eef4ff; color:#1f5fbf; border:1px solid #8fb2ef; }
    .ca-badge-optional { background:#f0f0f0; color:#666; border:1px solid #ccc; }
    .ca-course-taken { background:${COLORS.takenBg}!important; border-left:3px solid ${COLORS.taken}!important; padding-left:6px; }
    .ca-course-taken > a:first-of-type { color:${COLORS.taken}!important; font-weight:bold; }
    .ca-course-taken::after { content:attr(data-ca-note); font-size:11px; color:${COLORS.taken}; margin-left:8px; font-style:italic; }
    .ca-course-opportunity { border-left:3px solid ${COLORS.opportunity}!important; padding-left:6px; }
    .ca-course-double-count { background:${COLORS.doubleCountBg}!important; border-left:3px solid ${COLORS.doubleCount}!important; padding-left:6px; }
    .ca-course-double-count::after { content:attr(data-ca-note); font-size:11px; color:${COLORS.doubleCount}; margin-left:8px; font-weight:bold; }
    .ca-course-taken-multi { background:linear-gradient(90deg, ${COLORS.takenBg} 70%, ${COLORS.doubleCountBg})!important;
      border-left:3px solid ${COLORS.taken}!important; padding-left:6px; }
    .ca-course-taken-multi > a:first-of-type { color:${COLORS.taken}!important; font-weight:bold; }
    .ca-course-taken-multi::after { content:attr(data-ca-note); font-size:11px; color:${COLORS.taken}; margin-left:8px; font-style:italic; }
    .ca-course-planned { background:#fff7e9!important; border-left:3px solid #d97706!important; padding-left:6px; }
    .ca-course-planned > a:first-of-type { color:#9a5a00!important; font-weight:600; }
    .ca-course-planned::after { content:attr(data-ca-note); font-size:11px; color:#9a5a00; margin-left:8px; font-style:italic; }
    .ca-course-planned-multi { background:linear-gradient(90deg, #fff7e9 70%, ${COLORS.doubleCountBg})!important;
      border-left:3px solid #d97706!important; padding-left:6px; }
    .ca-course-planned-multi > a:first-of-type { color:#9a5a00!important; font-weight:600; }
    .ca-course-planned-multi::after { content:attr(data-ca-note); font-size:11px; color:#9a5a00; margin-left:8px; font-style:italic; }
    .ca-course-in-progress { background:${COLORS.inProgressBg}!important; border-left:3px solid ${COLORS.inProgress}!important; padding-left:6px; }
    .ca-course-in-progress > a:first-of-type { color:${COLORS.inProgress}!important; font-weight:bold; }
    .ca-course-in-progress::after { content:attr(data-ca-note); font-size:11px; color:${COLORS.inProgress}; margin-left:8px; font-style:italic; }
    .ca-course-transfer { background:${COLORS.transferBg}!important; border-left:3px solid ${COLORS.transfer}!important; padding-left:6px; }
    .ca-course-transfer > a:first-of-type { color:${COLORS.transfer}!important; font-weight:bold; }
    .ca-course-transfer::after { content:attr(data-ca-note); font-size:11px; color:${COLORS.transfer}; margin-left:8px; font-style:italic; }
    .ca-badge-in-progress { background:${COLORS.inProgressBg}; color:${COLORS.inProgress}; border:1px solid ${COLORS.inProgress}; }
    .ca-badge-exempt { background:#f0fdf4; color:#166534; border:1px solid #86efac; font-style:italic; }
    .ca-course-maxed { opacity:0.35; }
    .ca-plan-toggle { margin-left:8px; padding:1px 7px; border-radius:999px; border:1px solid #c67b00;
      background:#fff; color:#9a5a00; font-size:10px; font-weight:700; cursor:pointer; vertical-align:middle; }
    .ca-plan-toggle:hover { background:#fff6dd; }
    .ca-plan-toggle.ca-plan-toggle-on { background:#fff1cc; border-color:#b86d00; color:#7d4700; }
    .ca-category-complete { opacity:0.45; transition:opacity 0.2s; }
    .ca-category-complete:hover { opacity:1; }
    .ca-hours-note { font-size:11px; color:#555; margin:2px 0 6px 0; padding:3px 10px;
      background:#f8f8f0; border-radius:4px; display:block; border:1px solid #e0e0d0; line-height:1.5; }
    .ca-summary-panel { background:linear-gradient(135deg,#1a1a2e,#16213e); color:#e0e0e0;
      padding:18px 22px; border-radius:10px; margin:16px 0;
      font-family:system-ui,-apple-system,sans-serif; box-shadow:0 2px 12px rgba(0,0,0,0.15); }
    .ca-summary-panel h3 { color:#fff!important; margin:0 0 12px 0; font-size:16px; }
    .ca-summary-section-label { color:#fbbf24; font-size:11px; font-weight:bold; text-transform:uppercase;
      letter-spacing:0.5px; margin:14px 0 6px 0; padding-top:10px; border-top:1px solid rgba(255,255,255,0.08); }
    .ca-summary-section-label:first-of-type { margin-top:8px; padding-top:0; border-top:none; }
    .ca-summary-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; }
    .ca-summary-grid-4 { grid-template-columns:1fr 1fr 1fr 1fr; }
    .ca-summary-item { background:rgba(255,255,255,0.08); padding:8px 12px; border-radius:6px; font-size:12px;
      cursor:pointer; transition:background 0.15s; text-decoration:none; display:block; }
    .ca-summary-item:hover { background:rgba(255,255,255,0.15); }
    .ca-summary-item .label { color:#aaa; font-size:11px; }
    .ca-summary-item .value { color:#fff; font-weight:bold; font-size:14px; }
    .ca-summary-item.complete .value { color:#4ade80; }
    .ca-summary-item.incomplete .value { color:#fbbf24; }
    .ca-summary-item.exempt .value { color:#86efac; font-style:italic; }
    .ca-summary-item.optional .value { color:#888; }
    .ca-summary-item .cap-note { color:#f87171; font-size:10px; }
    .ca-progress-bar { background:#2a2a3e; border-radius:8px; height:16px; overflow:hidden; position:relative; margin-top:4px; }
    .ca-progress-fill { height:100%; border-radius:8px; }
    .ca-progress-label { position:absolute; top:0; left:50%; transform:translateX(-50%);
      font-size:10px; font-weight:bold; line-height:16px; color:#fff; text-shadow:0 1px 2px rgba(0,0,0,0.5); }
    .ca-legend { display:flex; gap:16px; flex-wrap:wrap; margin:10px 0 16px 0; font-size:12px;
      font-family:system-ui,-apple-system,sans-serif; padding:8px 12px;
      background:#fafafa; border:1px solid #e0e0e0; border-radius:6px; }
    .ca-legend-item { display:flex; align-items:center; gap:5px; }
    .ca-legend-swatch { width:14px; height:14px; border-radius:3px; border:1px solid rgba(0,0,0,0.15); }
    .ca-disclaimer { font-size:12px; color:#7a5c00; background:#fffbea; border:1px solid #e8d87a;
      border-radius:6px; padding:7px 12px; margin:10px 0 6px 0;
      font-family:system-ui,-apple-system,sans-serif; line-height:1.5; }
    .ca-ku-warning { font-size:13px; color:#7c2d12; background:#fff1e6; border:1px solid #f0a868;
      border-radius:6px; padding:8px 12px; margin:10px 0 6px 0;
      font-family:system-ui,-apple-system,sans-serif; line-height:1.5; }
    .ca-mismatch { font-size:13px; color:#7f1d1d; background:#fee2e2; border:2px solid #b91c1c; border-radius:6px; padding:10px 14px; margin:10px 0; }
    .ca-mismatch p { margin:8px 0 4px; font-weight:600; }
    .ca-mismatch textarea { width:100%; box-sizing:border-box; font:12px/1.4 monospace; }
    .ca-ku-warning ul { margin:4px 0 4px 18px; padding:0; }
    .ca-hours-note.ca-assumed-note { color:#7c2d12; background:#fff1e6; }
    .ca-transcript-section { font-family:system-ui,-apple-system,sans-serif; margin:24px 0 16px 0; }
    .ca-transcript-section h3 { font-size:14px; color:#333!important; margin:0 0 8px 0; }
    .ca-transcript-table { width:100%; border-collapse:collapse; font-size:12px; }
    .ca-transcript-table th { background:#f0f0f0; text-align:left; padding:4px 8px;
      border-bottom:2px solid #ccc; font-weight:bold; color:#333; }
    .ca-transcript-table td { padding:3px 8px; border-bottom:1px solid #eee; vertical-align:top; }
    .ca-transcript-table tr:hover td { background:#f9f9f9; }
    .ca-transcript-cats { color:#555; font-style:italic; }
    .ca-transcript-none { color:#bbb; font-style:italic; }
  `;
  document.head.appendChild(style);

  // ===== TOC STYLES =====
  const tocStyle = document.createElement('style');
  tocStyle.id = 'ca-toc-styles';
  tocStyle.textContent = `
    #ca-toc { position:fixed; top:80px; right:0; z-index:10000; font-family:system-ui,-apple-system,sans-serif; }
    #ca-toc-toggle { position:absolute; top:0; right:0; width:36px; height:36px; border:1px solid #333; border-right:none;
      border-radius:6px 0 0 6px; background:#1a1a2e; color:#fff; font-size:18px; cursor:pointer;
      display:flex; align-items:center; justify-content:center; box-shadow:-2px 2px 8px rgba(0,0,0,0.15); z-index:2; }
    #ca-toc-toggle:hover { background:#16213e; }
    #ca-toc-panel { display:none; position:absolute; top:0; right:36px; width:240px; max-height:calc(100vh - 120px);
      overflow-y:auto; background:#1a1a2e; border-radius:8px 0 0 8px; box-shadow:-4px 4px 16px rgba(0,0,0,0.25); padding:8px 0; }
    .ca-toc-header { padding:8px 14px; font-size:13px; font-weight:bold; color:#fff;
      border-bottom:1px solid rgba(255,255,255,0.1); margin-bottom:4px; }
    .ca-toc-item { display:block; padding:4px 14px; font-size:12px; color:#ccc; text-decoration:none;
      border-left:3px solid transparent; transition:all 0.15s; line-height:1.3; cursor:pointer; }
    .ca-toc-item:hover { background:rgba(255,255,255,0.08); color:#fff; }
    .ca-toc-item.ca-toc-active { border-left-color:#fbbf24; color:#fff; background:rgba(255,255,255,0.05); font-weight:bold; }
    .ca-toc-cat { padding-left:24px; font-size:11px; }
    .ca-toc-tag { padding-left:32px; font-size:11px; font-style:italic; }
    .ca-toc-item:not(.ca-toc-cat):not(.ca-toc-tag) { font-weight:bold; font-size:11px; color:#fbbf24;
      text-transform:uppercase; letter-spacing:0.5px; margin-top:6px; padding-top:6px;
      border-top:1px solid rgba(255,255,255,0.06); }
    .ca-toc-status { font-size:9px; margin-left:4px; vertical-align:middle; }
    .ca-toc-status-done { color:#4ade80; }
    .ca-toc-status-needed { color:#fbbf24; }
    .ca-toc-status-satisfied { color:#8fb2ef; }
    .ca-toc-status-optional { color:#888; }
    #ca-toc-panel::-webkit-scrollbar { width:4px; }
    #ca-toc-panel::-webkit-scrollbar-track { background:transparent; }
    #ca-toc-panel::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.2); border-radius:2px; }
  `;
  document.head.appendChild(tocStyle);

  const firstCore = document.querySelector('div.acalog-core');
  if (!firstCore) return;

  // ===== LEGEND =====
  const legend = document.createElement('div');
  legend.className = 'ca-legend';
  legend.innerHTML = `
    <div class="ca-legend-item"><div class="ca-legend-swatch" style="background:${COLORS.takenBg};border-color:${COLORS.taken}"></div>Taken</div>
    <div class="ca-legend-item"><div class="ca-legend-swatch" style="background:linear-gradient(90deg,${COLORS.takenBg} 70%,${COLORS.doubleCountBg});border-color:${COLORS.taken}"></div>Taken (multi-section)</div>
    <div class="ca-legend-item"><div class="ca-legend-swatch" style="background:#fff7e9;border-color:#d97706"></div>Planned</div>
    <div class="ca-legend-item"><div class="ca-legend-swatch" style="background:${COLORS.doubleCountBg};border-color:${COLORS.doubleCount}"></div>Double-count opportunity</div>
    <div class="ca-legend-item"><div class="ca-legend-swatch" style="border-left:3px solid ${COLORS.opportunity}"></div>Open opportunities</div>
    <div class="ca-legend-item"><div class="ca-legend-swatch" style="background:${COLORS.inProgressBg};border-color:${COLORS.inProgress}"></div>In Progress</div>
    <div class="ca-legend-item"><div class="ca-legend-swatch" style="background:${COLORS.transferBg};border-color:${COLORS.transfer}"></div>Transfer Credit</div>
    <div class="ca-legend-item"><div class="ca-legend-swatch" style="background:#eee;opacity:0.35"></div>Maxed / satisfied</div>
  `;

  // ===== SUMMARY PANEL (all sections) =====
  const panel = document.createElement('div');
  panel.className = 'ca-summary-panel';

  // Overall progress count
  const countable = results.filter(r => r.status !== 'header' && r.status !== 'info-only');
  const doneCount = countable.filter(r => r.status === 'complete' || r.isExempt).length;

  // Group results by section
  const sections = [];
  let curSection = null;
  for (const r of results) {
    if (r.status === 'header') { curSection = { name: r.section, items: [] }; sections.push(curSection); continue; }
    if (curSection && r.status !== 'info-only') curSection.items.push(r);
  }

  // Build section HTML
  function statusCls(r) {
    if (r.isExempt) return 'exempt';
    if (r.status === 'complete') return 'complete';
    if (r.status === 'satisfied') return 'complete';
    if (r.status === 'optional-available') return 'optional';
    return 'incomplete';
  }
  function statusValue(r) {
    if (r.isExempt) return 'Exempt';
    if (r.status === 'complete') return '\u2713';
    if (r.status === 'satisfied') return 'Min met';
    if (r.status === 'optional-available') return 'Optional';
    return '\u25CB';
  }

  let sectionsHTML = '';
  for (const sec of sections) {
    if (sec.items.length === 0) continue;
    const isKU = sec.name === 'KNOWLEDGE AND UNDERSTANDING';
    sectionsHTML += `<div class="ca-summary-section-label">${sec.name}</div>`;

    if (isKU) {
      // K&U: show hours progress bar + grid with hours
      const pct = Math.min(100, Math.round(kuSummary.totalHours / kuSummary.requiredHours * 100));
      const hColor = kuSummary.totalHours >= kuSummary.requiredHours ? '#4ade80' : '#fbbf24';
      const cColor = kuSummary.categoriesUsed >= kuSummary.requiredCategories ? '#4ade80' : '#fbbf24';
      sectionsHTML += `<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
        <span>Hours: <strong style="color:${hColor}">${kuSummary.totalHours} / ${kuSummary.requiredHours}</strong></span>
        <span>Categories: <strong style="color:${cColor}">${kuSummary.categoriesUsed} / ${kuSummary.requiredCategories}</strong></span>
      </div>
      <div class="ca-progress-bar"><div class="ca-progress-fill" style="width:${pct}%;background:${hColor}"></div>
        <div class="ca-progress-label">${pct}%</div></div>`;
      let kuGrid = '';
      for (const n of KU_NAMES) {
        const info = kuSummary.hoursByCategory[n] || { raw: 0, effective: 0, max: null };
        const cls = info.raw > 0 ? 'complete' : 'incomplete';
        const capNote = info.raw > info.effective ? `<div class="cap-note">${info.raw}h earned, ${info.effective}h count</div>` : '';
        const slug = slugify(n);
        kuGrid += `<a href="#${slug}" class="ca-summary-item ${cls}" data-slug="${slug}">
          <span class="label">${n}</span><br><span class="value">${info.effective} hrs</span>${capNote}</a>`;
      }
      sectionsHTML += `<div class="ca-summary-grid">${kuGrid}</div>`;
    } else {
      // Non-K&U: compact status cards
      const colCls = sec.items.length === 4 ? ' ca-summary-grid-4' : '';
      let cards = '';
      for (const r of sec.items) {
        const cls = statusCls(r);
        const val = statusValue(r);
        const slug = r.slug;
        const label = r.name;
        cards += `<a href="#${slug}" class="ca-summary-item ${cls}" data-slug="${slug}">
          <span class="label">${label}</span><br><span class="value">${val}</span></a>`;
      }
      sectionsHTML += `<div class="ca-summary-grid${colCls}">${cards}</div>`;
    }
  }

  panel.innerHTML = `
    <h3>\u{1F4CA} Core Opportunities</h3>
    <div style="font-size:13px;margin-bottom:4px">
      <span>Overall: <strong style="color:${doneCount >= countable.length ? '#4ade80' : '#fbbf24'}">${doneCount} / ${countable.length}</strong> requirements complete</span>
    </div>
    <div style="font-size:12px;color:#d5dbe5;margin-bottom:2px">Planned courses: <strong>${(plannedCourses || []).length}</strong> (do not count toward completed hours until taken)</div>
    ${sectionsHTML}`;
  panel.addEventListener('click', (e) => {
    const item = e.target.closest('.ca-summary-item');
    if (item) { e.preventDefault(); document.getElementById(item.dataset.slug)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });

  const disclaimer = document.createElement('div');
  disclaimer.className = 'ca-disclaimer';
  disclaimer.textContent = '\u26A0\uFE0F These results are unofficial and for planning purposes only. They may not reflect all institutional policies, transfer credit decisions, or advisor overrides. Always verify your core program status with your academic advisor or the Registrar.';

  firstCore.parentElement.insertBefore(legend, firstCore);
  firstCore.parentElement.insertBefore(panel, firstCore);
  firstCore.parentElement.insertBefore(disclaimer, firstCore);

  if (warnings.length > 0) {
    const warning = document.createElement('div');
    warning.className = 'ca-ku-warning';
    const intro = document.createElement('strong');
    intro.textContent = '\u26A0\uFE0F Some credit Workday counts toward the core isn\u2019t counted the same way here, so your results above may understate your progress:';
    const list = document.createElement('ul');
    for (const w of warnings) {
      const li = document.createElement('li');
      li.textContent = w.code + (w.title ? ' \u2014 ' + w.title : '') + ' (' + w.hours + 'h): ' + w.reason + '.';
      list.appendChild(li);
    }
    const outro = document.createElement('span');
    outro.textContent = 'Check Academic Progress in Workday or ask the Registrar where these count.';
    warning.append(intro, list, outro);
    firstCore.parentElement.insertBefore(warning, firstCore);
  }

  // Workday and this tool disagree: one is wrong. Loud, with a report to send.
  const mismatches = workdayChecks.filter(c => c.kind === 'mismatch');
  if (mismatches.length > 0) {
    const box = document.createElement('div');
    box.className = 'ca-mismatch';
    box.setAttribute('role', 'alert');
    const intro = document.createElement('strong');
    intro.textContent = '\u26D4 Workday disagrees with this tool. Go with Workday. This is probably a bug: please copy each report below and send it to the developer (it lists your courses, not your name or ID).';
    box.appendChild(intro);
    for (const m of mismatches) {
      const line = document.createElement('p');
      line.textContent = (m.requirement === 'K&U' ? 'Knowledge and Understanding' : m.requirement)
        + ': Workday says ' + m.workdayStatus + '; this tool says ' + m.ourStatus + '.';
      const area = document.createElement('textarea');
      area.readOnly = true;
      area.rows = 8;
      area.value = bugReport(analysis, m, { source: options.source, testCase: options.testCase });
      box.append(line, area);
    }
    firstCore.parentElement.insertBefore(box, firstCore);
  }

  // ===== FLOATING TOC =====
  const tocContainer = document.createElement('div');
  tocContainer.id = 'ca-toc';
  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'ca-toc-toggle';
  toggleBtn.textContent = '\u2630';
  toggleBtn.title = 'Table of Contents';
  const tocPanel = document.createElement('div');
  tocPanel.id = 'ca-toc-panel';

  let tocHTML = '<div class="ca-toc-header">\u{1F4D1} Core Program</div>';
  for (const r of results) {
    if (!r.slug) continue;
    const indent = r.type === 'section-header' ? '' : (r.type === 'tag' ? 'ca-toc-tag' : 'ca-toc-cat');
    const label = r.name || r.section;
    let statusIcon = '';
    if (r.status === 'complete') statusIcon = '<span class="ca-toc-status ca-toc-status-done">\u2713</span>';
    else if (r.status === 'satisfied') statusIcon = '<span class="ca-toc-status ca-toc-status-satisfied">\u25D4</span>';
    else if (r.status === 'incomplete') statusIcon = '<span class="ca-toc-status ca-toc-status-needed">\u25CB</span>';
    else if (r.status === 'optional-available') statusIcon = '<span class="ca-toc-status ca-toc-status-optional">\u25CB</span>';
    tocHTML += `<a href="#${r.slug}" class="ca-toc-item ${indent}" data-slug="${r.slug}">${label}${statusIcon}</a>`;
  }
  tocPanel.innerHTML = tocHTML;
  tocContainer.appendChild(toggleBtn);
  tocContainer.appendChild(tocPanel);
  document.body.appendChild(tocContainer);

  let tocOpen = false;
  toggleBtn.addEventListener('click', () => {
    tocOpen = !tocOpen;
    tocPanel.style.display = tocOpen ? 'block' : 'none';
    toggleBtn.textContent = tocOpen ? '\u2715' : '\u2630';
  });
  tocPanel.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (link) { e.preventDefault(); document.getElementById(link.dataset.slug)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });

  // Scroll spy
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const slug = entry.target.id;
        document.querySelectorAll('.ca-toc-item').forEach(a => {
          a.classList.remove('ca-toc-active');
        });
        const active = document.querySelector(`.ca-toc-item[data-slug="${slug}"]`);
        if (active) { active.classList.add('ca-toc-active'); active.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
      }
    }
  }, { rootMargin: '-10% 0px -80% 0px' });
  results.filter(r => r.slug).forEach(r => {
    const el = document.getElementById(r.slug);
    if (el) observer.observe(el);
  });

  // ===== ANNOTATE CATEGORIES =====
  for (const r of results) {
    if (r.status === 'header' || !r.courseAnnotations) continue;
    const block = r.element;
    const heading = block.querySelector('h3') || block.querySelector('h4');

    if (heading) {
      const badge = document.createElement('span');
      badge.className = 'ca-badge';
      if (r.isExempt) { badge.className += ' ca-badge-exempt'; badge.textContent = '\u2713 EXEMPT'; }
      else if (r.status === 'complete') { badge.className += ' ca-badge-complete'; badge.textContent = '\u2713 COMPLETE'; }
      else if (r.status === 'satisfied') { badge.className += ' ca-badge-satisfied'; badge.textContent = 'MIN MET'; }
      else if (r.status === 'optional-available') { badge.className += ' ca-badge-optional'; badge.textContent = 'OPTIONAL'; }
      else { badge.className += ' ca-badge-incomplete';
        badge.textContent = r.reqType === 'hour-range' ? r.hoursEarned + '/' + (r.minHours || 0) + '+ hrs' : 'AREAS TO EXPLORE'; }
      heading.appendChild(badge);
    }

    if (Array.isArray(r.subDisciplineElements) && r.subDisciplines) {
      for (const sub of r.subDisciplineElements) {
        const info = r.subDisciplines[sub.name];
        if (!info) continue;
        const badge = document.createElement('span');
        badge.className = 'ca-badge';
        if (info.isMaxed) {
          badge.className += ' ca-badge-complete';
          badge.textContent = '\u2713 ' + info.hoursEarned + 'h/' + info.cap + 'h';
        } else if (info.hoursEarned > 0) {
          badge.className += ' ca-badge-incomplete';
          badge.textContent = info.hoursEarned + 'h/' + info.cap + 'h max';
        } else {
          badge.className += ' ca-badge-optional';
          badge.textContent = '0h \u2014 up to ' + info.cap + 'h';
        }
        sub.element.appendChild(badge);
      }
    }

    if (r.type === 'category' && r.name === 'World Languages I') {
      const note = document.createElement('span');
      note.className = 'ca-hours-note';
      note.textContent = '\u2139\uFE0F World Languages I may already be satisfied through qualifying high school language coursework/exemption. Confirm with your advisor or the Registrar if this applies to you.';
      block.querySelector('p')?.after(note);
    }

    if (r.reqType === 'hour-range' && (r.hoursEarned > 0 || r.maxPerDiscipline)) {
      const note = document.createElement('span');
      note.className = 'ca-hours-note';
      let txt = '\u{1F4D0} ' + r.hoursEarned + 'h earned';
      if (r.minHours !== null) txt += ' (need ' + r.minHours + '\u2013' + r.maxHours + 'h)';
      if (r.hoursEffective < r.hoursEarned)
        txt += ' \u26A0\uFE0F only ' + r.hoursEffective + 'h count toward K&U total';
      if (Object.keys(r.hoursByDiscipline).length > 0) {
        const parts = Object.entries(r.hoursByDiscipline).map(([d, h]) => {
          return d + ': ' + h + 'h' + (r.maxedDisciplines.has(d) ? ' \u26A0\uFE0F maxed' : '');
        }).join(' \u00B7 ');
        txt += ' \u2014 ' + parts;
        if (r.maxPerDiscipline) txt += ' (max ' + r.maxPerDiscipline + 'h/discipline)';
      }
      note.textContent = txt;
      block.querySelector('p')?.after(note);
    }

    const otherCatalogCourses = r.courseAnnotations.filter(c => c.isFromOtherCatalog);
    if (otherCatalogCourses.length > 0) {
      const note = document.createElement('span');
      note.className = 'ca-hours-note';
      note.textContent = '\u2713 Also counted (listed here in another catalog year): '
        + otherCatalogCourses.map(c => c.code + ' (' + c.hours + 'h)').join(', ');
      block.querySelector('p')?.after(note);
    }

    const workdayCourses = r.courseAnnotations.filter(c => c.isFromWorkday);
    if (workdayCourses.length > 0) {
      const note = document.createElement('span');
      note.className = 'ca-hours-note';
      note.textContent = '✓ Also counted (Workday Academic Progress lists it here, though the catalog doesn’t): '
        + workdayCourses.map(c => c.code + (c.title ? ' — ' + c.title : '')).join(', ');
      block.querySelector('p')?.after(note);
    }

    const assumedCourses = r.courseAnnotations.filter(c => c.isAssumed);
    if (assumedCourses.length > 0) {
      const note = document.createElement('span');
      note.className = 'ca-hours-note ca-assumed-note';
      note.textContent = '\u26A0\uFE0F Assumed: '
        + assumedCourses.map(c => c.code + (c.title ? ' \u2014 ' + c.title : '') + ' (' + c.hours + 'h'
          + (c.subDiscipline ? ', as ' + c.subDiscipline : '') + ')').join(', ')
        + '. Placeholder credit with no course number; counted here based on its subject prefix. Confirm with the Registrar.';
      block.querySelector('p')?.after(note);
    }

    if (r.status === 'complete' && r.type !== 'tag') block.classList.add('ca-category-complete');

    for (const c of r.courseAnnotations) {
      if (!c.element) continue;
      const li = c.element;
      if (c.isInProgress) {
        li.classList.add('ca-course-in-progress');
        li.setAttribute('data-ca-note', '\u23F3 In Progress (' + c.hours + 'h)');
      } else if (c.isExcludedTransfer) {
        li.classList.add('ca-course-transfer');
        li.setAttribute('data-ca-note', 'Transfer (' + c.hours + 'h) \u2014 not accepted for this requirement');
      } else if (c.isTransfer) {
        li.classList.add('ca-course-transfer');
        li.setAttribute('data-ca-note', '\u2713 Transfer (' + c.hours + 'h)');
      } else if (c.isTaken) {
        if (c.isMultiSection) {
          li.classList.add('ca-course-taken-multi');
          li.setAttribute('data-ca-note', '\u2713 ' + c.grade + ' (' + c.hours + 'h) \u21C9 Also: ' + c.otherCategories.join(', '));
        } else {
          li.classList.add('ca-course-taken');
          li.setAttribute('data-ca-note', '\u2713 ' + c.grade + ' (' + c.hours + 'h)');
        }
      } else if (c.isPlanned) {
        if (c.isMultiSection) {
          li.classList.add('ca-course-planned-multi');
          li.setAttribute('data-ca-note', 'Planned \u21C9 Also: ' + c.otherCategories.join(', '));
        } else {
          li.classList.add('ca-course-planned');
          li.setAttribute('data-ca-note', 'Planned');
        }
      } else if (r.status === 'complete' && r.type !== 'tag') {
        if (c.isMultiSection) {
          li.classList.add('ca-course-double-count');
          li.setAttribute('data-ca-note', '\u21C9 Also: ' + c.otherCategories.join(', '));
        } else li.classList.add('ca-course-maxed');
      } else if (c.isMaxedDiscipline) {
        li.classList.add('ca-course-maxed');
      } else if (c.isMultiSection && !c.isTaken) {
        li.classList.add('ca-course-double-count');
        li.setAttribute('data-ca-note', '\u21C9 Also: ' + c.otherCategories.join(', '));
      } else if (r.status !== 'complete') {
        li.classList.add('ca-course-opportunity');
      } else li.classList.add('ca-course-maxed');

      if (!c.isTaken && !c.isInProgress && !c.isTransfer) attachPlanToggle(li, c.code, c.isPlanned, onTogglePlanned);
    }
  }

  // ===== TRANSCRIPT REFERENCE TABLE =====
  if (transcript && transcript.length > 0) {
    const courseToCategories = {};
    for (const r of results) {
      if (!r.courseAnnotations) continue;
      for (const c of r.courseAnnotations) {
        if (!courseToCategories[c.code]) courseToCategories[c.code] = [];
        courseToCategories[c.code].push(r.name + (c.isAssumed ? ' (assumed)' : ''));
      }
    }
    const warnedCodes = new Map();
    for (const w of warnings) warnedCodes.set(w.code, [...(warnedCodes.get(w.code) || []), w.requirement]);

    const section = document.createElement('div');
    section.className = 'ca-transcript-section';
    let rows = '';
    for (const c of transcript) {
      const cats = courseToCategories[c.code] || [];
      const catsCell = (cats.length > 0
        ? `<span class="ca-transcript-cats">${cats.join(', ')}</span>`
        : `<span class="ca-transcript-none">not in core lists</span>`)
        + (warnedCodes.has(c.code) ? ' <span style="color:#7c2d12">\u26A0\uFE0F Workday counts it toward '
          + warnedCodes.get(c.code).join(', ').replace(/&/g, '&amp;') + '; not matched here</span>' : '');
      const statusLabel = c.status === 'in-progress' ? ' <span style="color:' + COLORS.inProgress + '">⏳</span>'
        : c.status === 'transfer' ? ' <span style="color:' + COLORS.transfer + '">↗</span>' : '';
      rows += `<tr><td><strong>${c.code}</strong>${statusLabel}</td><td>${c.title}</td><td>${c.grade || '—'}</td><td>${c.hours}h</td><td>${catsCell}</td></tr>`;
    }
    section.innerHTML = `<h3>\u{1F4CB} Transcript Reference (${transcript.length} courses)</h3>
      <table class="ca-transcript-table">
        <thead><tr><th>Code</th><th>Title</th><th>Grade</th><th>Hrs</th><th>Core Categories</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    firstCore.parentElement.appendChild(section);
  }
}
