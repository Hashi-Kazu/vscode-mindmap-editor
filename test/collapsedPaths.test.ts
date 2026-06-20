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

// ─── 新規追加テスト 2 (v2.6.3) ───────────────────────────────────────────────

// AT-06-02 / R-06-02: 折りたたまれた親とその折りたたまれた子の両方が
// extractCollapsedPaths に含まれる（深さ優先順で親が先）
test('extractCollapsedPaths includes both a collapsed parent and a collapsed descendant in DFS order', () => {
  const c = node('C', 3, [node('D', 4)]);
  const b = node('B', 2, [c]);
  const a = node('A', 1, [b]);
  const root = node('Root', 0, [a]);

  a.collapsed = true;
  c.collapsed = true;

  assert.deepEqual(extractCollapsedPaths(root), ['Root/A', 'Root/A/B/C']);
});

// AT-06-02: ルートノード自身が collapsed でも、ルートはパスの起点なので
// "Root" 単体のパスとして抽出される（子を持つため対象になる）
test('extractCollapsedPaths includes the root path when the root itself is collapsed', () => {
  const a = node('A', 1);
  const root = node('Root', 0, [a]);
  root.collapsed = true;
  assert.deepEqual(extractCollapsedPaths(root), ['Root']);
});

// AT-06-03 / R-06-04: applyCollapsedPaths は存在しないパスを無視し、
// 一致するノードのみ折りたたむ（誤爆しない）
test('applyCollapsedPaths ignores non-matching paths and only collapses exact matches', () => {
  const b = node('B', 2);
  const a = node('A', 1, [b]);
  const root = node('Root', 0, [a]);

  applyCollapsedPaths(root, ['Root/A', 'Root/Nonexistent', 'A'], '');
  assert.equal(a.collapsed, true);
  assert.equal(b.collapsed, false); // "B" 単体パスでは一致しない
  assert.equal(root.collapsed, false);
});

// AT-06-03: 同名の兄弟ノードでも、フルパスが異なれば独立して制御される
test('applyCollapsedPaths distinguishes same-named nodes by their full path', () => {
  const dupA = node('Dup', 2);
  const dupB = node('Dup', 2);
  const a = node('A', 1, [dupA]);
  const b = node('B', 1, [dupB]);
  const root = node('Root', 0, [a, b]);

  applyCollapsedPaths(root, ['Root/A/Dup'], '');
  assert.equal(dupA.collapsed, true);
  assert.equal(dupB.collapsed, false);
});

// AT-06-02: apply→extract のラウンドトリップが複数の折りたたみパスで安定する
test('apply then extract round-trips multiple collapse paths', () => {
  // extractCollapsedPaths only emits paths for nodes that have children
  // (collapsing a leaf is meaningless), so every node in `paths` must be a
  // parent. Here A→B and D/E→F give both collapse targets a child.
  const input = ['# A', '## B', '### C', '# D', '## E', '### F', ''].join('\n');
  const parsed = parseMarkdown(input, FILE);
  const paths = ['Doc/A', 'Doc/D/E'].sort();

  applyCollapsedPaths(parsed.root, paths, '');
  assert.deepEqual(extractCollapsedPaths(parsed.root).sort(), paths);
});

// AT-06-02 / R-06-02: フロントマターに mindmap-collapse と body-item-collapse が
// 両方あっても見出し collapse パスのみが parseMarkdown で適用される
test('parseMarkdown applies heading collapse independently of a body-item-collapse block', () => {
  const input = [
    '---',
    'mindmap-collapse:',
    '  - "A"',
    'body-item-collapse:',
    '  - "A::item"',
    '---',
    '',
    '# A',
    '- item',
    '## B',
    '',
  ].join('\n');

  const parsed = parseMarkdown(input, FILE);
  const a = parsed.root.children[0];
  assert.equal(a.text, 'A');
  assert.equal(a.collapsed, true);
  assert.deepEqual(parsed.bodyItemCollapsePaths, ['Doc/A::item']);
});

// AT-06-02: フロントマターが空（mindmap-collapse キーなし）の場合は
// 折りたたみパスが抽出されず、どのノードも展開状態
test('parseMarkdown with frontmatter but no collapse keys leaves all nodes expanded', () => {
  const input = ['---', 'title: T', '---', '', '# A', '## B', ''].join('\n');
  const parsed = parseMarkdown(input, FILE);
  assert.equal(parsed.root.children[0].collapsed, false);
  assert.deepEqual(extractCollapsedPaths(parsed.root), []);
});
