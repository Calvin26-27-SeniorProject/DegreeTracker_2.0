/**
 * Claims tests: everything the app concludes must trace to catalog wording.
 *
 * - Every sentence of every requirement's instructions matches exactly one
 *   INSTRUCTION_RULES entry. New or changed catalog wording fails here until
 *   someone decides whether it's checked or shown as "not checked".
 * - Every `checked` rule agrees with the fields analyze() actually uses.
 * - Structural assumptions analyze() relies on hold for each catalog.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INSTRUCTION_RULES, classifyInstructions, doubleCountConfirmed, KU_NAMES } from '../src/core.js';
import { loadCategories } from './helpers.js';

const CATALOG_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'catalog');
const CATOIDS = readdirSync(CATALOG_DIR)
  .map(f => f.match(/^catalog-categories-(\d+)\.json$/)?.[1]).filter(Boolean);

describe('catalog claims', () => {
  it('found saved catalogs', () => assert.ok(CATOIDS.length >= 2, CATOIDS.join(',')));

  for (const catoid of CATOIDS) {
    const cats = loadCategories(catoid);

    describe(`catalog ${catoid}`, () => {
      it('every instruction sentence matches exactly one rule', () => {
        for (const cat of cats) {
          for (const s of classifyInstructions(cat.instructions)) {
            const label = `${cat.name || cat.section}: "${s.text}"`;
            assert.ok(s.rule, `no rule recognizes ${label}`);
            const matching = INSTRUCTION_RULES.filter(r => r.re.test(s.text)).map(r => r.id);
            assert.deepEqual(matching, [s.rule.id], `${label} matches several rules`);
          }
        }
      });

      it('checked rules agree with the parsed requirement', () => {
        for (const cat of cats) {
          for (const s of classifyInstructions(cat.instructions)) {
            if (!s.rule?.verify) continue;
            const ok = s.rule.verify(cat, s.match, cats);
            assert.equal(ok, true, `${cat.name || cat.section}: ${s.rule.id}: ${ok}`);
          }
        }
      });

      it('rules that are not checked explain themselves', () => {
        for (const rule of INSTRUCTION_RULES) {
          if (!rule.checked) assert.ok(rule.note, `${rule.id} needs a note`);
        }
      });

      it('requirement fields are only set when the wording supports them', () => {
        for (const cat of cats) {
          if (cat.type === 'section-header') continue;
          const ids = new Set(classifyInstructions(cat.instructions).map(s => s.rule?.id));
          const label = cat.name;
          if (cat.reqType === 'hour-range') {
            assert.ok(ids.has('hour-range') || ids.has('world-languages-ii'), `${label}: hour range without wording`);
          }
          if (cat.maxPerDiscipline !== null) assert.ok(ids.has('hour-range'), `${label}: discipline cap without wording`);
          if (cat.courses.length > 0 && cat.reqType === 'pick-one' && !cat.alternatives) {
            assert.ok(ids.has('pick-one'), `${label}: treated as pick-one but the catalog doesn't say "Complete one of the following courses."`);
          }
        }
      });

      it('requirements with "Or" are only Foundational Writing, modeled as alternatives', () => {
        const withOr = cats.filter(c => c.courses?.some(x => x.connectorBefore === 'Or'));
        assert.deepEqual(withOr.map(c => c.name), ['Foundational Writing']);
        assert.deepEqual(withOr[0].alternatives, [['ENGL 101'], ['ENGL 100', 'ENGL 102']]);
      });

      it('the six K&U categories exist and no course sits in two of them (hours would count twice)', () => {
        const ku = cats.filter(c => KU_NAMES.includes(c.name));
        assert.deepEqual(ku.map(c => c.name).sort(), [...KU_NAMES].sort());
        const seen = new Map();
        for (const cat of ku) {
          for (const c of cat.courses) {
            assert.ok(!seen.has(c.code), `${c.code} in both ${seen.get(c.code)} and ${cat.name}`);
            seen.set(c.code, cat.name);
          }
        }
      });

      it('every course listed under two requirements may count toward both', () => {
        // New overlaps fail here until confirmed (see overlapConfirmed in core.js);
        // until then the app lists them under "This result assumes".
        const byCode = new Map();
        for (const cat of cats) for (const c of cat.courses || []) {
          if (!byCode.has(c.code)) byCode.set(c.code, []);
          byCode.get(c.code).push(cat);
        }
        const unconfirmed = [];
        for (const [code, list] of byCode) {
          for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
            if (!doubleCountConfirmed(list[i], list[j])) unconfirmed.push(`${code}: ${list[i].name} / ${list[j].name}`);
          }
        }
        assert.deepEqual(unconfirmed, []);
      });

      it('every course links to its catalog entry', () => {
        for (const cat of cats) for (const c of cat.courses || []) assert.match(c.coid || '', /^\d+$/, `${cat.name}: ${c.code}`);
      });
    });
  }
});
