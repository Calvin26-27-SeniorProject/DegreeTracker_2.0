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
    'Core Planner bug report: Workday and Core Planner disagree',
    context.catalog ? `Catalog: ${catalogLabel(context.catalog)} (catoid ${context.catalog.catoid}, saved ${context.catalog.savedAt})` : null,
    context.source ? `Input: ${context.source}` : null,
    `Requirement: ${check.requirement}`,
    `Workday requirement: ${check.workdayRequirement}`,
    `Workday status: ${check.workdayStatus}`,
    `Core Planner status: ${OUR_STATUS_TEXT[check.ourStatus] || check.ourStatus}`,
    'Workday lists:',
    ...(check.items.length ? check.items.map(i => '  ' + i) : ['  (nothing)']),
    'Core Planner counted:',
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
    const offered = schedule?.offerings[code];
    const terms = shownTerms.filter(t => offered?.[t.term]);
    if (terms.length === 0) return null;
    const key = `sections:${cat.slug}:${code}`;
    const count = list => list.filter(s => !s.lab).length || list.length;
    const label = terms.map(t => {
      const n = count(offered[t.term]);
      return `${t.label}: ${n} section${n === 1 ? '' : 's'}`;
    }).join(' · ');
    return h('details', { class: 'offered', open: openLists.get(key) || null,
      ontoggle: e => state.onListToggle?.(key, e.target.open) },
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

  function sectionList(code, sections) {
    return h('ul', { class: 'section-list' }, sections.map(s => h('li', { class: 'section' },
      h('strong', {}, `${code}-${s.section}`),
      ' ', [s.meets || (s.delivery === 'Online' ? null : 'Time TBA'), s.instructors,
        s.delivery, s.offCampus ? 'Off campus' : null, s.hours != null ? `${s.hours} hrs` : null].filter(Boolean).join(' · '),
      s.period ? h('span', { class: 'section-period' }, s.period) : null,
      s.title ? h('span', { class: 'section-title' }, s.title) : null)));
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

    return h('article', { class: 'req' + (cat.type === 'tag' ? ' is-tag' : '') + (status ? ' status-' + status.cls : ''),
      id: cat.slug, dataset: { coreIndex: cat.coreIndex } },
      h('header', { class: 'req-header' },
        h('h3', { class: 'req-name' }, cat.name),
        cat.type === 'tag' ? h('span', { class: 'tag-label' }, 'Overlaps other requirements') : null,
        status ? h('span', { class: 'status-pill status-' + status.cls }, status.text) : null,
        withPlan ? h('span', { class: 'status-pill status-plan' }, 'With plan: ' + withPlan.text) : null),
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
