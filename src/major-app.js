import { analyzeMajor } from './major.js';
import { isNonPassingGrade } from './core.js';

const normalizeCode = code => String(code || '').trim().replace(/\s+/g, ' ').toUpperCase();
const passed = course => course.status !== 'in-progress'
  && course.status !== 'exemption'
  && !isNonPassingGrade(course.grade);

function periodOrder(period) {
  const match = String(period || '').match(/^(\d{4})\s+(Spring|Summer|Fall|Winter|Interim)$/i);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const season = { winter: 0, interim: 0, spring: 1, summer: 2, fall: 3 }[match[2].toLowerCase()];
  return Number(match[1]) * 10 + season;
}

function shortPeriod(period) {
  const match = String(period || '').match(/^(\d{4})\s+(Spring|Summer|Fall|Winter|Interim)$/i);
  if (!match) return period || 'Term not specified';
  const season = { spring: 'SP', summer: 'SU', fall: 'FA', winter: 'WI', interim: 'WI' }[match[2].toLowerCase()];
  return `${match[1].slice(-2)}${season}`;
}

export function nextSemesterCode(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth();
  if (month < 4) return `${String(year).slice(-2)}FA`;
  if (month < 7) return `${String(year).slice(-2)}FA`;
  return `${String(year + 1).slice(-2)}SP`;
}

function nextTermAvailability(terms, nextTerm) {
  const offering = terms?.find(term => typeof term !== 'string' && term.term === nextTerm);
  if (!offering) return 'Not listed';
  if (offering.statuses?.includes('Open')) return 'Open';
  if (offering.statuses?.includes('Waitlist')) return 'Waitlist';
  return 'Closed';
}

function h(doc, tag, props, ...children) {
  const element = doc.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (key === 'class') element.className = value;
    else if (key.startsWith('on')) element.addEventListener(key.slice(2), value);
    else if (value === true) element.setAttribute(key, '');
    else if (value != null && value !== false) element.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    element.append(typeof child === 'string' || typeof child === 'number'
      ? doc.createTextNode(String(child)) : child);
  }
  return element;
}

function courseStatus(course) {
  if (course.status === 'in-progress') return { cls: 'min', text: 'In progress' };
  if (passed(course)) return { cls: 'done', text: 'Completed' };
  return { cls: 'todo', text: `Not counted${course.grade ? ` (${course.grade})` : ''}` };
}

function statusChip(doc, label, status, target) {
  return h(doc, 'li', {}, h(doc, 'a', {
    class: `summary-chip status-${status.cls}`,
    href: `#${target}`,
    title: `View ${label}`,
  }, h(doc, 'span', { class: 'chip-name' }, label),
  h(doc, 'span', { class: 'chip-value' }, status.text)));
}

function optionsList(doc, options, courseByCode, { title, note, emptyMessage, date = new Date() }) {
  const nextTerm = nextSemesterCode(date);
  const available = options.map(option => {
    const code = normalizeCode(option.code);
    const taken = option.taken || courseByCode.get(code);
    const status = taken ? courseStatus(taken) : null;
    const credits = taken?.hours ?? option.credits;
    const flags = [];
    if (option.badgeText) {
      flags.push(h(doc, 'span', { class: 'chip chip-taken' }, option.badgeText));
    } else if (status?.cls === 'done') {
      flags.push(h(doc, 'span', { class: 'chip chip-taken' },
        `Taken${taken.grade ? ` · ${taken.grade}` : ''}${credits ? ` · ${credits} hrs` : ''}`));
    } else if (status?.cls === 'min') {
      flags.push(h(doc, 'span', { class: 'chip chip-progress' },
        `In progress${credits ? ` · ${credits} hrs` : ''}`));
    } else if (status?.cls === 'todo') {
      flags.push(h(doc, 'span', { class: 'chip chip-excluded' }, status.text));
    }
    if (option.showAvailability) {
      const availability = nextTermAvailability(option.terms, nextTerm);
      flags.push(h(doc, 'span', {
        class: `chip ${availability === 'Open' ? 'chip-taken' : availability === 'Waitlist' ? 'chip-progress' : 'chip-muted'}`,
        title: `Next semester (${nextTerm}): ${availability}`,
        'aria-label': `Next semester (${nextTerm}): ${availability}`,
      }, availability));
    }
    return h(doc, 'li', { class: `course${option.taken || status?.cls === 'done' ? ' is-active' : ''}` },
      h(doc, 'strong', { class: 'course-code' }, option.code),
      h(doc, 'span', { class: 'course-title' }, option.title || ''),
      option.evidence ? h(doc, 'span', { class: 'course-evidence' }, `Lab evidence: ${option.evidence}`) : null,
      flags.length ? h(doc, 'span', { class: 'course-flags' }, flags) : null);
  });
  return h(doc, 'article', { class: 'req', id: title.id },
    h(doc, 'header', { class: 'req-header' },
      h(doc, 'h3', { class: 'req-name' }, title.label),
      h(doc, 'span', { class: `status-pill status-${title.status.cls}` }, title.status.text)),
    note ? h(doc, 'p', { class: 'req-note' }, note) : null,
    h(doc, 'details', { class: 'course-options', open: '' },
      h(doc, 'summary', {}, `Course options (${options.length})`),
      options.length ? h(doc, 'ol', { class: 'course-list' }, available)
        : h(doc, 'p', { class: 'req-note' }, emptyMessage)));
}

function renderCourseRequirement(doc, result, courses, courseOptions, courseAttempts) {
  const found = courses.filter(c => result.codes.includes(normalizeCode(c.code)));
  const done = found.find(passed);
  const inProgress = found.find(c => c.status === 'in-progress');
  const matched = done || inProgress;
  let status;
  if (result.status === 'complete') status = { cls: 'done', text: 'Complete' };
  else if (result.requiredOccurrences) {
    status = { cls: 'todo', text: `${result.occurrenceCount || 0} of ${result.requiredOccurrences} terms` };
  } else if (done) {
    status = { cls: result.manual ? 'todo' : 'done', text: result.manual ? 'Record found · verify manually' : 'Complete' };
  } else {
    status = inProgress ? { cls: 'min', text: 'In progress' } : { cls: 'todo', text: 'Not yet' };
  }
  const primaryCode = normalizeCode(result.primaryCode || result.codes[0]);
  const alternatives = result.codes.filter(code => normalizeCode(code) !== primaryCode);
  const displayCode = normalizeCode(matched?.code || result.primaryCode || result.codes[0]);
  const expected = courseOptions.requiredCourses.find(course =>
    normalizeCode(course.code) === displayCode);
  const credits = matched?.hours ?? result.credits ?? expected?.credits;
  const title = matched?.title || expected?.title || result.title || result.label;
  const attempts = result.requiredOccurrences
    ? courseAttempts.filter(course => result.codes.includes(normalizeCode(course.code))
      && course.period && passed(course))
      .sort((a, b) => periodOrder(a.period) - periodOrder(b.period))
    : [];
  const seminarOptions = attempts.map(course => ({
    code: course.code,
    title: course.title,
    taken: course,
    badgeText: `Taken · ${shortPeriod(course.period)}`,
  }));
  const statusDisplay = result.requiredOccurrences && result.occurrenceCount >= result.requiredOccurrences
    ? { cls: 'done', text: 'Complete' } : status;
  return h(doc, 'article', { class: `req status-${statusDisplay.cls}`, id: `bcs-${result.id}` },
    h(doc, 'header', { class: 'req-header' },
      h(doc, 'h3', { class: 'req-name' }, `${displayCode} - ${title}`),
      matched && passed(matched) && !result.requiredOccurrences
        ? h(doc, 'span', { class: 'chip chip-taken', 'aria-label': 'Credits and grade' },
          `Taken${matched.grade ? ` · ${matched.grade}` : ''}${credits != null ? ` · ${credits} hrs` : ''}`)
        : h(doc, 'span', { class: `status-pill status-${statusDisplay.cls}` }, statusDisplay.text)),
    result.requiredOccurrences
      ? h(doc, 'details', { class: 'course-options', open: '' },
        h(doc, 'summary', {}, `Course options (${attempts.length} of ${result.requiredOccurrences} taken)`),
        attempts.length ? h(doc, 'ol', { class: 'course-list' }, seminarOptions.map(option =>
          h(doc, 'li', { class: 'course is-active' },
            h(doc, 'strong', { class: 'course-code' }, option.code),
            h(doc, 'span', { class: 'course-title' }, option.title),
            h(doc, 'span', { class: 'chip chip-taken' }, option.badgeText))))
          : h(doc, 'p', { class: 'req-note' }, `No completed ${displayCode} term is in your records.`))
      : null,
    alternatives.length ? h(doc, 'details', { class: 'course-options' },
      h(doc, 'summary', {}, `Other accepted courses (${alternatives.length})`),
      h(doc, 'ul', { class: 'course-list' }, alternatives.map(code => {
        const alternative = courseOptions.requiredCourses.find(course => normalizeCode(course.code) === normalizeCode(code));
        return h(doc, 'li', { class: `course${normalizeCode(matched?.code) === normalizeCode(code) ? ' is-active' : ''}` },
          h(doc, 'strong', { class: 'course-code' }, code),
          h(doc, 'span', { class: 'course-title' },
            alternative?.title || (normalizeCode(matched?.code) === normalizeCode(code) ? 'Matched in your record' : 'Alternative; confirm with your advisor')));
      }))) : null,
    result.note ? h(doc, 'p', { class: 'req-note' }, result.note) : null);
}

function renderGroup(doc, group, { courses, catalog, schedule, courseByCode, courseOptions, date }) {
  let options = [];
  let status = { cls: 'todo', text: 'Manual review' };
  const note = group.note;
  if (group.type === 'lab-science-options') {
    const category = catalog.categories.find(c => c.name === group.catalogCategory);
    const allowedCodes = new Set((category?.courses || []).map(course => normalizeCode(course.code)));
    options = courseOptions.labScience.filter(course =>
      course.catalogs.includes(catalog._meta.catoid) && allowedCodes.has(normalizeCode(course.code)));
    const hoursEarned = courses.filter(c => passed(c)
      && options.some(option => normalizeCode(option.code) === normalizeCode(c.code)))
      .reduce((sum, course) => sum + (Number(course.hours) || 0), 0);
    status = hoursEarned >= group.minHours
      ? { cls: 'done', text: `${hoursEarned} of ${group.minHours}+ hrs` }
      : { cls: 'todo', text: `${hoursEarned} of ${group.minHours} hrs` };
  } else if (group.type === 'course-options') {
    options = courseOptions.csCourses.map(course => ({ ...course, showAvailability: true }));
    const completed = courses.filter(course => passed(course)
      && options.some(option => normalizeCode(option.code) === normalizeCode(course.code)));
    status = completed.length
      ? { cls: 'min', text: `${completed.length} course${completed.length === 1 ? '' : 's'} recorded` }
      : { cls: 'todo', text: 'No matching completed course found' };
  } else {
    options = Object.keys(schedule.offerings || {}).filter(code =>
      new RegExp(`^${group.subject} \\d{3}$`).test(code))
      .map(code => ({ code, title: courseByCode.get(normalizeCode(code))?.title || 'Current course listing' }));
  }
  return optionsList(doc, options, courseByCode, {
    title: { id: `bcs-${group.id}`, label: group.label, status },
    note,
    emptyMessage: 'No course options are available for this catalog section.',
    date,
  });
}

export function renderMajor(root, major, courseOptions, courses, catalog, schedule, courseAttempts = [], date = new Date()) {
  const doc = root.ownerDocument;
  const requirements = analyzeMajor(major, courses, courseAttempts);
  const courseByCode = new Map(courses.filter(c => c.code).map(c => [normalizeCode(c.code), c]));
  const groupResults = major.courseGroups.map(group => {
    const isScience = group.type === 'lab-science-options';
    const category = isScience ? catalog.categories.find(c => c.name === group.catalogCategory) : null;
    const allowedCodes = new Set((category?.courses || []).map(course => normalizeCode(course.code)));
    const options = isScience
      ? courseOptions.labScience.filter(course => course.catalogs.includes(catalog._meta.catoid)
        && allowedCodes.has(normalizeCode(course.code)))
      : courseOptions.csCourses.map(course => ({ ...course, showAvailability: true }));
    const completed = courses.filter(c => passed(c)
      && options.some(option => normalizeCode(option.code) === normalizeCode(c.code)));
    const hours = completed.reduce((sum, course) => sum + (Number(course.hours) || 0), 0);
    const status = isScience
      ? hours >= group.minHours ? { cls: 'done', text: `${hours} of ${group.minHours}+ hrs` } : { cls: 'todo', text: `${hours} of ${group.minHours} hrs` }
      : { cls: completed.length ? 'min' : 'todo', text: completed.length ? `${completed.length} course${completed.length === 1 ? '' : 's'} recorded` : 'Manual review' };
    return { group, status };
  });
  const requiredDone = requirements.filter(r => r.status === 'complete').length;
  const completeGroups = groupResults.filter(r => r.status.cls === 'done').length;

  const overview = h(doc, 'section', { class: 'summary', 'aria-label': 'BCS major overview' },
    h(doc, 'h2', {}, `${requiredDone} of ${requirements.length} listed courses complete`),
    h(doc, 'p', { class: 'summary-sub' }, 'Select an item to see its requirement and matching course options. In-progress and manual-review items are shown separately.'),
    h(doc, 'div', { class: 'summary-group' },
      h(doc, 'h3', {}, 'Required courses'),
      h(doc, 'ul', { class: 'summary-chips' }, requirements.map(result => {
        const status = {
          complete: { cls: 'done', text: 'Complete' },
          'manual-found': { cls: 'todo', text: 'Record found · verify' },
          'in-progress': { cls: 'min', text: 'In progress' },
          incomplete: { cls: 'todo', text: 'Not yet' },
          manual: { cls: 'todo', text: 'Manual check' },
        }[result.status];
        return statusChip(doc, result.label, status, `bcs-${result.id}`);
      })),
    ),
    h(doc, 'div', { class: 'summary-group' },
      h(doc, 'h3', {}, `Electives and science · ${completeGroups} group${completeGroups === 1 ? '' : 's'} met`),
      h(doc, 'ul', { class: 'summary-chips' }, groupResults.map(({ group, status }) =>
        statusChip(doc, group.label, status, `bcs-${group.id}`))),
    ),
  );
  const sections = [
    h(doc, 'section', { class: 'req-section', id: 'bcs-required' },
      h(doc, 'h2', { class: 'req-section-title' }, 'Required courses'),
      ...requirements.map(result => renderCourseRequirement(doc, result, courses, courseOptions, courseAttempts))),
    h(doc, 'section', { class: 'req-section', id: 'bcs-electives' },
      h(doc, 'h2', { class: 'req-section-title' }, 'Electives and science'),
    ...major.courseGroups.map(group => renderGroup(doc, group, {
      courses, catalog, schedule, courseByCode, courseOptions, date,
    }))),
  ];
  const caution = h(doc, 'section', { class: 'callout' },
    h(doc, 'h2', {}, 'Not checked automatically'),
    h(doc, 'ul', {}, major.manualRequirements.map(item =>
      h(doc, 'li', {}, h(doc, 'strong', {}, `${item.label}: `), item.note))),
  );
  root.replaceChildren(overview, ...sections, caution);
}
