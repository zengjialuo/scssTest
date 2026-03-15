#!/usr/bin/env node
/**
 * Build all SCSS files individually (for compilation speed research)
 * Each component/page file is compiled separately to measure individual compilation times
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

// Ensure dist exists
if (!fs.existsSync(DIST)) fs.mkdirSync(DIST, { recursive: true });

// SCSS load paths
// packages/ is listed first so common-mixin resolves directly without
// relying on npm symlink behaviour (node_modules/common-mixin -> packages/common-mixin)
const LOAD_PATHS = [
  `--load-path=${SRC}`,
  `--load-path=${path.join(ROOT, 'packages')}`,
  `--load-path=${path.join(ROOT, 'node_modules')}`,
];

// Scan src/pages/ for all SCSS files
const entries = fs.readdirSync(path.join(SRC, 'pages'))
  .filter(f => f.endsWith('.scss'))
  .map(f => {
    const name = path.basename(f, '.scss');
    return {
      input: `src/pages/${f}`,
      output: `dist/pages/${name}.css`,
      label: `${name.charAt(0).toUpperCase() + name.slice(1)} page`,
    };
  });

const sassCmd = path.join(ROOT, 'node_modules', '.bin', 'sass');
const results = [];

console.log('\n📊 SCSS Compilation Speed Research\n');
console.log('='.repeat(60));

let totalStart = Date.now();

for (const entry of entries) {
  const inputAbs = path.join(ROOT, entry.input);
  const outputAbs = path.join(ROOT, entry.output);

  // Ensure output directory exists
  fs.mkdirSync(path.dirname(outputAbs), { recursive: true });

  const cmd = `${sassCmd} ${LOAD_PATHS.join(' ')} ${inputAbs}:${outputAbs} --no-source-map`;

  const start = Date.now();
  try {
    execSync(cmd, { cwd: ROOT, stdio: 'pipe' });
    const duration = Date.now() - start;
    const size = fs.statSync(outputAbs).size;
    results.push({ label: entry.label, duration, size, status: 'ok' });
    console.log(`✅  ${entry.label.padEnd(25)} ${String(duration).padStart(5)}ms   ${(size / 1024).toFixed(1)}KB`);
  } catch (err) {
    const duration = Date.now() - start;
    results.push({ label: entry.label, duration, status: 'error', error: err.stderr?.toString() });
    console.log(`❌  ${entry.label.padEnd(25)} ${String(duration).padStart(5)}ms   ERROR`);
    console.error(err.stderr?.toString().split('\n').map(l => '    ' + l).join('\n'));
  }
}

const totalDuration = Date.now() - totalStart;

console.log('='.repeat(60));
console.log(`\nTotal: ${totalDuration}ms for ${entries.length} files\n`);

// Write JSON report
const report = {
  timestamp: new Date().toISOString(),
  totalDuration,
  fileCount: entries.length,
  results,
};

fs.writeFileSync(
  path.join(DIST, 'build-report.json'),
  JSON.stringify(report, null, 2),
);

console.log('📄 Report saved to dist/build-report.json\n');

// Exit with error if any failed
const failures = results.filter(r => r.status === 'error');
if (failures.length > 0) {
  console.error(`\n⚠️  ${failures.length} file(s) failed to compile.\n`);
  process.exit(1);
}
