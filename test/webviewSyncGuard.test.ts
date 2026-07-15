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

/** Extract a brace-balanced block starting at the first `{` after `marker`. */
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

interface UpdateHarness {
  setDragState(v: unknown): void;
  setEditingId(v: unknown): void;
  handle(msg: unknown): void;
  applyPending(): void;
  root: { id: string };
  pendingUpdate: unknown;
  appliedGeneration: number;
  appliedDocUri: string | null;
  renderCount: number;
}

function makeUpdateHarness(): UpdateHarness {
  const src = [
    extractFunction('applyUpdateMessage'),
    extractFunction('handleUpdateMessage'),
    extractFunction('applyPendingUpdate'),
  ].join('\n');
  return new Function(`
    let root = { id: 'original-root' };
    let editingId = null, bodyEditing = false, dragState = null, bodyDragState = null;
    let pendingUpdate = null, appliedGeneration = 0, appliedDocUri = null;
    let selectedId = null;
    let selectedIds = new Set();
    let selectedBodyItemKey = null, selectedBodyItemData = null;
    let renderCount = 0;
    function render() { renderCount++; }
    function applyBodyItemCollapsePaths() {}
    function createBodyItemSelectionLocator() { return null; }
    function resolveBodyItemSelection() { return null; }
    function clearBodyItemSelection() { selectedBodyItemKey = null; selectedBodyItemData = null; }
    ${src}
    return {
      setDragState(v) { dragState = v; },
      setEditingId(v) { editingId = v; },
      handle(msg) { handleUpdateMessage(msg); },
      applyPending() { applyPendingUpdate(); },
      get root() { return root; },
      get pendingUpdate() { return pendingUpdate; },
      get appliedGeneration() { return appliedGeneration; },
      get appliedDocUri() { return appliedDocUri; },
      get renderCount() { return renderCount; },
    };
  `)() as UpdateHarness;
}

// R-11-09（2.6.4 回帰ピン）: ドラッグ中に届いた update は root を差し替えず、
// 最新1件として保留される
test('ドラッグ中の update は保留され root を差し替えない', () => {
  const h = makeUpdateHarness();
  h.setDragState({ node: { id: 'dragging' } });

  const msg1 = { type: 'update', root: { id: 'ext-1' }, generation: 1, docUri: 'file:///doc.md' };
  const msg2 = { type: 'update', root: { id: 'ext-2' }, generation: 2, docUri: 'file:///doc.md' };
  h.handle(msg1);
  h.handle(msg2);

  assert.equal(h.root.id, 'original-root', 'root must NOT be replaced mid-drag');
  assert.equal(h.renderCount, 0, 'no re-render mid-drag');
  assert.equal(h.pendingUpdate, msg2, 'the LATEST update is held');
  assert.equal(h.appliedGeneration, 0, 'generation not recorded for a held update');
});

// R-11-09: ロックなしなら update は即時適用され、世代・URI が記録される
test('ロックなしの update は即時適用される', () => {
  const h = makeUpdateHarness();
  const msg = { type: 'update', root: { id: 'ext-1' }, generation: 3, docUri: 'file:///doc.md' };
  h.handle(msg);

  assert.equal(h.root.id, 'ext-1');
  assert.equal(h.renderCount, 1);
  assert.equal(h.pendingUpdate, null);
  assert.equal(h.appliedGeneration, 3);
  assert.equal(h.appliedDocUri, 'file:///doc.md');
});

// R-11-09: 全ロック解除後に保留 update が適用され、pendingUpdate がクリアされる
test('ロック解除後に保留 update が適用される', () => {
  const h = makeUpdateHarness();
  h.setDragState({ node: { id: 'dragging' } });
  const msg = { type: 'update', root: { id: 'ext-held' }, generation: 4, docUri: 'file:///doc.md' };
  h.handle(msg);
  assert.equal(h.root.id, 'original-root');

  // ロックが残っている間は applyPendingUpdate も何もしない
  h.applyPending();
  assert.equal(h.root.id, 'original-root');
  assert.equal(h.pendingUpdate, msg);

  // ロック解除後に適用される
  h.setDragState(null);
  h.applyPending();
  assert.equal(h.root.id, 'ext-held');
  assert.equal(h.pendingUpdate, null);
  assert.equal(h.appliedGeneration, 4);
  assert.equal(h.appliedDocUri, 'file:///doc.md');
});

// R-11-09: structuralEdit は編集の基になった世代と URI を返し、保留 update を
// クリアする（拡張側の再同期／コンフリクト解決に委ねる）
test('postStructuralEdit が baseGeneration/docUri を含む', () => {
  const src = extractFunction('postStructuralEdit');
  const h = new Function(`
    const posted = [];
    const vscode = { postMessage: (m) => posted.push(m) };
    let root = { id: 'web-root' };
    let appliedGeneration = 7;
    let appliedDocUri = 'file:///doc.md';
    let pendingUpdate = { type: 'update', root: { id: 'held' } };
    function extractBodyItemCollapsePaths() { return []; }
    ${src}
    postStructuralEdit();
    return { posted, get pendingUpdate() { return pendingUpdate; } };
  `)() as { posted: Array<Record<string, unknown>>; pendingUpdate: unknown };

  assert.equal(h.posted.length, 1);
  assert.equal(h.posted[0].type, 'structuralEdit');
  assert.equal(h.posted[0].baseGeneration, 7);
  assert.equal(h.posted[0].docUri, 'file:///doc.md');
  assert.equal(h.pendingUpdate, null, 'held update is dropped on commit');
});

// Issue#38 / R-15-05: structuralEdit は編集後ツリーから再計算した
// body-item-collapse パスを同梱し、拡張側のキャッシュ更新を可能にする
test('postStructuralEdit が body-item collapse パスを含む', () => {
  const src = extractFunction('postStructuralEdit');
  const h = new Function(`
    const posted = [];
    const vscode = { postMessage: (m) => posted.push(m) };
    let root = { id: 'web-root' };
    let appliedGeneration = 7;
    let appliedDocUri = 'file:///doc.md';
    let pendingUpdate = null;
    function extractBodyItemCollapsePaths() { return ['A/B::x']; }
    ${src}
    postStructuralEdit();
    return { posted };
  `)() as { posted: Array<Record<string, unknown>> };

  assert.equal(h.posted[0].type, 'structuralEdit');
  assert.deepEqual(h.posted[0].bodyItemCollapsePaths, ['A/B::x']);
});

// BUG-04 / R-12-09: render による入力欄破棄では blur が発火せずロックが残るため、
// performUndo は防御的に編集ロックを解除する
test('performUndo が editingId/bodyEditing を解除する', () => {
  const src = extractFunction('performUndo');
  const h = new Function(`
    let editingId = 'node-1';
    let bodyEditing = true;
    let root = { id: 'current' };
    let selectedId = 'x';
    let selectedIds = new Set(['x']);
    let selectedBodyItemKey = 'k';
    let selectedBodyItemData = {};
    let selectedBodyItemKeys = new Set(['k']);
    let selectedBodyItemsData = new Map([['k', {}]]);
    let undoStack = [{ id: 'previous' }];
    let redoStack = [];
    const MAX_UNDO = 50;
    function cloneForUndo(n) { return { id: n.id }; }
    function render() {}
    function postStructuralEdit() {}
    function postBodyItemCollapseState() {}
    ${src}
    performUndo();
    return { editingId, bodyEditing, root };
  `)() as { editingId: unknown; bodyEditing: boolean; root: { id: string } };

  assert.equal(h.editingId, null);
  assert.equal(h.bodyEditing, false);
  assert.equal(h.root.id, 'previous');
});

// BUG-04 回帰ピン: keydown ハンドラのソース上で Ctrl+Z（performUndo）が
// 編集ガードの後、Ctrl+S（save）がその前に評価される
test('keydown で Ctrl+Z が編集ガードの後に評価される', () => {
  const block = extractBlockAfter("document.addEventListener('keydown'");
  const guardIdx = block.indexOf('if (editingId || bodyEditing) return;');
  const undoIdx = block.indexOf('performUndo()');
  const saveIdx = block.indexOf("type: 'save'");

  assert.ok(guardIdx >= 0, 'editing guard not found in keydown handler');
  assert.ok(undoIdx >= 0, 'performUndo() call not found in keydown handler');
  assert.ok(saveIdx >= 0, "Ctrl+S ({ type: 'save' }) not found in keydown handler");
  assert.ok(undoIdx > guardIdx, 'Ctrl+Z must be evaluated AFTER the editing guard');
  assert.ok(saveIdx < guardIdx, 'Ctrl+S must remain available while editing (before the guard)');
});

test('R-13-14: render releases unconsumed _pendingBodyEdit and bodyEditing', () => {
  const src = extractFunction('render');
  assert.ok(src.includes('if (_pendingBodyEdit)'));
  assert.ok(src.includes('_pendingBodyEdit = null'));
  assert.ok(src.includes('bodyEditing = false'));
  assert.ok(src.includes('applyPendingUpdate()'));
});

test('R-13-14 / R-11-09: render() releases a stranded editingId/bodyEditing and applies the pending update', () => {
  const src = extractFunction('render');
  // A live inline edit input is detected via the edit-input selector, and its
  // absence while editingId/bodyEditing is set triggers a release.
  assert.ok(src.includes("nodeLayer.querySelector('input.edit-input')"),
    'render() must probe for a live inline edit input');
  assert.ok(/editingId \|\| bodyEditing/.test(src),
    'render() must consider both editingId and bodyEditing as stranded locks');
  assert.ok(src.includes('editingId = null'),
    'render() must release a stranded editingId');
  assert.ok(src.includes('bodyEditing = false'),
    'render() must release a stranded bodyEditing');
  assert.ok(src.includes('applyPendingUpdate()'),
    'render() must apply the held update after releasing locks');
  // The just-consumed _pendingBodyEdit case (async input via rAF) must be
  // excluded from the stranded-lock release path.
  assert.ok(src.includes('hadPendingBodyEdit'),
    'render() must exclude the async _pendingBodyEdit case from the release path');
});

test('R-13-14: addBodyItem resets checked filter for top-level add', () => {
  const src = extractFunction('addBodyItem');
  assert.ok(src.includes("indent === 0 && checkboxFilter === 'checked'"));
  assert.ok(src.includes("setCheckboxFilter('all')"));
});

test('R-10-02: toggleBodyItemCollapse pushes undo', () => {
  const src = extractFunction('toggleBodyItemCollapse');
  const harness = new Function(`
    let undoCount = 0;
    const pushUndo = () => { undoCount++; };
    const render = () => {};
    const postBodyItemCollapseState = () => {};
    ${src}
    return { toggleBodyItemCollapse, get undoCount() { return undoCount; } };
  `)() as {
    toggleBodyItemCollapse: (item: { lineIdx: number }, parentNode: { collapsedBodyLines?: Set<number> }) => void;
    undoCount: number;
  };
  harness.toggleBodyItemCollapse({ lineIdx: 3 }, {});
  assert.equal(harness.undoCount, 1);
});

test('R-10-04: cloneForUndo copies collapsedBodyLines as a new Set', () => {
  const src = extractFunction('cloneForUndo');
  const cloneForUndo = new Function(`${src}; return cloneForUndo;`)() as (node: {
    id: string; text: string; level: number; collapsed: boolean; body: string;
    side?: string; collapsedBodyLines?: Set<number>; children: unknown[];
  }) => { collapsedBodyLines?: Set<number> };
  const original = {
    id: 'n', text: 'node', level: 1, collapsed: false, body: '', side: 'right',
    collapsedBodyLines: new Set([1, 4]), children: [],
  };
  const cloned = cloneForUndo(original);

  assert.deepEqual(cloned.collapsedBodyLines, original.collapsedBodyLines);
  assert.notEqual(cloned.collapsedBodyLines, original.collapsedBodyLines);
});

test('R-15-03/R-15-04: add-child body item is appended after existing children (Issue #46)', () => {
  const helpers = new Function(`
    const BODY_H = 20;
    ${extractFunction('getBodyItems')}
    ${extractFunction('getBodyItemTree')}
    ${extractFunction('bodyItemLastLineIdx')}
    ${extractFunction('findBodyItemByLineIdx')}
    return { getBodyItemTree, findBodyItemByLineIdx, bodyItemLastLineIdx };
  `)() as {
    getBodyItemTree: (body: string) => { lineIdx: number }[];
    findBodyItemByLineIdx: (tree: unknown, lineIdx: number) => { lineIdx: number } | null;
    bodyItemLastLineIdx: (item: unknown) => number;
  };
  // parent (line 0) already has two children (lines 1,2) and a following sibling (line 3)
  const body = '- parent\n  - childA\n  - childB\n- sibling';
  const tree = helpers.getBodyItemTree(body);
  const parent = helpers.findBodyItemByLineIdx(tree, 0);
  assert.ok(parent);
  const last = helpers.bodyItemLastLineIdx(parent);
  // last line of parent's subtree is childB (line 2); addBodyItem inserts at last+1,
  // i.e. after childB and before the sibling — the bottom of the sub-hierarchy.
  assert.equal(last, 2);

  // Both call sites must compute the parent's subtree tail rather than passing the
  // parent's own lineIdx (which would insert at the top).
  const tabBlock = extractBlockAfter('// Tab: add child body item');
  assert.ok(tabBlock.includes('bodyItemLastLineIdx'),
    'Tab add-child must append after the existing children');
  const handlerSrc = extractFunction('handleContextAction');
  const addChildIdx = handlerSrc.indexOf("case 'body-add-child'");
  assert.ok(addChildIdx >= 0);
  const addChildBlock = handlerSrc.slice(addChildIdx, handlerSrc.indexOf("case 'body-add-sibling'"));
  assert.ok(addChildBlock.includes('bodyItemLastLineIdx'),
    'body-add-child must append after the existing children');
});

test('R-13-13: root add-body is disabled in context menu and guarded in handler', () => {
  const menuSrc = extractFunction('showHeadingContextMenu');
  const handlerSrc = extractFunction('handleContextAction');
  assert.ok(menuSrc.includes('disabled: !!(root && node.id === root.id)'));
  assert.ok(handlerSrc.includes("case 'add-body'"));
  assert.ok(handlerSrc.includes('contextTarget.id !== root.id'));
});
