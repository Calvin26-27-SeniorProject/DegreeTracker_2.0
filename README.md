# Calvin Core

Unofficial planning aid that checks a student's Workday courses against Calvin's core requirements.

## Core Planner (standalone app)

`docs/index.html`, served by GitHub Pages at https://kcarnold.github.io/calvin-core/. Students pick their entry-year catalog, paste Workday Academic Progress (or Academic History), and see each requirement's status, course options, and where each course counts.

- Workday is the official record; the page says so up front.
- Requirements come from catalog snapshots in `catalog/` (saved from a browser; see CLAUDE.md). Catalog wording, course codes, titles, and list order are shown as the catalog has them; `test/test-app-fidelity.js` checks this against the saved HTML.
- Each sentence of catalog wording is labeled Checked, Partly checked, Not checked, or Advice (`INSTRUCTION_RULES` in `src/core.js`). New catalog wording fails `test/test-catalog-claims.js` until it's classified.
- Course codes link to `preview_course_nopop.php`; each requirement links to its spot on the official catalog page.
- Everything runs in the browser. The page's Content-Security-Policy blocks network requests (`connect-src 'none'`), so pasted data can't leave it.

## Catalog extension and bookmarklet

The original tool annotates the catalog page itself:

- https://catalog.calvin.edu/content.php?catoid=25&navoid=803 (2026–27 catalog)
- https://catalog.calvin.edu/content.php?catoid=24&navoid=780 (2025–26 catalog)

Requirements are read from whichever page is open. When the page loads, the extension adds a collapsed Calvin Core Annotator panel above the catalog content; paste Workday Academic History or Academic Progress into it.

## Load Locally

### Chrome or Edge

1. Open the extensions page.
	Chrome: `chrome://extensions`
	Edge: `edge://extensions`
2. Turn on Developer mode.
3. Click Load unpacked.
4. Select this repository folder.

### Firefox

1. Open `about:debugging`.
2. Click This Firefox.
3. Click Load Temporary Add-on.
4. Select `manifest.json` from this repository.

Firefox temporary add-ons unload when the browser restarts, so that path is best for testing. For broader student distribution, publish the extension package.

> **Note:** Run `npm run build` first — the manifest now points to `dist/extension.js`.

## Run locally

Install Node.js dependencies:

```powershell
npm install
```

Start the local server on Windows:

```powershell
.\dev.ps1
```

Or use the npm script:

```powershell
npm run dev
```

Open [http://localhost:8000](http://localhost:8000).

The app is entirely browser-based. It does not upload or save pasted Workday data.

## Development

```sh
npm install
npm run build   # → docs/app.js, dist/extension.js, dist/bookmarklet.js, docs/bookmarklet.js
npm test        # unit, claims, fidelity, and integration tests
# Preview the app (its CSP needs http, not file://):
python3 -m http.server --directory docs
```

## Testing

Put transcript `.txt` files in `test/fixtures/` (gitignored so student data stays local):

```sh
# First run prints analysis JSON for review:
npm test

# Snapshot the output as the expected baseline:
node test/run-test.js test/fixtures/transcript-alice.txt > test/fixtures/transcript-alice.expected.json

# Future runs assert results match the snapshot:
npm test
```

The integration harness uses `catalog/catalog-24.html`.

## Bookmarklet

For local testing, after `npm run build`, wrap `dist/bookmarklet.js` in a `javascript:` URL:

```sh
echo "javascript:$(cat dist/bookmarklet.js)" | pbcopy
```

Paste as a bookmark's URL. Click it on the catalog page.

For a hosted bookmarklet that always loads the latest deployed bundle, publish the `docs/` directory with GitHub Pages. The install page lives at:

```text
https://kcarnold.github.io/calvin-core/bookmarklet.html
```

The live bookmarklet there injects `https://kcarnold.github.io/calvin-core/bookmarklet.js`, so pushing a new `docs/bookmarklet.js` updates the bookmarklet behavior without asking users to replace the bookmark.

## Program Overlap Viewer (Separate)

The overlap viewer is intentionally distributed as a separate tool from the core transcript annotator.

- Install page: `https://kcarnold.github.io/calvin-core/overlap.html`
- Hosted script: `https://kcarnold.github.io/calvin-core/overlap-view.js`
- Source script: `overlap_view.js` (runs on `preview_program.php` pages)

Run `npm run build` to regenerate `docs/overlap-view.js`.

## Files

```
src/
  core.js       ← parsers, catalog instruction rules, analyze (pure, testable)
  app.js        ← standalone app entry (bundles catalog/*.json)
  app-render.js ← standalone app rendering (testable in jsdom)
  render.js     ← catalog-page annotation (extension/bookmarklet)
  ui.js         ← catalog-page launcher panel
  main.js       ← extension entry point
  bookmarklet-entry.js ← hosted bookmarklet entry point
catalog/        ← catalog-<catoid>.html (saved from a browser) + generated catalog-categories-<catoid>.json
docs/           ← GitHub Pages: app (index.html, app.js), bookmarklet install page + bundle
test/           ← node:test suites, integration harness, catalog JSON generator
build.js        ← esbuild config
manifest.json   ← WebExtension manifest (Chrome, Edge, Firefox)
script.js       ← legacy monolith (kept for reference, not used by build)
overlap_view.js ← standalone program/core overlap panel script
```
