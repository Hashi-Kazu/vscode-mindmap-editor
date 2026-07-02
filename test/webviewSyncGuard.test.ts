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

test('R-13-13: root add-body is disabled in context menu and guarded in handler', () => {
  const menuSrc = extractFunction('showHeadingContextMenu');
  const handlerSrc = extractFunction('handleContextAction');
  assert.ok(menuSrc.includes('disabled: !!(root && node.id === root.id)'));
  assert.ok(handlerSrc.includes("case 'add-body'"));
  assert.ok(handlerSrc.includes('contextTarget.id !== root.id'));
});
