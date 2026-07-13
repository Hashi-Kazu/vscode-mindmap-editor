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

interface TreeNode {
  id: string;
  text: string;
  level: number;
  children: TreeNode[];
  collapsed: boolean;
  body: string;
  collapsedBodyLines?: Set<number>;
}

interface PromoteHarness {
  promoteBodyItemToNode(parentNode: TreeNode, lineIdx: number): void;
  performUndo(): void;
  get root(): TreeNode;
  get undoCount(): number;
}

function makePromoteHarness(root: TreeNode): PromoteHarness {
  const src = [
    extractFunction('getBodyItems'),
    extractFunction('getBodyItemTree'),
    extractFunction('findBodyItemByLineIdx'),
    extractFunction('bodyItemLastLineIdx'),
    extractFunction('remapCollapsedBodyLinesAfterDelete'),
    extractFunction('makeNode'),
    extractFunction('bodyItemTreeToLines'),
    extractFunction('promoteBodyItemToNode'),
  ].join('\n');
  return new Function(`
    const BODY_H = 30;
    let _idSeq = 1000;
    let root = ${JSON.stringify(root)};
    let undoCount = 0;
    let undoSnapshot = null;
    function pushUndo() { undoCount++; undoSnapshot = JSON.parse(JSON.stringify(root)); }
    function postStructuralEdit() {}
    function render() {}
    ${src}
    return {
      promoteBodyItemToNode(parentNode, lineIdx) { promoteBodyItemToNode(parentNode, lineIdx); },
      performUndo() { root = undoSnapshot; },
      get root() { return root; },
      get undoCount() { return undoCount; },
    };
  `)() as PromoteHarness;
}

interface DemoteHarness {
  demoteNodeToBodyItem(node: TreeNode): void;
  performUndo(): void;
  get root(): TreeNode;
  get undoCount(): number;
}

function makeDemoteHarness(root: TreeNode): DemoteHarness {
  const src = [
    extractFunction('findParent'),
    extractFunction('reformatBodyLines'),
    extractFunction('demoteNodeToBodyItem'),
  ].join('\n');
  return new Function(`
    let root = ${JSON.stringify(root)};
    let selectedId = null;
    let undoCount = 0;
    let undoSnapshot = null;
    function pushUndo() { undoCount++; undoSnapshot = JSON.parse(JSON.stringify(root)); }
    function postStructuralEdit() {}
    function render() {}
    ${src}
    return {
      demoteNodeToBodyItem(node) { demoteNodeToBodyItem(node); },
      performUndo() { root = undoSnapshot; },
      get root() { return root; },
      get undoCount() { return undoCount; },
    };
  `)() as DemoteHarness;
}

function findById(node: TreeNode, id: string): TreeNode | null {
  if (node.id === id) return node;
  for (const c of node.children) {
    const f = findById(c, id);
    if (f) return f;
  }
  return null;
}

// ─── Promote ────────────────────────────────────────────────────────────

// R-14-01: only a top-level (indent 0) body item, with a parent below the
// heading level ceiling, can be promoted; nested items and items whose
// parent is already at level 6 are no-ops.
test('R-14-01: ネスト本文項目やlevel6の親を持つ本文項目は昇格されず、トップレベル項目のみ昇格される', () => {
  const parent: TreeNode = { id: 'p1', text: 'Parent', level: 1, children: [], collapsed: false, body: '- top item\n  - nested item' };
  const root: TreeNode = { id: 'root', text: 'Root', level: 0, children: [parent], collapsed: false, body: '' };
  const h = makePromoteHarness(root);
  const p = h.root.children[0];

  // Nested item (indent > 0) -> no-op.
  h.promoteBodyItemToNode(p, 1);
  assert.equal(h.root.children[0].children.length, 0, 'nested item is not promoted');
  assert.equal(h.undoCount, 0, 'no undo snapshot pushed for no-op');
  assert.equal(h.root.children[0].body, '- top item\n  - nested item', 'body unchanged');

  // Parent at level 6 -> no-op even for a top-level item.
  const deepParent: TreeNode = { id: 'p6', text: 'Deep', level: 6, children: [], collapsed: false, body: '- solo item' };
  const deepRoot: TreeNode = { id: 'root2', text: 'Root', level: 0, children: [deepParent], collapsed: false, body: '' };
  const h2 = makePromoteHarness(deepRoot);
  const dp = h2.root.children[0];
  h2.promoteBodyItemToNode(dp, 0);
  assert.equal(h2.root.children[0].children.length, 0, 'level 6 parent blocks promotion');
  assert.equal(h2.undoCount, 0);

  // Top-level item with a parent below level 6 -> promoted.
  h.promoteBodyItemToNode(p, 0);
  assert.equal(h.root.children[0].children.length, 1, 'top-level item is promoted');
});

// R-14-02: promoting creates a new heading at parentNode.level + 1, inserted
// at the front of parentNode.children, using the item's text; nested child
// body items are re-indented from 0 and become the new node's body.
test('R-14-02: 昇格すると親のlevel+1の見出しが先頭挿入され、ネスト子項目はインデント0起点で新規ノード本文になる', () => {
  const parent: TreeNode = { id: 'p1', text: 'Parent', level: 1, children: [{ id: 'existing', text: 'Existing', level: 2, children: [], collapsed: false, body: '' }], collapsed: false, body: '- top item\n  - nested a\n    - nested a1\n- second item' };
  const root: TreeNode = { id: 'root', text: 'Root', level: 0, children: [parent], collapsed: false, body: '' };
  const h = makePromoteHarness(root);
  const p = h.root.children[0];

  h.promoteBodyItemToNode(p, 0);

  const promotedParent = h.root.children[0];
  assert.equal(promotedParent.children.length, 2, 'new node inserted alongside existing child');
  const newNode = promotedParent.children[0];
  assert.equal(newNode.text, 'top item');
  assert.equal(newNode.level, 2, 'new node level is parent level + 1');
  assert.equal(promotedParent.children[1].id, 'existing', 'new node inserted at the front');
  assert.equal(newNode.body, '- nested a\n  - nested a1', 'nested children re-indented from 0 into new node body');
  assert.equal(promotedParent.body, '- second item', 'promoted item removed from parent body');
});

// R-14-03: promoting a checked checkbox body item discards the checked state;
// the new heading's text has no checkbox markup.
test('R-14-03: チェック済み本文項目を昇格するとチェック状態は破棄されテキストにチェックボックス記法が残らない', () => {
  const parent: TreeNode = { id: 'p1', text: 'Parent', level: 1, children: [], collapsed: false, body: '- [x] done item' };
  const root: TreeNode = { id: 'root', text: 'Root', level: 0, children: [parent], collapsed: false, body: '' };
  const h = makePromoteHarness(root);
  const p = h.root.children[0];

  h.promoteBodyItemToNode(p, 0);

  const newNode = h.root.children[0].children[0];
  assert.equal(newNode.text, 'done item', 'checkbox markup and checked state discarded');
  assert.ok(!/\[[ xX]\]/.test(newNode.text), 'no checkbox markup remains in the new heading text');
});

// ─── Demote ─────────────────────────────────────────────────────────────

// R-14-04: only a heading with no child headings can be demoted; root,
// level-0, and nodes without a parent are no-ops, as are headings that have
// child headings.
test('R-14-04: 子見出しを持つ見出し・ルート・親なしノードは降格されず、子見出しの無い見出しのみ降格される', () => {
  const leaf: TreeNode = { id: 'leaf', text: 'Leaf', level: 2, children: [], collapsed: false, body: '' };
  const branch: TreeNode = { id: 'branch', text: 'Branch', level: 1, children: [leaf], collapsed: false, body: '' };
  const root: TreeNode = { id: 'root', text: 'Root', level: 0, children: [branch], collapsed: false, body: '' };
  const h = makeDemoteHarness(root);

  // Root itself -> no-op.
  h.demoteNodeToBodyItem(h.root);
  assert.equal(h.undoCount, 0, 'root cannot be demoted');
  assert.equal(h.root.children.length, 1);

  // Heading with a child heading -> no-op.
  const b = h.root.children[0];
  h.demoteNodeToBodyItem(b);
  assert.equal(h.undoCount, 0, 'heading with child headings cannot be demoted');
  assert.equal(h.root.children[0].children.length, 1);

  // Node without a parent in this tree (detached) -> no-op.
  const detached: TreeNode = { id: 'detached', text: 'Detached', level: 1, children: [], collapsed: false, body: '' };
  h.demoteNodeToBodyItem(detached);
  assert.equal(h.undoCount, 0, 'node without a parent cannot be demoted');

  // Leaf heading with no children -> demoted successfully.
  const leafNode = findById(h.root, 'leaf')!;
  h.demoteNodeToBodyItem(leafNode);
  assert.equal(h.undoCount, 1, 'leaf heading is demoted');
  assert.equal(h.root.children[0].children.length, 0);
});

// R-14-05: demoting appends a `- text` bullet to the parent's body, followed
// by the demoted node's own body reformatted at indent+2, and removes the
// node from parent.children.
test('R-14-05: 降格すると親本文末尾に箇条書きが追加され自身の本文はインデント+2の子項目になり親から除去される', () => {
  const leaf: TreeNode = { id: 'leaf', text: 'Leaf', level: 2, children: [], collapsed: false, body: '- sub item\n- [x] sub checked' };
  const branch: TreeNode = { id: 'branch', text: 'Branch', level: 1, children: [leaf], collapsed: false, body: '- existing branch item' };
  const root: TreeNode = { id: 'root', text: 'Root', level: 0, children: [branch], collapsed: false, body: '' };
  const h = makeDemoteHarness(root);

  const leafNode = findById(h.root, 'leaf')!;
  h.demoteNodeToBodyItem(leafNode);

  const demotedBranch = h.root.children[0];
  assert.equal(demotedBranch.children.length, 0, 'leaf removed from parent.children');
  assert.equal(
    demotedBranch.body,
    '- existing branch item\n- Leaf\n  - sub item\n  - [x] sub checked',
    'parent body gets a new bullet followed by the reformatted child body at indent+2'
  );
});

// R-14-06: promoting/demoting pushes exactly one undo snapshot taken before
// the mutation, so performUndo restores the pre-change state completely.
test('R-14-06: 昇格・降格それぞれでUndoスナップショットが変更前状態として1件積まれ、Undoで完全復元される', () => {
  // Promote.
  const parent: TreeNode = { id: 'p1', text: 'Parent', level: 1, children: [], collapsed: false, body: '- top item' };
  const promoteRoot: TreeNode = { id: 'root', text: 'Root', level: 0, children: [parent], collapsed: false, body: '' };
  const beforePromote = JSON.parse(JSON.stringify(promoteRoot));
  const ph = makePromoteHarness(promoteRoot);
  const p = ph.root.children[0];

  ph.promoteBodyItemToNode(p, 0);
  assert.equal(ph.undoCount, 1, 'exactly one undo snapshot for the promotion');
  assert.equal(ph.root.children[0].children.length, 1, 'sanity check: promotion actually happened');

  ph.performUndo();
  assert.deepEqual(ph.root, beforePromote, 'undo restores the exact pre-promotion state');

  // Demote.
  const leaf: TreeNode = { id: 'leaf', text: 'Leaf', level: 2, children: [], collapsed: false, body: '- sub item' };
  const branch: TreeNode = { id: 'branch', text: 'Branch', level: 1, children: [leaf], collapsed: false, body: '' };
  const demoteRoot: TreeNode = { id: 'root', text: 'Root', level: 0, children: [branch], collapsed: false, body: '' };
  const beforeDemote = JSON.parse(JSON.stringify(demoteRoot));
  const dh = makeDemoteHarness(demoteRoot);
  const leafNode = findById(dh.root, 'leaf')!;

  dh.demoteNodeToBodyItem(leafNode);
  assert.equal(dh.undoCount, 1, 'exactly one undo snapshot for the demotion');
  assert.equal(dh.root.children[0].children.length, 0, 'sanity check: demotion actually happened');

  dh.performUndo();
  assert.deepEqual(dh.root, beforeDemote, 'undo restores the exact pre-demotion state');
});
