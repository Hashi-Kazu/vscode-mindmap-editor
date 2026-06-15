const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

// Transpile the TS test files (and their src imports) to CJS so they can run
// under `node --test`. Bundling keeps src imports resolved without ts-node/tsx.
const TEST_DIR = path.join(__dirname, 'test');
const OUT_DIR = path.join(__dirname, 'dist-test');

function findTestEntries(dir) {
  const entries = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) {
      entries.push(...findTestEntries(full));
    } else if (name.endsWith('.test.ts')) {
      entries.push(full);
    }
  }
  return entries;
}

async function main() {
  const entryPoints = findTestEntries(TEST_DIR);
  await esbuild.build({
    entryPoints,
    bundle: true,
    outdir: OUT_DIR,
    external: ['vscode', 'node:test', 'node:assert', 'path'],
    format: 'cjs',
    platform: 'node',
    sourcemap: false,
    logLevel: 'info',
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
