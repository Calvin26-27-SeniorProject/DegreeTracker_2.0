/**
 * The committed catalog data must be exactly what the saved catalog HTML says.
 * If this fails, re-run `npm run generate-catalog -- <catoid>`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalogJson, buildUnion } from './catalog-json.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const CATALOG_DIR = join(ROOT, 'catalog');
const catoids = readdirSync(CATALOG_DIR)
  .map(f => f.match(/^catalog-(\d+)\.html$/)?.[1]).filter(Boolean)
  .sort((a, b) => Number(b) - Number(a));
const readJson = catoid => JSON.parse(readFileSync(join(CATALOG_DIR, `catalog-categories-${catoid}.json`), 'utf-8'));

describe('catalog snapshot', () => {
  for (const catoid of catoids) {
    it(`catalog-categories-${catoid}.json matches catalog-${catoid}.html`, () => {
      const html = readFileSync(join(CATALOG_DIR, `catalog-${catoid}.html`), 'utf-8');
      assert.deepEqual(readJson(catoid), JSON.parse(JSON.stringify(buildCatalogJson(html, catoid))));
    });
  }

  it('src/catalog-courses.js is the union of the committed catalogs', () => {
    const committed = readFileSync(join(ROOT, 'src', 'catalog-courses.js'), 'utf-8');
    assert.equal(committed, buildUnion(catoids.map(readJson)));
  });
});
