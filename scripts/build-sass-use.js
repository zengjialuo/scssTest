#!/usr/bin/env node
/**
 * @import → @use conversion performance test.
 *
 * Validates the speedup from replacing @import with @use WITHOUT touching
 * any source file.  A custom Importer intercepts every file load at compile
 * time, rewrites @import statements to @use … as * in-memory, and returns
 * the patched content to the dart-sass engine.
 *
 * Because @use caches each module within a compilation, files that are
 * required by multiple dependency chains are parsed only once.
 * With @import they are re-executed every time they appear in the graph.
 *
 * Run baseline first:  node scripts/build-sass.js   (writes build-report-js-api.json)
 * Then run this file:  node scripts/build-sass-use.js
 */

'use strict';

const sass = require('sass');
const path = require('path');
const fs   = require('fs');
const { pathToFileURL, fileURLToPath } = require('url');

const ROOT     = path.resolve(__dirname, '..');
const SRC      = path.join(ROOT, 'src');
const DIST     = path.join(ROOT, 'dist');
const DIST_USE = path.join(DIST, 'pages-use');

if (!fs.existsSync(DIST_USE)) fs.mkdirSync(DIST_USE, { recursive: true });

const LOAD_PATHS = [SRC, path.join(ROOT, 'packages'), path.join(ROOT, 'node_modules')];

// ---------------------------------------------------------------------------
// Helper: convert every @import statement in a string to @use … as *
// ---------------------------------------------------------------------------
function convertToUse(content) {
  return content
    .replace(/@import\s+'([^']+)'\s*;/g, "@use '$1' as *;")
    .replace(/@import\s+"([^"]+)"\s*;/g, '@use "$1" as *;');
}

// ---------------------------------------------------------------------------
// Helper: resolve a sass URL to an absolute file path (mirrors sass's
// partial-resolution rules: _foo.scss, foo.scss, foo/_index.scss …)
// ---------------------------------------------------------------------------
function resolveScssFile(url, fromDir) {
  const base = path.basename(url);
  const dir  = path.dirname(url);

  function tryCandidates(root, rel) {
    const b = path.basename(rel);
    const d = path.dirname(rel);
    const candidates = [
      path.join(root, rel),
      path.join(root, d, `_${b}`),
      path.join(root, d, `_${b}.scss`),
      path.join(root, `${rel}.scss`),
      path.join(root, rel, '_index.scss'),
      path.join(root, rel, 'index.scss'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return null;
  }

  // 1. relative to the containing file
  if (fromDir) {
    const r = tryCandidates(fromDir, url);
    if (r) return r;
  }

  // 2. each load path
  for (const lp of LOAD_PATHS) {
    const r = tryCandidates(lp, url);
    if (r) return r;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Custom Importer — intercepts ALL file loads, applies @import → @use
// Also handles the @base/ alias registered in build-sass.js
// ---------------------------------------------------------------------------
const convertingImporter = {
  /**
   * canonicalize: resolve a bare URL to a canonical file:// URL.
   * Return null to fall through to the next importer / built-in resolver.
   */
  canonicalize(url, { containingUrl } = {}) {
    // Already canonical – let sass handle it
    if (url.startsWith('file:') || url.startsWith('data:')) return null;

    // @base/ alias: maps to src/scss/
    if (url.startsWith('@base/')) {
      const tail     = url.slice('@base/'.length);
      const baseDir  = path.join(SRC, 'scss');
      const resolved = resolveScssFile(tail, baseDir) ?? resolveScssFile(path.join(baseDir, tail), null);
      if (resolved) return pathToFileURL(resolved);
      return null;
    }

    const fromDir  = containingUrl
      ? path.dirname(fileURLToPath(containingUrl.toString()))
      : null;

    const resolved = resolveScssFile(url, fromDir);
    if (resolved) return pathToFileURL(resolved);

    return null;  // let built-in resolution handle it
  },

  /**
   * load: read the file and return its content with @import → @use applied.
   */
  load(canonicalUrl) {
    const filePath = fileURLToPath(canonicalUrl.toString());
    if (!fs.existsSync(filePath)) return null;

    const original = fs.readFileSync(filePath, 'utf8');
    const patched  = convertToUse(original);

    return { contents: patched, syntax: 'scss' };
  },
};

// ---------------------------------------------------------------------------
// Recursively scan src/ subdirectory
// ---------------------------------------------------------------------------
function scanScssFiles(dir, srcRel, base) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.join(base, entry.name);
    if (entry.isDirectory()) {
      results.push(...scanScssFiles(path.join(dir, entry.name), srcRel, rel));
    } else if (entry.name.endsWith('.scss')) {
      results.push({
        input:  path.join('src', srcRel, rel),
        output: path.join('dist', srcRel + '-use', rel.replace(/\.scss$/, '.use.css')),
        label:  path.join(srcRel, rel).replace(/\.scss$/, ''),
      });
    }
  }
  return results;
}

const entries = [
  ...scanScssFiles(path.join(SRC, 'pages'), 'pages', ''),
  ...scanScssFiles(path.join(SRC, 'components'), 'components', ''),
];

console.log('\n📊 SCSS Compilation (@use — in-memory conversion)\n');
console.log('='.repeat(60));

const results    = [];
const totalStart = Date.now();

for (const entry of entries) {
  const inputAbs  = path.join(ROOT, entry.input);
  const outputAbs = path.join(ROOT, entry.output);
  fs.mkdirSync(path.dirname(outputAbs), { recursive: true });

  // Read the page source and convert its own @import lines
  const pageSource = convertToUse(fs.readFileSync(inputAbs, 'utf8'));

  const start = Date.now();
  try {
    const result = sass.compileString(pageSource, {
      // url tells sass where this string "lives" so relative paths inside it resolve correctly
      url:       pathToFileURL(inputAbs),
      importers: [convertingImporter],
      sourceMap: false,
      style:     'expanded',
    });

    const duration = Date.now() - start;
    fs.writeFileSync(outputAbs, result.css);
    const size = Buffer.byteLength(result.css);
    results.push({ label: entry.label, duration, size, status: 'ok' });
    console.log(`✅  ${entry.label.padEnd(35)} ${String(duration).padStart(5)}ms   ${(size / 1024).toFixed(1)}KB`);
  } catch (err) {
    const duration = Date.now() - start;
    results.push({ label: entry.label, duration, status: 'error', error: err.message });
    console.log(`❌  ${entry.label.padEnd(35)} ${String(duration).padStart(5)}ms   ERROR`);
    console.error(`    ${err.message.split('\n').slice(0, 4).join(' | ')}`);
  }
}

const totalDuration = Date.now() - totalStart;
console.log('='.repeat(60));
console.log(`\nTotal (@use): ${totalDuration}ms for ${entries.length} files\n`);

// ---------------------------------------------------------------------------
// Comparison table vs @import baseline
// ---------------------------------------------------------------------------
const baselinePath = path.join(DIST, 'build-report-js-api.json');
if (fs.existsSync(baselinePath)) {
  const baseline    = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const baselineMap = Object.fromEntries(baseline.results.map(r => [r.label, r]));
  const successful  = results.filter(r => r.status === 'ok' && baselineMap[r.label]);

  console.log('📊 Per-file comparison: @import (baseline)  vs  @use (this run)');
  console.log('='.repeat(75));
  const H = `${'label'.padEnd(35)} ${'@import'.padStart(8)}  ${'@use'.padStart(8)}  ${'Δ time'.padStart(8)}  ${'Δ size'.padStart(10)}`;
  console.log(H);
  console.log('-'.repeat(75));

  let sumBaseTime = 0, sumUseTime = 0;
  let sumBaseSize = 0, sumUseSize = 0;

  for (const r of successful) {
    const b = baselineMap[r.label];
    sumBaseTime += b.duration;
    sumUseTime  += r.duration;
    sumBaseSize += b.size ?? 0;
    sumUseSize  += r.size;

    const dt = r.duration - b.duration;
    const ds = r.size - (b.size ?? 0);
    const dtStr = (dt > 0 ? '+' : '') + dt + 'ms';
    const dsStr = (ds > 0 ? '+' : '') + (ds / 1024).toFixed(0) + 'KB';
    console.log(
      `${r.label.padEnd(35)} ${String(b.duration).padStart(7)}ms  ${String(r.duration).padStart(7)}ms  ${dtStr.padStart(8)}  ${dsStr.padStart(10)}`
    );
  }

  console.log('-'.repeat(75));
  const dtTotal = sumUseTime  - sumBaseTime;
  const dsTotal = sumUseSize  - sumBaseSize;
  console.log(
    `${'TOTAL (matched files)'.padEnd(35)} ${String(sumBaseTime).padStart(7)}ms  ${String(sumUseTime).padStart(7)}ms  ${((dtTotal > 0 ? '+' : '') + dtTotal + 'ms').padStart(8)}  ${((dsTotal / 1024 / 1024).toFixed(1) + 'MB').padStart(10)}`
  );

  console.log(`
┌─────────────────────────────────────────────┐
│  Baseline   (@import)  ${String(baseline.totalDuration).padStart(7)}ms  ${(sumBaseSize/1024/1024).toFixed(1)}MB total output
│  This run   (@use)     ${String(totalDuration).padStart(7)}ms  ${(sumUseSize/1024/1024).toFixed(1)}MB total output
│  Speedup               ${((1 - totalDuration / baseline.totalDuration) * 100).toFixed(1)}%
│  Output reduction      ${((1 - sumUseSize / sumBaseSize) * 100).toFixed(1)}%
└─────────────────────────────────────────────┘`);
}

// ---------------------------------------------------------------------------
// Save report
// ---------------------------------------------------------------------------
const report = {
  timestamp:     new Date().toISOString(),
  api:           'sass-js-use',
  totalDuration,
  fileCount:     entries.length,
  results,
};

fs.writeFileSync(
  path.join(DIST, 'build-report-js-api-use.json'),
  JSON.stringify(report, null, 2),
);

console.log('\n📄 Report saved to dist/build-report-js-api-use.json\n');

const failures = results.filter(r => r.status === 'error');
if (failures.length > 0) process.exit(1);
