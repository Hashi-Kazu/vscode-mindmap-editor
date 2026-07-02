import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(process.cwd(), 'media', 'mindmap.js'), 'utf8');

/** Extract the full text of a top-level `function name(...) { ... }` by brace matching. */
function extractFunction(name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} not found in media/mindmap.js`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  assert.fail(`function ${name} braces are unbalanced`);
}

interface TestNode {
  children: TestNode[];
}

test('R-02-08: subtreeDepth returns max relative depth of a subtree', () => {
  const fnText = extractFunction('subtreeDepth');
  const subtreeDepth = new Function(fnText + '; return subtreeDepth;')() as (n: TestNode) => number;

  const leaf: TestNode = { children: [] };
  assert.equal(subtreeDepth(leaf), 0);

  const chain2: TestNode = { children: [{ children: [{ children: [] }] }] };
  assert.equal(subtreeDepth(chain2), 2);
});

test('R-02-08: inside drop is blocked when target level + dragged subtree depth exceeds H6', () => {
  const fnText = extractFunction('collectDropCandidates');
  assert.ok(fnText.includes('node.level + 1 + maxDepth > 6'));
  assert.ok(fnText.includes("pos === 'inside' && node.level + 1 + maxDepth > 6"));
});

test('R-02-08: before/after drop is blocked when sibling level + dragged subtree depth exceeds H6', () => {
  const fnText = extractFunction('collectDropCandidates');
  assert.ok(fnText.includes('node.level + maxDepth > 6'));
  assert.ok(fnText.includes("(pos === 'before' || pos === 'after') && node.level + maxDepth > 6"));
});

test('R-02-10: performMultiDrop validates target parent before removing nodes', () => {
  const fnText = extractFunction('performMultiDrop');
  const guardIdx = fnText.indexOf('!findParent(root, targetNode)) return;');
  const removeIdx = fnText.indexOf('srcParent.children = srcParent.children.filter(');
  assert.ok(guardIdx >= 0, 'early-return guard with findParent(root, targetNode) not found');
  assert.ok(removeIdx >= 0, 'node removal (srcParent.children.filter) not found');
  assert.ok(guardIdx < removeIdx, 'guard must run before nodes are removed from their parents');
});

test('R-13-10: performBodyDrop has no text-match fallback', () => {
  const fnText = extractFunction('performBodyDrop');
  assert.ok(fnText.includes('i.lineIdx === adjustedIdx'));
  assert.ok(!fnText.includes('i.text === result.targetItem.text'));
});
