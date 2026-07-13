import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getBodyItems,
  getBodyItemTree,
  bodyItemLastLineIdx,
  findBodyItemByLineIdx,
  reformatBodyLines,
  remapCollapsedBodyLinesAfterDelete,
  remapCollapsedBodyLinesAfterInsert,
  remapCollapsedBodyLinesAfterMove,
  findBodyItemSiblings,
  moveBodyItemLines,
  toggleBodyItemType,
  bodyItemTreeToLines,
  type BodyItem,
} from '../src/bodyItems';

const webviewSource = readFileSync(join(process.cwd(), 'media', 'mindmap.js'), 'utf8');

function extractWebviewFunction(name: string): string {
  const start = webviewSource.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} not found in media/mindmap.js`);
  const bodyStart = webviewSource.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < webviewSource.length; i++) {
    const ch = webviewSource[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return webviewSource.slice(start, i + 1);
    }
  }
  assert.fail(`function ${name} braces are unbalanced`);
}

test('R-15-05: remapCollapsedBodyLinesAfterDelete drops deleted range and shifts trailing indices', () => {
  assert.deepEqual(
    remapCollapsedBodyLinesAfterDelete(new Set([1, 3, 7]), 2, 3),
    new Set([1, 4])
  );
  assert.deepEqual(
    remapCollapsedBodyLinesAfterDelete(new Set([2, 3, 4]), 2, 3),
    new Set()
  );
  assert.equal(remapCollapsedBodyLinesAfterDelete(undefined, 2, 3), undefined);
});

test('Issue#40: remapCollapsedBodyLinesAfterInsert shifts entries at/after the insertion point', () => {
  assert.deepEqual(
    remapCollapsedBodyLinesAfterInsert(new Set([1, 3, 7]), 3, 2),
    new Set([1, 5, 9])
  );
  // Entries strictly before the insertion point are untouched.
  assert.deepEqual(
    remapCollapsedBodyLinesAfterInsert(new Set([0, 1, 2]), 5, 4),
    new Set([0, 1, 2])
  );
  assert.equal(remapCollapsedBodyLinesAfterInsert(undefined, 3, 2), undefined);
});

// ─── getBodyItems ───────────────────────────────────────────────────────────

test('getBodyItems parses unchecked, checked (x and X) checkboxes', () => {
  const body = '- [ ] a\n- [x] b\n- [X] c';
  const items = getBodyItems(body);
  assert.equal(items.length, 3);
  assert.deepEqual(
    items.map((i) => [i.type, i.checked, i.text, i.lineIdx, i.indent]),
    [
      ['checkbox', false, 'a', 0, 0],
      ['checkbox', true, 'b', 1, 0],
      ['checkbox', true, 'c', 2, 0],
    ]
  );
});

test('getBodyItems parses plain bullets', () => {
  const items = getBodyItems('- one\n- two');
  assert.deepEqual(
    items.map((i) => [i.type, i.text, i.checked]),
    [
      ['bullet', 'one', false],
      ['bullet', 'two', false],
    ]
  );
});

test('getBodyItems tracks indent and mixes checkbox/bullet', () => {
  const body = '- [ ] root\n  - child\n    - [x] grand';
  const items = getBodyItems(body);
  assert.deepEqual(
    items.map((i) => [i.indent, i.type, i.text]),
    [
      [0, 'checkbox', 'root'],
      [2, 'bullet', 'child'],
      [4, 'checkbox', 'grand'],
    ]
  );
});

test('getBodyItems skips blank and non-list lines but keeps lineIdx aligned', () => {
  const body = '- [ ] a\n\nplain paragraph\n- b';
  const items = getBodyItems(body);
  assert.equal(items.length, 2);
  assert.equal(items[0].lineIdx, 0);
  assert.equal(items[1].lineIdx, 3); // blank + paragraph consumed lines 1,2
});

test('getBodyItems on empty body yields no items', () => {
  assert.deepEqual(getBodyItems(''), []);
  assert.deepEqual(getBodyItems(undefined as unknown as string), []);
});

test('R-13-12: getBodyItems excludes list-like lines inside code fences', () => {
  const body = [
    '- before',
    '```ts',
    '- code in backtick fence',
    '~~~',
    '- [x] tilde does not close backtick fence',
    '```',
    '- between',
    '  ~~~ javascript',
    '- [ ] code in tilde fence',
    '```',
    '- backtick does not close tilde fence',
    '~~~',
    '- after',
  ].join('\n');

  assert.deepEqual(
    getBodyItems(body).map((item) => [item.lineIdx, item.type, item.text]),
    [
      [0, 'bullet', 'before'],
      [6, 'bullet', 'between'],
      [12, 'bullet', 'after'],
    ]
  );
});

test('R-13-12: lineIdx stays aligned for items after a code fence', () => {
  const body = '- before\n```\n- hidden\n```\nparagraph\n- [ ] after';
  const items = getBodyItems(body);

  assert.deepEqual(
    items.map((item) => [item.lineIdx, item.text]),
    [
      [0, 'before'],
      [5, 'after'],
    ]
  );
});

test('R-13-12: webview getBodyItems mirrors fence exclusion', () => {
  const webviewGetBodyItems = new Function(`
    const BODY_H = 42;
    ${extractWebviewFunction('getBodyItems')}
    return getBodyItems;
  `)() as (bodyText: string) => Array<{ lineIdx: number; type: string; text: string }>;
  const body = '- before\n```js\n- hidden\n```\n~~~\n- [x] hidden too\n~~~\n- [ ] after';
  const columns = (items: Array<{ lineIdx: number; type: string; text: string }>) =>
    items.map((item) => [item.lineIdx, item.type, item.text]);

  assert.deepEqual(columns(webviewGetBodyItems(body)), columns(getBodyItems(body)));
});

// ─── getBodyItemTree ────────────────────────────────────────────────────────

test('getBodyItemTree nests by indent across multiple levels', () => {
  const body = '- a\n  - b\n    - c';
  const tree = getBodyItemTree(body);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].text, 'a');
  assert.equal(tree[0].children[0].text, 'b');
  assert.equal(tree[0].children[0].children[0].text, 'c');
});

test('getBodyItemTree handles multiple siblings under one parent', () => {
  const body = '- a\n  - b1\n  - b2\n  - b3';
  const tree = getBodyItemTree(body);
  assert.equal(tree.length, 1);
  assert.deepEqual(
    tree[0].children.map((c) => c.text),
    ['b1', 'b2', 'b3']
  );
});

test('getBodyItemTree handles roots at top level', () => {
  const body = '- a\n- b\n  - b1\n- c';
  const tree = getBodyItemTree(body);
  assert.deepEqual(
    tree.map((r) => r.text),
    ['a', 'b', 'c']
  );
  assert.deepEqual(
    tree[1].children.map((c) => c.text),
    ['b1']
  );
});

test('getBodyItemTree: when indent jumps down it reattaches to nearest shallower ancestor', () => {
  // c is indent 2 again after a deep child at 4 → sibling of the indent-2 child
  const body = '- a\n  - b\n    - deep\n  - c';
  const tree = getBodyItemTree(body);
  assert.deepEqual(
    tree[0].children.map((c) => c.text),
    ['b', 'c']
  );
  assert.deepEqual(
    tree[0].children[0].children.map((c) => c.text),
    ['deep']
  );
});

test('getBodyItemTree: a deeper-than-expected first child still attaches to its parent', () => {
  // child jumps from indent 0 to indent 4 (skips 2) — still a child of root
  const body = '- a\n    - x';
  const tree = getBodyItemTree(body);
  assert.equal(tree.length, 1);
  assert.deepEqual(
    tree[0].children.map((c) => c.text),
    ['x']
  );
});

// ─── bodyItemLastLineIdx ────────────────────────────────────────────────────

test('bodyItemLastLineIdx returns own lineIdx for a leaf', () => {
  const tree = getBodyItemTree('- a');
  assert.equal(bodyItemLastLineIdx(tree[0]), 0);
});

test('bodyItemLastLineIdx returns the deepest/last descendant line', () => {
  const body = '- a\n  - b\n    - c\n  - d';
  const tree = getBodyItemTree(body);
  // last descendant of a is d at lineIdx 3
  assert.equal(bodyItemLastLineIdx(tree[0]), 3);
});

// ─── findBodyItemByLineIdx ──────────────────────────────────────────────────

test('findBodyItemByLineIdx finds nested items', () => {
  const body = '- a\n  - b\n    - c';
  const tree = getBodyItemTree(body);
  assert.equal(findBodyItemByLineIdx(tree, 2)?.text, 'c');
  assert.equal(findBodyItemByLineIdx(tree, 0)?.text, 'a');
});

test('findBodyItemByLineIdx returns null for missing lineIdx', () => {
  const tree = getBodyItemTree('- a\n- b');
  assert.equal(findBodyItemByLineIdx(tree, 99), null);
});

// ─── reformatBodyLines ──────────────────────────────────────────────────────

test('reformatBodyLines indent 0→2 preserves checkbox type (no auto bullet conversion)', () => {
  assert.deepEqual(reformatBodyLines(['- [ ] x'], 0, 2), ['  - [ ] x']);
  assert.deepEqual(reformatBodyLines(['- [x] done'], 0, 2), ['  - [x] done']);
});

test('reformatBodyLines indent 2→0 preserves bullet type (no auto checkbox conversion)', () => {
  assert.deepEqual(reformatBodyLines(['  - x'], 2, 0), ['- x']);
});

test('reformatBodyLines indent 2→0 preserves an existing checkbox state', () => {
  assert.deepEqual(reformatBodyLines(['  - [x] done'], 2, 0), ['- [x] done']);
  assert.deepEqual(reformatBodyLines(['  - [ ] todo'], 2, 0), ['- [ ] todo']);
});

test('reformatBodyLines keeps non-list lines untouched', () => {
  assert.deepEqual(reformatBodyLines(['plain', '- a'], 0, 2), [
    'plain',
    '  - a',
  ]);
});

test('reformatBodyLines clamps negative resulting indent to zero', () => {
  // moving a level-0 line further left stays at 0 and keeps its existing (bullet) marker
  assert.deepEqual(reformatBodyLines(['- a'], 2, 0), ['- a']);
});

// ─── 新規追加テスト ──────────────────────────────────────────────────────────

// R-13-10: reformatBodyLines は子項目も含めて相対的にインデントが増える（種別は維持）
test('reformatBodyLines indent 0→2 shifts both parent and child lines', () => {
  const lines = ['- [ ] parent', '  - child'];
  const result = reformatBodyLines(lines, 0, 2);
  assert.deepEqual(result, ['  - [ ] parent', '    - child']);
});

// R-13-01: getBodyItemTree は空文字列/空ボディで空配列を返す
test('getBodyItemTree returns empty array for empty string', () => {
  assert.deepEqual(getBodyItemTree(''), []);
});

// ─── 新規追加テスト 2 (v2.6.3) ───────────────────────────────────────────────

// AT-13-01 / R-13-01: getBodyItems はタブ混在/全角を含まないインデントでも
// 桁数をそのまま indent として保持する（不正な奇数インデントも壊さない）
test('getBodyItems records the raw indent width including odd/single-space indents', () => {
  const body = '- a\n - b\n   - c';
  const items = getBodyItems(body);
  assert.deepEqual(
    items.map((i) => i.indent),
    [0, 1, 3]
  );
});

// AT-13-01 / R-13-02: チェックボックス記法の前後に余分な空白がある行も
// テキスト部分のみを取り出す（プレフィックスの空白は text に混入しない）
test('getBodyItems trims the checkbox marker but keeps trailing text spaces intact', () => {
  const items = getBodyItems('- [x]   spaced text  ');
  assert.equal(items.length, 1);
  assert.equal(items[0].type, 'checkbox');
  assert.equal(items[0].checked, true);
  assert.equal(items[0].text, 'spaced text  ');
});

// AT-13-03 / R-13-04: "-" の直後にスペースが無い行（"-text"）はリスト項目として
// 扱わない（誤検出しない）
test('getBodyItems does not treat a dash without a following space as a list item', () => {
  assert.deepEqual(getBodyItems('-notalist\n--- hr'), []);
});

// AT-13-01: 空角括弧でないブラケット（- [] / - [a]）はチェックボックスではなく
// プレーン bullet として解釈される
test('getBodyItems treats an invalid checkbox bracket as a plain bullet', () => {
  const items = getBodyItems('- [] empty\n- [a] letter');
  assert.deepEqual(
    items.map((i) => [i.type, i.text]),
    [
      ['bullet', '[] empty'],
      ['bullet', '[a] letter'],
    ]
  );
});

// AT-13-01: getBodyItems は単一行（末尾改行なし）でも 1 項目を返す
test('getBodyItems parses a single line without a trailing newline', () => {
  const items = getBodyItems('- [ ] only');
  assert.equal(items.length, 1);
  assert.equal(items[0].lineIdx, 0);
});

// AT-15-01 / R-15-01: getBodyItemTree は同じインデント幅の連続項目を
// すべて兄弟として扱う（同一階層の平坦リスト）
test('getBodyItemTree keeps same-indent items as siblings (flat list, no nesting)', () => {
  const tree = getBodyItemTree('- a\n- b\n- c');
  assert.equal(tree.length, 3);
  assert.equal(tree[0].children.length, 0);
});

// AT-15-01 / R-15-01: インデントが一旦深くなった後、親より浅いインデントに戻ると
// より上位の祖先に再アタッチされる（複数レベルのポップ）
test('getBodyItemTree pops multiple levels when indent drops below several ancestors', () => {
  const body = '- a\n  - b\n    - c\n      - d\n- e';
  const tree = getBodyItemTree(body);
  // e は最浅インデントに戻るのでルート（a の兄弟）になる
  assert.deepEqual(
    tree.map((r) => r.text),
    ['a', 'e']
  );
  assert.equal(tree[0].children[0].children[0].children[0].text, 'd');
});

// AT-15-01: 最初の項目がインデント付き（孤児）でもツリーは破綻せず
// その項目がルートとして扱われる
test('getBodyItemTree treats a leading indented item as a root', () => {
  const tree = getBodyItemTree('    - orphan\n- realroot');
  assert.deepEqual(
    tree.map((r) => r.text),
    ['orphan', 'realroot']
  );
});

// AT-13-07 / R-13-09: bodyItemLastLineIdx は途中に浅い兄弟が挟まっても
// サブツリー全体の最終行を返す（兄弟挿入位置の算出）
test('bodyItemLastLineIdx returns the last line of a deep-then-shallow subtree', () => {
  // a の子孫は b(1), c(2) で終わり、d(3) は a の兄弟ではなく a の直下の兄弟扱い
  const body = '- a\n  - b\n    - c';
  const tree = getBodyItemTree(body);
  assert.equal(bodyItemLastLineIdx(tree[0]), 2);
});

// AT-13-05: findBodyItemByLineIdx は空ツリーで null を返す
test('findBodyItemByLineIdx returns null on an empty tree', () => {
  assert.equal(findBodyItemByLineIdx([], 0), null);
});

// AT-13-08 / R-13-10: reformatBodyLines は delta=0（移動なし）のとき
// indent>0 の bullet はそのまま、indent=0 はチェックボックス形式を維持する
test('reformatBodyLines with zero delta keeps lines in their level-appropriate form', () => {
  assert.deepEqual(reformatBodyLines(['  - child'], 2, 2), ['  - child']);
  assert.deepEqual(reformatBodyLines(['- [x] done'], 0, 0), ['- [x] done']);
});

// AT-13-08 / R-13-10: ネスト→ネスト（2→4）の移動では子もろとも相対インデントが
// 増え、どの行もチェックボックス化されない（すべて indent>0 のまま）
test('reformatBodyLines indent 2→4 shifts nested lines and keeps them as bullets', () => {
  const lines = ['  - parent', '    - child'];
  assert.deepEqual(reformatBodyLines(lines, 2, 4), ['    - parent', '      - child']);
});

// AT-13-08 / R-13-10: ネスト→トップ（4→0）移動でも各行の既存マーカー（種別）は
// 一切変換されず、インデントのみがシフトする
test('reformatBodyLines indent 4→0 shifts indentation without converting checkbox/bullet type', () => {
  const lines = ['    - [x] parent', '      - child'];
  // delta = -4: parent 4→0 (checkbox marker preserved), child 6→2 (bullet preserved)
  assert.deepEqual(reformatBodyLines(lines, 4, 0), ['- [x] parent', '  - child']);
});

// AT-13-08 / R-13-10: reformatBodyLines は空配列で空配列を返す
test('reformatBodyLines returns an empty array for empty input', () => {
  assert.deepEqual(reformatBodyLines([], 0, 2), []);
});

// AT-13-08: reformatBodyLines は大文字 [X] のチェック状態も保持して
// チェックボックス形式に戻す
test('reformatBodyLines preserves an uppercase [X] checkbox state when moving to top level', () => {
  assert.deepEqual(reformatBodyLines(['  - [X] done'], 2, 0), ['- [X] done']);
});

// ─── toggleBodyItemType ─────────────────────────────────────────────────────

// R-13-16: checkbox → bullet はマーカーを除去し、インデントはそのまま保持する
test('toggleBodyItemType converts a checkbox item to a bullet, preserving indent', () => {
  assert.equal(toggleBodyItemType('- [ ] a', 0, 'bullet'), '- a');
  assert.equal(toggleBodyItemType('  - [x] nested', 0, 'bullet'), '  - nested');
});

// R-13-16: bullet → checkbox は常に未チェック状態で `- [ ] ` を付与する
test('toggleBodyItemType converts a bullet item to a checkbox, always starting unchecked', () => {
  assert.equal(toggleBodyItemType('- a', 0, 'checkbox'), '- [ ] a');
  assert.equal(toggleBodyItemType('  - nested', 0, 'checkbox'), '  - [ ] nested');
});

// R-13-16: 既にチェック済みの項目を checkbox へ再変換すると未チェックにリセットされる
test('toggleBodyItemType resets an already-checked item to unchecked when re-targeted to checkbox', () => {
  assert.equal(toggleBodyItemType('- [x] done', 0, 'checkbox'), '- [ ] done');
  assert.equal(toggleBodyItemType('- [X] done', 0, 'checkbox'), '- [ ] done');
});

test('toggleBodyItemType returns the original bodyText for an out-of-range lineIdx', () => {
  const body = '- a\n- b';
  assert.equal(toggleBodyItemType(body, 5, 'checkbox'), body);
  assert.equal(toggleBodyItemType(body, -1, 'bullet'), body);
});

test('toggleBodyItemType returns the original bodyText when the targeted line is not a list item', () => {
  const body = '- a\nplain paragraph\n- b';
  assert.equal(toggleBodyItemType(body, 1, 'checkbox'), body);
});

// ─── bodyItemTreeToLines ────────────────────────────────────────────────────

test('bodyItemTreeToLines serializes a flat list (no nesting) at depth=0', () => {
  const items: BodyItem[] = [
    { lineIdx: 0, type: 'bullet', checked: false, text: 'a', indent: 0, children: [] },
    { lineIdx: 1, type: 'checkbox', checked: true, text: 'b', indent: 0, children: [] },
  ];
  assert.deepEqual(bodyItemTreeToLines(items), ['- a', '- [x] b']);
});

test('bodyItemTreeToLines serializes a nested tree with mixed checkbox/bullet items using 2-space indents', () => {
  const items: BodyItem[] = [
    {
      lineIdx: 0,
      type: 'checkbox',
      checked: false,
      text: 'parent',
      indent: 0,
      children: [
        { lineIdx: 1, type: 'bullet', checked: false, text: 'child', indent: 2, children: [] },
        {
          lineIdx: 2,
          type: 'checkbox',
          checked: true,
          text: 'grandparent-sibling',
          indent: 2,
          children: [
            { lineIdx: 3, type: 'bullet', checked: false, text: 'grandchild', indent: 4, children: [] },
          ],
        },
      ],
    },
  ];
  assert.deepEqual(bodyItemTreeToLines(items), [
    '- [ ] parent',
    '  - child',
    '  - [x] grandparent-sibling',
    '    - grandchild',
  ]);
});

test('bodyItemTreeToLines returns an empty array for an empty tree', () => {
  assert.deepEqual(bodyItemTreeToLines([]), []);
});

test('bodyItemTreeToLines offsets the leading indent when depth is 1 or more', () => {
  const items: BodyItem[] = [
    { lineIdx: 0, type: 'bullet', checked: false, text: 'a', indent: 0, children: [] },
  ];
  assert.deepEqual(bodyItemTreeToLines(items, 1), ['  - a']);
  assert.deepEqual(bodyItemTreeToLines(items, 2), ['    - a']);
});

// ─── findBodyItemSiblings / moveBodyItemLines / remapCollapsedBodyLinesAfterMove ─

test('findBodyItemSiblings locates top-level and nested sibling arrays', () => {
  const body = '- a\n- b\n  - b1\n  - b2\n- c';
  const tree = getBodyItemTree(body);
  const top = findBodyItemSiblings(tree, 4); // c
  assert.ok(top);
  assert.equal(top!.siblings.length, 3);
  assert.equal(top!.index, 2);
  const nested = findBodyItemSiblings(tree, 3); // b2
  assert.ok(nested);
  assert.equal(nested!.siblings.length, 2);
  assert.equal(nested!.index, 1);
  assert.equal(findBodyItemSiblings(tree, 99), null);
});

test('moveBodyItemLines swaps adjacent top-level siblings (up and down)', () => {
  const body = '- a\n- b\n- c';
  const down = moveBodyItemLines(body, 0, 1); // move a down
  assert.deepEqual(down, { body: '- b\n- a\n- c', newLineIdx: 1 });
  const up = moveBodyItemLines(body, 2, -1); // move c up
  assert.deepEqual(up, { body: '- a\n- c\n- b', newLineIdx: 1 });
});

test('moveBodyItemLines returns null at sibling boundaries', () => {
  const body = '- a\n- b\n- c';
  assert.equal(moveBodyItemLines(body, 0, -1), null); // a already first
  assert.equal(moveBodyItemLines(body, 2, 1), null);  // c already last
});

test('moveBodyItemLines moves an item together with its nested children block', () => {
  const body = '- a\n- b\n  - b1\n  - b2\n- c';
  // move b (with b1,b2) down past c
  const res = moveBodyItemLines(body, 1, 1);
  assert.deepEqual(res, { body: '- a\n- c\n- b\n  - b1\n  - b2', newLineIdx: 2 });
  // moved item b now starts at line 2, its children intact
  const tree = getBodyItemTree(res!.body);
  const b = findBodyItemByLineIdx(tree, 2);
  assert.ok(b);
  assert.equal(b!.text, 'b');
  assert.equal(b!.children.length, 2);
});

test('moveBodyItemLines only reorders among same-indent siblings (nested)', () => {
  const body = '- p\n  - x\n  - y';
  const res = moveBodyItemLines(body, 2, -1); // move y above x
  assert.deepEqual(res, { body: '- p\n  - y\n  - x', newLineIdx: 1 });
});

test('moveBodyItemLines preserves indentation and markers verbatim', () => {
  const body = '  - [x] a\n  - b';
  const res = moveBodyItemLines(body, 0, 1);
  assert.deepEqual(res, { body: '  - b\n  - [x] a', newLineIdx: 1 });
});

test('remapCollapsedBodyLinesAfterMove shifts a-block down and b-block up', () => {
  // a-block: lines 1-2 (len 2), b-block: line 3 (len 1); b immediately follows a
  const remapped = remapCollapsedBodyLinesAfterMove(
    new Set([0, 1, 3]), 1, 2, 2, 3, 3, 1
  );
  // 0 unchanged; 1 (a-block) -> 1+1=2; 3 (b-block) -> 3-2=1
  assert.deepEqual(remapped, new Set([0, 2, 1]));
  assert.equal(remapCollapsedBodyLinesAfterMove(undefined, 1, 2, 2, 3, 3, 1), undefined);
});

// ─── webview/src mirror parity ───────────────────────────────────────────────

test('media/mindmap.js moveBodyItem mirrors the pure logic and persists', () => {
  const fn = extractWebviewFunction('moveBodyItem');
  assert.ok(fn.includes('moveBodyItemLines('), 'should delegate line math to moveBodyItemLines');
  assert.ok(fn.includes('remapCollapsedBodyLinesAfterMove('), 'should remap collapse state');
  assert.ok(fn.includes('postStructuralEdit()'), 'should persist via structuralEdit');
});

test('media/mindmap.js body-item context menu exposes move up/down actions', () => {
  const fn = extractWebviewFunction('showBodyItemContextMenu');
  assert.ok(fn.includes("action: 'body-move-up'"), 'menu should include body-move-up');
  assert.ok(fn.includes("action: 'body-move-down'"), 'menu should include body-move-down');
});

test('media/mindmap.js handleContextAction handles body move actions', () => {
  const fn = extractWebviewFunction('handleContextAction');
  assert.ok(fn.includes("case 'body-move-up'"), 'handler should have body-move-up case');
  assert.ok(fn.includes("case 'body-move-down'"), 'handler should have body-move-down case');
});
