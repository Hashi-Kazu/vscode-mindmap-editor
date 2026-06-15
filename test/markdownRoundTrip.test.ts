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
