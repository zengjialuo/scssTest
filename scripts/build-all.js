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
const LOAD_PATHS = [
  `--load-path=${SRC}`,
  `--load-path=${path.join(ROOT, 'node_modules')}`,
];

// Files to compile individually
const entries = [
  { input: 'src/index.scss', output: 'dist/index.css', label: 'Full bundle' },
  { input: 'src/components/button.scss', output: 'dist/components/button.css', label: 'Button' },
  { input: 'src/components/card.scss', output: 'dist/components/card.css', label: 'Card' },
  { input: 'src/components/form.scss', output: 'dist/components/form.css', label: 'Form' },
  { input: 'src/components/badge.scss', output: 'dist/components/badge.css', label: 'Badge' },
  { input: 'src/components/modal.scss', output: 'dist/components/modal.css', label: 'Modal' },
  { input: 'src/components/navigation.scss', output: 'dist/components/navigation.css', label: 'Navigation' },
  { input: 'src/components/table.scss', output: 'dist/components/table.css', label: 'Table' },
  { input: 'src/components/tooltip.scss', output: 'dist/components/tooltip.css', label: 'Tooltip' },
  { input: 'src/components/alert.scss', output: 'dist/components/alert.css', label: 'Alert' },
  { input: 'src/pages/home.scss', output: 'dist/pages/home.css', label: 'Home page' },
  { input: 'src/pages/dashboard.scss', output: 'dist/pages/dashboard.css', label: 'Dashboard page' },
  { input: 'src/pages/auth.scss', output: 'dist/pages/auth.css', label: 'Auth page' },
  { input: 'src/utilities/spacing.scss', output: 'dist/utilities/spacing.css', label: 'Spacing utilities' },
  { input: 'src/utilities/typography.scss', output: 'dist/utilities/typography.css', label: 'Typography utilities' },
  { input: 'src/utilities/display.scss', output: 'dist/utilities/display.css', label: 'Display utilities' },
  { input: 'src/utilities/colors.scss', output: 'dist/utilities/colors.css', label: 'Color utilities' },
];

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
