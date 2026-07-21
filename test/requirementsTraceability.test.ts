import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const readWorkspaceFile = (path: string): string =>
  readFileSync(join(process.cwd(), path), 'utf8');

const usdm = readWorkspaceFile('docs/requirements-usdm.md');
const acceptance = readWorkspaceFile('docs/acceptance-tests.md');

const specificationIdPattern = /(?:R-\d{2}-\d{2}[a-z]?|S20-\d{2}|NF-\d{2}-\d{2})/g;

test('all USDM specification IDs are covered by acceptance tests', () => {
  const usdmIds = new Set<string>();
  for (const line of usdm.split(/\r?\n/)) {
    if (!/^- [■□]{3} /.test(line)) continue;
    for (const id of line.match(specificationIdPattern) ?? []) usdmIds.add(id);
  }

  const acceptanceIds = new Set<string>();
  for (const line of acceptance.split(/\r?\n/)) {
    if (!/^\| AT-[^|]+\|/.test(line)) continue;
    const targetColumn = line.split('|')[2] ?? '';
    for (const id of targetColumn.match(specificationIdPattern) ?? []) acceptanceIds.add(id);
  }

  assert.ok(usdmIds.has('R-12-04b'), 'lowercase-suffixed specification IDs must be extracted');
  assert.deepEqual(
    [...usdmIds].filter(id => !acceptanceIds.has(id)).sort(),
    [],
    'every USDM specification ID must appear in an acceptance-test target column'
  );
});

test('USDM, acceptance target and package versions are aligned', () => {
  const packageJson = JSON.parse(readWorkspaceFile('package.json')) as { version: string };
  const packageLock = JSON.parse(readWorkspaceFile('package-lock.json')) as {
    version: string;
    packages: Record<string, { version?: string }>;
  };
  const usdmVersion = usdm.match(/^\*\*バージョン\*\*: ([\d.]+)/m)?.[1];
  const acceptanceTargetVersion = acceptance.match(
    /^\*\*対象要求仕様書\*\*: MME-REQ-001-USDM \*\*v([\d.]+)\*\*/m
  )?.[1];

  assert.equal(usdmVersion, '2.22.9');
  assert.equal(acceptanceTargetVersion, usdmVersion);
  assert.equal(packageJson.version, usdmVersion);
  assert.equal(packageLock.version, usdmVersion);
  assert.equal(packageLock.packages['']?.version, usdmVersion);
});
