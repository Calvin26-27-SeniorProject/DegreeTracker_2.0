// Standalone app rendering: builds the whole page from saved catalog data and
// (optionally) an analyze() result. Takes a root element so tests can render
// into jsdom. Catalog text (names, instructions, course titles) is shown
// verbatim; test/test-app-fidelity.js compares it against the saved catalog HTML.

import { classifyInstructions, doubleCountConfirmed, KU_NAMES } from './core.js';
import { coarseGrade } from './test-case.js';

const CATALOG_ORIGIN = 'https://catalog.calvin.edu';

export function courseUrl(catoid, coid) {
  return `${CATALOG_ORIGIN}/preview_course_nopop.php?catoid=${catoid}&coid=${coid}`;
}

export function requirementUrl(meta, coreId) {
  return meta.sourceUrl + (coreId ? '#' + coreId : '');
}

export function catalogLabel(meta) {
  return meta.catalogYear.replace('-', '–');
}

const fmtHours = n => String(+Number(n).toFixed(2));
const fmtRange = h => h.min === h.max ? fmtHours(h.min) : `${fmtHours(h.min)}–${fmtHours(h.max)}`;

// "2026-10-14" → "Oct 14, 2026"
function fmtDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${d}, ${y}`;
}

// Tiny element builder: h('div', { class: 'x', onclick }, child, 'text', ...)
function builder(doc) {
  return function h(tag, props, ...children) {
    const el = doc.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(typeof c === 'string' || typeof c === 'number' ? String(c) : c);
    }
    return el;
  };
}

// Sections the saved course schedule lists for a course, as a collapsed list
// under the course's row (shared by the Core and Major/Minor pages). Closed,
// CPI, and Handlon sections are left out; whether a section is full isn't shown.
// ctx: { schedule, openLists, onListToggle }; key identifies the list's open state.
function offeredSectionsList(h, { schedule, openLists = new Map(), onListToggle }, key, code) {
  const shownTerms = (schedule?._meta.terms || []).filter(t => t.shown);
  const offered = schedule?.offerings[code];
  const terms = shownTerms.filter(t => offered?.[t.term]);
  if (terms.length === 0) return null;
  const count = list => list.filter(s => !s.lab).length || list.length;
  const label = terms.map(t => {
    const n = count(offered[t.term]);
    return `${t.label}: ${n} section${n === 1 ? '' : 's'}`;
  }).join(' · ');
  const sectionList = (listCode, sections) => h('ul', { class: 'section-list' }, sections.map(s => h('li', { class: 'section' },
    h('strong', {}, `${listCode}-${s.section}`),
    ' ', [s.meets || (s.delivery === 'Online' ? null : 'Time TBA'), s.instructors,
      s.delivery, s.offCampus ? 'Off campus' : null, s.hours != null ? `${s.hours} hrs` : null].filter(Boolean).join(' · '),
    s.period ? h('span', { class: 'section-period' }, s.period) : null,
    s.title ? h('span', { class: 'section-title' }, s.title) : null)));
  return h('details', { class: 'offered', open: openLists.get(key) || null,
    ontoggle: e => onListToggle?.(key, e.target.open) },
    h('summary', {}, label),
    terms.map(t => {
      const list = offered[t.term];
      const lectures = list.filter(s => !s.lab);
      const labs = list.filter(s => s.lab);
      return h('div', { class: 'offered-term' },
        h('p', { class: 'offered-term-name' }, t.label + (labs.length && lectures.length ? ' (take one lecture section and one lab section; the letters needn’t match)' : '')),
        lectures.length ? sectionList(code, lectures) : null,
        labs.length ? [h('p', { class: 'offered-kind' }, 'Lab'), sectionList(code + 'L', labs)] : null);
    }));
}

// The chevron that collapses a requirement card to its header. The open state
// is kept under `key` so a re-render keeps it.
function collapseButton(h, name, expanded, key, onListToggle) {
  return h('button', { type: 'button', class: 'req-collapse', 'aria-expanded': String(expanded),
    'aria-label': `Show or hide ${name}`, title: 'Show or hide details',
    onclick: e => {
      const card = e.currentTarget.closest('.req');
      const nowExpanded = card.classList.toggle('is-collapsed') === false;
      e.currentTarget.setAttribute('aria-expanded', String(nowExpanded));
      onListToggle?.(key, nowExpanded);
    } });
}

function statusInfo(r) {
  if (!r) return null;
  if (r.isExempt) return { cls: 'done', text: 'Exempt' };
  if (r.workdaySatisfied) return { cls: 'done', text: 'Satisfied in Workday' };
  switch (r.status) {
    case 'complete': return { cls: 'done', text: 'Complete' };
    case 'satisfied': return { cls: 'min', text: 'Minimum met' };
    case 'optional-available': return { cls: 'optional', text: 'Optional' };
    case 'incomplete':
      return { cls: 'todo', text: r.reqType === 'hour-range'
        ? `${fmtHours(r.hoursEarned)} of ${r.minHours}+ hrs` : 'Not yet' };
    default: return null;
  }
}

// A requirement card's status, including "Complete at least one tagged course
// in all three areas" (no course list of its own), shown as "N of 3 tags".
function requirementStatus(cat, r, analysis) {
  if (analysis && classifyInstructions(cat.instructions).some(s => s.rule?.id === 'three-tags')) {
    const tags = analysis.results.filter(t => t.type === 'tag' && t.section === cat.section);
    const done = tags.filter(t => t.status === 'complete').length;
    return { cls: done === tags.length ? 'done' : 'todo', text: `${done} of ${tags.length} tags` };
  }
  return statusInfo(r);
}

// K&U as a whole: enough hours, enough categories, and each category's minimum.
// (Computed by analyze(); Workday may also have accepted it.)
export function kuStatus(analysis) {
  const ku = analysis.kuSummary;
  if (ku.requiredHours == null || ku.requiredCategories == null) return null;
  return { ...ku };
}

const OUR_STATUS_TEXT = { complete: 'Complete', satisfied: 'Minimum met', incomplete: 'Not yet',
  'optional-available': 'Optional', exempt: 'Exempt', met: 'Met', 'not met': 'Not met' };

// Plain text a student can copy to the developer when Workday and this tool
// disagree. Ends with the de-identified test case (src/test-case.js) when
// given, else the course list with grades coarsened the same way; no name or ID.
// context: { catalog: _meta, source: input label, testCase: formatted case }
export function bugReport(analysis, check, context = {}) {
  const fmtCourse = c => [c.code || c.title, c.title && c.code ? '- ' + c.title : null,
    c.status && c.status !== 'completed' ? `(${c.status})` : null, c.period || null,
    c.grade ? 'grade ' + coarseGrade(c.grade) : null, `${fmtHours(c.hours)} hrs`].filter(Boolean).join(' ');
  const counted = check.requirement === 'K&U'
    ? analysis.results.filter(r => KU_NAMES.includes(r.name))
    : analysis.results.filter(r => r.name === check.requirement);
  const countedLines = counted.flatMap(r => (r.courseAnnotations || [])
    .filter(a => (a.isTaken || a.isInProgress) && !a.isExcludedTransfer)
    .map(a => `  ${a.code} (${fmtHours(a.hours)} hrs${counted.length > 1 ? ', ' + r.name : ''})`));
  const lines = [
    'Degree Tracker bug report: Workday and Degree Tracker disagree',
    context.catalog ? `Catalog: ${catalogLabel(context.catalog)} (catoid ${context.catalog.catoid}, saved ${context.catalog.savedAt})` : null,
    context.source ? `Input: ${context.source}` : null,
    `Requirement: ${check.requirement}`,
    `Workday requirement: ${check.workdayRequirement}`,
    `Workday status: ${check.workdayStatus}`,
    `Degree Tracker status: ${OUR_STATUS_TEXT[check.ourStatus] || check.ourStatus}`,
    'Workday lists:',
    ...(check.items.length ? check.items.map(i => '  ' + i) : ['  (nothing)']),
    'Degree Tracker counted:',
    ...(countedLines.length ? countedLines : ['  (nothing)']),
    check.requirement === 'K&U' && analysis.kuSummary
      ? `K&U: ${fmtHours(analysis.kuSummary.totalHours)} of ${analysis.kuSummary.requiredHours} hrs, ${analysis.kuSummary.categoriesUsed} of ${analysis.kuSummary.requiredCategories} categories` : null,
    ...(context.testCase ? ['Test case (de-identified):', context.testCase]
      : [`All courses (${analysis.transcript.length}):`, ...analysis.transcript.map(c => '  ' + fmtCourse(c))]),
  ];
  return lines.filter(l => l != null).join('\n');
}

// state: {
//   catalog: { _meta, categories }      selected catalog
//   catalogs: [{ _meta, categories }]   all known catalogs (for provenance)
//   analysis: analyze() result or null
//   openLists: Map slug → bool          remembered <details> state
//   format, source                      input format ('transcript', ...) and its label, for notices and bug reports
//   testCase                            de-identified test case text (src/test-case.js), shown at the bottom
//   schedule                            schedule/sections.json: course hours and listed sections, or null
//   projection                          analyze() result counting planned courses, or null
//   onTogglePlanned(code), onListToggle(slug, open)
// }
export function renderApp(root, state) {
  const doc = root.ownerDocument;
  const h = builder(doc);
  const { catalog, catalogs = [catalog], analysis, openLists = new Map(), source, testCase, schedule, projection } = state;
  const shownTerms = (schedule?._meta.terms || []).filter(t => t.shown);
  const projectedByIndex = new Map((projection?.results || []).map(r => [r.coreIndex, r]));
  const mismatchesFor = name => (analysis?.workdayChecks || []).filter(c => c.kind === 'mismatch' && c.requirement === name);
  const meta = catalog._meta;
  const resultsByIndex = new Map((analysis?.results || []).map(r => [r.coreIndex, r]));
  const slugByName = new Map(catalog.categories.filter(c => c.name).map(c => [c.name, c.slug]));
  // Requirements this catalog lists each course under, for before there's an analysis.
  const listedUnder = new Map();
  for (const cat of catalog.categories) {
    for (const c of cat.courses || []) {
      if (!listedUnder.has(c.code)) listedUnder.set(c.code, []);
      if (!listedUnder.get(c.code).includes(cat.name)) listedUnder.get(c.code).push(cat.name);
    }
  }

  // Where another catalog lists a course under the same requirement.
  function otherCatalogListing(catName, code) {
    for (const other of catalogs) {
      if (other._meta.catoid === meta.catoid) continue;
      const cat = other.categories.find(c => c.name === catName);
      const course = cat?.courses?.find(c => c.code === code);
      if (course) return { meta: other._meta, course };
    }
    return null;
  }

  function categoryLinks(names) {
    return names.map((n, i) => [i > 0 ? ', ' : '', slugByName.has(n) ? h('a', { href: '#' + slugByName.get(n) }, n) : n]);
  }

  function wording(instructions) {
    const sentences = classifyInstructions(instructions);
    if (sentences.length === 0) return null;
    return h('ul', { class: 'catalog-wording' }, sentences.map(s => {
      const kind = s.rule?.checked ? 'checked' : s.rule?.advice ? 'advice' : s.rule?.partial ? 'partial' : 'unchecked';
      const note = s.rule ? s.rule.note : 'This tool doesn\u2019t recognize this wording.';
      return h('li', { class: 'sentence is-' + kind },
        h('span', { class: 'sentence-text' }, s.text),
        h('span', { class: 'sentence-check', title: kind === 'checked' ? 'This tool checks this' : note },
          { checked: 'Checked', advice: 'Advice', partial: 'Partly checked', unchecked: 'Not checked' }[kind]),
        kind === 'unchecked' || kind === 'partial' ? h('span', { class: 'sentence-note' }, note) : null);
    }));
  }

  function courseRow(cat, c, a) {
    // a: the course's annotation from analyze(), if any
    const flags = [];
    let rowCls = 'course';
    if (a) {
      if (a.isExcludedTransfer) { rowCls += ' is-excluded'; flags.push(h('span', { class: 'chip chip-excluded' }, `Transfer, ${fmtHours(a.hours)} hrs — not accepted here`)); }
      else if (a.isInProgress) { rowCls += ' is-active'; flags.push(h('span', { class: 'chip chip-progress' }, `In progress · ${fmtHours(a.hours)} hrs`)); }
      else if (a.isTaken) {
        rowCls += ' is-active';
        flags.push(h('span', { class: 'chip chip-taken' },
          (a.isTransfer ? 'Transfer' : 'Taken') + (a.grade && !a.isTransfer ? ` · ${a.grade}` : '') + ` · ${fmtHours(a.hours)} hrs`));
      } else if (a.isPlanned) { rowCls += ' is-planned'; flags.push(h('span', { class: 'chip chip-planned' }, plannedLabel(c.code))); }
      else if (a.isMaxedDiscipline) { rowCls += ' is-maxed'; flags.push(h('span', { class: 'chip chip-muted' }, 'Discipline max reached')); }
    }
    const hrs = schedule?.hours[c.code];
    if (hrs && !(a && (a.isTaken || a.isInProgress || a.isPlanned))) {
      flags.unshift(h('span', { class: 'chip chip-hours', title: `Hours in the ${termLabel(hrs.term)} schedule` }, `${fmtRange(hrs)} hrs`));
    }
    const others = a ? a.otherCategories || [] : (listedUnder.get(c.code) || []).filter(n => n !== cat.name);
    if (others.length) {
      flags.push(h('span', { class: 'also' }, '\u21c9 Also listed for ', categoryLinks(others)));
    }
    const active = a && (a.isTaken || a.isInProgress);
    const planBtn = a && !active && typeof state.onTogglePlanned === 'function'
      ? h('button', { type: 'button', class: 'plan-toggle' + (a.isPlanned ? ' is-on' : ''),
          'aria-pressed': a.isPlanned ? 'true' : 'false',
          onclick: () => state.onTogglePlanned(c.code) }, a.isPlanned ? 'Planned ✓' : '+ Plan')
      : null;
    return h('li', { class: rowCls, dataset: { kind: 'course', code: c.code } },
      h('a', { class: 'course-code', href: courseUrl(meta.catoid, c.coid), target: '_blank', rel: 'noopener',
        title: 'Course description in the official catalog' }, c.code),
      h('span', { class: 'course-title' }, c.title),
      flags.length ? h('span', { class: 'course-flags' }, flags) : null,
      planBtn,
      active ? null : offeredSections(cat, c.code));
  }

  const termLabel = term => schedule?._meta.terms.find(t => t.term === term)?.label || term;

  function plannedLabel(code) {
    const hrs = schedule?.hours[code];
    if (!hrs) return 'Planned · hours unknown, not counted toward hours';
    return hrs.min === hrs.max ? `Planned · ${fmtHours(hrs.min)} hrs` : `Planned · ${fmtRange(hrs)} hrs, counting ${fmtHours(hrs.min)}`;
  }

  // Sections listed for the shown terms (closed, CPI, and Handlon sections left out;
  // whether a section is full isn't shown).
  function offeredSections(cat, code) {
    return offeredSectionsList(h, { schedule, openLists, onListToggle: state.onListToggle }, `sections:${cat.slug}:${code}`, code);
  }

  function courseList(cat, r) {
    const annByCode = new Map((r?.courseAnnotations || []).map(a => [a.code, a]));
    const items = [];
    let sub = null;
    for (const c of cat.courses) {
      if (c.subDiscipline !== sub) {
        sub = c.subDiscipline;
        if (sub) {
          const info = r?.subDisciplines?.[sub];
          items.push(h('li', { class: 'course-heading', dataset: { kind: 'heading' } },
            h('span', { class: 'heading-text' }, sub),
            info ? h('span', { class: 'chip ' + (info.isMaxed ? 'chip-taken' : info.hoursEarned > 0 ? 'chip-min' : 'chip-muted') },
              `${fmtHours(info.hoursEarned)} of max ${info.cap} hrs`) : null));
        }
      }
      if (c.connectorBefore) {
        items.push(h('li', { class: 'course-connector', dataset: { kind: 'connector' } }, c.connectorBefore));
      }
      items.push(courseRow(cat, c, annByCode.get(c.code)));
    }
    return h('ol', { class: 'course-list' }, items);
  }

  // Taken courses counted here that this catalog doesn't list here.
  const isExtra = a => a.isFromOtherCatalog || a.isAssumed || a.isFromWorkday;
  function extraCourses(cat, r) {
    const extras = (r?.courseAnnotations || []).filter(isExtra);
    if (extras.length === 0) return null;
    return h('div', { class: 'extra-courses' },
      h('p', { class: 'extra-label' }, `Also counted here, though the ${catalogLabel(meta)} catalog doesn’t list them:`),
      h('ul', {}, extras.map(a => {
        let why;
        if (a.isAssumed) {
          why = `Assumed: credit with no course number, placed here by its subject${a.subDiscipline ? ' (as ' + a.subDiscipline + ')' : ''}. Check Workday.`;
        } else if (a.isFromWorkday) {
          why = 'Listed for this requirement in your Workday Academic Progress (e.g. a section-specific tag or an override).';
        } else {
          const other = otherCatalogListing(cat.name, a.code);
          why = other
            ? h('span', {}, 'Listed for this requirement in the ',
              h('a', { href: courseUrl(other.meta.catoid, other.course.coid), target: '_blank', rel: 'noopener' }, catalogLabel(other.meta) + ' catalog'), '.')
            : 'Listed for this requirement in another catalog year.';
        }
        const provenance = a.isAssumed ? 'assumed' : a.isFromWorkday ? 'workday' : 'other-catalog';
        return h('li', { class: 'extra-course', dataset: { kind: 'extra-course', code: a.code, provenance } },
          h('strong', {}, a.code), a.title ? ' ' + a.title : '', ` · ${fmtHours(a.hours)} hrs — `, why);
      })));
  }

  function hoursLine(cat, r) {
    if (cat.reqType !== 'hour-range') return null;
    const parts = [`Counts ${cat.minHours}–${cat.maxHours} hrs`];
    if (cat.maxPerDiscipline) parts.push(`at most ${cat.maxPerDiscipline} from one discipline`);
    if (!r) return h('p', { class: 'req-hours' }, parts.join(', ') + '.');
    let text = `You have ${fmtHours(r.hoursEarned)} hrs here. ` + parts.join(', ') + '.';
    if (r.hoursEffective < r.hoursEarned) text += ` Only ${fmtHours(r.hoursEffective)} count toward the K&U total.`;
    const p = projectedByIndex.get(cat.coreIndex);
    if (p && p.hoursEarned !== r.hoursEarned) text += ` With your plan: ${fmtHours(p.hoursEarned)} hrs.`;
    return h('p', { class: 'req-hours' }, text);
  }

  // The status counting planned courses, when it differs from the actual one.
  function plannedStatus(cat, status) {
    if (!projection) return null;
    const p = requirementStatus(cat, projectedByIndex.get(cat.coreIndex), projection);
    return p && p.text !== status?.text ? p : null;
  }

  function requirementCard(cat) {
    const r = resultsByIndex.get(cat.coreIndex);
    const status = requirementStatus(cat, r, analysis);
    const withPlan = plannedStatus(cat, status);
    const notes = [];
    if (cat.alternatives) {
      notes.push('Read as: ' + cat.alternatives.map(alt => alt.join(' and ')).join(', or ') + '.');
    }
    const hasCourses = cat.courses?.length > 0;
    const defaultOpen = analysis ? (r?.status !== 'complete' && !r?.isExempt) : cat.courses?.length <= 12;
    const open = openLists.has(cat.slug) ? openLists.get(cat.slug) : defaultOpen;
    const activeHere = (r?.courseAnnotations || []).filter(a => (a.isTaken || a.isInProgress) && !isExtra(a));
    // The whole card collapses to its header (CSS hides the rest; the DOM stays the same).
    const cardKey = 'card:' + cat.slug;
    const expanded = openLists.has(cardKey) ? openLists.get(cardKey) : true;

    return h('article', { class: 'req' + (cat.type === 'tag' ? ' is-tag' : '') + (status ? ' status-' + status.cls : '')
      + (expanded ? '' : ' is-collapsed'), id: cat.slug, dataset: { coreIndex: cat.coreIndex } },
      h('header', { class: 'req-header' },
        h('h3', { class: 'req-name' }, cat.name),
        cat.type === 'tag' ? h('span', { class: 'tag-label' }, 'Overlaps other requirements') : null,
        status ? h('span', { class: 'status-pill status-' + status.cls }, status.text) : null,
        withPlan ? h('span', { class: 'status-pill status-plan' }, 'With plan: ' + withPlan.text) : null,
        collapseButton(h, cat.name, expanded, cardKey, state.onListToggle)),
      wording(cat.instructions),
      notes.map(n => h('p', { class: 'req-note' }, n)),
      hoursLine(cat, r),
      activeHere.length && !open ? h('p', { class: 'req-taken' }, 'Counted: ',
        activeHere.map((a, i) => [i ? ', ' : '', a.code])) : null,
      extraCourses(cat, r),
      r?.isExempt ? h('p', { class: 'req-note' }, 'Academic Progress lists an exemption for this requirement.') : null,
      r?.workdaySatisfied ? workdaySatisfiedNote(r.workdaySatisfied) : null,
      mismatchesFor(cat.name).map(m => h('p', { class: 'req-note is-mismatch' },
        `Workday says ${m.workdayStatus}. `, h('a', { href: '#workday-mismatches' }, 'See the report above.'))),
      hasCourses ? h('details', { class: 'course-options', open: open || null,
        ontoggle: e => state.onListToggle?.(cat.slug, e.target.open) },
        h('summary', {}, `Course options (${cat.courses.length})`),
        courseList(cat, r)) : null,
      h('p', { class: 'req-source' }, h('a', { href: requirementUrl(meta, cat.coreId), target: '_blank', rel: 'noopener' },
        `View in the ${catalogLabel(meta)} catalog`)));
  }

  function summary() {
    if (!analysis) return null;
    const groups = [];
    let cur = null;
    for (const cat of catalog.categories) {
      if (cat.type === 'section-header') { cur = { section: cat, items: [] }; groups.push(cur); continue; }
      const r = resultsByIndex.get(cat.coreIndex);
      if (!cur || !r || r.status === 'info-only') continue;
      cur.items.push({ cat, r });
    }
    const ku = kuStatus(analysis);
    const countable = groups.flatMap(g => g.items).filter(({ cat }) => !KU_NAMES.includes(cat.name));
    const isDone = r => r && (r.status === 'complete' || r.isExempt);
    const done = countable.filter(({ r }) => isDone(r)).length + (ku?.met ? 1 : 0);
    const total = countable.length + (ku ? 1 : 0);
    let planLine = null;
    if (projection) {
      const pku = kuStatus(projection);
      const pdone = countable.filter(({ cat }) => isDone(projectedByIndex.get(cat.coreIndex))).length + (pku?.met ? 1 : 0);
      planLine = h('p', { class: 'summary-plan' }, `With your planned courses: ${pdone} of ${total} met`
        + (pku && !ku?.met ? `, K&U ${fmtHours(pku.totalHours)} of ${pku.requiredHours} hrs in ${pku.categoriesUsed} of ${pku.requiredCategories} categories` : '') + '.');
    }

    return h('section', { class: 'summary', 'aria-label': 'Summary' },
      h('h2', {}, `${done} of ${total} requirements met`),
      h('p', { class: 'summary-sub' }, 'By this tool’s reading of the catalog. Workday may differ.'),
      planLine,
      groups.filter(g => g.items.length).map(g => h('div', { class: 'summary-group' },
        h('h3', {}, g.section.section),
        KU_NAMES.includes(g.items[0].cat.name) && ku ? kuMeter(ku) : null,
        KU_NAMES.includes(g.items[0].cat.name) && ku?.workdaySatisfied ? workdaySatisfiedNote(ku.workdaySatisfied) : null,
        h('ul', { class: 'summary-chips' }, g.items.map(({ cat, r }) => {
          const s = statusInfo(r) || { cls: 'muted', text: '' };
          const isKU = KU_NAMES.includes(cat.name);
          const label = isKU ? kuChipLabel(r) : s.text;
          return h('li', {}, h('a', { href: '#' + cat.slug, class: 'summary-chip status-' + s.cls },
            h('span', { class: 'chip-name' }, cat.name), h('span', { class: 'chip-value' }, label),
            isKU && r.roomHours != null ? h('span', { class: 'chip-room' + (r.roomHours > 0 ? ' has-room' : '') },
              r.roomHours > 0 ? `Room for ${fmtHours(r.roomHours)} more` : 'Full') : null));
        })),
        KU_NAMES.includes(g.items[0].cat.name) && ku ? kuOpportunities(ku, g.items.map(i => i.r)) : null)));
  }

  function workdaySatisfiedNote(ws) {
    return h('p', { class: 'req-note is-workday' }, 'Workday Academic Progress shows this as Satisfied',
      ws.items.length ? [' with: ', ws.items.map((item, i) => [i ? '; ' : '', h('strong', {}, item)])] : ' (nothing listed under it)',
      '. This tool doesn’t know how that counts, so it goes by Workday.');
  }

  function kuChipLabel(r) {
    return r.maxHours != null ? `${fmtHours(r.hoursEffective)} of ${r.maxHours} hrs` : `${fmtHours(r.hoursEffective)} hrs`;
  }

  // Where more K&U hours would still count, most useful first: categories below
  // their minimum, then unused ones (if more categories are needed), then the rest.
  function kuOpportunities(ku, results) {
    if (ku.met) return null;
    const needHours = Math.max(0, ku.requiredHours - ku.totalHours);
    const needCategories = ku.categoriesUsed < ku.requiredCategories;
    const rank = r => r.status === 'incomplete' ? 0 : needCategories && r.hoursEarned === 0 ? 1 : 2;
    const open = results.filter(r => r.roomHours > 0)
      .sort((a, b) => rank(a) - rank(b) || b.roomHours - a.roomHours);
    const full = results.filter(r => r.roomHours === 0 && r.hoursEarned > 0);
    const totalRoom = open.reduce((s, r) => s + r.roomHours, 0);
    const lead = [needHours > 0 ? `${fmtHours(needHours)} more hrs` : null,
      needCategories ? `${ku.requiredCategories - ku.categoriesUsed} more ${ku.requiredCategories - ku.categoriesUsed === 1 ? 'category' : 'categories'}` : null]
      .filter(Boolean).join(' and ');
    return h('div', { class: 'ku-opportunities' },
      h('p', { class: 'ku-opp-lead' }, lead ? `K&U needs ${lead}. Where more hours would count:` : 'Where more K&U hours would count:'),
      open.length ? h('ul', {}, open.map(r => {
        const why = [];
        if (r.status === 'incomplete') why.push(`${fmtHours(r.minHours - r.hoursEarned)} needed for its minimum`);
        else if (needCategories && r.hoursEarned === 0) why.push('adds a category');
        const maxed = [...(r.maxedDisciplines || [])];
        if (maxed.length) why.push(`not ${maxed.join(' or ')}, which ${maxed.length === 1 ? 'is' : 'are'} full`);
        return h('li', {}, h('a', { href: '#' + r.slug }, r.name), `: up to ${fmtHours(r.roomHours)} more hrs`,
          why.length ? ` (${why.join('; ')})` : '');
      })) : null,
      full.length ? h('p', { class: 'ku-opp-full' }, 'Full, so more hours there won’t count: ', categoryLinks(full.map(r => r.name)), '.') : null,
      totalRoom < needHours ? h('p', { class: 'ku-opp-full' }, `Only ${fmtHours(totalRoom)} more hrs can count across these categories.`) : null);
  }

  function kuMeter(ku) {
    const pct = Math.min(100, Math.round(ku.totalHours / ku.requiredHours * 100));
    return h('div', { class: 'ku-meter' + (ku.met ? ' is-met' : '') },
      h('div', { class: 'ku-numbers' },
        h('span', {}, h('strong', {}, `${fmtHours(ku.totalHours)} of ${ku.requiredHours}`), ' hrs'),
        h('span', {}, h('strong', {}, `${ku.categoriesUsed} of ${ku.requiredCategories}`), ' categories')),
      h('div', { class: 'meter', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': ku.requiredHours, 'aria-valuenow': ku.totalHours },
        h('div', { class: 'meter-fill', style: `width:${pct}%` })));
  }

  function warnings() {
    if (!analysis) return null;
    const items = [];
    for (const w of analysis.warnings || []) {
      items.push(h('li', {}, h('strong', {}, w.code), w.title ? ' ' + w.title : '', ` (${fmtHours(w.hours)} hrs): ${w.reason}. `,
        w.requirement === 'K&U' ? 'Your K&U totals may be too low.'
          : h('span', {}, 'So it isn’t counted toward ', categoryLinks([w.requirement]), ' here.')));
    }
    for (const c of analysis.notCounted || []) {
      items.push(h('li', {}, h('strong', {}, c.code), c.title ? ' ' + c.title : '',
        ` has grade ${c.grade}, so it isn’t counted toward any requirement.`));
    }
    for (const r of analysis.results) {
      for (const a of r.courseAnnotations || []) {
        if (a.isExcludedTransfer) items.push(h('li', {}, h('strong', {}, a.code),
          ` is transfer credit, which `, h('a', { href: '#' + r.slug }, r.name), ' doesn’t accept, so it isn’t counted there.'));
      }
    }
    if (items.length === 0) return null;
    return h('section', { class: 'callout callout-warn' }, h('h2', {}, 'Check these in Workday'), h('ul', {}, items));
  }

  // Loud: Workday and this tool disagree, so one of them is wrong.
  function mismatches() {
    const list = (analysis?.workdayChecks || []).filter(c => c.kind === 'mismatch');
    if (list.length === 0) return null;
    return h('section', { class: 'callout callout-mismatch', id: 'workday-mismatches', role: 'alert' },
      h('h2', {}, list.length === 1 ? 'Workday disagrees with this tool' : `Workday disagrees with this tool on ${list.length} requirements`),
      h('p', {}, 'Go with Workday. This is probably a bug in this tool: please copy the report below and send it to the developer. It lists your courses but not your name or ID.'),
      list.map(m => {
        const report = bugReport(analysis, m, { catalog: meta, source, testCase });
        const area = h('textarea', { readonly: true, rows: 10, 'aria-label': 'Bug report for ' + m.requirement }, report);
        const copy = h('button', { type: 'button', class: 'button', onclick: async e => {
          try { await doc.defaultView.navigator.clipboard.writeText(report); e.target.textContent = 'Copied'; }
          catch { area.select(); }
        } }, 'Copy report');
        return h('div', { class: 'mismatch', dataset: { requirement: m.requirement } },
          h('p', { class: 'mismatch-line' }, h('strong', {}, m.requirement === 'K&U' ? 'Knowledge and Understanding' : m.requirement),
            `: Workday says ${m.workdayStatus}; this tool says ${OUR_STATUS_TEXT[m.ourStatus] || m.ourStatus}.`),
          h('details', { class: 'bug-report' }, h('summary', {}, 'Bug report'), area, copy));
      }));
  }

  function historyNotice() {
    if (state.format !== 'transcript' || !analysis) return null;
    return h('section', { class: 'callout callout-warn' }, h('h2', {}, 'Academic History isn’t fully supported'),
      h('p', {}, 'Academic History doesn’t show which courses are transfer credit, are in progress, or count where in Workday, so these results may be wrong. Use your Academic Progress page instead, ideally its Excel export.'));
  }

  // Interpretations this result depends on, listed only when they apply.
  function assumptions() {
    if (!analysis) return null;
    const items = [];
    const all = analysis.results.flatMap(r => (r.courseAnnotations || []).map(a => ({ r, a })));
    const active = all.filter(({ a }) => (a.isTaken || a.isInProgress) && !a.isExcludedTransfer);
    if (active.some(({ a }) => a.isFromOtherCatalog)) items.push('A course listed for a requirement in another catalog year is counted toward that requirement too (courses get renumbered between years).');
    if (active.some(({ a }) => a.isFromWorkday)) items.push('A course your Workday Academic Progress lists under a requirement counts toward it, even if the catalog doesn’t list it there.');
    if (active.some(({ a }) => a.isAssumed)) items.push('Transfer or AP credit without a course number is placed by its subject, e.g. HIST counts as History.');
    const catByName = new Map(catalog.categories.filter(c => c.name).map(c => [c.name, c]));
    const unconfirmed = active.filter(({ r, a }) => (a.otherCategories || [])
      .some(n => !doubleCountConfirmed(catByName.get(r.name), catByName.get(n))));
    if (unconfirmed.length) {
      const codes = [...new Set(unconfirmed.map(({ a }) => a.code))].join(', ');
      items.push(`A course listed under several requirements counts toward each of them (${codes}).`);
    }
    if (active.some(({ a }) => a.isInProgress)) items.push('In-progress courses are counted as if completed.');
    if (analysis.plannedCourses?.length) {
      items.push(projection
        ? 'Planned courses count only in the “With plan” results, with hours from the course schedule (the lowest, if a course’s hours vary).'
        : 'Planned courses are shown but not counted.');
    }
    if (items.length === 0) return null;
    return h('section', { class: 'callout' }, h('h2', {}, 'This result assumes'), h('ul', {}, items.map(t => h('li', {}, t))));
  }

  function transcriptTable() {
    const transcript = analysis?.transcript;
    if (!transcript?.length) return null;
    const where = new Map();
    for (const r of analysis.results) {
      for (const a of r.courseAnnotations || []) {
        if (!(a.isTaken || a.isInProgress) || a.isExcludedTransfer) continue;
        if (!where.has(a.code)) where.set(a.code, []);
        where.get(a.code).push(r.name);
      }
    }
    const statusText = { 'in-progress': 'In progress', transfer: 'Transfer', exemption: 'Exemption', completed: '' };
    return h('section', { class: 'transcript' },
      h('h2', {}, `Your courses (${transcript.length})`),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Course', 'Title', 'Grade', 'Hrs', 'Counts toward'].map(t => h('th', {}, t)))),
        h('tbody', {}, transcript.map(c => {
          const names = where.get(c.code) || [];
          const notCounted = analysis.notCounted?.includes(c);
          return h('tr', {},
            h('td', {}, h('strong', {}, c.code || '—'), statusText[c.status] ? h('span', { class: 'cell-status' }, statusText[c.status]) : null),
            h('td', {}, c.title),
            h('td', {}, c.grade || '—'),
            h('td', {}, fmtHours(c.hours)),
            h('td', {}, notCounted ? h('span', { class: 'muted' }, `not counted (grade ${c.grade})`)
              : names.length ? categoryLinks(names) : h('span', { class: 'muted' }, 'none')));
        })))));
  }

  // Collapsed at the bottom: this record as a test case, for advisors to send
  // to the developer.
  function testCaseSection() {
    const area = h('textarea', { readonly: true, rows: 12, 'aria-label': 'De-identified test case' }, testCase);
    return h('details', { class: 'test-case' },
      h('summary', {}, 'Test case for the developer'),
      h('p', {}, 'This record as a test case: grades are reduced to A (A through C), D, or F; years are shifted to start at 2000; and Workday requirements outside the core are dropped. The course list stays, so share it only with the developer.'),
      area,
      h('button', { type: 'button', class: 'button', onclick: async e => {
        try { await doc.defaultView.navigator.clipboard.writeText(testCase); e.target.textContent = 'Copied'; }
        catch { area.select(); }
      } }, 'Copy test case'));
  }

  // Where section lists and hours come from, and that they go stale.
  function scheduleNote() {
    if (!shownTerms.length) return null;
    const terms = shownTerms.map(t => `${t.label} (as of ${fmtDate(t.savedAt)})`).join(' and ');
    return h('p', { class: 'schedule-note' }, `Sections listed under courses are from the course schedule for ${terms}. `
      + 'Sections get added, cancelled, and filled, so check Workday when you register. Section-specific tags (such as one section of a course tagged Diversity and Difference) aren’t shown.');
  }

  const body = [];
  body.push(historyNotice(), mismatches(), warnings(), summary(), assumptions(), scheduleNote());
  for (const cat of catalog.categories) {
    if (cat.type === 'section-header') {
      body.push(h('section', { class: 'req-section', id: cat.slug, dataset: { coreIndex: cat.coreIndex } },
        h('h2', { class: 'req-section-title' }, cat.section),
        wording(cat.instructions)));
    } else {
      const sections = body.filter(el => el?.classList?.contains('req-section'));
      const container = sections[sections.length - 1];
      if (container) container.append(requirementCard(cat));
      else body.push(requirementCard(cat));
    }
  }
  body.push(transcriptTable());
  if (analysis && testCase) body.push(testCaseSection());
  root.replaceChildren(...body.filter(Boolean));
  if (state.tocRoot) renderToc(state.tocRoot, state);
}

const TOC_ICONS = { done: '✓', min: '◔', todo: '○', optional: '○' };

// Contents sidebar: every section and requirement, with its status at a glance.
// Links go to the ids renderApp gives sections and cards.
export function renderToc(root, state) {
  const h = builder(root.ownerDocument);
  const { catalog, analysis } = state;
  const resultsByIndex = new Map((analysis?.results || []).map(r => [r.coreIndex, r]));
  const ku = analysis && kuStatus(analysis);
  function tocLink(cat, label, cls, status) {
    return h('li', {}, h('a', { href: '#' + cat.slug, class: 'toc-link ' + cls + (status ? ' status-' + status.cls : ''),
      dataset: { slug: cat.slug }, title: status ? `${label}: ${status.text}` : null },
      h('span', { class: 'toc-label' }, label),
      status ? h('span', { class: 'toc-status', 'aria-label': status.text }, TOC_ICONS[status.cls] || '') : null));
  }
  const items = catalog.categories.map(cat => {
    if (cat.type !== 'section-header') {
      return tocLink(cat, cat.name, cat.type === 'tag' ? 'toc-tag' : 'toc-req',
        requirementStatus(cat, resultsByIndex.get(cat.coreIndex), analysis));
    }
    // K&U's section status is the aggregate (hours and categories).
    const isKu = catalog.categories.some(c => c.section === cat.section && KU_NAMES.includes(c.name));
    const status = isKu && ku ? { cls: ku.met ? 'done' : 'todo',
      text: `${fmtHours(ku.totalHours)} of ${ku.requiredHours} hrs, ${ku.categoriesUsed} of ${ku.requiredCategories} categories` } : null;
    return tocLink(cat, cat.section, 'toc-section', status);
  });
  root.replaceChildren(h('h2', { class: 'toc-title' }, 'Contents'), h('ol', { class: 'toc-list' }, items));
}

// Core requirements met, counted the same way as the summary's "N of M
// requirements met" (K&U as one requirement), plus how many of the rest have an
// in-progress course counted. { done, inProgress, total }
export function coreProgress(catalog, analysis) {
  const resultsByIndex = new Map(analysis.results.map(r => [r.coreIndex, r]));
  const items = [];
  let inSection = false;
  for (const cat of catalog.categories) {
    if (cat.type === 'section-header') { inSection = true; continue; }
    const r = resultsByIndex.get(cat.coreIndex);
    if (inSection && r && r.status !== 'info-only') items.push({ cat, r });
  }
  const ku = kuStatus(analysis);
  const isKU = ({ cat }) => KU_NAMES.includes(cat.name);
  const countable = items.filter(i => !isKU(i));
  const isDone = r => r.status === 'complete' || r.isExempt;
  const kuInProgress = ku && !ku.met && items.some(i => isKU(i) && i.r.inProgressCount > 0);
  return {
    done: countable.filter(({ r }) => isDone(r)).length + (ku?.met ? 1 : 0),
    inProgress: countable.filter(({ r }) => !isDone(r) && r.inProgressCount > 0).length + (kuInProgress ? 1 : 0),
    total: countable.length + (ku ? 1 : 0),
  };
}

// A program's requirements by Workday's status. { done, inProgress, total }
export function programProgress(group) {
  const n = status => group.requirements.filter(r => r.status === status).length;
  return { done: n('Satisfied'), inProgress: n('In Progress'), total: group.requirements.length };
}

// Workday names minors "... Minor"; everything else (majors, a pasted page's
// unnamed group) goes on the Major tab.
export const isMinor = group => /\bminor\b/i.test(group.name || '');

const pct = p => (p.total ? Math.round((100 * p.done) / p.total) : null);

// Donut for one progress: satisfied, in progress, and remaining arcs, with a 2px
// surface gap between them. The percentage is satisfied of total; in-progress
// requirements show as their own arc but don't count toward it.
function donut(doc, p, label) {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, ...kids) => {
    const e = doc.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    e.append(...kids);
    return e;
  };
  const r = 52, width = 14, c = 2 * Math.PI * r, gap = 2;
  const svg = el('svg', { viewBox: '0 0 140 140', width: 140, height: 140, class: 'donut', role: 'img',
    'aria-label': `${label}: ${p.done} of ${p.total} satisfied, ${p.inProgress} in progress` });
  const segments = [['done', p.done, 'satisfied'], ['progress', p.inProgress, 'in progress'],
    ['remaining', p.total - p.done - p.inProgress, 'remaining']].filter(([, n]) => n > 0);
  let offset = 0;
  for (const [kind, n, word] of segments) {
    const len = (c * n) / p.total;
    const drawn = segments.length > 1 ? Math.max(len - gap, 0.5) : len;
    svg.append(el('circle', { cx: 70, cy: 70, r, fill: 'none', 'stroke-width': width, class: 'donut-' + kind,
      'stroke-dasharray': `${drawn} ${c - drawn}`, 'stroke-dashoffset': -offset, transform: 'rotate(-90 70 70)' },
    el('title', {}, `${n} ${word}`)));
    offset += len;
  }
  if (!segments.length) svg.append(el('circle', { cx: 70, cy: 70, r, fill: 'none', 'stroke-width': width, class: 'donut-remaining' }));
  const value = pct(p);
  svg.append(el('text', { x: 70, y: 70, class: 'donut-value', 'text-anchor': 'middle', 'dominant-baseline': 'central' },
    value == null ? '—' : `${value}%`));
  return svg;
}

// Dashboard: progress donuts for everything, the core, and each major and minor.
// state: { catalog, analysis, groups }
export function renderDashboard(root, state) {
  const doc = root.ownerDocument;
  const h = builder(doc);
  const { catalog, analysis, groups = [], checks = new Map() } = state;
  if (!analysis) {
    root.replaceChildren(h('p', { class: 'programs-empty' }, 'Upload your Academic Progress export to see your progress.'));
    return;
  }
  const core = coreProgress(catalog, analysis);
  const programs = groups.map(g => {
    const check = checks.get(g.name);
    return { g, p: check ? check.result : programProgress(g),
      source: check ? `By this tool’s reading of the ${catalogLabel({ catalogYear: check.program.catalogYear })} catalog. Workday may differ.` : 'By Workday’s status.' };
  });
  const sum = key => core[key] + programs.reduce((s, { p }) => s + p[key], 0);
  const all = { done: sum('done'), inProgress: sum('inProgress'), total: sum('total') };
  const card = (title, p, source, tab, extra) => h('section', { class: 'dash-card' + (extra || '') },
    h('h3', {}, title),
    donut(doc, p, title),
    h('p', { class: 'dash-count' }, `${p.done} of ${p.total} requirements satisfied`),
    p.inProgress ? h('p', { class: 'dash-sub' }, `${p.inProgress} more in progress`) : null,
    h('p', { class: 'dash-source' }, source),
    tab ? h('button', { type: 'button', class: 'link-button dash-open', dataset: { openTab: tab } }, 'See requirements →') : null);
  const majors = programs.filter(({ g }) => !isMinor(g));
  const minors = programs.filter(({ g }) => isMinor(g));
  root.replaceChildren(
    h('section', { class: 'programs-intro' },
      h('h2', {}, 'Your progress'),
      h('p', {}, 'Requirements satisfied out of all listed. In-progress courses show as their own part of each ring but don’t count toward the percentage until they’re done.'),
      h('ul', { class: 'dash-legend', 'aria-label': 'Legend' },
        h('li', {}, h('span', { class: 'swatch donut-done', 'aria-hidden': 'true' }), 'Satisfied'),
        h('li', {}, h('span', { class: 'swatch donut-progress', 'aria-hidden': 'true' }), 'In progress'),
        h('li', {}, h('span', { class: 'swatch donut-remaining', 'aria-hidden': 'true' }), 'Remaining'))),
    h('div', { class: 'dash-grid' },
      card('All requirements', all, checks.size
        ? 'Calvin Core and checked programs by this tool’s reading; the rest by Workday’s status.'
        : 'Calvin Core by this tool’s reading; major and minor by Workday’s status.', null, ' is-overall'),
      card('Calvin Core', core, 'By this tool’s reading of the catalog. Workday may differ.', 'core'),
      ...(majors.length ? majors.map(({ g, p, source }) => card(g.name || 'Major and other requirements', p, source, 'major'))
        : [h('section', { class: 'dash-card is-empty' }, h('h3', {}, 'Major'), h('p', { class: 'dash-source' }, 'Workday doesn’t list a major in this record.'))]),
      ...(minors.length ? minors.map(({ g, p, source }) => card(g.name, p, source, 'minor'))
        : [h('section', { class: 'dash-card is-empty' }, h('h3', {}, 'Minor'), h('p', { class: 'dash-source' }, 'Workday doesn’t list a minor in this record.'))])));
}

// Major or Minor page, one block per program Workday lists. A program with a
// program file for the selected catalog year (checks: name → { program, result },
// from findProgram/checkProgram in core.js) shows this tool's check of it, with
// Workday's listing below for comparison. Others show Workday's listing only,
// exactly as Workday lists it, under a summary box like the core's.
// state: { groups, hasInput, kind: 'major' | 'minor', checks, schedule }
const WORKDAY_STATUS_CLS = { Satisfied: 'done', 'In Progress': 'min', 'Not Satisfied': 'todo' };
const CHECK_STATUS = { done: ['done', 'Complete'], progress: ['min', 'In progress'], todo: ['todo', 'Not yet'] };
export function renderPrograms(root, state) {
  const h = builder(root.ownerDocument);
  const { groups = [], hasInput, kind = 'major', checks = new Map(), schedule = null,
    openLists = new Map(), onListToggle, catalogCourses = new Map() } = state;
  const listState = { schedule, openLists, onListToggle };
  const noun = kind === 'minor' ? 'minor' : 'major';
  if (!groups.length) {
    root.replaceChildren(h('p', { class: 'programs-empty' }, hasInput
      ? `Your Academic Progress doesn’t list a ${noun}.`
      : `Upload your Academic Progress export to see your ${noun} requirements.`));
    return;
  }
  const workdayNote = h('p', { class: 'programs-note' },
    'Workday’s listings are shown as Workday lists them: this tool doesn’t check them, and Workday is the official record. Core requirements are on the Calvin Core tab; GPA requirements aren’t shown here.');
  const slug = (g, i) => `${kind}-${groups.indexOf(g)}-req-${i}`;

  // Everything below is built from the same pieces as the Core page: a
  // .req-section per heading, a .req card per requirement, and a .course-list
  // of .course rows, where a course the student took is a green row with a chip.
  const connector = text => h('li', { class: 'course-connector', dataset: { kind: 'connector' } }, text);
  const hoursText = hours => (hours != null ? ` · ${fmtHours(hours)} hrs` : '');
  const cardState = key => (openLists.has(key) ? openLists.get(key) : true);

  // A Workday item: "CS 108 - Introduction to Computing (In Progress)", or other
  // text such as an exemption.
  const WORKDAY_ITEM_RE = /^([A-Z]{2,5} \d{3}[A-Z]?) - (.+?)( \(In Progress\))?$/;
  function workdayItem(item) {
    const m = WORKDAY_ITEM_RE.exec(item.text);
    const flags = [];
    if (m) {
      flags.push(m[3]
        ? h('span', { class: 'chip chip-progress' }, `In progress${hoursText(item.hours)}`)
        : h('span', { class: 'chip chip-taken' }, `Taken${hoursText(item.hours)}`));
    } else if (item.hours != null) {
      flags.push(h('span', { class: 'chip chip-hours' }, `${fmtHours(item.hours)} hrs`));
    }
    if (item.period) flags.push(h('span', { class: 'chip chip-hours' }, item.period));
    return h('li', { class: 'course is-active' },
      m ? [h('span', { class: 'course-code' }, m[1]), h('span', { class: 'course-title' }, m[2])]
        : h('span', { class: 'course-title' }, item.text),
      flags.length ? h('span', { class: 'course-flags' }, flags) : null);
  }

  // Workday's requirements for a program, verbatim.
  function workdayCards(g) {
    return g.requirements.map((r, i) => {
      const cls = WORKDAY_STATUS_CLS[r.status] || 'optional';
      const key = 'card:' + slug(g, i);
      const expanded = cardState(key);
      return h('article', { class: 'req status-' + cls + (expanded ? '' : ' is-collapsed'), id: slug(g, i) },
        h('header', { class: 'req-header' },
          h('h3', { class: 'req-name' }, r.name),
          r.status ? h('span', { class: 'status-pill status-' + cls }, r.status) : null,
          collapseButton(h, r.name, expanded, key, onListToggle)),
        r.remaining && r.status !== 'Satisfied' ? h('p', { class: 'req-note' }, 'Remaining: ' + r.remaining) : null,
        r.items.length ? h('ul', { class: 'course-list' }, r.items.map(workdayItem)) : null);
    });
  }

  function workdayOnly(g) {
    const p = programProgress(g);
    return [h('section', { class: 'summary', 'aria-label': `${g.name || 'Requirements'} summary` },
      h('h2', {}, `${p.done} of ${p.total} requirements satisfied`),
      h('p', { class: 'summary-sub' }, `${g.name || 'From your Academic Progress'}: by Workday’s status${p.inProgress ? `; ${p.inProgress} in progress` : ''}.`
        + (g.total != null && g.satisfied != null ? ` (Workday’s own count, with any core and GPA requirements in this program: ${fmtHours(g.satisfied)} of ${fmtHours(g.total)}.)` : '')),
      h('ul', { class: 'summary-chips' }, g.requirements.map((r, i) => {
        const cls = WORKDAY_STATUS_CLS[r.status] || 'optional';
        return h('li', {}, h('a', { href: '#' + slug(g, i), class: 'summary-chip status-' + cls },
          h('span', { class: 'chip-name' }, r.name), h('span', { class: 'chip-value' }, r.status || '')));
      }))),
    h('section', { class: 'req-section' },
      h('h2', { class: 'req-section-title' }, g.name || 'From your Academic Progress'),
      workdayCards(g))];
  }

  // The chip for a course on the student's record, worded like the Core page.
  function takenChip(m) {
    return m.status === 'done'
      ? h('span', { class: 'chip chip-taken' }, `Taken${m.grade ? ` · ${m.grade}` : ''}${hoursText(m.hours)}`)
      : h('span', { class: 'chip chip-progress' }, `In progress${hoursText(m.hours)}`);
  }

  // One course option's row. A lab (lectureCode set) is its own row under its
  // lecture, with its title and hours from the student's record when it's there.
  function programCourse(program, courses, itemId, code, credits, matched, lectureCode = null) {
    const info = courses.get(code);
    const m = matched.find(x => x.code === code);
    const isLab = lectureCode != null;
    const missing = isLab && !m && matched.some(x => x.code === lectureCode);
    const flags = [];
    if (m) flags.push(takenChip(m));
    else if (missing) flags.push(h('span', { class: 'chip chip-excluded' }, 'Not on your record'));
    else if (credits != null) flags.push(h('span', { class: 'chip chip-hours', title: 'Hours the catalog lists' }, `${credits} hrs`));
    const title = m?.title || program.titles?.[code] || info?.title || (isLab ? `Lab for ${lectureCode}` : '');
    return h('li', { class: 'course' + (m ? ' is-active' : '') + (missing ? ' is-excluded' : '') + (isLab ? ' is-lab' : ''),
      dataset: { kind: 'course', code } },
      info?.url
        ? h('a', { class: 'course-code', href: info.url, target: '_blank', rel: 'noopener', title: 'Course description in the official catalog' }, code)
        : h('span', { class: 'course-code' }, code),
      h('span', { class: 'course-title' }, title),
      flags.length ? h('span', { class: 'course-flags' }, flags) : null,
      m || missing ? null : offeredSectionsList(h, listState, `sections:${itemId}:${code}`, code));
  }

  // The rows of a requirement: its options (joined by Or/And where the catalog
  // lists alternatives) or a group's courses, each lecture followed by its lab.
  // A repeatable seminar lists each semester you took it, oldest first, then
  // the course itself again until the semesters are all there.
  function optionRows(program, courses, item, itemId) {
    const credits = code => (item.kind === 'group' ? item.courses.find(c => c.code === code)?.credits : item.credits);
    const rowsFor = (code, matched = item.matched) => [
      programCourse(program, courses, itemId, code, credits(code), matched),
      ...(program.labs?.[code] ? [programCourse(program, courses, itemId, program.labs[code], null, matched, code)] : []),
    ];
    if (item.kind === 'group') return item.courses.flatMap(c => rowsFor(c.code));
    if (item.occurrences) {
      const semesterRow = term => {
        const info = courses.get(term.code);
        return h('li', { class: 'course is-active', dataset: { kind: 'course', code: term.code } },
          info?.url
            ? h('a', { class: 'course-code', href: info.url, target: '_blank', rel: 'noopener', title: 'Course description in the official catalog' }, term.code)
            : h('span', { class: 'course-code' }, term.code),
          h('span', { class: 'course-title' }, term.title || program.titles?.[term.code] || info?.title || ''),
          h('span', { class: 'course-flags' }, takenChip(term),
            term.period ? h('span', { class: 'chip chip-hours' }, term.period) : null));
      };
      return [...item.occurrences.terms.map(semesterRow),
        ...(item.status === 'done' ? [] : item.options.flat().flatMap(code => rowsFor(code, [])))];
    }
    const seen = new Set();
    return item.options.flatMap((option, i) => {
      const codes = option.filter(code => !seen.has(code));
      codes.forEach(code => seen.add(code));
      return codes.length ? [i ? connector('Or') : null, ...codes.flatMap((code, j) => [j ? connector('And') : null, ...rowsFor(code)])] : [];
    });
  }

  // What the status pill and summary chip say: hours for a group, "2 of 3
  // semesters" for a seminar still short, otherwise Complete / In progress / Not yet.
  function pillText(item) {
    if (item.kind === 'group') return `${fmtHours(item.hours)} of ${item.minHours} hrs`;
    if (item.occurrences && item.status !== 'done' && item.status !== 'todo') {
      return `${item.occurrences.completed} of ${item.occurrences.required} semesters`;
    }
    return CHECK_STATUS[item.status][1];
  }

  function checkedCard(program, courses, item, itemId) {
    const cls = CHECK_STATUS[item.status][0];
    const codes = item.kind === 'group' ? item.courses.map(c => c.code) : [...new Set(item.options.flat())];
    const single = item.kind !== 'group' && codes.length === 1;
    const cardKey = 'card:' + itemId;
    const expanded = cardState(cardKey);
    // Like the Core page, a list opens until the requirement is met; it also
    // stays open when it holds courses you took, so they show in green.
    const open = openLists.has(itemId) ? openLists.get(itemId) : item.status !== 'done' || item.matched.length > 0;
    const rows = optionRows(program, courses, item, itemId);
    const counted = item.matched.filter(m => !m.lab);
    return h('article', { class: 'req status-' + cls + (expanded ? '' : ' is-collapsed'), id: itemId },
      h('header', { class: 'req-header' },
        h('h3', { class: 'req-name' }, item.label),
        h('span', { class: 'status-pill status-' + cls }, pillText(item)),
        collapseButton(h, item.label, expanded, cardKey, onListToggle)),
      item.kind === 'group' && item.inProgressHours ? h('p', { class: 'req-hours' }, `${fmtHours(item.inProgressHours)} more hrs in progress.`) : null,
      item.occurrences?.inProgress ? h('p', { class: 'req-hours' },
        `${item.occurrences.inProgress} more semester${item.occurrences.inProgress === 1 ? '' : 's'} in progress.`) : null,
      item.note ? h('p', { class: 'req-note' }, item.note) : null,
      item.missingLabs.length ? h('p', { class: 'req-note is-mismatch' },
        `${item.missingLabs.join(', ')} ${item.missingLabs.length === 1 ? 'isn’t' : 'aren’t'} on your record. The catalog lists ${item.missingLabs.length === 1 ? 'it' : 'them'} as a corequisite, so the course counts only with it.`) : null,
      !single && !open && counted.length ? h('p', { class: 'req-taken' }, 'Counted: ', counted.map((m, i) => [i ? ', ' : '', m.code])) : null,
      single
        ? h('ul', { class: 'course-list' }, rows)
        : h('details', { class: 'course-options', open: open || null, ontoggle: e => onListToggle?.(itemId, e.target.open) },
          h('summary', {}, `Course options (${codes.length})`),
          h('ol', { class: 'course-list' }, rows)));
  }

  function checked(g, { program, result }) {
    const year = catalogLabel({ catalogYear: program.catalogYear });
    const itemId = item => `${kind}-${program.id}-${item.id}`;
    const courses = catalogCourses.get(`${program.id}-${program.catoid}`) || new Map();
    const summaryBox = h('section', { class: 'summary', 'aria-label': `${program.programName} summary` },
      h('h2', {}, `${result.done} of ${result.total} requirements met`),
      h('p', { class: 'summary-sub' }, `${program.programName}: by this tool’s reading of the `,
        h('a', { href: program.sourceUrl, target: '_blank', rel: 'noopener' }, `${year} catalog`),
        `${result.inProgress ? `; ${result.inProgress} more in progress` : ''}. Workday may differ.`),
      h('ul', { class: 'summary-chips' }, result.items.map(item => {
        const cls = CHECK_STATUS[item.status][0];
        return h('li', {}, h('a', { href: '#' + itemId(item), class: 'summary-chip status-' + cls },
          h('span', { class: 'chip-name' }, item.label),
          h('span', { class: 'chip-value' }, pillText(item))));
      })));
    const sections = [...new Set(result.items.map(i => i.section))].map(section =>
      h('section', { class: 'req-section' },
        h('h2', { class: 'req-section-title' }, section),
        result.items.filter(i => i.section === section).map(item => checkedCard(program, courses, item, itemId(item)))));
    const unchecked = program.notes?.length || program.manualRequirements?.length
      ? h('section', { class: 'callout program-unchecked' },
        h('h2', {}, 'Not checked here'),
        h('ul', {}, [...(program.notes || []).map(n => h('li', {}, n)),
          ...(program.manualRequirements || []).map(m => h('li', {}, h('strong', {}, m.label + ': '), m.note))]))
      : null;
    const workday = h('details', { class: 'course-options program-workday' },
      h('summary', {}, 'Workday’s listing for this program'),
      workdayCards(g));
    return [summaryBox, ...sections, unchecked, workday];
  }

  root.replaceChildren(...groups.flatMap(g => checks.has(g.name) ? checked(g, checks.get(g.name)) : workdayOnly(g)).filter(Boolean),
    workdayNote);
}
