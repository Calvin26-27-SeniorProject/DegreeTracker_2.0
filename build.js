import * as esbuild from 'esbuild';
import { generateMajorCourseOptions } from './test/generate-major-course-options.js';

const common = {
  bundle: true,
  sourcemap: true,
  target: ['chrome120', 'firefox120'],
};

generateMajorCourseOptions();

// Chrome extension content script
await esbuild.build({
  ...common,
  entryPoints: ['src/main.js'],
  outfile: 'dist/extension.js',
  format: 'iife',
});

// Local bookmarklet bundle (same app bundle, minified)
await esbuild.build({
  ...common,
  entryPoints: ['src/main.js'],
  outfile: 'dist/bookmarklet.js',
  format: 'iife',
  minify: true,
  sourcemap: false,
});

// Hosted bookmarklet bundle for GitHub Pages.
await esbuild.build({
  ...common,
  entryPoints: ['src/bookmarklet-entry.js'],
  outfile: 'docs/bookmarklet.js',
  format: 'iife',
  minify: true,
  sourcemap: false,
});

// Hosted standalone overlap viewer bundle for program pages.
await esbuild.build({
  ...common,
  entryPoints: ['overlap_view.js'],
  outfile: 'docs/overlap-view.js',
  format: 'iife',
  minify: true,
  sourcemap: false,
});

// Standalone app (index.html), with the saved catalogs bundled in.
await esbuild.build({
  ...common,
  entryPoints: ['src/app.js'],
  outfile: 'docs/app.js',
  format: 'iife',
  minify: true,
  sourcemap: false,
});

console.log('Built docs/app.js, dist/extension.js, dist/bookmarklet.js, docs/bookmarklet.js, and docs/overlap-view.js');
