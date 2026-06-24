import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getBodyItems,
  getBodyItemTree,
  bodyItemLastLineIdx,
  findBodyItemByLineIdx,
  findBodyItemParentByLineIdx,
  getBodyItemSiblingsByLineIdx,
  reformatBodyLines,
  normalizeBodyCheckboxes,
  normalizeTreeCheckboxes,
} from '../src/bodyItems';

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

test('findBodyItemParentByLineIdx returns the direct parent for a nested item', () => {
  const tree = getBodyItemTree('- a\n  - b\n    - c\n  - d');
  assert.equal(findBodyItemParentByLineIdx(tree, 2)?.text, 'b');
  assert.equal(findBodyItemParentByLineIdx(tree, 1)?.text, 'a');
  assert.equal(findBodyItemParentByLineIdx(tree, 0), null);
});

// AT-12-10 / R-12-11: 本文項目の上下移動は同じ直接親の可視兄弟だけを対象にする
test('getBodyItemSiblingsByLineIdx returns only direct siblings for nested items', () => {
  const tree = getBodyItemTree('- a\n  - b\n    - c\n  - d\n- e');
  assert.deepEqual(
    getBodyItemSiblingsByLineIdx(tree, 2).map((item) => item.text),
    ['c']
  );
  assert.deepEqual(
    getBodyItemSiblingsByLineIdx(tree, 1).map((item) => item.text),
    ['b', 'd']
  );
  assert.deepEqual(
    getBodyItemSiblingsByLineIdx(tree, 4).map((item) => item.text),
    ['a', 'e']
  );
});

// ─── reformatBodyLines ──────────────────────────────────────────────────────

test('reformatBodyLines indent 0→2 converts checkbox to bullet', () => {
  assert.deepEqual(reformatBodyLines(['- [ ] x'], 0, 2), ['  - x']);
  assert.deepEqual(reformatBodyLines(['- [x] done'], 0, 2), ['  - done']);
});

test('reformatBodyLines indent 2→0 converts bullet to checkbox', () => {
  assert.deepEqual(reformatBodyLines(['  - x'], 2, 0), ['- [ ] x']);
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
  // moving a level-0 line further left stays at 0 (and becomes a checkbox)
  assert.deepEqual(reformatBodyLines(['- a'], 2, 0), ['- [ ] a']);
});

// ─── normalizeBodyCheckboxes ────────────────────────────────────────────────

test('normalizeBodyCheckboxes converts top-level plain bullets to empty checkboxes', () => {
  assert.equal(normalizeBodyCheckboxes('- a\n- b'), '- [ ] a\n- [ ] b');
});

test('normalizeBodyCheckboxes leaves existing checkboxes untouched (state preserved)', () => {
  const body = '- [ ] a\n- [x] b\n- [X] c';
  assert.equal(normalizeBodyCheckboxes(body), body);
});

test('normalizeBodyCheckboxes does not touch nested (indent>0) bullets', () => {
  const body = '- a\n  - child\n    - grand';
  assert.equal(normalizeBodyCheckboxes(body), '- [ ] a\n  - child\n    - grand');
});

test('normalizeBodyCheckboxes leaves prose and blank lines untouched', () => {
  const body = 'plain paragraph\n\nanother line';
  assert.equal(normalizeBodyCheckboxes(body), body);
});

test('normalizeBodyCheckboxes returns the original string when nothing changes', () => {
  const body = '- [ ] already';
  assert.equal(normalizeBodyCheckboxes(body), body);
});

test('normalizeBodyCheckboxes handles empty/undefined bodies', () => {
  assert.equal(normalizeBodyCheckboxes(''), '');
  assert.equal(normalizeBodyCheckboxes(undefined as unknown as string), undefined);
});

test('normalizeBodyCheckboxes does not touch list-like lines inside fenced code blocks', () => {
  const body = '- a\n```\n- not a real item\n```\n- b';
  assert.equal(
    normalizeBodyCheckboxes(body),
    '- [ ] a\n```\n- not a real item\n```\n- [ ] b'
  );
});

test('normalizeBodyCheckboxes handles a tilde fence', () => {
  const body = '~~~\n- code\n~~~\n- real';
  assert.equal(normalizeBodyCheckboxes(body), '~~~\n- code\n~~~\n- [ ] real');
});

// ─── normalizeTreeCheckboxes ────────────────────────────────────────────────

test('normalizeTreeCheckboxes mutates bodies recursively and reports change', () => {
  const tree = {
    body: '- a',
    children: [
      { body: '- b', children: [] as unknown[] },
      { body: '- [x] done', children: [] as unknown[] },
    ],
  };
  const changed = normalizeTreeCheckboxes(tree);
  assert.equal(changed, true);
  assert.equal(tree.body, '- [ ] a');
  assert.equal((tree.children[0] as { body: string }).body, '- [ ] b');
  assert.equal((tree.children[1] as { body: string }).body, '- [x] done');
});

test('normalizeTreeCheckboxes returns false when nothing needs migrating', () => {
  const tree = {
    body: '- [ ] a',
    children: [{ body: 'plain', children: [] as unknown[] }],
  };
  assert.equal(normalizeTreeCheckboxes(tree), false);
});

// ─── 新規追加テスト ──────────────────────────────────────────────────────────

// R-13-10: reformatBodyLines は子項目も含めて相対的にインデントが増える
test('reformatBodyLines indent 0→2 shifts both parent and child lines', () => {
  const lines = ['- [ ] parent', '  - child'];
  const result = reformatBodyLines(lines, 0, 2);
  assert.deepEqual(result, ['  - parent', '    - child']);
});

// R-13-12: normalizeBodyCheckboxes は既にすべてチェックボックスの場合は同一参照を返す
test('normalizeBodyCheckboxes returns the same string reference when all items are already checkboxes', () => {
  const body = '- [ ] a\n- [x] b';
  const result = normalizeBodyCheckboxes(body);
  assert.equal(result === body, true);
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

// AT-13-08 / R-13-10: ネスト→トップ（4→0）移動で、深い子は indent>0 のまま
// bullet を維持しつつ、トップに来た行のみチェックボックス化される
test('reformatBodyLines indent 4→0 checkbox-ifies only the lines that reach indent 0', () => {
  const lines = ['    - [x] parent', '      - child'];
  // delta = -4: parent 4→0 (checkbox, state kept), child 6→2 (bullet)
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

// AT-13-11 / R-13-11: normalizeBodyCheckboxes はインデント付きの本文行
// （indent>0）を一切変換しない（先頭が "- " で始まる行のみ対象）
test('normalizeBodyCheckboxes ignores indented bullets even at the top of the body', () => {
  const body = '  - nested only';
  assert.equal(normalizeBodyCheckboxes(body), body);
});

// AT-13-12 / R-13-11: 段落・空行・ネスト bullet のみで変換対象が無い本文は
// 同一参照を返し書き込みを発生させない
test('normalizeBodyCheckboxes returns the same reference when only prose/nested lines exist', () => {
  const body = 'paragraph\n\n  - nested\ntext';
  assert.equal(normalizeBodyCheckboxes(body) === body, true);
});

// AT-13-11: 閉じられていないコードフェンス内のリスト行は変換されない
// （フェンスが閉じない限りドキュメント末尾まで保護される）
test('normalizeBodyCheckboxes leaves list lines inside an unclosed fence untouched', () => {
  const body = '- real\n```\n- still code\n- more code';
  assert.equal(
    normalizeBodyCheckboxes(body),
    '- [ ] real\n```\n- still code\n- more code'
  );
});

// AT-13-11: 同種フェンス（```）の開閉後、フェンス外の行は再び変換対象になる
test('normalizeBodyCheckboxes resumes conversion after a closed fence', () => {
  const body = '```\n- code\n```\n- after';
  assert.equal(normalizeBodyCheckboxes(body), '```\n- code\n```\n- [ ] after');
});

// AT-13-12 / R-13-11: normalizeTreeCheckboxes は深いネスト（孫）まで再帰し、
// 変換が一切無ければ false を返す
test('normalizeTreeCheckboxes recurses into grandchildren and reports no change when all are checkboxes', () => {
  const tree = {
    body: '- [ ] a',
    children: [
      {
        body: '- [x] b',
        children: [{ body: '- [ ] c', children: [] as unknown[] }],
      },
    ],
  };
  assert.equal(normalizeTreeCheckboxes(tree), false);
});

// AT-13-11: normalizeTreeCheckboxes は孫ノードのみ変換が必要な場合でも
// true を返し、その孫だけを変換する
test('normalizeTreeCheckboxes reports change when only a deeply nested body needs migrating', () => {
  const grand = { body: '- needs', children: [] as unknown[] };
  const tree = {
    body: '- [ ] a',
    children: [{ body: '- [x] b', children: [grand] }],
  };
  assert.equal(normalizeTreeCheckboxes(tree), true);
  assert.equal(grand.body, '- [ ] needs');
});
