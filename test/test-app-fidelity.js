/**
 * Fidelity: the standalone app shows what the official catalog shows.
 *
 * Renders the app in jsdom from the bundled catalog data, then compares it to
 * the saved catalog HTML read directly (not through parseCoreProgram, so a
 * parser bug can't hide here): every requirement in order, heading text,
 * instruction wording, and each list's headings, connectors, course codes,
 * titles, and course links. Also checks that anything the app adds beyond the
 * catalog's lists is labeled, and that the page keeps its official-record
 * notice and no-network policy.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { analyze } from '../src/core.js';
import { KNOWN_COURSE_CATEGORIES } from '../src/catalog-courses.js';
import { renderApp, courseUrl } from '../src/app-render.js';
import { makeCourse } from './helpers.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const CATALOG_DIR = join(ROOT, 'catalog');
const CATOIDS = readdirSync(CATALOG_DIR).map(f => f.match(/^catalog-(\d+)\.html$/)?.[1]).filter(Boolean);
const CATALOGS = CATOIDS.map(id => JSON.parse(readFileSync(join(CATALOG_DIR, `catalog-categories-${id}.json`), 'utf-8')));
// Rendered with section lists and hours, so the comparisons below cover them too.
const SCHEDULE = JSON.parse(readFileSync(join(ROOT, 'schedule', 'sections.json'), 'utf-8'));

const norm = s => (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const squash = s => (s || '').replace(/\s+/g, '');

// The official page, read straight from the DOM.
function officialBlocks(catoid) {
  const doc = new JSDOM(readFileSync(join(CATALOG_DIR, `catalog-${catoid}.html`), 'utf-8')).window.document;
  return Array.from(doc.querySelectorAll('div.acalog-core')).map(b => {
    const heading = b.querySelector('h2, h3, h4');
    const items = Array.from(b.querySelector('ul')?.children || []).map(li => {
      if (li.classList.contains('acalog-adhoc')) return { text: norm(li.textContent) };
      const a = li.querySelector('a');
      return { text: norm(a.textContent), coid: a.getAttribute('onclick').match(/showCourse\('\d+',\s*'(\d+)'/)[1] };
    });
    return {
      isSection: heading.tagName === 'H2',
      heading: norm(heading.textContent),
      instructions: norm(Array.from(b.children).filter(el => el.tagName === 'P').map(p => p.textContent).join(' ')),
      items,
    };
  });
}

function render(catalog, transcript, withToc = false) {
  const doc = new JSDOM('<!doctype html><main id="results"></main><nav id="toc"></nav>').window.document;
  const root = doc.getElementById('results');
  const analysis = transcript && analyze(catalog.categories, transcript, { extraCourses: KNOWN_COURSE_CATEGORIES });
  renderApp(root, { catalog, catalogs: CATALOGS, analysis, schedule: SCHEDULE, onTogglePlanned: () => {},
    tocRoot: withToc ? doc.getElementById('toc') : null });
  return root;
}

// Exercises taken, in-progress, transfer (accepted and excluded), the
// alternatives list, an other-catalog course, placeholder credit, and a
// course only Workday's Academic Progress lists for a requirement.
const SAMPLE_TRANSCRIPT = [
  makeCourse('CORE 100', 2, { status: 'transfer' }),
  makeCourse('ENGL 100', 4),
  makeCourse('HIST 152', 4),
  makeCourse('MATH 171', 4),
  makeCourse('ENST 210', 4),
  makeCourse('COMM 200', 4, { status: 'in-progress' }),
  { code: 'ARTS CORE', subject: 'ARTS', isPlaceholder: true, title: 'AP Art', hours: 4, grade: 'CR', status: 'transfer' },
  { ...makeCourse('ENGR 202', 4), title: 'Statics and Dynamics', requirements: ['Global Regions and Cultures Core'] },
];

describe('app fidelity to the official catalog', () => {
  for (const catalog of CATALOGS) {
    const catoid = catalog._meta.catoid;
    const official = officialBlocks(catoid);

    for (const [label, transcript] of [['before pasting', null], ['with a transcript', SAMPLE_TRANSCRIPT]]) {
      describe(`catalog ${catoid}, ${label}`, () => {
        const root = render(catalog, transcript);
        const rendered = Array.from(root.querySelectorAll('[data-core-index]'));

        it('shows every catalog requirement once, in catalog order', () => {
          assert.deepEqual(rendered.map(el => Number(el.dataset.coreIndex)), official.map((_, i) => i));
        });

        it('headings and instruction wording match the catalog', () => {
          official.forEach((o, i) => {
            const el = rendered[i];
            const heading = el.querySelector(o.isSection ? '.req-section-title' : '.req-name');
            assert.equal(norm(heading.textContent), o.heading, `block ${i} heading`);
            const sentences = Array.from(el.querySelectorAll(':scope > .catalog-wording .sentence-text')).map(s => s.textContent);
            // The app splits run-together sentences, so compare ignoring whitespace.
            assert.equal(squash(sentences.join('')), squash(o.instructions), `${o.heading} wording`);
          });
        });

        it('course lists match the catalog item for item, with links to each course', () => {
          official.forEach((o, i) => {
            const items = Array.from(rendered[i].querySelectorAll(':scope > details > .course-list > li')).map(li => {
              if (li.dataset.kind === 'course') {
                const a = li.querySelector('.course-code');
                return { text: `${norm(a.textContent)} - ${norm(li.querySelector('.course-title').textContent)}`, href: a.href };
              }
              return { text: norm(li.querySelector('.heading-text')?.textContent ?? li.textContent) };
            });
            const expected = o.items.map(x => x.coid ? { text: x.text, href: courseUrl(catoid, x.coid) } : { text: x.text });
            assert.deepEqual(items, expected, `${o.heading} list`);
          });
        });

        it('links each requirement to its place in the official catalog', () => {
          for (const el of rendered.filter(e => e.matches('article'))) {
            const href = el.querySelector('.req-source a').href;
            assert.ok(href.startsWith(catalog._meta.sourceUrl + '#core_'), href);
          }
        });

        it('courses outside the catalog lists are labeled with where they come from', () => {
          for (const li of root.querySelectorAll('[data-kind="course"]')) {
            assert.ok(li.closest('.course-list'), `${li.dataset.code} rendered outside a catalog list`);
          }
          for (const li of root.querySelectorAll('.extra-course')) {
            assert.ok(['assumed', 'other-catalog', 'workday'].includes(li.dataset.provenance), li.textContent);
            assert.match(li.textContent, /Assumed|Listed for this requirement in (the|your Workday)/);
            assert.match(li.closest('.extra-courses').textContent, /catalog doesn.t list them/);
          }
        });
      });
    }
  }

  it('the sample transcript exercises the labeled extras', () => {
    const root = render(CATALOGS.find(c => c._meta.catoid === '25'), SAMPLE_TRANSCRIPT);
    const kinds = new Set(Array.from(root.querySelectorAll('.extra-course')).map(li => li.dataset.provenance));
    assert.deepEqual([...kinds].sort(), ['assumed', 'other-catalog', 'workday']);
    assert.ok(root.querySelector('.course.is-excluded'), 'excluded transfer shown');
    assert.match(root.querySelector('.callout-warn').textContent, /CORE 100 is transfer credit/);
  });

  for (const catalog of CATALOGS) {
    it(`${catalog._meta.catoid}: contents link every requirement, with the card's status`, () => {
      const root = render(catalog, SAMPLE_TRANSCRIPT, true);
      const toc = root.ownerDocument.getElementById('toc');
      const links = Array.from(toc.querySelectorAll('.toc-link'));
      const targets = Array.from(root.querySelectorAll('[data-core-index]'));
      assert.deepEqual(links.map(a => a.getAttribute('href')), targets.map(el => '#' + el.id));
      for (const [i, el] of targets.entries()) {
        if (!el.classList.contains('req')) continue;
        const pill = el.querySelector('.status-pill');
        const statusCls = pill && [...pill.classList].find(c => c.startsWith('status-') && c !== 'status-pill');
        assert.equal([...links[i].classList].find(c => c.startsWith('status-')), statusCls, el.id);
        assert.equal(links[i].querySelector('.toc-status')?.getAttribute('aria-label'), pill?.textContent, el.id);
      }
    });
  }
});

describe('app summary', () => {
  it('K&U shows where more hours would count and which categories are full', () => {
    const catalog = CATALOGS.find(c => c._meta.catoid === '25');
    const root = render(catalog, [makeCourse('COMM 101', 3), makeCourse('MUSC 100', 3), makeCourse('HIST 152', 3)]);
    const chip = name => Array.from(root.querySelectorAll('.summary-chip'))
      .find(a => norm(a.querySelector('.chip-name').textContent) === name);
    assert.equal(norm(chip('Arts, Oral Rhetoric, Visual Rhetoric').querySelector('.chip-room').textContent), 'Full');
    assert.equal(norm(chip('Humanities').querySelector('.chip-room').textContent), 'Room for 3 more');
    const opp = norm(root.querySelector('.ku-opportunities').textContent);
    assert.match(opp, /Humanities: up to 3 more hrs/);
    assert.match(opp, /Full, so more hours there won’t count: Arts, Oral Rhetoric, Visual Rhetoric/);
  });
});

describe('app page', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf-8');

  it('says Workday is the official record', () => {
    assert.match(html, /Workday is the official record/);
  });

  it('forbids network requests, so pasted data cannot leave the browser', () => {
    const csp = new JSDOM(html).window.document.querySelector('meta[http-equiv="Content-Security-Policy"]').content;
    assert.match(csp, /connect-src 'none'/);
    assert.match(csp, /form-action 'none'/);
    assert.match(csp, /script-src 'self'(;|$)/);
  });
});
