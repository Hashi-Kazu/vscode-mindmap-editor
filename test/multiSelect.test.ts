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

function extractBlockAfter(marker: string): string {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `marker "${marker}" not found in media/mindmap.js`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(bodyStart, i + 1);
    }
  }
  assert.fail(`block after "${marker}" braces are unbalanced`);
}

interface TreeNode {
  id: string;
  text: string;
  level: number;
  children: TreeNode[];
  collapsed: boolean;
  body: string;
}

function makeTree(): TreeNode {
  // root
  //  ├─ h1 (children: h1a, h1b)
  //  │    ├─ h1a (leaf)
  //  │    └─ h1b (leaf)
  //  └─ h2 (leaf)
  const h1a: TreeNode = { id: 'h1a', text: 'H1A', level: 2, children: [], collapsed: false, body: '' };
  const h1b: TreeNode = { id: 'h1b', text: 'H1B', level: 2, children: [], collapsed: false, body: '' };
  const h1: TreeNode = { id: 'h1', text: 'H1', level: 1, children: [h1a, h1b], collapsed: false, body: '' };
  const h2: TreeNode = { id: 'h2', text: 'H2', level: 1, children: [], collapsed: false, body: '' };
  return { id: 'root', text: 'Root', level: 0, children: [h1, h2], collapsed: false, body: '' };
}

interface HeadingHarness {
  ctrlClickSelectHeading(node: TreeNode): void;
  get selectedId(): string | null;
  get selectedIds(): Set<string>;
  isHeadingMultiSelectMember(id: string): boolean;
  getMultiSelectedHeadingNodes(): TreeNode[];
}

function makeHeadingHarness(root: TreeNode, initialSelectedId: string | null, initialSelectedIds: string[]): HeadingHarness {
  const src = [
    extractFunction('findParent'),
    extractFunction('findById'),
    extractFunction('ctrlClickSelectHeading'),
    extractFunction('headingMultiSelectCount'),
    extractFunction('isHeadingMultiSelectMember'),
    extractFunction('getMultiSelectedHeadingNodes'),
  ].join('\n');
  return new Function(`
    let root = ${JSON.stringify(root)};
    let selectedId = ${JSON.stringify(initialSelectedId)};
    let selectedIds = new Set(${JSON.stringify(initialSelectedIds)});
    let selectedBodyItemKey = null, selectedBodyItemData = null;
    let selectedBodyItemKeys = new Set();
    let selectedBodyItemsData = new Map();
    ${src}
    return {
      ctrlClickSelectHeading(node) { ctrlClickSelectHeading(node); },
      get selectedId() { return selectedId; },
      get selectedIds() { return selectedIds; },
      isHeadingMultiSelectMember(id) { return isHeadingMultiSelectMember(id); },
      getMultiSelectedHeadingNodes() { return getMultiSelectedHeadingNodes(); },
    };
  `)() as HeadingHarness;
}

// R-18-01: Ctrl+click on a heading node from a different parent resets the
// selection to that node alone.
test('異なる親の見出しノードをCtrl+クリックすると複数選択がリセットされ単体選択になる', () => {
  const root = makeTree();
  // h1a and h1b are siblings (parent h1); h2 has a different parent (root).
  const h = makeHeadingHarness(root, 'h1a', []);
  const h2 = root.children[1];
  h.ctrlClickSelectHeading(h2);

  assert.equal(h.selectedId, 'h2');
  assert.equal(h.selectedIds.size, 0);
});

// R-18-01: Ctrl+click on a sibling heading node (same parent) adds it to the
// multi-selection.
test('同一親の兄弟見出しノードはCtrl+クリックで複数選択に追加される', () => {
  const root = makeTree();
  const h = makeHeadingHarness(root, 'h1a', []);
  const h1b = root.children[0].children[1];
  h.ctrlClickSelectHeading(h1b);

  assert.equal(h.selectedId, 'h1b');
  assert.ok(h.selectedIds.has('h1a'));
  assert.ok(h.selectedIds.has('h1b'));
  assert.equal(h.selectedIds.size, 2);
});

interface BodyHarness {
  ctrlClickSelectBodyItem(parentNode: TreeNode, item: { lineIdx: number; indent: number }, key: string): void;
  get selectedBodyItemKey(): string | null;
  get selectedBodyItemKeys(): Set<string>;
}

function makeBodyHarness(
  initialKey: string | null,
  initialData: { parentNode: TreeNode; lineIdx: number; indent: number } | null,
  initialKeys: string[],
  initialDataMap: Array<[string, { parentNode: TreeNode; lineIdx: number; indent: number }]>
): BodyHarness {
  const src = [extractFunction('ctrlClickSelectBodyItem')].join('\n');
  const fn = new Function('initialData', 'initialDataMap', `
    let root = null;
    let selectedId = null;
    let selectedIds = new Set();
    let selectedBodyItemKey = ${JSON.stringify(initialKey)};
    let selectedBodyItemData = initialData;
    let selectedBodyItemKeys = new Set(${JSON.stringify(initialKeys)});
    let selectedBodyItemsData = new Map(initialDataMap);
    ${src}
    return {
      ctrlClickSelectBodyItem(parentNode, item, key) { ctrlClickSelectBodyItem(parentNode, item, key); },
      get selectedBodyItemKey() { return selectedBodyItemKey; },
      get selectedBodyItemKeys() { return selectedBodyItemKeys; },
    };
  `);
  return fn(initialData, initialDataMap) as BodyHarness;
}

// R-18-02: Ctrl+click on a body item with a different parent OR different
// indent resets the selection to that item alone.
test('異なる親または異なるインデントの本文項目をCtrl+クリックすると複数選択がリセットされる', () => {
  const parentA: TreeNode = { id: 'pa', text: 'A', level: 1, children: [], collapsed: false, body: '' };
  const parentB: TreeNode = { id: 'pb', text: 'B', level: 1, children: [], collapsed: false, body: '' };

  // Case 1: different parent
  {
    const h = makeBodyHarness('pa:0', { parentNode: parentA, lineIdx: 0, indent: 0 }, [], []);
    h.ctrlClickSelectBodyItem(parentB, { lineIdx: 0, indent: 0 }, 'pb:0');
    assert.equal(h.selectedBodyItemKey, 'pb:0');
    assert.equal(h.selectedBodyItemKeys.size, 0);
  }

  // Case 2: same parent, different indent
  {
    const h = makeBodyHarness('pa:0', { parentNode: parentA, lineIdx: 0, indent: 0 }, [], []);
    h.ctrlClickSelectBodyItem(parentA, { lineIdx: 1, indent: 2 }, 'pa:1');
    assert.equal(h.selectedBodyItemKey, 'pa:1');
    assert.equal(h.selectedBodyItemKeys.size, 0);
  }

  // Sanity: same parent + same indent is added to the selection.
  {
    const h = makeBodyHarness('pa:0', { parentNode: parentA, lineIdx: 0, indent: 0 }, [], []);
    h.ctrlClickSelectBodyItem(parentA, { lineIdx: 1, indent: 0 }, 'pa:1');
    assert.equal(h.selectedBodyItemKey, 'pa:1');
    assert.ok(h.selectedBodyItemKeys.has('pa:0'));
  }
});

// R-18-07: Right-clicking a node that is already part of an active
// multi-selection keeps the multi-selection intact.
test('複数選択中のノードを右クリックすると複数選択状態が維持される', () => {
  const src = [
    extractFunction('findParent'),
    extractFunction('findById'),
    extractFunction('headingMultiSelectCount'),
    extractFunction('isHeadingMultiSelectMember'),
    extractFunction('getMultiSelectedHeadingNodes'),
  ].join('\n');
  const root = makeTree();
  const h = new Function(`
    let root = ${JSON.stringify(root)};
    let selectedId = 'h1b';
    let selectedIds = new Set(['h1a']);
    ${src}
    return {
      isHeadingMultiSelectMember(id) { return isHeadingMultiSelectMember(id); },
      getMultiSelectedHeadingNodes() { return getMultiSelectedHeadingNodes().map(n => n.id).sort(); },
    };
  `)() as { isHeadingMultiSelectMember(id: string): boolean; getMultiSelectedHeadingNodes(): string[] };

  // h1a/h1b are both members of the active (2-node) multi-selection.
  assert.equal(h.isHeadingMultiSelectMember('h1a'), true);
  assert.equal(h.isHeadingMultiSelectMember('h1b'), true);
  assert.deepEqual(h.getMultiSelectedHeadingNodes(), ['h1a', 'h1b']);

  // h2 is not part of the current selection.
  assert.equal(h.isHeadingMultiSelectMember('h2'), false);
});

interface DemoteHarness {
  demoteNodesToBodyItems(nodes: TreeNode[]): void;
  performUndo(): void;
  get root(): TreeNode;
  get undoCount(): number;
}

function makeDemoteHarness(root: TreeNode): DemoteHarness {
  const src = [
    extractFunction('findParent'),
    extractFunction('reformatBodyLines'),
    extractFunction('demoteNodesToBodyItems'),
  ].join('\n');
  return new Function(`
    let root = ${JSON.stringify(root)};
    let selectedId = null;
    let selectedIds = new Set();
    let undoCount = 0;
    let undoSnapshot = null;
    function pushUndo() { undoCount++; undoSnapshot = JSON.parse(JSON.stringify(root)); }
    function postStructuralEdit() {}
    function render() {}
    ${src}
    return {
      demoteNodesToBodyItems(nodes) { demoteNodesToBodyItems(nodes); },
      performUndo() { root = undoSnapshot; },
      get root() { return root; },
      get undoCount() { return undoCount; },
    };
  `)() as DemoteHarness;
}

// R-18-09: bulk-demoting multi-selected heading nodes moves them all into
// the parent's body as bullet items, with a single undo entry that restores
// all of them at once.
test('複数選択中の見出しノードに対し本文項目にするアクションで一括降格され、Undoで一括復元される', () => {
  const root = makeTree();
  const h = makeDemoteHarness(root);
  const h1 = root.children[0];
  const h1a = h1.children[0];
  const h1b = h1.children[1];

  h.demoteNodesToBodyItems([h1a, h1b]);

  assert.equal(h.undoCount, 1, 'exactly one undo snapshot for the whole batch');
  const demotedH1 = h.root.children[0];
  assert.equal(demotedH1.children.length, 0, 'both children were demoted');
  assert.ok(demotedH1.body.includes('H1A'));
  assert.ok(demotedH1.body.includes('H1B'));

  h.performUndo();
  assert.equal(h.root.children[0].children.length, 2, 'undo restores both demoted nodes at once');
  assert.equal(h.root.children[0].children[0].id, 'h1a');
  assert.equal(h.root.children[0].children[1].id, 'h1b');
});

interface PromoteHarness {
  promoteBodyItemsToNodes(items: Array<{ parentNode: TreeNode; lineIdx: number; indent: number }>): void;
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
    extractFunction('promoteBodyItemsToNodes'),
  ].join('\n');
  return new Function(`
    const BODY_H = 30;
    let _idSeq = 1000;
    let root = ${JSON.stringify(root)};
    let selectedBodyItemKey = null, selectedBodyItemData = null;
    let selectedBodyItemKeys = new Set();
    let selectedBodyItemsData = new Map();
    let undoCount = 0;
    let undoSnapshot = null;
    function pushUndo() { undoCount++; undoSnapshot = JSON.parse(JSON.stringify(root)); }
    function postStructuralEdit() {}
    function render() {}
    ${src}
    return {
      promoteBodyItemsToNodes(items) { promoteBodyItemsToNodes(items); },
      performUndo() { root = undoSnapshot; },
      get root() { return root; },
      get undoCount() { return undoCount; },
    };
  `)() as PromoteHarness;
}

// R-18-10: bulk-promoting multi-selected top-level body items converts them
// all into sibling heading nodes, with a single undo entry that restores all
// of them at once.
test('複数選択中の本文項目に対し見出しにするアクションで一括昇格され、Undoで一括復元される', () => {
  const parent: TreeNode = { id: 'p1', text: 'Parent', level: 1, children: [], collapsed: false, body: '- item one\n- item two' };
  const root: TreeNode = { id: 'root', text: 'Root', level: 0, children: [parent], collapsed: false, body: '' };

  const h = makePromoteHarness(root);
  const p = h.root.children[0];
  h.promoteBodyItemsToNodes([
    { parentNode: p, lineIdx: 0, indent: 0 },
    { parentNode: p, lineIdx: 1, indent: 0 },
  ]);

  assert.equal(h.undoCount, 1, 'exactly one undo snapshot for the whole batch');
  const promotedParent = h.root.children[0];
  assert.equal(promotedParent.body.trim(), '', 'both body lines were promoted out');
  assert.equal(promotedParent.children.length, 2, 'both items became heading nodes');
  assert.deepEqual(promotedParent.children.map((c: TreeNode) => c.text), ['item one', 'item two']);

  h.performUndo();
  const restoredParent = h.root.children[0];
  assert.equal(restoredParent.children.length, 0, 'undo removes both promoted nodes at once');
  assert.equal(restoredParent.body, '- item one\n- item two');
});

interface ToggleTypeHarness {
  toggleBodyItemsType(items: Array<{ parentNode: TreeNode; lineIdx: number; indent: number }>, targetType: string): void;
  performUndo(): void;
  get root(): TreeNode;
  get undoCount(): number;
}

function makeToggleTypeHarness(root: TreeNode): ToggleTypeHarness {
  const src = [
    extractFunction('toggleBodyItemType'),
    extractFunction('toggleBodyItemsType'),
  ].join('\n');
  return new Function(`
    let root = ${JSON.stringify(root)};
    let selectedBodyItemKey = null, selectedBodyItemData = null;
    let selectedBodyItemKeys = new Set();
    let selectedBodyItemsData = new Map();
    let undoCount = 0;
    let undoSnapshot = null;
    function pushUndo() { undoCount++; undoSnapshot = JSON.parse(JSON.stringify(root)); }
    function postStructuralEdit() {}
    function render() {}
    ${src}
    return {
      toggleBodyItemsType(items, targetType) { toggleBodyItemsType(items, targetType); },
      performUndo() { root = undoSnapshot; },
      get root() { return root; },
      get undoCount() { return undoCount; },
    };
  `)() as ToggleTypeHarness;
}

// R-18-11: bulk-converting multi-selected body items to a single target type
// (checkbox/bullet) applies to all of them, with a single undo entry that
// restores all of them at once.
test('複数選択中の本文項目に対しチェックボックス切替アクションで全項目が同一種別へ一括変換され、Undoで一括復元される', () => {
  const parent: TreeNode = { id: 'p1', text: 'Parent', level: 1, children: [], collapsed: false, body: '- item one\n- item two' };
  const root: TreeNode = { id: 'root', text: 'Root', level: 0, children: [parent], collapsed: false, body: '' };

  const h = makeToggleTypeHarness(root);
  const p = h.root.children[0];
  h.toggleBodyItemsType(
    [
      { parentNode: p, lineIdx: 0, indent: 0 },
      { parentNode: p, lineIdx: 1, indent: 0 },
    ],
    'checkbox'
  );

  assert.equal(h.undoCount, 1, 'exactly one undo snapshot for the whole batch');
  const converted = h.root.children[0];
  assert.equal(converted.body, '- [ ] item one\n- [ ] item two');

  h.performUndo();
  assert.equal(h.root.children[0].body, '- item one\n- item two', 'undo restores both items at once');
});

test('R-18-12: Delete removes selected body items as one undoable operation', () => {
  const keydownBlock = extractBlockAfter("document.addEventListener('keydown'");
  const h = new Function(`
    const BODY_H = 42;
    let root = {
      id: 'root', text: 'Root', level: 0, collapsed: false, body: '', children: [
        { id: 'p', text: 'Parent', level: 1, collapsed: false,
          body: '- first\\n- keep\\n- third', children: [], collapsedBodyLines: new Set() }
      ]
    };
    const parent = root.children[0];
    let selectedId = null, selectedIds = new Set();
    let selectedBodyItemKey = 'p:0';
    let selectedBodyItemData = { parentNode: parent, lineIdx: 0, indent: 0 };
    let selectedBodyItemKeys = new Set(['p:0', 'p:2']);
    let selectedBodyItemsData = new Map([
      ['p:0', selectedBodyItemData],
      ['p:2', { parentNode: parent, lineIdx: 2, indent: 0 }],
    ]);
    let editingId = null, bodyEditing = false;
    let undoCount = 0, undoSnapshot = null, structuralCount = 0, renderCount = 0;
    function pushUndo() { undoCount++; undoSnapshot = JSON.parse(JSON.stringify(root)); }
    function postStructuralEdit() { structuralCount++; }
    function render() { renderCount++; }
    ${extractFunction('getBodyItems')}
    ${extractFunction('getBodyItemTree')}
    ${extractFunction('findBodyItemByLineIdx')}
    ${extractFunction('bodyItemLastLineIdx')}
    ${extractFunction('remapCollapsedBodyLinesAfterDelete')}
    ${extractFunction('deleteBodyItemNoUndo')}
    function handleKeydown(e) ${keydownBlock}
    return {
      deleteSelected() {
        handleKeydown({ key: 'Delete', ctrlKey: false, metaKey: false, shiftKey: false,
          altKey: false, preventDefault() {} });
      },
      get body() { return parent.body; },
      get undoBody() { return undoSnapshot.children[0].body; },
      get undoCount() { return undoCount; },
      get structuralCount() { return structuralCount; },
      get renderCount() { return renderCount; },
      get selectionCleared() {
        return selectedBodyItemKey === null && selectedBodyItemData === null
          && selectedBodyItemKeys.size === 0 && selectedBodyItemsData.size === 0;
      },
    };
  `)() as {
    deleteSelected(): void;
    readonly body: string;
    readonly undoBody: string;
    readonly undoCount: number;
    readonly structuralCount: number;
    readonly renderCount: number;
    readonly selectionCleared: boolean;
  };

  h.deleteSelected();
  assert.equal(h.body, '- keep', 'descending line deletion avoids index shifts');
  assert.equal(h.undoBody, '- first\n- keep\n- third', 'one snapshot restores the complete pre-delete Markdown');
  assert.equal(h.undoCount, 1, 'the batch records exactly one Undo operation');
  assert.equal(h.structuralCount, 2, 'each removed body block is synchronized to Markdown');
  assert.equal(h.renderCount, 1);
  assert.equal(h.selectionCleared, true);
});
