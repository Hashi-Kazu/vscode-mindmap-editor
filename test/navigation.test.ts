import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createBodyItemSelectionLocator,
  getHorizontalIntent,
  resolveBodyItemSelection,
} from '../src/navigation';

interface TestNode {
  id: string;
  text: string;
  level: number;
  body: string;
  children: TestNode[];
}

function node(
  id: string,
  text: string,
  level: number,
  body = '',
  children: TestNode[] = []
): TestNode {
  return { id, text, level, body, children };
}

// R-12-02 / R-12-03 / R-12-11: horizontal keys follow screen direction.
test('getHorizontalIntent maps right branches to right=child and left=parent', () => {
  assert.equal(getHorizontalIntent('right', 'ArrowRight'), 'child');
  assert.equal(getHorizontalIntent('right', 'ArrowLeft'), 'parent');
});

test('getHorizontalIntent maps left branches to left=child and right=parent', () => {
  assert.equal(getHorizontalIntent('left', 'ArrowLeft'), 'child');
  assert.equal(getHorizontalIntent('left', 'ArrowRight'), 'parent');
});

// R-12-11: a parser update may renumber both heading IDs and body line indexes.
test('body selection rebinds by unique heading/item ancestry after IDs and line indexes change', () => {
  const before = node('n1', 'Doc', 0, '', [
    node('n2', 'Topic', 1, '- [ ] first\n  - selected', []),
  ]);
  const locator = createBodyItemSelectionLocator(before, 'n2', 1);
  assert.ok(locator);

  const after = node('n9', 'Doc', 0, '', [
    node('n10', 'Topic', 1, 'paragraph\n- [ ] first\n  - selected', []),
  ]);
  const resolved = resolveBodyItemSelection(after, locator);

  assert.equal(resolved?.parentNode.id, 'n10');
  assert.equal(resolved?.item.lineIdx, 2);
  assert.equal(resolved?.item.text, 'selected');
});

test('body selection is not rebound when duplicate heading ancestry is ambiguous', () => {
  const before = node('n1', 'Doc', 0, '', [
    node('n2', 'Topic', 1, '- [ ] selected'),
  ]);
  const locator = createBodyItemSelectionLocator(before, 'n2', 0);
  assert.ok(locator);

  const after = node('n10', 'Doc', 0, '', [
    node('n11', 'Topic', 1, '- [ ] selected'),
    node('n12', 'Topic', 1, '- [ ] selected'),
  ]);
  assert.equal(resolveBodyItemSelection(after, locator), null);
});

test('body selection is not rebound when duplicate item ancestry is ambiguous', () => {
  const before = node('n1', 'Doc', 0, '', [
    node('n2', 'Topic', 1, '- [ ] selected'),
  ]);
  const locator = createBodyItemSelectionLocator(before, 'n2', 0);
  assert.ok(locator);

  const after = node('n10', 'Doc', 0, '', [
    node('n11', 'Topic', 1, '- [ ] selected\n- [ ] selected'),
  ]);
  assert.equal(resolveBodyItemSelection(after, locator), null);
});

test('body selection is not rebound when the selected item no longer exists', () => {
  const before = node('n1', 'Doc', 0, '', [
    node('n2', 'Topic', 1, '- [ ] selected'),
  ]);
  const locator = createBodyItemSelectionLocator(before, 'n2', 0);
  assert.ok(locator);

  const after = node('n10', 'Doc', 0, '', [
    node('n11', 'Topic', 1, '- [ ] replacement'),
  ]);
  assert.equal(resolveBodyItemSelection(after, locator), null);
});
