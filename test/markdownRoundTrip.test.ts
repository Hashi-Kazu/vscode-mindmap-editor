import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, extractCollapsedPaths, extractLeftPaths } from '../src/markdownParser';
import { serializeToMarkdown } from '../src/markdownSerializer';

const FILE = '/tmp/Doc.md';

// Run input -> parse -> serialize and return the serialized output.
function roundTrip(input: string): string {
  const parsed = parseMarkdown(input, FILE);
  const collapsedPaths = extractCollapsedPaths(parsed.root);
  const leftPaths = extractLeftPaths(parsed.root);
  return serializeToMarkdown(
    parsed.root,
    parsed.frontmatter,
    parsed.preamble,
    collapsedPaths,
    parsed.bodyItemCollapsePaths,
    leftPaths
  );
}

// A round-trip is "stable" when a second pass produces identical output.
// This is the meaningful semantic-equality check, since the first pass may
// normalize whitespace/newlines but the structure must then be a fixed point.
function assertStable(input: string): string {
  const once = roundTrip(input);
  const twice = roundTrip(once);
  assert.equal(twice, once, 'round-trip is not idempotent');
  return once;
}

test('basic heading hierarchy with body', () => {
  const input = [
    '# Top',
    'top body',
    '',
    '## Child',
    'child body',
    '',
    '### Grandchild',
    'gc body',
    '',
  ].join('\n');

  const out = assertStable(input);
  assert.equal(
    out,
    [
      '# Top',
      'top body',
      '## Child',
      'child body',
      '### Grandchild',
      'gc body',
      '',
    ].join('\n')
  );
});

test('heading level skip (# directly to ###) is preserved', () => {
  const input = ['# Top', '### Deep', 'deep body', ''].join('\n');
  const out = assertStable(input);
  assert.equal(out, ['# Top', '### Deep', 'deep body', ''].join('\n'));

  // Structurally Deep is nested under Top despite the level skip.
  const parsed = parseMarkdown(input, FILE);
  assert.equal(parsed.root.children.length, 1);
  assert.equal(parsed.root.children[0].text, 'Top');
  assert.equal(parsed.root.children[0].children.length, 1);
  assert.equal(parsed.root.children[0].children[0].text, 'Deep');
  assert.equal(parsed.root.children[0].children[0].level, 3);
});

test('no frontmatter input stays without frontmatter', () => {
  const input = ['# A', 'body', ''].join('\n');
  const out = assertStable(input);
  assert.ok(!out.startsWith('---'));
});

test('existing frontmatter with title is preserved', () => {
  const input = [
    '---',
    'title: My Doc',
    '---',
    '',
    '# A',
    'body',
    '',
  ].join('\n');
  const out = assertStable(input);
  assert.ok(out.includes('title: My Doc'));
  assert.ok(out.startsWith('---\ntitle: My Doc\n---'));
});

test('mindmap-collapse (old filename-prefixed format) is honored for backward compat', () => {
  // Old files store paths rooted at the filename (root node text = "Doc").
  // These must still resolve so existing files keep their collapse state.
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
  const b = parsed.root.children[0].children[0];
  assert.equal(b.text, 'B');
  assert.equal(b.collapsed, true);

  // On save the path migrates to the relative (filename-stripped) format.
  const out = assertStable(input);
  assert.ok(out.includes('mindmap-collapse:'));
  assert.ok(out.includes('- "A/B"'));
  assert.ok(!out.includes('Doc/A/B'));
});

test('mindmap-collapse (new relative format) round-trips and stays collapsed', () => {
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

  const out = assertStable(input);
  assert.ok(out.includes('mindmap-collapse:'));
  assert.ok(out.includes('- "A/B"'));
});

test('collapse state survives a file rename (relative paths are filename-independent)', () => {
  // Saved with the new relative format, then re-opened under a different
  // filename (rename). The collapse state must be preserved.
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

  const renamed = parseMarkdown(input, '/tmp/Renamed.md');
  const b = renamed.root.children[0].children[0];
  assert.equal(b.text, 'B');
  assert.equal(b.collapsed, true);

  // Re-serializing under the new name keeps the relative path intact.
  const out = serializeToMarkdown(
    renamed.root,
    renamed.frontmatter,
    renamed.preamble,
    extractCollapsedPaths(renamed.root),
    renamed.bodyItemCollapsePaths
  );
  assert.ok(out.includes('- "A/B"'));
  assert.ok(!out.includes('Renamed/'));
});

test('body-item-collapse (new relative format) round-trips with the heading prefix re-added', () => {
  // Stored relative to the root; the parser re-adds the filename prefix so the
  // webview's findNodeByHeadingPath (which expects the prefix) still resolves.
  const input = [
    '---',
    'body-item-collapse:',
    '  - "A::item"',
    '---',
    '',
    '# A',
    '- item',
    '',
  ].join('\n');

  const parsed = parseMarkdown(input, FILE);
  assert.deepEqual(parsed.bodyItemCollapsePaths, ['Doc/A::item']);

  // On save the heading prefix is stripped back to the relative format.
  const out = assertStable(input);
  assert.ok(out.includes('body-item-collapse:'));
  assert.ok(out.includes('- "A::item"'));
  assert.ok(!out.includes('Doc/A::item'));
});

test('body-item-collapse (old filename-prefixed format) is honored for backward compat', () => {
  const input = [
    '---',
    'body-item-collapse:',
    '  - "Doc/A::item"',
    '---',
    '',
    '# A',
    '- item',
    '',
  ].join('\n');

  const parsed = parseMarkdown(input, FILE);
  // Already prefixed -> kept unchanged.
  assert.deepEqual(parsed.bodyItemCollapsePaths, ['Doc/A::item']);

  // Migrates to relative format on save.
  const out = assertStable(input);
  assert.ok(out.includes('- "A::item"'));
  assert.ok(!out.includes('Doc/A::item'));
});

test('title is kept alongside collapse blocks (only managed blocks swapped)', () => {
  const input = [
    '---',
    'title: Keep Me',
    'mindmap-collapse:',
    '  - "Doc/A/B"',
    '---',
    '',
    '# A',
    '## B',
    '### C',
    '',
  ].join('\n');

  const out = assertStable(input);
  assert.ok(out.includes('title: Keep Me'));
  assert.ok(out.includes('mindmap-collapse:'));
  // Migrated to the relative format on save.
  assert.ok(out.includes('- "A/B"'));
});

test('preamble before the first heading is preserved', () => {
  const input = [
    'intro paragraph',
    'second line',
    '',
    '# A',
    'body',
    '',
  ].join('\n');

  const parsed = parseMarkdown(input, FILE);
  // Preamble retains one trailing blank line from parsing.
  assert.equal(parsed.preamble, 'intro paragraph\nsecond line\n');

  // Single pass: preamble content is preserved ahead of the first heading.
  const out = assertStable(input);
  assert.ok(out.startsWith('intro paragraph\nsecond line'));
  assert.ok(out.includes('# A'));
  // Exactly one blank line separates the preamble from the first heading.
  assert.ok(out.startsWith('intro paragraph\nsecond line\n\n# A'));
});

test('preamble round-trip is idempotent (no growing blank-line gap)', () => {
  // The serializer trims trailing blank lines the parser retains, so the gap
  // before the first heading stays at exactly one blank line across passes.
  const input = ['intro', '', '# A', 'body', ''].join('\n');
  const once = roundTrip(input);
  const twice = roundTrip(once);
  assert.equal(twice, once);
  assert.equal(once, ['intro', '', '# A', 'body', ''].join('\n'));
});

test('multi-line preamble round-trip is idempotent', () => {
  const input = [
    'line one',
    'line two',
    '',
    '# A',
    'body',
    '',
  ].join('\n');
  const once = roundTrip(input);
  const twice = roundTrip(once);
  assert.equal(twice, once);
  assert.equal(once, ['line one', 'line two', '', '# A', 'body', ''].join('\n'));
});

test('CRLF newlines are normalized to LF', () => {
  const input = ['# A', 'body', ''].join('\r\n');
  const out = roundTrip(input);
  assert.ok(!out.includes('\r'));
  assert.equal(out, ['# A', 'body', ''].join('\n'));
});

test('CR-only newlines are normalized to LF', () => {
  const input = ['# A', 'body', ''].join('\r');
  const out = roundTrip(input);
  assert.ok(!out.includes('\r'));
  assert.equal(out, ['# A', 'body', ''].join('\n'));
});

test('trailing blank lines collapse to a single terminating newline', () => {
  const input = ['# A', 'body', '', '', '', ''].join('\n');
  const out = roundTrip(input);
  assert.equal(out, '# A\nbody\n');
  assert.ok(out.endsWith('\n'));
  assert.ok(!out.endsWith('\n\n'));
});

test('empty input produces just a terminating newline', () => {
  const out = roundTrip('');
  assert.equal(out, '\n');
});

test('heading-like lines inside a code fence stay as body (not promoted)', () => {
  const input = [
    '# Real',
    'intro',
    '```',
    '# not a heading',
    '- [ ] not an item',
    '```',
    'outro',
    '',
  ].join('\n');

  const parsed = parseMarkdown(input, FILE);
  // Only the real heading becomes a child; the fenced "# not a heading" stays
  // inside Real's body.
  assert.equal(parsed.root.children.length, 1);
  const real = parsed.root.children[0];
  assert.equal(real.text, 'Real');
  assert.equal(real.children.length, 0);
  assert.ok(real.body.includes('# not a heading'));
  assert.ok(real.body.includes('- [ ] not an item'));

  const out = assertStable(input);
  assert.equal(out, input);
});

test('language-labeled fence (```js) protects its contents', () => {
  const input = [
    '# H',
    '```js',
    '## still code',
    '```',
    '',
  ].join('\n');
  const parsed = parseMarkdown(input, FILE);
  assert.equal(parsed.root.children.length, 1);
  assert.ok(parsed.root.children[0].body.includes('## still code'));
  assert.equal(assertStable(input), input);
});

test('tilde (~~~) fence protects its contents', () => {
  const input = [
    '# H',
    '~~~',
    '### inside tilde',
    '~~~',
    '',
  ].join('\n');
  const parsed = parseMarkdown(input, FILE);
  assert.equal(parsed.root.children.length, 1);
  assert.ok(parsed.root.children[0].body.includes('### inside tilde'));
  assert.equal(assertStable(input), input);
});

test('a ``` fence is not closed by a ~~~ line (mismatched fences are content)', () => {
  const input = [
    '# H',
    '```',
    '~~~ inner tilde line',
    '# still inside backtick fence',
    '```',
    '',
  ].join('\n');
  const parsed = parseMarkdown(input, FILE);
  assert.equal(parsed.root.children.length, 1);
  assert.ok(parsed.root.children[0].body.includes('# still inside backtick fence'));
  assert.equal(assertStable(input), input);
});

test('unclosed fence keeps the rest of the document as body', () => {
  const input = [
    '# H',
    'before',
    '```',
    '# never escapes',
    '## also code',
    '',
  ].join('\n');
  const parsed = parseMarkdown(input, FILE);
  assert.equal(parsed.root.children.length, 1);
  assert.ok(parsed.root.children[0].body.includes('# never escapes'));
  assert.ok(parsed.root.children[0].body.includes('## also code'));
  // Idempotent even when the fence is left open.
  const once = roundTrip(input);
  const twice = roundTrip(once);
  assert.equal(twice, once);
});

test('indented fence still protects its contents', () => {
  const input = [
    '# H',
    '  ```',
    '  # indented code heading',
    '  ```',
    '',
  ].join('\n');
  const parsed = parseMarkdown(input, FILE);
  assert.equal(parsed.root.children.length, 1);
  assert.ok(parsed.root.children[0].body.includes('# indented code heading'));
  assert.equal(assertStable(input), input);
});

test('fence inside a nested heading body is scoped to that heading', () => {
  const input = [
    '# A',
    '## B',
    '```',
    '# fenced in B',
    '```',
    '### C',
    'c body',
    '',
  ].join('\n');
  const parsed = parseMarkdown(input, FILE);
  const a = parsed.root.children[0];
  assert.equal(a.text, 'A');
  const b = a.children[0];
  assert.equal(b.text, 'B');
  assert.ok(b.body.includes('# fenced in B'));
  // C is still recognized as a real heading after the fence closes.
  assert.equal(b.children[0].text, 'C');
  assert.equal(assertStable(input), input);
});

// ─── 新規追加テスト ──────────────────────────────────────────────────────────

// R-01-01: H1〜H6全6段階の階層化
test('H1 to H6 all six levels are parsed with correct level numbers', () => {
  const input = '# A\n## B\n### C\n#### D\n##### E\n###### F\n';
  const parsed = parseMarkdown(input, FILE);

  const a = parsed.root.children[0];
  assert.equal(a.text, 'A');
  assert.equal(a.level, 1);

  const b = a.children[0];
  assert.equal(b.text, 'B');
  assert.equal(b.level, 2);

  const c = b.children[0];
  assert.equal(c.text, 'C');
  assert.equal(c.level, 3);

  const d = c.children[0];
  assert.equal(d.text, 'D');
  assert.equal(d.level, 4);

  const e = d.children[0];
  assert.equal(e.text, 'E');
  assert.equal(e.level, 5);

  const f = e.children[0];
  assert.equal(f.text, 'F');
  assert.equal(f.level, 6);
});

// R-01-01: H6ノードを含む round-trip でレベルが保持される
test('H6 node level is preserved through serialize then re-parse', () => {
  const input = '# A\n## B\n### C\n#### D\n##### E\n###### F\n';
  const out = assertStable(input);
  const reparsed = parseMarkdown(out, FILE);

  const f = reparsed.root.children[0]
    .children[0].children[0].children[0].children[0].children[0];
  assert.equal(f.text, 'F');
  assert.equal(f.level, 6);
});

// R-01-02: H1なしファイルはファイル名がルートになる
test('file without H1: root.text is filename, first child has level 2', () => {
  const input = '## Section\n### Sub\n';
  const parsed = parseMarkdown(input, FILE);

  assert.equal(parsed.root.text, 'Doc');
  assert.equal(parsed.root.level, 0);
  assert.equal(parsed.root.children.length, 1);
  assert.equal(parsed.root.children[0].level, 2);
  assert.equal(parsed.root.children[0].text, 'Section');
});

// R-01-02: H1ありファイルの構造
test('file with H1: root.text is filename, root child has level 1 with H1 text', () => {
  const input = '# Title\n## Sub\n';
  const parsed = parseMarkdown(input, FILE);

  assert.equal(parsed.root.text, 'Doc');
  assert.equal(parsed.root.level, 0);
  assert.equal(parsed.root.children[0].level, 1);
  assert.equal(parsed.root.children[0].text, 'Title');
});

// R-01-04, NF-02-01: 段落・コードブロック・チェックリストを含む本文の保持
test('body with paragraphs, code block, and checklist is preserved through round-trip', () => {
  const input = [
    '# Head',
    'first paragraph',
    '',
    'second paragraph',
    '',
    '```',
    'code here',
    '```',
    '',
    '- [ ] todo item',
    '- [x] done item',
    '',
  ].join('\n');

  const out = assertStable(input);
  const node = parseMarkdown(out, FILE).root.children[0];
  assert.ok(node.body.includes('first paragraph'));
  assert.ok(node.body.includes('second paragraph'));
  assert.ok(node.body.includes('```'));
  assert.ok(node.body.includes('code here'));
  assert.ok(node.body.includes('- [ ] todo item'));
  assert.ok(node.body.includes('- [x] done item'));
});

// R-06-02: フロントマターなし＋collapsedPaths あり → frontmatter が書き込まれる
test('no frontmatter + collapsedPaths serializes mindmap-collapse block', () => {
  const input = '# A\n## B\n### C\n';
  const parsed = parseMarkdown(input, FILE);
  // B の collapse パスは filename-prefixed
  const out = serializeToMarkdown(
    parsed.root,
    parsed.frontmatter,
    parsed.preamble,
    ['Doc/A/B'],
    parsed.bodyItemCollapsePaths
  );
  assert.ok(out.includes('mindmap-collapse:'));
  assert.ok(out.includes('  - "A/B"'));
});

// R-06-02: フロントマターなし＋collapsedPaths 空 → frontmatter ブロックが出力されない
test('no frontmatter + empty collapsedPaths produces no frontmatter in output', () => {
  const input = '# A\n## B\n';
  const parsed = parseMarkdown(input, FILE);
  const out = serializeToMarkdown(
    parsed.root,
    parsed.frontmatter,
    parsed.preamble,
    [],
    []
  );
  assert.ok(!out.startsWith('---'));
});

// R-01-07/R-01-08: 見出し直後の本文は各ノードに格納される
test('node with body has non-empty body field, node without body has empty body', () => {
  const input = '# HasBody\nbody text\n## NoBody\n### AlsoHasBody\nsome content\n';
  const parsed = parseMarkdown(input, FILE);

  const hasBody = parsed.root.children[0];
  assert.equal(hasBody.text, 'HasBody');
  assert.notEqual(hasBody.body, '');

  const noBody = hasBody.children[0];
  assert.equal(noBody.text, 'NoBody');
  assert.equal(noBody.body, '');

  const alsoHasBody = noBody.children[0];
  assert.equal(alsoHasBody.text, 'AlsoHasBody');
  assert.notEqual(alsoHasBody.body, '');
});

// ─── 新規追加テスト 2 (v2.6.3) ───────────────────────────────────────────────

// AT-06-02 / AT-15-04 / R-06-02, R-15-05: title + mindmap-collapse +
// body-item-collapse の3ブロック共存がラウンドトリップで全て保全される
test('title + mindmap-collapse + body-item-collapse coexist and survive round-trip', () => {
  const input = [
    '---',
    'title: Combo',
    'mindmap-collapse:',
    '  - "A/B"',
    'body-item-collapse:',
    '  - "A::item"',
    '---',
    '',
    '# A',
    '- item',
    '## B',
    '### C',
    '',
  ].join('\n');

  const parsed = parseMarkdown(input, FILE);
  // 見出し collapse と本文 collapse が両方適用される
  assert.equal(parsed.root.children[0].children[0].collapsed, true); // B
  assert.deepEqual(parsed.bodyItemCollapsePaths, ['Doc/A::item']);

  const out = assertStable(input);
  assert.ok(out.includes('title: Combo'));
  assert.ok(out.includes('mindmap-collapse:'));
  assert.ok(out.includes('- "A/B"'));
  assert.ok(out.includes('body-item-collapse:'));
  assert.ok(out.includes('- "A::item"'));
  // 旧プレフィックス形式に巻き戻らない
  assert.ok(!out.includes('Doc/A'));
});

// AT-15-04 / R-15-05: 複数の body-item-collapse パスが順序を保って round-trip する
test('multiple body-item-collapse paths preserve their order through round-trip', () => {
  const input = [
    '---',
    'body-item-collapse:',
    '  - "A::first"',
    '  - "A::second"',
    '---',
    '',
    '# A',
    '- first',
    '- second',
    '',
  ].join('\n');

  const parsed = parseMarkdown(input, FILE);
  assert.deepEqual(parsed.bodyItemCollapsePaths, ['Doc/A::first', 'Doc/A::second']);

  const out = assertStable(input);
  const firstIdx = out.indexOf('- "A::first"');
  const secondIdx = out.indexOf('- "A::second"');
  assert.ok(firstIdx !== -1 && secondIdx !== -1);
  assert.ok(firstIdx < secondIdx, 'body-item-collapse order is not preserved');
});

// AT-06-02: serializeToMarkdown はブロックを常に mindmap-collapse →
// body-item-collapse の順で書き出す（順序保全の固定点）
test('serializer emits mindmap-collapse before body-item-collapse', () => {
  const input = '# A\n- item\n## B\n';
  const parsed = parseMarkdown(input, FILE);
  const out = serializeToMarkdown(
    parsed.root,
    parsed.frontmatter,
    parsed.preamble,
    ['Doc/A'],
    ['Doc/A::item']
  );
  const mmIdx = out.indexOf('mindmap-collapse:');
  const biIdx = out.indexOf('body-item-collapse:');
  assert.ok(mmIdx !== -1 && biIdx !== -1);
  assert.ok(mmIdx < biIdx);
});

// AT-06-02 / NF-03: 既存フロントマターの未管理キー（title 等）は順序を保って
// 残り、管理ブロックは末尾に追加される
test('unmanaged frontmatter keys are kept and managed blocks are appended after them', () => {
  const input = [
    '---',
    'title: Keep',
    'author: Me',
    '---',
    '',
    '# A',
    '## B',
    '',
  ].join('\n');
  const parsed = parseMarkdown(input, FILE);
  const out = serializeToMarkdown(
    parsed.root,
    parsed.frontmatter,
    parsed.preamble,
    ['Doc/A'],
    []
  );
  assert.ok(out.includes('title: Keep'));
  assert.ok(out.includes('author: Me'));
  // 未管理キーが collapse ブロックより前に残る
  assert.ok(out.indexOf('author: Me') < out.indexOf('mindmap-collapse:'));
});

// AT-06-02: collapse 状態を解除して保存すると管理ブロックが消え、
// 未管理キーのみのフロントマターになる
test('removing all collapse state drops managed blocks but keeps other frontmatter', () => {
  const input = [
    '---',
    'title: T',
    'mindmap-collapse:',
    '  - "A/B"',
    '---',
    '',
    '# A',
    '## B',
    '',
  ].join('\n');
  const parsed = parseMarkdown(input, FILE);
  // collapse なしで保存
  const out = serializeToMarkdown(
    parsed.root,
    parsed.frontmatter,
    parsed.preamble,
    [],
    []
  );
  assert.ok(out.includes('title: T'));
  assert.ok(!out.includes('mindmap-collapse:'));
});

// AT-NF03 / NF-02-01: preamble + frontmatter が同時に存在しても、両方が
// 正しい順序（frontmatter → preamble → 見出し）でラウンドトリップする
test('frontmatter and preamble coexist and round-trip in the correct order', () => {
  const input = [
    '---',
    'title: Has Preamble',
    '---',
    '',
    'intro paragraph',
    '',
    '# A',
    'body',
    '',
  ].join('\n');

  const out = assertStable(input);
  const fmEnd = out.indexOf('---', 3); // closing delimiter
  const introIdx = out.indexOf('intro paragraph');
  const headingIdx = out.indexOf('# A');
  assert.ok(fmEnd !== -1 && introIdx !== -1 && headingIdx !== -1);
  assert.ok(fmEnd < introIdx, 'frontmatter must come before preamble');
  assert.ok(introIdx < headingIdx, 'preamble must come before the first heading');
});

// AT-13-08 / R-13-10: ネストした本文項目（チェックボックス + ダッシュ混在）が
// ラウンドトリップで形式・チェック状態ともに保全される
test('nested body items (checkbox + dash mix) survive round-trip unchanged', () => {
  const input = [
    '# A',
    '- [ ] top todo',
    '- [x] top done',
    '  - nested dash',
    '    - deeper dash',
    '',
  ].join('\n');

  const out = assertStable(input);
  const body = parseMarkdown(out, FILE).root.children[0].body;
  assert.ok(body.includes('- [ ] top todo'));
  assert.ok(body.includes('- [x] top done'));
  assert.ok(body.includes('  - nested dash'));
  assert.ok(body.includes('    - deeper dash'));
});

// AT-15-04 / R-15-05: body-item-collapse のみ（mindmap-collapse なし）でも
// フロントマターが正しく構築されラウンドトリップする
test('body-item-collapse alone (no mindmap-collapse) round-trips', () => {
  const input = [
    '---',
    'body-item-collapse:',
    '  - "A::item"',
    '---',
    '',
    '# A',
    '- item',
    '  - child',
    '',
  ].join('\n');

  const out = assertStable(input);
  assert.ok(out.includes('body-item-collapse:'));
  assert.ok(out.includes('- "A::item"'));
  assert.ok(!out.includes('mindmap-collapse:'));
});

// AT-01-02: 同名の兄弟見出しがあってもツリー構造は両方保持され、
// ラウンドトリップで失われない
test('sibling headings with the same text are both preserved through round-trip', () => {
  const input = ['# Dup', 'b1', '# Dup', 'b2', ''].join('\n');
  const parsed = parseMarkdown(input, FILE);
  assert.equal(parsed.root.children.length, 2);
  assert.equal(parsed.root.children[0].text, 'Dup');
  assert.equal(parsed.root.children[1].text, 'Dup');

  const out = assertStable(input);
  assert.ok(out.includes('b1'));
  assert.ok(out.includes('b2'));
});

// AT-01-01: 見出しテキスト前後の余分な空白は trim され、ラウンドトリップで
// 安定する（# の後ろの複数スペースも 1 スペースに正規化）
test('heading text whitespace is trimmed and stays stable across round-trip', () => {
  const input = '#    Spaced Title   \nbody\n';
  const parsed = parseMarkdown(input, FILE);
  assert.equal(parsed.root.children[0].text, 'Spaced Title');
  assert.equal(assertStable(input), '# Spaced Title\nbody\n');
});

// ─── 空フロントマターの冪等性 (BUG-06) ───────────────────────────────────────

// NF-02-01: 空フロントマター（---/---）がラウンドトリップで壊れず、
// `---` 行が編集のたびに増殖しない
test('NF-02-01: empty frontmatter (---/---) round-trips unchanged and does not multiply', () => {
  const input = ['---', '---', '', '# A', 'body', ''].join('\n');
  const out = assertStable(input);
  assert.ok(out.startsWith('---\n---\n'), 'empty frontmatter must be preserved');
  const delimiterLines = out.split('\n').filter((line) => line === '---');
  assert.equal(delimiterLines.length, 2, '--- lines must not multiply');
});

// NF-02-01: 値が --- で終わるフロントマターがデリミタ剥がしで壊れない
// （`\n?---$` 化による誤剥がしがないことの回帰確認）
test('NF-02-01: frontmatter value ending with --- is not corrupted by delimiter stripping', () => {
  const input = ['---', 'title: abc---', '---', '', '# A', 'body', ''].join('\n');
  const out = assertStable(input);
  assert.ok(out.includes('title: abc---'), 'trailing --- in a value must be preserved');
});

// ─── mindmap-left ラウンドトリップテスト (R-20) ──────────────────────────────

// S20-01: mindmap-left に記載された H1 ノードに side='left' が付与される
test('mindmap-left paths are parsed and side=left applied to matching H1 nodes', () => {
  const input = [
    '---',
    'mindmap-left:',
    '  - "Left Topic"',
    '---',
    '',
    '# Left Topic',
    '## Child',
    '# Right Topic',
    '',
  ].join('\n');

  const parsed = parseMarkdown(input, FILE);
  const leftTopic  = parsed.root.children[0];
  const rightTopic = parsed.root.children[1];
  assert.equal(leftTopic.text,  'Left Topic');
  assert.equal(leftTopic.side,  'left');
  assert.equal(rightTopic.text, 'Right Topic');
  assert.equal(rightTopic.side, 'right');
});

// S20-02: mindmap-left がないファイルはすべての H1 ノードが side='right'
test('without mindmap-left all H1 nodes get side=right', () => {
  const input = '# A\n## AA\n# B\n';
  const parsed = parseMarkdown(input, FILE);
  for (const child of parsed.root.children) {
    assert.equal(child.side, 'right');
  }
});

// S20-03: mindmap-left のラウンドトリップ（書き出し→読み込み→書き出しが等価）
test('mindmap-left round-trips stably', () => {
  const input = [
    '---',
    'mindmap-left:',
    '  - "Left Topic"',
    '---',
    '',
    '# Left Topic',
    '# Right Topic',
    '',
  ].join('\n');

  const once = roundTrip(input);
  const twice = roundTrip(once);
  assert.equal(twice, once, 'mindmap-left round-trip is not idempotent');
  assert.ok(once.includes('mindmap-left:'));
  assert.ok(once.includes('- "Left Topic"'));
  assert.ok(!once.includes('Doc/'));
});

// S20-04: extractLeftPaths はルート直下の side='left' ノードのパスを返す
test('extractLeftPaths returns filename-prefixed paths for side=left H1 nodes', () => {
  const input = [
    '---',
    'mindmap-left:',
    '  - "Left Topic"',
    '  - "Another Left"',
    '---',
    '',
    '# Left Topic',
    '# Another Left',
    '# Right',
    '',
  ].join('\n');

  const parsed = parseMarkdown(input, FILE);
  const leftPaths = extractLeftPaths(parsed.root);
  assert.deepEqual(leftPaths.sort(), ['Doc/Another Left', 'Doc/Left Topic'].sort());
});

// S20-05: side='left' が消えると mindmap-left ブロックも消える
test('removing all left sides drops the mindmap-left block', () => {
  const input = [
    '---',
    'mindmap-left:',
    '  - "Left Topic"',
    '---',
    '',
    '# Left Topic',
    '# Right Topic',
    '',
  ].join('\n');

  const parsed = parseMarkdown(input, FILE);
  // Remove left side from all nodes
  for (const child of parsed.root.children) {
    child.side = 'right';
  }
  const out = serializeToMarkdown(
    parsed.root,
    parsed.frontmatter,
    parsed.preamble,
    [],
    [],
    []
  );
  assert.ok(!out.includes('mindmap-left:'));
});

// S20-06: mindmap-left と mindmap-collapse が共存してラウンドトリップする
test('mindmap-left and mindmap-collapse coexist through round-trip', () => {
  const input = [
    '---',
    'mindmap-collapse:',
    '  - "Right/Sub"',
    'mindmap-left:',
    '  - "Left"',
    '---',
    '',
    '# Left',
    '# Right',
    '## Sub',
    '### Deep',
    '',
  ].join('\n');

  const parsed = parseMarkdown(input, FILE);
  // Check parse
  assert.equal(parsed.root.children[0].side, 'left');
  assert.equal(parsed.root.children[1].side, 'right');
  const sub = parsed.root.children[1].children[0];
  assert.equal(sub.collapsed, true);

  const once = roundTrip(input);
  const twice = roundTrip(once);
  assert.equal(twice, once);
  assert.ok(once.includes('mindmap-left:'));
  assert.ok(once.includes('- "Left"'));
  assert.ok(once.includes('mindmap-collapse:'));
});
