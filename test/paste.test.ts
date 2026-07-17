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
  side: string;
}

/** A single-chain tree: root(L0) -> n1(L1) -> n2(L2) -> n3(L3) -> n4(L4) -> n5(L5), n5 is a leaf. */
function makeChainTree(): TreeNode {
  const n5: TreeNode = { id: 'n5', text: 'N5', level: 5, children: [], collapsed: false, body: '', side: 'right' };
  const n4: TreeNode = { id: 'n4', text: 'N4', level: 4, children: [n5], collapsed: false, body: '', side: 'right' };
  const n3: TreeNode = { id: 'n3', text: 'N3', level: 3, children: [n4], collapsed: false, body: '', side: 'right' };
  const n2: TreeNode = { id: 'n2', text: 'N2', level: 2, children: [n3], collapsed: false, body: '', side: 'right' };
  const n1: TreeNode = { id: 'n1', text: 'N1', level: 1, children: [n2], collapsed: false, body: '', side: 'right' };
  return { id: 'root', text: 'Root', level: 0, children: [n1], collapsed: false, body: '', side: 'right' };
}

/** A two-level clipboard branch (parent + one child), i.e. subtreeDepth === 1. */
function makeTwoLevelClipboardNode(): TreeNode {
  return {
    id: 'src1', text: 'S1', level: 1,
    children: [{ id: 'src1a', text: 'S1A', level: 2, children: [], collapsed: false, body: '', side: 'right' }],
    collapsed: false, body: '', side: 'right',
  };
}

interface PasteHarness {
  performPaste(): void;
  get root(): TreeNode;
  get selectedId(): string | null;
  get pushUndoCalls(): number;
}

function makePasteHarness(root: TreeNode, selectedId: string | null, clipboard: unknown): PasteHarness {
  const src = [
    extractFunction('findById'),
    extractFunction('cloneWithNewIds'),
    extractFunction('subtreeDepth'),
    extractFunction('performPaste'),
  ].join('\n');
  return new Function(`
    let _idSeq = 1000;
    let root = ${JSON.stringify(root)};
    let selectedId = ${JSON.stringify(selectedId)};
    let selectedIds = new Set();
    let clipboard = ${JSON.stringify(clipboard)};
    let selectedBodyItemData = null;
    let pushUndoCalls = 0;
    function pushUndo() { pushUndoCalls++; }
    function postStructuralEdit() {}
    function render() {}
    ${src}
    return {
      performPaste() { performPaste(); },
      get root() { return root; },
      get selectedId() { return selectedId; },
      get pushUndoCalls() { return pushUndoCalls; },
    };
  `)() as PasteHarness;
}

// ─── Source-level guard assertions (mirrors the R-02-08 test style) ────────

test('R-17-02: performPaste (heading) has an H6 depth guard before mutating the tree', () => {
  const fnText = extractFunction('performPaste');
  assert.ok(fnText.includes('node.level + 1 + subtreeDepth(clipboard.node) > 6'),
    'heading paste must guard against results exceeding H6 using subtreeDepth');
});

test('R-17-02: performPaste (heading-multi) has an H6 depth guard before mutating the tree', () => {
  const fnText = extractFunction('performPaste');
  assert.ok(fnText.includes('clipboard.nodes.some(srcNode => node.level + 1 + subtreeDepth(srcNode) > 6)'),
    'heading-multi paste must guard against results exceeding H6 using subtreeDepth');
});

// ─── Functional: single-node heading paste ──────────────────────────────────

test('R-17-02: pasting a 2-level branch onto an H5 node is a no-op (would exceed H6)', () => {
  const root = makeChainTree();
  const clipboard = { type: 'heading', node: makeTwoLevelClipboardNode() };
  const h = makePasteHarness(root, 'n5', clipboard);

  h.performPaste();

  const n5 = h.root.children[0].children[0].children[0].children[0].children[0];
  assert.equal(n5.id, 'n5');
  assert.equal(n5.children.length, 0, 'no child should have been added to n5');
  assert.equal(h.pushUndoCalls, 0, 'pushUndo must not be called for a blocked paste');
  assert.equal(h.selectedId, 'n5', 'selection must remain unchanged on a blocked paste');
});

test('R-17-02: pasting a 2-level branch onto an H4 node succeeds (result stays within H6)', () => {
  const root = makeChainTree();
  const clipboard = { type: 'heading', node: makeTwoLevelClipboardNode() };
  const h = makePasteHarness(root, 'n4', clipboard);

  h.performPaste();

  const n4 = h.root.children[0].children[0].children[0].children[0];
  assert.equal(n4.id, 'n4');
  assert.equal(n4.children.length, 2, 'n5 plus the newly pasted child should be present');
  const pasted = n4.children.find(c => c.id !== 'n5')!;
  assert.ok(pasted, 'pasted node should be present');
  assert.equal(pasted.level, 5);
  assert.equal(pasted.children.length, 1);
  assert.equal(pasted.children[0].level, 6);
  assert.equal(h.pushUndoCalls, 1, 'pushUndo must be called exactly once for a successful paste');
  assert.equal(h.selectedId, pasted.id, 'selection must move to the pasted node');
});

// ─── Functional: multi-node heading paste ───────────────────────────────────

test('R-17-02: heading-multi paste onto an H5 node is a no-op when any source exceeds H6', () => {
  const root = makeChainTree();
  const clipboard = { type: 'heading-multi', nodes: [makeTwoLevelClipboardNode()] };
  const h = makePasteHarness(root, 'n5', clipboard);

  h.performPaste();

  const n5 = h.root.children[0].children[0].children[0].children[0].children[0];
  assert.equal(n5.children.length, 0, 'no child should have been added to n5');
  assert.equal(h.pushUndoCalls, 0, 'pushUndo must not be called for a blocked multi-paste');
});

test('R-17-02: heading-multi paste onto an H4 node succeeds (result stays within H6)', () => {
  const root = makeChainTree();
  const clipboard = { type: 'heading-multi', nodes: [makeTwoLevelClipboardNode()] };
  const h = makePasteHarness(root, 'n4', clipboard);

  h.performPaste();

  const n4 = h.root.children[0].children[0].children[0].children[0];
  assert.equal(n4.children.length, 2);
  const pasted = n4.children.find(c => c.id !== 'n5')!;
  assert.ok(pasted, 'pasted node should be present');
  assert.equal(pasted.level, 5);
  assert.equal(pasted.children.length, 1);
  assert.equal(pasted.children[0].level, 6);
  assert.equal(h.pushUndoCalls, 1);
});
