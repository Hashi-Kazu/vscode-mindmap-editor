import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, extractCollapsedPaths, applyCollapsedPaths } from '../src/markdownParser';
import { MindMapNode } from '../src/types';

const FILE = '/tmp/Doc.md';

function node(text: string, level: number, children: MindMapNode[] = []): MindMapNode {
  return { id: text, text, level, children, collapsed: false, body: '' };
}

test('extractCollapsedPaths returns full slash paths for collapsed nodes with children', () => {
  const c = node('C', 3);
  const b = node('B', 2, [c]);
  const a = node('A', 1, [b]);
  const root = node('Root', 0, [a]);

  b.collapsed = true;
  assert.deepEqual(extractCollapsedPaths(root), ['Root/A/B']);
});

test('extractCollapsedPaths ignores collapsed leaf nodes (no children)', () => {
  const c = node('C', 3);
  const a = node('A', 1, [c]);
  const root = node('Root', 0, [a]);

  c.collapsed = true; // leaf -> excluded
  assert.deepEqual(extractCollapsedPaths(root), []);
});

test('extractCollapsedPaths handles multiple collapsed nodes', () => {
  const c = node('C', 3, [node('D', 4)]);
  const b = node('B', 2, [c]);
  const a = node('A', 1, [b]);
  const root = node('Root', 0, [a]);

  a.collapsed = true;
  c.collapsed = true;
  assert.deepEqual(extractCollapsedPaths(root), ['Root/A', 'Root/A/B/C']);
});

test('applyCollapsedPaths sets collapsed flag by matching full path', () => {
  const c = node('C', 3);
  const b = node('B', 2, [c]);
  const a = node('A', 1, [b]);
  const root = node('Root', 0, [a]);

  applyCollapsedPaths(root, ['Root/A/B'], '');
  assert.equal(b.collapsed, true);
  assert.equal(a.collapsed, false);
  assert.equal(root.collapsed, false);
  assert.equal(c.collapsed, false);
});

test('applyCollapsedPaths clears collapsed when path not present', () => {
  const a = node('A', 1);
  const root = node('Root', 0, [a]);
  a.collapsed = true;

  applyCollapsedPaths(root, [], '');
  assert.equal(a.collapsed, false);
});

test('apply then extract is a round-trip for collapse state', () => {
  const input = ['# A', '## B', '### C', ''].join('\n');
  const parsed = parseMarkdown(input, FILE);
  const paths = ['Doc/A/B'];

  applyCollapsedPaths(parsed.root, paths, '');
  assert.deepEqual(extractCollapsedPaths(parsed.root), paths);
});

test('parse re-adds the filename prefix to a relative (new-format) collapse path', () => {
  // On disk: relative path "A/B". The parser re-adds the filename prefix so the
  // in-memory tree (and webview) keep using filename-prefixed paths.
  const input = [
    '---',
    'mindmap-collapse:',
    '  - "A/B"',
    '---',
    '',
    '# A',
    '## B',
    '### C',
    '',
  ].join('\n');

  const parsed = parseMarkdown(input, FILE);
  assert.equal(parsed.root.children[0].children[0].collapsed, true);
  assert.deepEqual(extractCollapsedPaths(parsed.root), ['Doc/A/B']);
});

test('parse keeps an old filename-prefixed collapse path (backward compat)', () => {
  const input = [
    '---',
    'mindmap-collapse:',
    '  - "Doc/A/B"',
    '---',
    '',
    '# A',
    '## B',
    '### C',
    '',
  ].join('\n');

  const parsed = parseMarkdown(input, FILE);
  assert.equal(parsed.root.children[0].children[0].collapsed, true);
});

test('relative collapse path resolves under a different filename (rename safety)', () => {
  const input = [
    '---',
    'mindmap-collapse:',
    '  - "A/B"',
    '---',
    '',
    '# A',
    '## B',
    '### C',
    '',
  ].join('\n');

  const parsed = parseMarkdown(input, '/tmp/Renamed.md');
  assert.equal(parsed.root.children[0].children[0].collapsed, true);
  assert.deepEqual(extractCollapsedPaths(parsed.root), ['Renamed/A/B']);
});

// ─── 新規追加テスト ──────────────────────────────────────────────────────────

// R-06-01: 折りたたんでいないノードのパスは extractCollapsedPaths に含まれない
test('extractCollapsedPaths returns empty array when all nodes are not collapsed', () => {
  const d = node('D', 4);
  const c = node('C', 3, [d]);
  const b = node('B', 2, [c]);
  const a = node('A', 1, [b]);
  const root = node('Root', 0, [a]);

  // すべて collapsed=false (デフォルト)
  assert.deepEqual(extractCollapsedPaths(root), []);
});

// R-06-03: 複数の兄弟ノードが同時に折りたたまれる
test('extractCollapsedPaths includes paths for multiple collapsed siblings', () => {
  const a1child = node('A1child', 2);
  const a2child = node('A2child', 2);
  const a1 = node('A1', 1, [a1child]);
  const a2 = node('A2', 1, [a2child]);
  const root = node('Root', 0, [a1, a2]);

  a1.collapsed = true;
  a2.collapsed = true;

  const paths = extractCollapsedPaths(root);
  assert.ok(paths.includes('Root/A1'));
  assert.ok(paths.includes('Root/A2'));
  assert.equal(paths.length, 2);
});
