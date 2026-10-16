/**
 * One-shot script: parse catalog/catalog-<catoid>.html → catalog/catalog-categories-<catoid>.json
 *
 * Extracts the pure-data fields from parseCoreProgram() output, stripping
 * all DOM element references. The resulting JSON is hand-verifiable,
 * diffable, and loads instantly (no JSDOM needed for logic tests). The
 * standalone app bundles it.
 *
 * Usage:
 *   node test/generate-catalog-json.js [catoid]   (default: 25)
 *
 * catalog-<catoid>.html must be saved from a browser: catalog.calvin.edu sits
 * behind a bot challenge, so plain fetch/curl gets an empty page. Update
 * CATALOG_INFO in catalog-json.js (savedAt, and navoid for a new catalog).
 * Re-run when the catalog changes (typically once per academic year).
 *
 * Also regenerates src/catalog-courses.js: the union of every
 * catalog-categories-*.json, so a course listed for a requirement in any known
 * catalog counts toward it regardless of which catalog is selected.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalogJson, buildUnion } from './catalog-json.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const CATOID = process.argv[2] || '25';
const CATALOG_DIR = join(__dirname, '..', 'catalog');
const UNION_OUTPUT = join(__dirname, '..', 'src', 'catalog-courses.js');
const CATALOG_HTML = join(CATALOG_DIR, `catalog-${CATOID}.html`);
const OUTPUT = join(CATALOG_DIR, `catalog-categories-${CATOID}.json`);

if (!existsSync(CATALOG_HTML)) {
  console.error(`Missing ${CATALOG_HTML}. Save the core program page's HTML from a browser.`);
  process.exit(1);
}

const output = buildCatalogJson(readFileSync(CATALOG_HTML, 'utf-8'), CATOID);
writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + '\n', 'utf-8');

// Print summary
const categories = output.categories;
const sections = categories.filter(c => c.type === 'section-header');
const cats = categories.filter(c => c.type !== 'section-header');
const totalCourses = cats.reduce((n, c) => n + (c.courses?.length || 0), 0);
console.log(`Wrote ${OUTPUT}`);
console.log(`  ${sections.length} sections, ${cats.length} categories, ${totalCourses} total courses`);
for (const cat of cats) {
  const courses = cat.courses?.length || 0;
  const details = [cat.reqType];
  if (cat.minHours != null) details.push(`${cat.minHours}–${cat.maxHours}h`);
  if (cat.maxPerDiscipline) details.push(`max ${cat.maxPerDiscipline}h/disc`);
  console.log(`  ${cat.name}: ${courses} courses (${details.join(', ')})`);
}

// ---- Union of all known catalogs → src/catalog-courses.js ----

const catalogs = readdirSync(CATALOG_DIR)
  .map(f => f.match(/^catalog-categories-(\d+)\.json$/))
  .filter(Boolean)
  .sort((a, b) => Number(b[1]) - Number(a[1]))  // newest first: its sub-discipline wins
  .map(([file]) => JSON.parse(readFileSync(join(CATALOG_DIR, file), 'utf-8')));
writeFileSync(UNION_OUTPUT, buildUnion(catalogs), 'utf-8');
console.log(`Wrote ${UNION_OUTPUT} from catalogs ${catalogs.map(d => d._meta.catoid).join(', ')}`);
