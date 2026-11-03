import { slugify, KU_NAMES } from './core.js';
import { bugReport } from './app-render.js';
import { annotatorStyles, tocStyles } from './render-styles.js';

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

  // ===== INJECT EDITABLE THEME =====
  const style = document.createElement('style');
  style.id = 'ca-styles';
  style.textContent = annotatorStyles(COLORS);
  document.head.appendChild(style);

  const tocStyle = document.createElement('style');
  tocStyle.id = 'ca-toc-styles';
  tocStyle.textContent = tocStyles;
  document.head.appendChild(tocStyle);

  // ===== LEGEND =====


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
