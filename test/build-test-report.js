/**
 * node test/build-test-report.js → docs/test-cases.html
 *
 * Runs the logic tests with test/recorder.js recording every analyze() call,
 * then lists each case in plain language: the student's courses (and what
 * Workday says, when the test gives it) and what the tool concluded. Only
 * requirements that differ from a student with no courses are shown. Fails,
 * writing nothing, if any test fails.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze } from '../src/core.js';
import { loadCategories } from './helpers.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'test-cases.html');

// Test files, in reading order, with what each shows.
const SECTIONS = [
  { file: 'test/test-logic.js', title: 'Requirement rules',
    about: 'One requirement rule at a time: pick-one requirements, K&U hour ranges and discipline caps, the K&U total, exemptions, in-progress and transfer credit, labs, renumbered courses, and AP/transfer credit with no course number.' },
  { file: 'test/test-workday-status.js', title: 'Grades, repeated courses, and Workday’s status',
    about: 'Courses with no credit (F, W, ...), repeated courses, and how the tool compares its verdict with the Status Workday shows for each requirement.' },
  { file: 'test/test-opportunities.js', title: '“Minimum met” means more hours can still count',
    about: 'Whenever the tool says a K&U category’s minimum is met but more hours could count, these cases add a course there and confirm the count goes up.' },
  { file: 'test/test-advising-cases.js', title: 'Advising cases',
    about: 'Real students’ records, de-identified (grades reduced to A, D, or F; years shifted to start at 2000), copied from the Core Planner while advising. A case marked as a known bug is one where the tool is currently wrong.' },
  { file: 'test/test-xlsx.js', title: 'Reading Workday’s Excel export',
    about: 'Courses read from Academic Progress exports, including a real, anonymized one.' },
];

// ---- Run the tests, recording ----
const dir = mkdtempSync(join(tmpdir(), 'core-test-report-'));
const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...SECTIONS.map(s => s.file)], {
  cwd: ROOT, env: { ...process.env, CORE_TEST_REPORT: dir }, encoding: 'utf-8',
});
const passed = +(run.stdout.match(/^# pass (\d+)/m)?.[1] ?? 0);
if (run.status !== 0) {
  process.stdout.write(run.stdout.split('\n').filter(l => /not ok|# (pass|fail)/.test(l)).join('\n') + '\n');
  rmSync(dir, { recursive: true, force: true });
  console.error('Tests failed; docs/test-cases.html not written.');
  process.exit(1);
}
// Advising cases the tool currently gets wrong, by test name.
const CASES = new URL('./fixtures/cases/', import.meta.url);
const knownBugs = new Map(readdirSync(CASES).filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(readFileSync(new URL(f, CASES), 'utf-8')))
  .filter(c => c.toolIsWrong).map(c => [c.about, c.toolIsWrong]));
const records = readdirSync(dir).flatMap(f => JSON.parse(readFileSync(join(dir, f), 'utf-8')));
rmSync(dir, { recursive: true, force: true });

// ---- Plain-language pieces ----
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const hrs = n => String(+Number(n).toFixed(2));
import { isNonPassingGrade } from '../src/core.js';

function courseText(c) {
  if (c.status === 'exemption') return `<b>${esc(c.title)}</b> (exemption for ${esc(c.exemptionTarget)})`;
  const notes = [];
  if (c.status === 'in-progress') notes.push('in progress');
  if (c.status === 'transfer') notes.push('transfer credit');
  if (c.grade && c.status !== 'in-progress') notes.push(isNonPassingGrade(c.grade) ? `<span class="bad">grade ${esc(c.grade)}</span>` : 'grade ' + esc(c.grade));
  if (c.period) notes.push(esc(c.period));
  const title = c.title && c.title !== c.code ? ' ' + esc(c.title) : '';
  const listed = c.requirements?.length ? ` <span class="muted">· Workday lists it under ${c.requirements.map(esc).join('; ')}</span>` : '';
  return `<b>${esc(c.code)}</b>${title} · ${hrs(c.hours)} hrs${notes.length ? ', ' + notes.join(', ') : ''}${listed}`;
}

function statusText(r) {
  if (r.isExempt) return 'Exempt';
  if (r.workdaySatisfied) return 'Satisfied in Workday';
  switch (r.status) {
    case 'complete': return 'Complete';
    case 'satisfied': return 'Minimum met';
    case 'optional-available': return 'Optional, nothing taken';
    case 'incomplete': return r.reqType === 'hour-range' ? `Not yet (${hrs(r.hours)} of ${r.minHours}+ hrs)` : 'Not yet';
    default: return r.status;
  }
}
const statusCls = r => r.isExempt || r.workdaySatisfied || r.status === 'complete' ? 'done'
  : r.status === 'satisfied' ? 'min' : r.status === 'incomplete' ? 'todo' : 'muted';

function resultLine(r) {
  const details = [];
  if (r.reqType === 'hour-range' && r.hours > 0) {
    details.push(`${hrs(r.hours)} hrs` + (r.effective < r.hours ? ` (${hrs(r.effective)} count toward the K&U total)` : ''));
  }
  const VIA = { assumed: 'placed by its subject', 'other-catalog': 'listed here in another year’s catalog', workday: 'Workday lists it here' };
  if (r.counted.length) details.push('counts ' + r.counted.map(c => esc(c.code) + (c.via ? ` <i>(${VIA[c.via]})</i>` : '')).join(', '));
  if (r.excluded.length) details.push(`<span class="bad">doesn’t accept ${r.excluded.join(', ')} (transfer)</span>`);
  if (r.maxed.length) details.push(`${r.maxed.join(', ')} at its discipline maximum`);
  if (r.workdaySatisfied) details.push(`Workday lists ${r.workdaySatisfied.items.length ? r.workdaySatisfied.items.map(i => '“' + esc(i) + '”').join(', ') : 'nothing'}`);
  return `<li><span class="req">${esc(r.name)}</span> <span class="pill ${statusCls(r)}">${esc(statusText(r))}</span>`
    + (details.length ? ` <span class="detail">${details.join('; ')}</span>` : '') + '</li>';
}

// What a student with no courses sees, per catalog. A row equal to this is left
// out, unless the catalog lists one of the student's courses there: then a
// course that should count but doesn't still shows.
const catalogs = new Map(['24', '25'].map(id => {
  const cats = loadCategories(id);
  const label = cats.some(c => c.name === 'Rhetoric in Disciplines') ? '2026–27' : '2025–26';
  const listed = new Map(cats.filter(c => c.name).map(c => [c.name, new Set((c.courses || []).map(x => x.code))]));
  return [label, { baseline: new Map(analyze(cats, []).results.filter(r => r.name).map(r => [r.name, r])), listed }];
}));
const shownRow = (rec, r) => {
  const { baseline, listed } = catalogs.get(rec.catalog) || {};
  const base = baseline?.get(r.name);
  return !base || base.status !== r.status || (base.hoursEarned || 0) !== r.hours || r.isExempt || r.workdaySatisfied
    || r.counted.length || r.excluded.length || rec.courses.some(c => listed.get(r.name)?.has(c.code));
};

function outcomeHtml(rec) {
  const o = rec.outcome;
  const items = [];
  for (const c of o.workdayChecks) {
    const name = c.requirement === 'K&U' ? 'Knowledge and Understanding' : c.requirement;
    items.push(c.kind === 'mismatch'
      ? `<li class="flag"><b>Disagreement flagged:</b> ${esc(name)}: Workday says ${esc(c.workdayStatus)}, the tool says ${esc(c.ourStatus)}. The student sees a red box and a bug report.</li>`
      : `<li class="flag ok"><b>Goes by Workday:</b> ${esc(name)} is Satisfied in Workday by ${c.items.length ? c.items.map(i => '“' + esc(i) + '”').join(', ') : 'nothing listed'}.</li>`);
  }
  const rows = o.results.filter(r => shownRow(rec, r));
  items.push(...rows.map(resultLine));
  const ku = o.ku;
  if (ku.requiredHours != null && (ku.totalHours > 0 || ku.met)) {
    items.push(`<li><span class="req">K&amp;U total</span> <span class="pill ${ku.met ? 'done' : 'todo'}">${ku.met ? 'Met' : 'Not met'}</span> `
      + `<span class="detail">${hrs(ku.totalHours)} of ${ku.requiredHours} hrs, ${ku.categoriesUsed} of ${ku.requiredCategories} categories</span></li>`);
  }
  if (o.notCounted.length) items.push(`<li><span class="bad">Not counted anywhere (no-credit grade): ${o.notCounted.map(esc).join(', ')}</span></li>`);
  for (const w of o.warnings) items.push(`<li class="flag">Warning: <b>${esc(w.code)}</b>: ${esc(w.reason)}.</li>`);
  if (items.length === 0) items.push('<li class="muted">Every requirement as for a student with no courses.</li>');
  return `<ul class="outcome">${items.join('')}</ul>`;
}

const sameCourse = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function inputHtml(rec, prev) {
  const parts = [];
  // A scenario that adds a course: show only what's new.
  const extends_ = prev && prev.catalog === rec.catalog && prev.courses.length < rec.courses.length
    && prev.courses.every((c, i) => sameCourse(c, rec.courses[i]));
  const shown = extends_ ? rec.courses.slice(prev.courses.length) : rec.courses;
  if (extends_) parts.push(`<p class="then">Then add:</p>`);
  parts.push(shown.length ? `<ul class="courses">${shown.map(c => `<li>${courseText(c)}</li>`).join('')}</ul>` : '<p class="muted">No courses.</p>');
  if (rec.workdayStatus?.length) {
    parts.push('<p class="label">Workday’s Status:</p><ul class="courses">' + rec.workdayStatus.map(([req, s]) =>
      `<li>${esc(req)}: <b>${esc(s.status)}</b>${s.items.length ? ' with ' + s.items.map(i => '“' + esc(i) + '”').join(', ') : ''}</li>`).join('') + '</ul>');
  }
  if (rec.planned.length) parts.push(`<p class="label">Planned (shown, not counted): ${rec.planned.map(esc).join(', ')}</p>`);
  return parts.join('');
}

// ---- Group: section → test → calls ----
let caseCount = 0;
const sectionsHtml = SECTIONS.map((section, si) => {
  const recs = records.filter(r => r.at?.file === section.file);
  const byTest = new Map();
  for (const r of recs) {
    if (!byTest.has(r.test)) byTest.set(r.test, []);
    const list = byTest.get(r.test);
    const last = list.at(-1);
    // The same input twice in one test (e.g. analyzed again for a sub-check) shows once.
    if (last && last.catalog === r.catalog && JSON.stringify([last.courses, last.workdayStatus, last.planned])
      === JSON.stringify([r.courses, r.workdayStatus, r.planned])) continue;
    list.push(r);
  }
  let group = null;
  const out = [];
  for (const [test, calls] of byTest) {
    const [describe, ...rest] = (test || 'Other').split(' > ');
    const title = rest.length ? rest.join(' › ') : describe;
    if (rest.length && describe !== group) { group = describe; out.push(`<h3>${esc(describe)}</h3>`); }
    caseCount++;
    const steps = calls.map((rec, i) => `<div class="step"><div class="in">${inputHtml(rec, calls[i - 1])}</div>`
      + `<div class="out">${outcomeHtml(rec)}</div></div>`).join('');
    const catalogs = [...new Set(calls.map(c => c.catalog))].join(', ');
    const bug = knownBugs.get(title) ? `<p class="flag"><b>Known bug:</b> ${esc(knownBugs.get(title))}</p>` : '';
    out.push(`<article class="case"><h4>${esc(title)}</h4>${bug}<p class="meta">${esc(catalogs)} catalog · <code>${esc(calls[0].at.file)}:${calls[0].at.line}</code></p>${steps}</article>`);
  }
  return `<section id="s${si + 1}"><h2>${esc(section.title)}</h2><p class="about">${esc(section.about)}</p>${out.join('\n')}</section>`;
}).join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Core Planner Test Cases</title>
<style>
  :root { --bg:#f4f5f7; --surface:#fff; --ink:#1b2330; --muted:#5d6879; --line:#dde1e8;
    --done:#1f7a4d; --done-bg:#e3f4ea; --min:#2457b3; --min-bg:#e5edfb; --todo:#9a5b00; --todo-bg:#fdf0d9; --warn:#a2341b; --warn-bg:#fdece7; }
  @media (prefers-color-scheme: dark) { :root { --bg:#12151b; --surface:#1b2029; --ink:#e6e9ef; --muted:#9aa4b5; --line:#303846;
    --done:#6fd39d; --done-bg:#183427; --min:#8fb4ff; --min-bg:#1c2a45; --todo:#f0b45a; --todo-bg:#3a2a12; --warn:#ff9a80; --warn-bg:#3d1f18; } }
  body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; }
  .wrap { max-width:980px; margin:0 auto; padding:24px 16px 64px; }
  h1 { font-size:26px; margin:0 0 6px; } h2 { font-size:20px; margin:36px 0 4px; } h3 { font-size:14px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:24px 0 8px; }
  h4 { font-size:15px; margin:0 0 2px; } .about, .lead { color:var(--muted); margin:0 0 12px; }
  .lead { color:var(--ink); } nav ul { padding-left:20px; } nav a { color:var(--min); }
  .case { background:var(--surface); border:1px solid var(--line); border-radius:10px; padding:12px 14px; margin:10px 0; break-inside:avoid; }
  .meta { font-size:12px; color:var(--muted); margin:0 0 8px; } code { font-size:12px; }
  .step { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.3fr); gap:16px; padding:8px 0; border-top:1px solid var(--line); }
  .step:first-of-type { border-top:0; padding-top:0; }
  @media (max-width:700px) { .step { grid-template-columns:1fr; gap:6px; } }
  ul { margin:0; padding-left:18px; } li + li { margin-top:2px; }
  .outcome { list-style:none; padding:0; } .label, .then { margin:6px 0 2px; font-size:13px; color:var(--muted); } .then { margin-top:0; font-weight:600; }
  .req { font-weight:600; } .detail { color:var(--muted); font-size:13px; }
  .pill { font-size:12px; font-weight:700; padding:1px 8px; border-radius:999px; white-space:nowrap; }
  .pill.done { color:var(--done); background:var(--done-bg); } .pill.min { color:var(--min); background:var(--min-bg); }
  .pill.todo { color:var(--todo); background:var(--todo-bg); } .pill.muted { color:var(--muted); background:var(--bg); }
  .bad { color:var(--warn); font-weight:600; } .muted { color:var(--muted); }
  .flag { background:var(--warn-bg); border-radius:6px; padding:4px 8px; margin:2px 0; } .flag.ok { background:var(--done-bg); }
  .key { background:var(--surface); border:1px solid var(--line); border-radius:10px; padding:12px 16px; }
</style>
</head>
<body><div class="wrap">
<h1>Core Planner test cases</h1>
<p class="lead">Every case the automated logic tests run, written out: the student’s courses on the left, what the tool concluded on the right. All ${passed} checks in these tests pass. Courses are made up except in “Reading Workday’s Excel export,” which uses a real, anonymized record.</p>
<div class="key">
  <p><b>How to read a case.</b> The heading says what the case is meant to show. The right side lists the requirements that list one of the student’s courses or whose result differs from a student with no courses, plus the K&amp;U total when any K&amp;U hours count. A course that counts only because of an assumption says so in italics. “Then add” continues the same student with more courses. Statuses: <span class="pill done">Complete</span> done; <span class="pill min">Minimum met</span> K&amp;U minimum met, with room for more hours; <span class="pill todo">Not yet</span> not done.</p>
  <p class="muted">If a result looks wrong, note the case’s heading or the file and line under it.</p>
</div>
<nav><ul>${SECTIONS.map((s, i) => `<li><a href="#s${i + 1}">${esc(s.title)}</a></li>`).join('')}</ul></nav>
${sectionsHtml}
<p class="muted">${caseCount} cases. Generated by <code>npm run test-report</code> (also part of <code>npm run build</code>).</p>
</div></body></html>
`;
writeFileSync(OUT, html);
console.log(`Wrote docs/test-cases.html: ${caseCount} cases from ${records.length} analyses; ${passed} checks passed.`);
