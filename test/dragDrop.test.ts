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

test('R-02-03: performMultiDrop reaches postStructuralEdit for every mutating drop', () => {
  const fnText = extractFunction('performMultiDrop');
  // The post-removal data-loss return (nodes removed but never re-inserted and
  // no persist) must be gone: only the up-front R-02-10 guard may bail out.
  assert.ok(!fnText.includes('if (!targetParent) return;'),
    'performMultiDrop must not early-return after removing nodes');
  // The undo snapshot must be skipped when no dragged node lives in the tree,
  // before pushUndo(), so an ignored drop is a true no-op.
  const skipIdx = fnText.indexOf('nodes.some(n => findParent(root, n))');
  const undoIdx = fnText.indexOf('pushUndo();');
  assert.ok(skipIdx >= 0, 'no-movable-nodes guard not found');
  assert.ok(skipIdx < undoIdx, 'no-movable-nodes guard must run before pushUndo()');
});

test('R-02-03: performDrop resolves the reorder target before mutating and always persists', () => {
  const fnText = extractFunction('performDrop');
  const guardIdx = fnText.indexOf('isReorder && !targetParent) return;');
  const removeIdx = fnText.indexOf('sourceParent.children = sourceParent.children.filter(');
  assert.ok(guardIdx >= 0, 'reorder target guard (isReorder && !targetParent) not found');
  assert.ok(removeIdx >= 0, 'node removal not found');
  assert.ok(guardIdx < removeIdx, 'reorder target must be validated before the node is removed');
  // The old branch that re-appended the node out of order and persisted a
  // spurious reorder must be gone.
  assert.ok(!fnText.includes('sourceParent.children.push(draggedNode)'),
    'performDrop must not re-append the dragged node on an unresolved target');
  assert.ok(fnText.includes('postStructuralEdit()'), 'performDrop must persist the change');
});

test('R-13-10: performBodyDrop has no text-match fallback', () => {
  const fnText = extractFunction('performBodyDrop');
  assert.ok(fnText.includes('i.lineIdx === adjustedIdx'));
  assert.ok(!fnText.includes('i.text === result.targetItem.text'));
});

test('R-13-10: performBodyDrop resolves after-insert subtree end from the tree', () => {
  // A downward `after` drop onto a body item that has children must insert past
  // the target's whole subtree, not between the target line and its descendants
  // (which would re-parent those descendants under the moved block). The subtree
  // end must therefore be computed from the hierarchical tree
  // (getBodyItemTree / findBodyItemByLineIdx), never from the flat item whose
  // `children` is always empty.
  const fnText = extractFunction('performBodyDrop');
  const treeIdx = fnText.indexOf('getBodyItemTree(result.targetNode.body)');
  const findIdx = fnText.indexOf('findBodyItemByLineIdx(tgtTree, updatedTargetItem.lineIdx)');
  const lastLineIdx = fnText.indexOf('bodyItemLastLineIdx(treeTargetItem || updatedTargetItem)');
  const afterIdx = fnText.indexOf("result.position === 'after'");
  assert.ok(treeIdx >= 0, 'target body must be parsed into a tree for after-insert resolution');
  assert.ok(findIdx > treeIdx, 'the tree target item must be located via findBodyItemByLineIdx');
  // The subtree-end (bodyItemLastLineIdx) used for the `after` insert must be
  // computed from the tree-resolved item, and must not be derived from the flat
  // updatedTargetItem.
  assert.ok(!fnText.includes('bodyItemLastLineIdx(updatedTargetItem)'),
    'after-insert subtree end must not be computed from the flat updatedTargetItem');
  assert.ok(lastLineIdx > findIdx, 'bodyItemLastLineIdx must run on the tree-resolved target');
  assert.ok(afterIdx > lastLineIdx, 'the after-branch insert must use the tree-resolved subtree end');
});

test('R-13-XX: body-item drop collection keeps root JSON-serializable (no _owner cycle)', () => {
  // Regression for the body-item D&D sync bug: tagging body items with an
  // `_owner` back-reference (item._owner = node, node._bodyItems ∋ item) made
  // `root` circular, so postStructuralEdit's postMessage(root) threw and the
  // move never reached the .md file. Owner must be threaded as a parameter.
  const collectCandidatesSrc = extractFunction('collectBodyDropCandidates');
  const collectFromItemsSrc = extractFunction('collectBodyDropFromItems');
  const distToRectSrc = extractFunction('distToRect');

  // The tagging function/back-reference must be gone entirely.
  assert.ok(!collectCandidatesSrc.includes('_owner'),
    'collectBodyDropCandidates must not tag items with _owner');
  assert.ok(!collectFromItemsSrc.includes('_owner'),
    'collectBodyDropFromItems must not read/write _owner');

  const makeItem = (lineIdx: number, y: number, children: unknown[] = []) => ({
    lineIdx, indent: 0, children,
    _x: 100, _y: y, _w: 120, _h: 42,
  });
  const a = makeItem(0, 100);
  const b = makeItem(1, 150);
  const node: Record<string, unknown> = {
    id: 'n1', collapsed: false, children: [],
    _x: 0, _y: 100, _w: 100, _h: 46,
    _bodyItems: [a, b],
    body: '- a\n- b',
  };
  const root = node;

  const harness = new Function(`
    const DROP_TOLERANCE = 40, BODY_MIN_W = 80, BODY_H = 42, NODE_MIN_W = 100, NODE_H = 46;
    ${distToRectSrc}
    ${collectFromItemsSrc}
    ${collectCandidatesSrc}
    return function(root, ds, sx, sy) {
      const results = [];
      collectBodyDropCandidates(root, ds, sx, sy, (r) => results.push(r));
      return results;
    };
  `)() as (root: unknown, ds: unknown, sx: number, sy: number) => Array<{ type: string }>;

  // Drag item `a`, hover over item `b`.
  const ds = { parentNode: { id: 'n1' }, lineIdx: 0 };
  const results = harness(root, ds, 110, 160);
  assert.ok(results.some((r) => r.type === 'body-item'),
    'should find body-item drop candidate for a same-node reorder');

  // The crux: the posted tree must still serialize (previously threw with the
  // _owner cycle).
  assert.doesNotThrow(() => JSON.stringify(root),
    'root must remain acyclic / JSON-serializable after drop collection');
});
