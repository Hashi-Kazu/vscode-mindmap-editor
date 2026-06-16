import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getBodyItems,
  getBodyItemTree,
  bodyItemLastLineIdx,
  findBodyItemByLineIdx,
  reformatBodyLines,
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
