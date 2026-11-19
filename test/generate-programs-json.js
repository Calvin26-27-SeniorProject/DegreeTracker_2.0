/**
 * Generates programs/<year>/<department>/<type>/<program>/program.json for every
 * program in the Calvin Academic Catalogs listed in CATALOGS (programs-json.js),
 * plus programs/index.json.
 *
 * The saved catalog/catalog-<catoid>.html files only hold the Core program page,
 * so programs come from the catalog's public widget API (the same data
 * calvin.edu uses to show program requirements). Needs network access:
 *
 *   npm run generate-programs            # every catalog
 *   npm run generate-programs -- 2025    # one year folder
 *
 * Files we curated by hand next to a program.json (e.g. bcs.json) are left alone.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CATALOGS, slugify, htmlToText, parseCourseTitle, parseCredits,
  typeFolder, departmentOf, departmentFolder, totalHoursOf,
} from './programs-json.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PROGRAMS_DIR = join(ROOT, 'programs');
const API = 'https://catalog.calvin.edu/widget-api';

// The catalog sits behind a rate-limiting firewall that answers 202 with an
// empty body ("challenge") when it is asked too often. We stay polite (a few
// requests a second) and, when it does push back, wait for the limit to expire
// rather than hammer it. Fetched data is cached in the temp folder so an
// interrupted run resumes where it stopped.
const REQUEST_GAP_MS = 350;
const CONCURRENCY = 3;
const MAX_ATTEMPTS = 14;
let lastRequestAt = 0;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Reserves the next start time, REQUEST_GAP_MS after the previous one.
async function pace() {
  const now = Date.now();
  const startAt = Math.max(now, lastRequestAt + REQUEST_GAP_MS);
  lastRequestAt = startAt;
  if (startAt > now) await sleep(startAt - now);
}

// Resolves to null only for a genuine 404; anything else retries, then throws.
async function getJson(path, attempt = 1) {
  try {
    await pace();
    const response = await fetch(`${API}${path}`);
    if (response.status === 404) return null;
    if (!response.ok || response.status === 202) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (!text.trim()) throw new Error('empty response');
    return JSON.parse(text);
  } catch (err) {
    if (attempt >= MAX_ATTEMPTS) throw new Error(`${path}: ${err.message}`);
    const delay = Math.min(60_000, 2000 * 2 ** Math.min(attempt - 1, 5));
    if (attempt === 1 || attempt % 4 === 0) console.log(`  waiting ${delay / 1000}s (${err.message}) …`);
    await sleep(delay);
    return getJson(path, attempt + 1);
  }
}

class DiskCache {
  constructor(name) {
    this.file = join(tmpdir(), `calvin-programs-${name}.json`);
    this.data = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : {};
    this.dirty = 0;
  }

  has(key) { return key in this.data; }

  get(key) { return this.data[key]; }

  set(key, value) {
    this.data[key] = value;
    if (++this.dirty % 25 === 0) this.save();
  }

  save() { writeFileSync(this.file, JSON.stringify(this.data), 'utf8'); }
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }));
  return results;
}

async function listPrograms(apiId) {
  const programs = [];
  for (let page = 1; ; page++) {
    const { 'program-list': list = [] } = await getJson(`/catalog/${apiId}/programs/?page-size=100&page=${page}`) || {};
    programs.push(...list);
    if (list.length < 100) return programs;
  }
}

function courseIdsOf(core, ids = new Set()) {
  for (const course of core.courses || []) ids.add(course.id);
  for (const child of core.children || []) courseIdsOf(child, ids);
  return ids;
}

async function loadCourse(apiId, id) {
  const detail = await getJson(`/catalog/${apiId}/course/${id}/`);
  if (!detail) return { legacyId: null, credits: null };
  const course = detail['course-list']?.[0] ?? detail;
  const field = name => course.fields?.find(item => item.custom_field?.name === name)?.content;
  return { legacyId: course['legacy-id'], credits: parseCredits(field('Credits:')) };
}

const bySortOrder = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0);

function buildCore(core, catalog, courseInfo) {
  const courses = [...(core.courses || [])].sort(bySortOrder).map(course => {
    const { code, title } = parseCourseTitle(course.title);
    const info = courseInfo.get(course.id) || {};
    return {
      code,
      title,
      credits: info.credits ?? null,
      courseId: course.id,
      url: info.legacyId
        ? `https://catalog.calvin.edu/preview_course_nopop.php?catoid=${catalog.catoid}&coid=${info.legacyId}`
        : null,
    };
  });
  const codeById = new Map((core.courses || []).map(course => [course.id, parseCourseTitle(course.title).code]));
  return {
    name: htmlToText(core.name),
    description: htmlToText(core.description) || null,
    courses,
    // Catalog notes attached to a course, e.g. "OR CS 106 - ..." or "(take 3 semesters)".
    notes: (core.adhocs || [])
      .map(note => ({
        course: codeById.get(note['course-id']) ?? null,
        placement: note.placement || null,
        text: htmlToText(note.display || note.content || note.name),
      }))
      .filter(note => note.text),
    children: [...(core.children || [])].sort(bySortOrder).map(child => buildCore(child, catalog, courseInfo)),
  };
}

function buildProgram(detail, catalog, courseInfo, folder) {
  const department = departmentOf(detail.parents);
  const departments = (Array.isArray(detail.parents) ? detail.parents : [detail.parents]).filter(Boolean);
  const cores = [...(detail.cores || [])].sort(bySortOrder);
  return {
    id: folder.program,
    name: detail.name,
    code: detail.code || null,
    type: (detail.program_types || []).map(type => type.name).find(Boolean) || null,
    degreeTypes: (detail.degree_types || []).map(type => type.name),
    department: department ? { id: department.id, name: department.name } : null,
    otherDepartments: departments.filter(item => item !== department).map(item => ({ id: item.id, name: item.name })),
    catalog: { catoid: catalog.catoid, year: catalog.label },
    sourceUrl: `https://catalog.calvin.edu/preview_program.php?catoid=${catalog.catoid}&poid=${detail['legacy-id']}`,
    description: htmlToText(detail.description) || null,
    totalHours: totalHoursOf(cores),
    requirements: cores.map(core => buildCore(core, catalog, courseInfo)),
  };
}

async function generateCatalog(catalog) {
  console.log(`\n== ${catalog.folder} (catalog ${catalog.catoid}, ${catalog.label})`);
  const cache = new DiskCache(`catalog-${catalog.catoid}`);
  let fetched = 0;
  const cached = async (key, load) => {
    if (cache.has(key)) return cache.get(key);
    const value = await load();
    cache.set(key, value);
    if (++fetched % 50 === 0) console.log(`  fetched ${fetched} …`);
    return value;
  };

  try {
    const listed = await cached('list', () => listPrograms(catalog.apiId));
    console.log(`${listed.length} programs`);
    const details = await mapPool(listed, CONCURRENCY, program =>
      cached(`program:${program.id}`, () => getJson(`/catalog/${catalog.apiId}/program/${program.id}/`)));
    console.log('program details loaded');

    const courseIds = new Set();
    details.forEach(detail => (detail.cores || []).forEach(core => courseIdsOf(core, courseIds)));
    console.log(`${courseIds.size} distinct courses referenced`);
    const ids = [...courseIds];
    const loaded = await mapPool(ids, CONCURRENCY, id =>
      cached(`course:${id}`, () => loadCourse(catalog.apiId, id)));
    const courseInfo = new Map(ids.map((id, index) => [id, loaded[index]]));
    console.log('course details loaded');

    // Everything is fetched before anything is written, so a failed run never
    // leaves half-filled files behind.
    const used = new Set();
    const entries = [];
    for (const detail of details) {
      const department = departmentFolder(detail.parents);
      const type = typeFolder(detail.program_types);
      let program = slugify(detail.name);
      if (used.has(`${department}/${type}/${program}`)) program = `${program}-${slugify(detail.code)}`;
      used.add(`${department}/${type}/${program}`);
      const folder = { department, type, program };
      const dir = join(PROGRAMS_DIR, catalog.folder, department, type, program);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'program.json'),
        `${JSON.stringify(buildProgram(detail, catalog, courseInfo, folder), null, 2)}\n`, 'utf8');
      entries.push({
        name: detail.name,
        code: detail.code || null,
        type: (detail.program_types || []).map(item => item.name).find(Boolean) || null,
        department: departmentOf(detail.parents)?.name ?? null,
        path: `${catalog.folder}/${department}/${type}/${program}/program.json`,
      });
    }
    entries.sort((a, b) => a.path.localeCompare(b.path));
    return { year: catalog.folder, catoid: catalog.catoid, catalogYear: catalog.label, programs: entries };
  } finally {
    cache.save();
  }
}

async function main() {
  const wanted = process.argv.slice(2);
  const catalogs = wanted.length ? CATALOGS.filter(catalog => wanted.includes(catalog.folder)) : CATALOGS;
  if (!catalogs.length) throw new Error(`No catalog matches ${wanted.join(', ')}; use ${CATALOGS.map(c => c.folder).join(', ')}.`);
  const generated = [];
  for (const catalog of catalogs) generated.push(await generateCatalog(catalog));

  // Keep index entries for years we didn't regenerate.
  let previous = [];
  try { previous = JSON.parse(readFileSync(join(PROGRAMS_DIR, 'index.json'), 'utf8')).catalogs; } catch { /* first run */ }
  const kept = previous.filter(entry => !generated.some(item => item.year === entry.year));
  const catalogsOut = [...generated, ...kept].sort((a, b) => b.year.localeCompare(a.year));
  mkdirSync(PROGRAMS_DIR, { recursive: true });
  writeFileSync(join(PROGRAMS_DIR, 'index.json'), `${JSON.stringify({ catalogs: catalogsOut }, null, 2)}\n`, 'utf8');
  console.log(`\nWrote ${generated.reduce((sum, item) => sum + item.programs.length, 0)} programs and programs/index.json`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(err => { console.error(err); process.exit(1); });
}
