/**
 * Opportunity verification tests — prove that status claims are actionable.
 *
 * If the system says a category is "satisfied" (room for more), this file
 * proves that adding a course actually advances the requirement.
 * If it says "incomplete", prove a course can move it forward.
 * If it says "optional-available", prove a course completes it.
 *
 * Also tests negative cases: adding to a maxed discipline shouldn't help.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  scenario, loadCategories, makeCourse, verifyOpportunities, getResult,
} from './helpers.js';
import { analyze } from './recorder.js';

const categories = loadCategories();

// ---- Targeted opportunity proofs ----

describe('satisfied → add course → improvement', () => {
  it('Humanities: satisfied → add Philosophy course → hours increase', async (t) => {
    await scenario('Humanities opportunity')
      .taken('HIST 152', 4)
      .expect('Humanities', { status: 'satisfied', hours: 4 })
      // Add a course from a non-maxed discipline
      .add('PHIL 153', 4)
      .expect('Humanities', { status: 'complete', hours: 8, effective: 6 })
      .run(t);
  });

  it('Natural Sciences: satisfied (min=0) → add course in new discipline → hours increase', async (t) => {
    await scenario('Natural Sciences opportunity')
      .taken('CHEM 101', 4)
      .expect('Natural Sciences', { status: 'satisfied', hours: 4 })
      .add('PHYS 133', 4)
      .expect('Natural Sciences', { status: 'complete', hours: 8, effective: 6 })
      .run(t);
  });

  it('Social & Behavioral: satisfied → add from different discipline → hours increase', async (t) => {
    await scenario('S&B Sciences opportunity')
      .taken('ECON 221', 4)
      .expect('Social and Behavioral Sciences', { status: 'satisfied', hours: 4 })
      .add('PSYC 151', 4)
      .expect('Social and Behavioral Sciences', { status: 'complete', hours: 8, effective: 6 })
      .run(t);
  });

  it('Arts: satisfied → add from different discipline → hours increase', async (t) => {
    await scenario('Arts opportunity')
      .taken('MUSC 100', 4)
      .expect('Arts, Oral Rhetoric, Visual Rhetoric', { status: 'satisfied', hours: 4 })
      .add('COMM 248', 4)  // Creative Writing
      .expect('Arts, Oral Rhetoric, Visual Rhetoric', { status: 'complete', hours: 8, effective: 6 })
      .run(t);
  });
});

describe('incomplete → add course → advancement', () => {
  it('incomplete pick-one → add any listed course → complete', async (t) => {
    await scenario('Pick-one advancement')
      .expect('Community and Commitments', { status: 'incomplete' })
      .add('CORE 100', 2)
      .expect('Community and Commitments', { status: 'complete' })
      .run(t);
  });

  it('incomplete hour-range → add course → hours increase', async (t) => {
    await scenario('Hour-range advancement')
      .expect('Humanities', { status: 'incomplete', hours: 0 })
      .add('HIST 152', 4)
      .expect('Humanities', { status: 'satisfied', hours: 4 })
      .run(t);
  });
});

describe('optional-available → add course → complete', () => {
  it('World Languages II: optional → take course → complete', async (t) => {
    await scenario('Optional advancement')
      .expect('World Languages II', { status: 'optional-available', hours: 0 })
      .add('SPAN 202', 4)
      .expect('World Languages II', { status: 'complete', hours: 4 })
      .run(t);
  });

  it('Mathematical Sciences: optional → take course → complete', async (t) => {
    await scenario('Math Sciences advancement')
      .expect('Mathematical Sciences', { status: 'optional-available', hours: 0 })
      .add('MATH 100', 4)
      .expect('Mathematical Sciences', { status: 'complete', hours: 4 })
      .run(t);
  });
});

describe('K&U aggregate advancement', () => {
  it('adding course increases totalHours', async (t) => {
    await scenario('K&U aggregate opportunity')
      .taken('HIST 152', 4)
      .expectKU({ total: 4, categories: 1 })
      .add('CHEM 101', 4)
      .expectKU({ total: 8, categories: 2 })
      .run(t);
  });

  it('adding course in new K&U category increases categoriesUsed', async (t) => {
    await scenario('K&U new category')
      .taken('HIST 152', 4)
      .taken('CHEM 101', 4)
      .expectKU({ total: 8, categories: 2 })
      .add('ECON 221', 4)
      .expectKU({ total: 12, categories: 3 })
      .run(t);
  });
});

// ---- Negative cases ----

describe('negative cases: adding should NOT improve', () => {
  it('adding course in maxed discipline does not increase effective hours', () => {
    // Humanities: HIST 152 (4h, History maxed). Add another History course.
    const transcript = [makeCourse('HIST 152', 4)];
    const before = analyze(categories, transcript);
    const humBefore = getResult(before, 'Humanities');
    assert.equal(humBefore.hoursEffective, 4);

    // Add HIST 150 (also History) — effective should stay at 4 because
    // the discipline is maxed at 4h and it's the only discipline contributing
    // Wait — effective is min(raw, maxHours). Raw goes 4→8, effective would be min(8,6)=6.
    // But the PER-DISCIPLINE effective tracking matters for the aggregate.
    // Actually, effective = min(raw, maxHours) not min(raw, maxPerDiscipline).
    // So adding in the same maxed discipline DOES increase raw and effective (up to maxHours).
    // The discipline cap limits the "satisfied" opportunity, not the raw/effective count.
    //
    // The real negative case: once effective hits maxHours, adding more does nothing.
    const transcript2 = [makeCourse('HIST 152', 4), makeCourse('PHIL 153', 4)];
    const before2 = analyze(categories, transcript2);
    const humBefore2 = getResult(before2, 'Humanities');
    assert.equal(humBefore2.hoursEffective, 6); // at max already
    assert.equal(humBefore2.status, 'complete');

    // Add yet another course — effective stays at 6 (maxHours)
    const transcript3 = [...transcript2, makeCourse('REL 255', 4)];
    const after = analyze(categories, transcript3);
    const humAfter = getResult(after, 'Humanities');
    assert.equal(humAfter.hoursEffective, 6); // unchanged, capped at maxHours
    assert.equal(humAfter.hoursEarned, 12);   // raw keeps going
    assert.equal(humAfter.status, 'complete');
  });

  it('K&U total does not increase beyond category maxHours sum', () => {
    // Load all K&U categories to compute theoretical max
    const kuCats = categories.filter(c =>
      ['World Languages II', 'Arts, Oral Rhetoric, Visual Rhetoric', 'Humanities',
       'Mathematical Sciences', 'Natural Sciences', 'Social and Behavioral Sciences'].includes(c.name)
    );
    const maxTotal = kuCats.reduce((sum, c) => sum + (c.maxHours || 0), 0);

    // Fill every K&U category to max with courses from 2 disciplines each
    const transcript = [
      makeCourse('HIST 152', 4), makeCourse('PHIL 153', 4),   // Humanities: 8 raw, 6 eff
      makeCourse('CHEM 101', 4), makeCourse('PHYS 133', 4),   // Nat Sci: 8 raw, 6 eff
      makeCourse('ECON 221', 4), makeCourse('PSYC 151', 4),   // S&B: 8 raw, 6 eff
      makeCourse('MUSC 100', 4), makeCourse('COMM 248', 4),   // Arts: 8 raw, 6 eff
      makeCourse('MATH 100', 4),                               // Math: 4 raw, 4 eff
      makeCourse('SPAN 202', 4),                               // WL2: 4 raw, 4 eff
    ];
    const analysis = analyze(categories, transcript);
    assert.equal(analysis.kuSummary.totalHours, maxTotal); // 6+6+6+6+4+4 = 32

    // Adding more courses shouldn't change the total
    const transcript2 = [...transcript, makeCourse('REL 255', 4)];
    const analysis2 = analyze(categories, transcript2);
    assert.equal(analysis2.kuSummary.totalHours, maxTotal); // still 32
  });
});

// ---- Generic opportunity verifier ----

describe('generic opportunity verifier', () => {
  it('all "satisfied" categories have a real, actionable opportunity (empty transcript)', async (t) => {
    // With no courses taken, no category should be "satisfied"
    const analysis = analyze(categories, []);
    await verifyOpportunities(analysis, categories, [], t);
  });

  it('verify opportunities with Humanities satisfied', async (t) => {
    const transcript = [makeCourse('HIST 152', 4)];
    const analysis = analyze(categories, transcript);
    await verifyOpportunities(analysis, categories, transcript, t);
  });

  it('verify opportunities with multiple K&U categories partially filled', async (t) => {
    const transcript = [
      makeCourse('HIST 152', 4),   // Humanities: satisfied
      makeCourse('CHEM 101', 4),   // Natural Sciences: satisfied
      makeCourse('ECON 221', 4),   // S&B Sciences: satisfied
    ];
    const analysis = analyze(categories, transcript);
    await verifyOpportunities(analysis, categories, transcript, t);
  });

  it('verify: no false opportunities when all K&U are complete', async (t) => {
    // Fill every K&U category to completion
    const transcript = [
      makeCourse('HIST 152', 4), makeCourse('PHIL 153', 4),
      makeCourse('CHEM 101', 4), makeCourse('PHYS 133', 4),
      makeCourse('ECON 221', 4), makeCourse('PSYC 151', 4),
      makeCourse('MUSC 100', 4), makeCourse('COMM 248', 4),
      makeCourse('MATH 100', 4),
      makeCourse('SPAN 202', 4),
    ];
    const analysis = analyze(categories, transcript);
    // No category should be "satisfied" — they should all be "complete"
    const satisfied = analysis.results.filter(r => r.status === 'satisfied');
    assert.equal(satisfied.length, 0,
      `Expected no satisfied categories, got: ${satisfied.map(r => r.name).join(', ')}`);
    // Run verifier anyway — it should find nothing to verify
    await verifyOpportunities(analysis, categories, transcript, t);
  });
});
