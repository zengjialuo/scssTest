#!/usr/bin/env node
/**
 * Build using dart-sass JS API (for programmatic compilation speed research)
 */

const sass = require('sass');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

if (!fs.existsSync(DIST)) fs.mkdirSync(DIST, { recursive: true });

const loadPaths = [SRC, path.join(ROOT, 'packages'), path.join(ROOT, 'node_modules')];

// Alias importer: maps "@base/" → "src/scss/" so SCSS files can write
//   @use '@base/variables/tokens'  instead of  @use 'scss/variables/tokens'
const aliasImporter = {
  findFileUrl(url) {
    if (!url.startsWith('@base/')) return null;
    const resolved = path.join(SRC, 'scss', url.slice('@base/'.length));
    return new URL(`file://${resolved}`);
  },
};

// Scan src/pages/ for all SCSS files
const entries = fs.readdirSync(path.join(SRC, 'pages'))
  .filter(f => f.endsWith('.scss'))
  .map(f => {
    const name = path.basename(f, '.scss');
    return {
      input: `src/pages/${f}`,
      output: `dist/pages/${name}.js-api.css`,
      label: `${name.charAt(0).toUpperCase() + name.slice(1)} page`,
    };
  });

console.log('\n📊 SCSS Compilation (sass JS API)\n');
console.log('='.repeat(60));

const results = [];
let totalStart = Date.now();

for (const entry of entries) {
  const inputAbs = path.join(ROOT, entry.input);
  const outputAbs = path.join(ROOT, entry.output);

  fs.mkdirSync(path.dirname(outputAbs), { recursive: true });

  const start = Date.now();
  try {
    const result = sass.compile(inputAbs, {
      loadPaths,
      importers: [aliasImporter],
      sourceMap: false,
      style: 'expanded',
    });
    const duration = Date.now() - start;
    fs.writeFileSync(outputAbs, result.css);
    const size = Buffer.byteLength(result.css);
    results.push({ label: entry.label, duration, size, status: 'ok' });
    console.log(`✅  ${entry.label.padEnd(25)} ${String(duration).padStart(5)}ms   ${(size / 1024).toFixed(1)}KB`);
  } catch (err) {
    const duration = Date.now() - start;
    results.push({ label: entry.label, duration, status: 'error', error: err.message });
    console.log(`❌  ${entry.label.padEnd(25)} ${String(duration).padStart(5)}ms   ERROR`);
    console.error(`    ${err.message}`);
  }
}

const totalDuration = Date.now() - totalStart;
console.log('='.repeat(60));
console.log(`\nTotal: ${totalDuration}ms for ${entries.length} files\n`);

const report = {
  timestamp: new Date().toISOString(),
  api: 'sass-js',
  totalDuration,
  fileCount: entries.length,
  results,
};

fs.writeFileSync(
  path.join(DIST, 'build-report-js-api.json'),
  JSON.stringify(report, null, 2),
);

console.log('📄 Report saved to dist/build-report-js-api.json\n');

const failures = results.filter(r => r.status === 'error');
if (failures.length > 0) {
  process.exit(1);
}
