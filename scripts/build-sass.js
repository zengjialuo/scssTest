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

// Scan src/pages/ for all SCSS files
const pagesEntries = fs.readdirSync(path.join(SRC, 'pages'))
  .filter(f => f.endsWith('.scss'))
  .map(f => {
    const name = path.basename(f, '.scss');
    return {
      input: `src/pages/${f}`,
      output: `dist/pages/${name}.js-api.css`,
      label: `${name.charAt(0).toUpperCase() + name.slice(1)} page`,
    };
  });

const entries = [
  { input: 'src/index.scss', output: 'dist/index.js-api.css', label: 'Full bundle' },
  { input: 'src/components/button.scss', output: 'dist/components/button.js-api.css', label: 'Button' },
  { input: 'src/components/card.scss', output: 'dist/components/card.js-api.css', label: 'Card' },
  { input: 'src/components/form.scss', output: 'dist/components/form.js-api.css', label: 'Form' },
  { input: 'src/components/badge.scss', output: 'dist/components/badge.js-api.css', label: 'Badge' },
  { input: 'src/components/modal.scss', output: 'dist/components/modal.js-api.css', label: 'Modal' },
  { input: 'src/components/navigation.scss', output: 'dist/components/navigation.js-api.css', label: 'Navigation' },
  { input: 'src/components/table.scss', output: 'dist/components/table.js-api.css', label: 'Table' },
  { input: 'src/components/tooltip.scss', output: 'dist/components/tooltip.js-api.css', label: 'Tooltip' },
  { input: 'src/components/alert.scss', output: 'dist/components/alert.js-api.css', label: 'Alert' },
  ...pagesEntries,
  { input: 'src/utilities/spacing.scss', output: 'dist/utilities/spacing.js-api.css', label: 'Spacing utilities' },
  { input: 'src/utilities/typography.scss', output: 'dist/utilities/typography.js-api.css', label: 'Typography utilities' },
  { input: 'src/utilities/display.scss', output: 'dist/utilities/display.js-api.css', label: 'Display utilities' },
  { input: 'src/utilities/colors.scss', output: 'dist/utilities/colors.js-api.css', label: 'Color utilities' },
];

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
