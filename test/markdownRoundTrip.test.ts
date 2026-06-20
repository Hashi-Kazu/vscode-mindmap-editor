import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, extractCollapsedPaths } from '../src/markdownParser';
import { serializeToMarkdown } from '../src/markdownSerializer';

const FILE = '/tmp/Doc.md';

// Run input -> parse -> serialize and return the serialized output.
function roundTrip(input: string): string {
  const parsed = parseMarkdown(input, FILE);
  const collapsedPaths = extractCollapsedPaths(parsed.root);
  return serializeToMarkdown(
    parsed.root,
    parsed.frontmatter,
    parsed.preamble,
    collapsedPaths,
    parsed.bodyItemCollapsePaths
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
