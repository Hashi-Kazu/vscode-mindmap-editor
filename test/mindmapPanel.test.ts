import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const panelSource = readFileSync(join(process.cwd(), 'src', 'mindmapPanel.ts'), 'utf8');
const typesSource = readFileSync(join(process.cwd(), 'src', 'types.ts'), 'utf8');

test('NF-02-03: applyDocumentEdit applies document EOL before replacement', () => {
  assert.match(panelSource, /edit\.replace\([^;]+applyDocumentEol\(newContent, useCrlf\)\);/s);
});

test('R-06-09: saveBodyItemCollapseState uses the operation and conflict guards', () => {
  const block = panelSource.match(
    /case 'saveBodyItemCollapseState':[\s\S]*?case 'setSide':/
  )?.[0];
  assert.ok(block, 'saveBodyItemCollapseState case must exist');
  assert.match(block, /this\.isOperating = true;/);
  assert.match(block, /await this\.commitTree\(undefined, true\);/);
  assert.match(block, /finally\s*{\s*this\.isOperating = false;/);
});

test('R-15-05 / Issue#38: structuralEdit updates lastBodyItemCollapsePaths from the message', () => {
  const block = panelSource.match(
    /case 'structuralEdit':[\s\S]*?case 'saveCollapseState':/
  )?.[0];
  assert.ok(block, 'structuralEdit case must exist');
  // Cache must be refreshed from the message (array-guarded) before commitTree,
  // so relocated/orphaned body-item-collapse paths are not written back.
  const assignIdx = block.search(
    /if\s*\(\s*Array\.isArray\(\s*msg\.bodyItemCollapsePaths\s*\)\s*\)[\s\S]*?this\.lastBodyItemCollapsePaths\s*=\s*msg\.bodyItemCollapsePaths;/
  );
  assert.ok(assignIdx >= 0, 'array-guarded assignment to lastBodyItemCollapsePaths must exist');
  const commitIdx = block.search(/await this\.commitTree\(/);
  assert.ok(commitIdx >= 0, 'commitTree call must exist');
  assert.ok(assignIdx < commitIdx, 'assignment must precede commitTree');
});

test('BUG-17: obsolete webview message variants are removed', () => {
  assert.ok(!typesSource.includes("type: 'renameNode'"));
  assert.ok(!typesSource.includes("type: 'editBody'"));
});
