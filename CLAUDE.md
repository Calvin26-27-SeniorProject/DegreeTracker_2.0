# Calvin Core Annotator

Shows a student's core program status from pasted Workday data. Two front ends share `src/core.js`:
- **Core Planner** (`index.html` + `src/app.js`): standalone app; bundles the saved catalog JSON. Doesn't look like the catalog, on purpose. Keeps "Workday is the official record" hedging. Must stay entirely client-side (CSP `connect-src 'none'`; Workday .xlsx exports are read locally).
- **Extension / bookmarklet** (`src/ui.js`, `src/render.js`): annotates the catalog's Core Program page in place.

Supported catalogs (listed in `CATALOG_PAGES` in `src/ui.js` and `CATALOGS` in `src/app.js`; students use the catalog for their entry year):
- `catoid=25&navoid=803` — 2026–27. Adds the "Rhetoric in Disciplines" pick-one requirement.
- `catoid=24&navoid=780` — 2025–26.

**Course lists are the union of all known catalogs.** Courses get renumbered between years (ENST 210 → GEO 210, MATH 171 → MATH 161), so a course listed for a requirement in *any* known catalog counts toward it (assumption: once satisfying, always satisfying). `src/catalog-courses.js` (generated) holds the union; `ui.js` passes it to `analyze()` as `extraCourses`. It's additive only and limited to categories on the open page. Taken courses matched only via the union get `isFromOtherCatalog` annotations with no `element`; render lists them in a note on the block. Future per-section mappings (e.g. a PHIL 153 section tagged Diversity and Difference, visible in Academic Progress but not the catalog) should feed the same additive path.

catalog.calvin.edu sits behind an AWS WAF bot challenge: `curl`/`fetch` get an empty 202. Save page HTML from a real browser into `catalog/catalog-<catoid>.html`, update `CATALOG_INFO` (savedAt; navoid for a new catalog) in `test/catalog-json.js`, and run `npm run generate-catalog -- <catoid>`. A new catalog also needs adding to `CATALOGS` in `src/app.js`.

## Course schedule (sections and hours)

- `schedule/CourseSchedule-<term>.json`: Workday course-search exports, downloaded by hand once per term from the API behind https://sites.calvin.edu/courses/course-search.js (don't hit it repeatedly). `SCHEDULE_INFO` in `test/schedule-json.js` gives each term's label, savedAt, and `shown`. `npm run generate-schedule` → `schedule/sections.json` (bundled by the app; `test-schedule.js` checks it's a fresh generation).
- `hours[code]` = `{ min, max, term }` from the latest term offering it, any section (closed too); a lecture includes its lab (`CHEM 101` 3 + `CHEM 101L` 1). Hours-only terms (`shown: false`, e.g. last fall's) only feed this: a 26FA section says nothing about 27FA.
- `offerings[code][term]`: sections of shown terms, minus Closed, CPI, and Handlon Campus. Status (open/waitlist/full) is never shown to students. Labs are listed under their lecture (`lab: true`).
- App: course rows show hours and a collapsed section list (not for taken/in-progress courses). Courses with no listed sections still show; nothing is filtered by offering.
- Plan: `plannedEntries` turns planned codes into in-progress entries with schedule hours (variable → minimum; unknown → 0). `app.js` runs a second `analyze()` with them (the projection); cards show "With plan: …" when it differs and the summary gives the planned count. The actual analysis and Workday checks never include plans.
- The export has no section-level tags (PHIL 153-C's Diversity and Difference tag isn't in it); that needs a Workday report.

## Not claiming more than the catalog

- `INSTRUCTION_RULES` in `src/core.js`: every sentence of catalog instructions must match exactly one rule, either `checked` (enforced, with `verify` confirming the parsed fields match the wording), `partial`, `advice`, or not checked with a `note`. The app labels each sentence accordingly. `test/test-catalog-claims.js` fails on unrecognized wording.
- `test/test-app-fidelity.js`: renders the app in jsdom and compares headings, wording, and list items (headings, connectors, codes, titles, links) to the saved HTML read directly, not through the parser. Courses the app adds (other-catalog, assumed placeholders) must be in labeled `.extra-course` items.
- `test/test-catalog-snapshot.js`: committed JSON and `src/catalog-courses.js` must equal a fresh generation from the saved HTML.
- K&U aggregate (26 hrs, 5 of 6 categories) is parsed from the K&U section wording (`kuAggregate`), not hardcoded.
- "Transfer credit not accepted" / "must be completed at Calvin" exclude `transfer` courses from that requirement (`isExcludedTransfer` annotation; app warns).
- Double counting: a course listed under two requirements counts toward both. Confirmed when either is a tag or Rhetoric in Disciplines (`overlapConfirmed` in `core.js`, confirmed 2026-10-15); the claims test fails on any other overlap, and the app lists unconfirmed ones as an assumption.
- World Languages II's 101–102 option: issue #2 (use Workday listing a language course under K&U).
- Foundational Writing's list is "ENGL 101 Or ENGL 100 ENGL 102": parsed as `alternatives` [[101], [100, 102]]; a whole alternative is needed. (ENGL 100 is a prerequisite of ENGL 102, so this mostly just surfaces the prerequisite; no need to handle it specially.)

## Project Structure

- `src/core.js` — Pure logic: `parseTranscript`, `parseProgress`, `parseProgressRows`, `parseCoreProgram(root)`, `INSTRUCTION_RULES`/`classifyInstructions`, `analyze`, `KU_NAMES`. No DOM globals; `parseCoreProgram` takes a root element (document or jsdom).
- `src/xlsx.js` — `readXlsxRows(data, { DOMParser })`: first worksheet's cells as rows of strings (fflate unzip + DOMParser; inline and shared strings).
- `src/app.js` — Standalone app entry: state, paste and .xlsx file handling, catalog picker. Imports `catalog/*.json`.
- `src/app-render.js` — `renderApp(root, state)`: builds the app page from catalog JSON + optional analysis. Uses `root.ownerDocument`, so tests render it in jsdom. With `state.tocRoot`, also `renderToc`: the Contents sidebar (every section/requirement with the card's status icon; K&U section shows the aggregate). Sticky beside the content at ≥1200px, a floating "Contents" panel below; `app.js` highlights the entry in view.
- `src/test-case.js` — `buildTestCase`/`formatTestCase`: the current record as a de-identified test case (grades → A/D/F keeping I, W, N, NR, CR; years shifted to start at 2000; non-core Workday requirements dropped), shown collapsed at the bottom of the app and used in bug reports. `expected` = the tool's result; advisors correct it and set `toolIsWrong` when the tool is wrong.
- `src/render.js` — Catalog-page rendering: injects styles, badges, TOC, annotations. Browser-only.
- `src/catalog-courses.js` — Generated: `KNOWN_COURSE_CATEGORIES`, union of course lists across `catalog-categories-*.json`. Don't edit by hand.
- `src/ui.js` — Launcher panel, paste and .xlsx file handlers, `main()` entry. Browser-only.
- `src/main.js` — Entry point (imports ui.js, calls `main()`).
- `build.js` — esbuild: bundles `docs/app.js` (standalone app), `dist/extension.js`, `dist/bookmarklet.js`, `docs/bookmarklet.js`, `docs/overlap-view.js`.
- `test/helpers.js` — Fluent scenario API and generic opportunity verifier for unit tests.
- `test/test-parsing.js` — Parsing unit tests (parseTranscript, parseProgress, detectInputFormat, parseCoreProgram).
- `test/test-xlsx.js` — `readXlsxRows` + `parseProgressRows` on `test/fixtures/academic-progress-sample.xlsx` (scrubbed via `test/scrub-progress-xlsx.py`) and generated workbooks.
- `test/test-logic.js` — Business logic tests: analyze() with real catalog categories + constructed transcripts.
- `test/test-advising-cases.js` — replays `test/fixtures/cases/*.json` (copied from the app while advising); `toolIsWrong` cases run as todo.
- `test/recorder.js` — `analyze()` for the logic tests; with `CORE_TEST_REPORT=<dir>` it records each call (test name, inputs, outcome). Logic test files import `analyze` from here, not core.js.
- `test/build-test-report.js` — runs the logic tests recording, writes `docs/test-cases.html` (every case in plain language, for the registrar; deployed with the site). Part of `npm run build`; also `npm run test-report`.
- `test/test-workday-status.js` — Non-passing grades, repeats, Workday Status checks (accepted/mismatch), the sample export agreeing with Workday, and their rendering.
- `test/test-opportunities.js` — Opportunity verification: proves "satisfied" status = real actionable opportunity.
- `test/run-test.js` — Integration test harness: full pipeline with real transcripts + catalog HTML.
- `test/catalog-json.js` — `CATALOG_INFO`, `buildCatalogJson(html, catoid)` (strips DOM fields; adds coid, coreId, alternatives, kuAggregate), `buildUnion`.
- `test/generate-catalog-json.js` — `node test/generate-catalog-json.js <catoid>`: catalog/catalog-<catoid>.html → catalog/catalog-categories-<catoid>.json, then regenerates `src/catalog-courses.js` from all catalog JSONs. `loadCategories(catoid)` in helpers defaults to the newest catalog.
- `catalog/` — Saved catalog HTML and generated JSON (public, committed). Integration snapshots use `catalog-24.html`.
- `schedule/` — Saved course-search exports and generated `sections.json` (see "Course schedule"). `test/schedule-json.js` (`SCHEDULE_INFO`, `buildScheduleJson`), `test/generate-schedule-json.js`, `test/test-schedule.js`.
- `test/fixtures/` — Student data; private transcripts gitignored.
- `script.js` — Legacy monolith (kept for reference).

## Build & Test

```sh
npm install
npm run build          # → docs/app.js, dist/extension.js, dist/bookmarklet.js, docs/bookmarklet.js, docs/test-cases.html (runs the logic tests)
npm test               # unit tests (node:test) + integration tests
npm run test:unit      # parsing, logic, opportunities, catalog claims/snapshot, app fidelity
npm run test:integration  # legacy harness with real transcript snapshots
npm run generate-catalog -- 25  # re-generate catalog-categories-25.json from catalog-25.html
npm run generate-schedule       # re-generate schedule/sections.json from schedule/CourseSchedule-*.json
```

### Test layers
1. **Parsing tests** (`test/test-parsing.js`) — parseTranscript, parseProgress, detectInputFormat, parseCoreProgram in isolation.
2. **Logic tests** (`test/test-logic.js`) — analyze() with real catalog categories + constructed transcripts. Fluent scenario API designed to walk through with the registrar.
3. **Opportunity tests** (`test/test-opportunities.js`) — proves every "satisfied" status is actionable: adding a course in a non-maxed discipline actually improves the result. Generic verifier tries both 4h and 2h.
4. **Integration tests** (`test/run-test.js`) — full pipeline with real transcript files and JSON snapshot comparison.
5. **Catalog claims / snapshot / app fidelity** — see "Not claiming more than the catalog".

## Target Page DOM

- Core categories live in `div.acalog-core` blocks (~22 of them). Section headers use `<h2>`, categories `<h3>`, Engaged Citizenship tags `<h4>`.
- Courses are `li.acalog-course` inside `<ul>`. Course text is in the `<a>` child — never use `li.textContent` directly because expanded course descriptions pollute it.
- Sub-discipline labels (e.g., "Performing Arts", "Biology") are `li.acalog-adhoc.acalog-adhoc-before`. The literals "Or", "One from", "And" are also adhoc items but aren't sub-disciplines.
- Course codes match `/^[A-Z]{2,5}\s+\d{3}[A-Z]?/`. All 459 courses on the page match this.
- Instructions are the block's direct-child `<p>`s only: adhoc `<li>`s (e.g. "Or") contain `<p>`s too.
- Course ids: the link's `onclick="showCourse('25', '56814', ...)"` → `coid`. Requirement anchors: heading `<a id="core_57993">` → `coreId` (the app links `content.php?...#core_57993`).

## Transcript Format (Workday Academic History)

- Students copy-paste from Workday's "Student Academic History" page. Entries are tab-delimited, separated by "Opens in new window" strings.
- Fields per entry: course name, grade, grade points (decimal), hours (integer), earned grade points (decimal). The grade regex must allow 1-2 uppercase letters (e.g., "A-", "B+", "CR").
- Lab courses (code ending in `L`, e.g., `CS 106L`) must have their hours merged into the parent lecture course. Labs rarely appear in core lists; when one does (ENGR 303L in the 2025–26 Environmental Sustainability tag), the merged parent's `labCodes` keep it matchable without double-counting hours.

## Academic Progress Format

- One field per line. Hours may be fractional (`1.5`, transfer credit).
- Any line that isn't a course or field value is taken as a requirement name; each course records the Workday requirement(s) it's listed under in `requirements` (e.g. "Knowledge and Understanding - minimum 26 hours").
- Exemptions get their target from their name ("Language Exemption") or the requirement they're listed under ("High School Exemption" under "World Languages I Core").

## Academic Progress .xlsx Export

- One sheet. Each program has a header row (`Requirement`, `Status`, `Remaining`, `Registrations Used`, `Academic Period`, `Hours`, `Grade`); `parseProgressRows` maps columns by header name. Every row below it is one requirement with at most one course/exemption, the requirement name repeated per course. A table ends at the first row lacking a requirement or status (e.g. "Program of Study GPA").
- Both progress inputs become records `{ requirement, item, period, hours, grade }`, converted to courses by the shared `progressFromRecords`.

## Placeholder Credit and K&U Warnings

- AP/transfer core credit can arrive with no course number: `HIST CORE - AP/Transfer History Core (Transfer Credit)`. Parsers set `isPlaceholder` + `subject`.
- `inferPlaceholderCategory` assumes it counts where ≥75% of that subject's K&U courses (page + union) sit, as that sub-discipline (HIST → Humanities/History, ARTS → Arts/Visual Arts). Ambiguous subjects (HNRS) aren't guessed. Assumed courses get `isAssumed` annotations with no `element`; render shows an orange "Assumed" note on the block.
- `analysis.warnings` (`{ code, title, hours, requirement, reason }`, `requirement` a catalog name or `'K&U'`): placeholders we couldn't place, and courses Workday lists under a requirement that don't count toward it here (e.g. under K&U but in no K&U category). Render shows a warning box above the summary; the launcher status mentions the count.

## Workday Requirement Listings

- `WORKDAY_REQUIREMENTS` / `workdayRequirementCategory` in `core.js` map Academic Progress requirement names ("Global Regions and Cultures Core") to catalog names. `test-xlsx.js` checks every core requirement in the sample export maps.
- A course Workday lists under a requirement counts toward it (though doesn't necessarily satisfy it). Pick-one requirements count such a course even if no catalog lists it (overrides, section-specific tags): `isFromWorkday` annotation, no `element`, shown as a labeled `.extra-course` (provenance `workday`). Hour-range requirements (K&U) can't place it in a sub-discipline, so they get a `warnings` entry instead.
- Workday's Status per requirement (the .xlsx Status column; in a paste, the line after the requirement name) comes back from both progress parsers as `workdayStatus` (requirement → `{ status, items }`, items verbatim). `analyze()` compares Satisfied / Not Satisfied with its own result (`workdayChecks`; "In Progress" isn't compared). Workday Satisfied by something that isn't a course (`Military - 05/01/2025`, nothing listed) → `accepted`: the result becomes complete with `workdaySatisfied`, shown as "Satisfied in Workday" with the items verbatim. Any other disagreement → `mismatch`: a loud box first on the page with a copyable `bugReport()` (app-render.js; course list, no name or ID). Both front ends.

## Grades and repeats

- `NON_PASSING_GRADES` (catalog: F, I, W, N, NR) count toward nothing (`analysis.notCounted`, listed in the warning box and the course table). A completed incomplete is "I" + its grade (`IA-`) and counts as that grade (so `IF` doesn't). Transfer CR counts.
- A repeated course's later attempt wins: by academic period in Academic Progress, else the later listing.

## Academic History

- Pasting Academic History is still accepted but not supported: it lacks transfer/in-progress labels and Workday's requirement listings. The app and launcher warn; instructions point to Academic Progress.

## Requirement Rules

- **Foundations / Competencies**: pick-one (any course taken = complete).
- **K&U categories**: hour-range parsed from instructions (e.g., "2–6 semester hours"). Note the en-dash `–` not hyphen.
- **Sub-discipline max**: "up to 4 semester hours in any one discipline" — tracked per sub-discipline heading.
- **K&U aggregate**: ≥26 hours from ≥5 of 6 K&U categories. Hours are **capped at maxHours per category** for the aggregate (a student with 8h in Math Sciences 0–4h only contributes 4h to the 26h total).
- **Engaged Citizenship tags**: pick-one, may overlap with any other category. Tags use `<h4>` not `<h3>`.
- **World Languages II**: 0–4h minimum means it's optional (status "optional-available" when 0h earned).

## Status Values

### Category result statuses (from `analyze()`)
- `header` — section-level heading (e.g., "Foundations"); not a real requirement; skipped in tests and rendering.
- `info-only` — category has no courses listed (nothing to fulfill); skipped in tests. (The app shows Engaged Citizenship Commitments as "N of 3 tags".)
- `complete` — all requirements satisfied. Pick-one: ≥1 course taken. Hour-range: min hours met and no more can be added (discipline cap reached or maxHours hit). Badge: "✓ COMPLETE"; block fades to 0.45 opacity.
- `satisfied` — K&U hour-range: minimum hours met (including minHours=0 with hours > 0) **and** more hours could still be counted (room in discipline/max). Badge: "MIN MET". Distinct from `complete` to signal the student can keep going.
- `incomplete` — requirement not yet met. Pick-one: no course taken. Hour-range: below minHours. Badge: "AREAS TO EXPLORE" or "X/Y+ hrs".
- `optional-available` — optional requirement (minHours = 0) with 0 hours earned (e.g., World Languages II). Badge: "OPTIONAL".

### Transcript course statuses (from `parseTranscript()`)
- `completed` — normal graded/passed course.
- `in-progress` — course marked "(In Progress)" in Workday; included in `allActiveSet`, so it counts for both pick-one and hour-range requirements (same as completed).
- `transfer` — transfer credit, marked "(Transfer Credit)" (Academic Progress only); treated like `completed` for requirement matching.
- `exemption` — special entry (e.g., "World Languages I Exemption"); satisfies a named category without contributing hours.

## Design Decisions

- Completed non-tag categories get `opacity: 0.45` with `:hover` restore. Tags stay full opacity because they overlap with other requirements.
- Double-count = course appearing in multiple `acalog-core` blocks. Annotated on **both sides** with clickable links that scroll to the other section.
- Double-count uses blue (#e8f0fe / #1a73e8), not red/orange — it's an opportunity, not a warning.
- Cross-references are real DOM `<span>` + `<a>` elements (not `::after` pseudo-elements) so they can be clickable.
- Taken courses that appear in multiple sections get a green→blue gradient background.
- Page reload = reset. No cleanup logic needed beyond what `render()` does for re-runs.

## Not Yet Implemented

- Credit hours for untaken courses that aren't in any saved schedule term (about a third of core courses); their Plan counts 0 hours.
- "One Foundations of Christianity course must be completed at Calvin" and "Test credit ... may not satisfy Engaged Citizenship" aren't checked (shown as Not checked).
- World Languages II's "101-102 in a different language" option isn't checked (Partly checked); see issue #2.
- No persistence — transcript must be re-pasted (or the export re-chosen) each time (app remembers only the catalog year, in localStorage).
