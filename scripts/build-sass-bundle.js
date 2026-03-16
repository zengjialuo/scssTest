#!/usr/bin/env node
/**
 * "Global bundle" performance test.
 *
 * Validates the speedup from compiling _utilities.scss ONCE globally instead
 * of re-importing it inside every page.
 *
 * Strategy (no source files are modified):
 *   1. Compile src/scss/legacy/_utilities.scss once → dist/global/utilities.css
 *   2. Compile all 94 pages with a custom importer that stubs out
 *      'scss/legacy/utilities', returning empty content.
 *      Pages still compile their own component / animation / var imports —
 *      only the utilities are removed from the per-page cost.
 *   3. Total measured time = utilities(×1) + pages_without_utils(×94)
 *   4. Print comparison table against the @import baseline.
 *
 * Run baseline first:  node scripts/build-sass.js
 * Then run this file:  node scripts/build-sass-bundle.js
 */

'use strict';

const sass = require('sass');
const path = require('path');
const fs   = require('fs');
const { pathToFileURL, fileURLToPath } = require('url');

const ROOT        = path.resolve(__dirname, '..');
const SRC         = path.join(ROOT, 'src');
const DIST        = path.join(ROOT, 'dist');
const DIST_BUNDLE = path.join(DIST, 'pages-bundle');
const DIST_GLOBAL = path.join(DIST, 'global');

[DIST_BUNDLE, DIST_GLOBAL].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

const LOAD_PATHS = [SRC, path.join(ROOT, 'packages'), path.join(ROOT, 'node_modules')];

// ---------------------------------------------------------------------------
// The canonical path of _utilities.scss — any import resolving to this file
// will be stubbed out during per-page compilation.
// ---------------------------------------------------------------------------
const UTILS_ABS  = path.join(SRC, 'scss', 'legacy', '_utilities.scss');
const UTILS_URL  = pathToFileURL(UTILS_ABS).href;

// ---------------------------------------------------------------------------
// Helper: resolve a SCSS partial URL to an absolute path
// ---------------------------------------------------------------------------
function resolveScssFile(url, fromDir) {
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
    for (const c of candidates) if (fs.existsSync(c)) return c;
    return null;
  }

  if (fromDir) {
    const r = tryCandidates(fromDir, url);
    if (r) return r;
  }
  for (const lp of LOAD_PATHS) {
    const r = tryCandidates(lp, url);
    if (r) return r;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Custom importer — resolves all files normally EXCEPT _utilities.scss,
// which is returned as empty content (already compiled into the global bundle).
// Also handles the @base/ alias.
// ---------------------------------------------------------------------------
const bundleImporter = {
  canonicalize(url, { containingUrl } = {}) {
    if (url.startsWith('file:') || url.startsWith('data:')) return null;

    // @base/ alias
    if (url.startsWith('@base/')) {
      const tail     = url.slice('@base/'.length);
      const resolved = resolveScssFile(tail, path.join(SRC, 'scss'))
                    ?? resolveScssFile(path.join(SRC, 'scss', tail), null);
      if (resolved) return pathToFileURL(resolved);
      return null;
    }

    const fromDir  = containingUrl
      ? path.dirname(fileURLToPath(containingUrl.toString()))
      : null;
    const resolved = resolveScssFile(url, fromDir);
    if (resolved) return pathToFileURL(resolved);
    return null;
  },

  load(canonicalUrl) {
    const canonical = canonicalUrl.toString();

    // Stub out utilities — they live in the global bundle
    if (canonical === UTILS_URL) {
      return {
        contents: '// [stubbed] utilities compiled into dist/global/utilities.css',
        syntax: 'scss',
      };
    }

    const filePath = fileURLToPath(canonical);
    if (!fs.existsSync(filePath)) return null;
    return { contents: fs.readFileSync(filePath, 'utf8'), syntax: 'scss' };
  },
};

// Alias importer for files that are compiled by sass.compile() directly
// (uses the FileImporter / findFileUrl API)
const aliasImporter = {
  findFileUrl(url) {
    if (!url.startsWith('@base/')) return null;
    const resolved = path.join(SRC, 'scss', url.slice('@base/'.length));
    return new URL(`file://${resolved}`);
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
        output: path.join('dist', srcRel + '-bundle', rel.replace(/\.scss$/, '.bundle.css')),
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

// ===========================================================================
// STEP 1 — compile utilities ONCE
// ===========================================================================
console.log('\n📦 Step 1: Compile utilities globally (once)\n');
console.log('='.repeat(60));

const utilsStart = Date.now();
let utilsSize = 0;
try {
  const utilsResult = sass.compile(UTILS_ABS, {
    loadPaths:  LOAD_PATHS,
    importers:  [aliasImporter],
    sourceMap:  false,
    style:      'expanded',
  });
  const utilsDuration = Date.now() - utilsStart;
  utilsSize = Buffer.byteLength(utilsResult.css);
  fs.writeFileSync(path.join(DIST_GLOBAL, 'utilities.css'), utilsResult.css);
  console.log(`✅  utilities (global)              ${String(utilsDuration).padStart(5)}ms   ${(utilsSize / 1024).toFixed(1)}KB`);
  console.log(`    → dist/global/utilities.css\n`);
} catch (err) {
  console.error('❌  utilities compilation failed:', err.message);
  process.exit(1);
}
const utilsDuration = Date.now() - utilsStart;

// ===========================================================================
// STEP 2 — compile all pages with utilities stubbed out
// ===========================================================================
console.log('📄 Step 2: Compile pages (utilities stubbed)\n');
console.log('='.repeat(60));

const results    = [];
const pagesStart = Date.now();

for (const entry of entries) {
  const inputAbs  = path.join(ROOT, entry.input);
  const outputAbs = path.join(ROOT, entry.output);
  fs.mkdirSync(path.dirname(outputAbs), { recursive: true });

  const pageSource = fs.readFileSync(inputAbs, 'utf8');

  const start = Date.now();
  try {
    const result = sass.compileString(pageSource, {
      url:       pathToFileURL(inputAbs),
      importers: [bundleImporter],
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
    console.error(`    ${err.message.split('\n').slice(0, 3).join(' | ')}`);
  }
}

const pagesDuration = Date.now() - pagesStart;
const totalDuration = utilsDuration + pagesDuration;

console.log('='.repeat(60));
console.log(`\nUtils (×1):   ${utilsDuration}ms`);
console.log(`Pages (×${entries.length}): ${pagesDuration}ms`);
console.log(`Total:        ${totalDuration}ms\n`);

// ===========================================================================
// Comparison table vs @import baseline
// ===========================================================================
const baselinePath = path.join(DIST, 'build-report-js-api.json');
if (fs.existsSync(baselinePath)) {
  const baseline    = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const baselineMap = Object.fromEntries(baseline.results.map(r => [r.label, r]));
  const successful  = results.filter(r => r.status === 'ok' && baselineMap[r.label]);

  console.log('📊 Per-file comparison: @import (baseline)  vs  bundle (this run)');
  console.log('='.repeat(75));
  console.log(`${'label'.padEnd(35)} ${'@import'.padStart(8)}  ${'bundle'.padStart(8)}  ${'Δ time'.padStart(8)}  ${'Δ size'.padStart(10)}`);
  console.log('-'.repeat(75));

  let sumBaseTime = 0, sumBundleTime = 0;
  let sumBaseSize = 0, sumBundleSize = 0;

  for (const r of successful) {
    const b = baselineMap[r.label];
    sumBaseTime   += b.duration;
    sumBundleTime += r.duration;
    sumBaseSize   += b.size ?? 0;
    sumBundleSize += r.size;

    const dt    = r.duration - b.duration;
    const ds    = r.size - (b.size ?? 0);
    const dtStr = (dt > 0 ? '+' : '') + dt + 'ms';
    const dsStr = (ds > 0 ? '+' : '') + (ds / 1024).toFixed(0) + 'KB';
    console.log(
      `${r.label.padEnd(35)} ${String(b.duration).padStart(7)}ms  ${String(r.duration).padStart(7)}ms  ${dtStr.padStart(8)}  ${dsStr.padStart(10)}`
    );
  }

  const utilsSizeKB = (utilsSize / 1024).toFixed(1);
  console.log('-'.repeat(75));
  const dtTotal = sumBundleTime - sumBaseTime;
  const dsTotal = sumBundleSize - sumBaseSize;
  console.log(
    `${'TOTAL pages (matched)'.padEnd(35)} ${String(sumBaseTime).padStart(7)}ms  ${String(sumBundleTime).padStart(7)}ms  ${((dtTotal > 0 ? '+' : '') + dtTotal + 'ms').padStart(8)}  ${((dsTotal / 1024 / 1024).toFixed(1) + 'MB').padStart(10)}`
  );

  const totalBundleTime = utilsDuration + sumBundleTime;
  console.log(`
┌─────────────────────────────────────────────────────────┐
│  Baseline  (@import, utils ×94)   ${String(baseline.totalDuration).padStart(7)}ms   ${(sumBaseSize / 1024 / 1024).toFixed(1)} MB pages
│
│  Bundle strategy:
│    utils compiled once            ${String(utilsDuration).padStart(7)}ms   ${utilsSizeKB} KB
│    pages without utils   ×${String(entries.length).padEnd(2)}    ${String(pagesDuration).padStart(7)}ms   ${(sumBundleSize / 1024 / 1024).toFixed(1)} MB pages
│    ────────────────────────────────────────────
│    total                          ${String(totalDuration).padStart(7)}ms
│
│  Speedup vs baseline              ${((1 - totalDuration / baseline.totalDuration) * 100).toFixed(1)}%
│  Pages output reduction           ${((1 - sumBundleSize / sumBaseSize) * 100).toFixed(1)}%
│  Utils shipped as single file     ${utilsSizeKB} KB  (vs ${((utilsSize * entries.length) / 1024 / 1024).toFixed(1)} MB duplicated)
└─────────────────────────────────────────────────────────┘`);
}

// ===========================================================================
// Save report
// ===========================================================================
const report = {
  timestamp:     new Date().toISOString(),
  strategy:      'global-bundle',
  utilsDuration,
  pagesDuration,
  totalDuration,
  utilsSize,
  fileCount:     entries.length,
  results,
};

fs.writeFileSync(
  path.join(DIST, 'build-report-js-api-bundle.json'),
  JSON.stringify(report, null, 2),
);
console.log('\n📄 Report saved to dist/build-report-js-api-bundle.json\n');

const failures = results.filter(r => r.status === 'error');
if (failures.length > 0) process.exit(1);
