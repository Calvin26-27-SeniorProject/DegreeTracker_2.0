// Parser for the catalog's Core Program page (catalog.calvin.edu): the
// requirement blocks, their instructions, and course lists, from a document or
// element (the browser's, or jsdom's in tests and the catalog generator).

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
