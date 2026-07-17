import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

// escapeHtml is a dependency of renderInlineMarkdown, so both are extracted
// into the same sandbox and renderInlineMarkdown is what's exercised by most
// tests (it always escapes first).
const renderInlineMarkdown = new Function(`
  ${extractWebviewFunction('escapeHtml')}
  ${extractWebviewFunction('renderInlineMarkdown')}
  return renderInlineMarkdown;
`)() as (text: string) => string;

const escapeHtml = new Function(`
  ${extractWebviewFunction('escapeHtml')}
  return escapeHtml;
`)() as (text: string) => string;

const parseEmphasis = new Function(`
  ${extractWebviewFunction('parseEmphasis')}
  return parseEmphasis;
`)() as (text: string) => { bold: boolean; italic: boolean; inner: string };

// ─── renderInlineMarkdown: emphasis decoration (R-21-01) ───────────────────

test('renderInlineMarkdown decorates **bold** as <strong>', () => {
  assert.equal(renderInlineMarkdown('**bold**'), '<strong>bold</strong>');
});

test('renderInlineMarkdown decorates *italic* as <em>', () => {
  assert.equal(renderInlineMarkdown('*italic*'), '<em>italic</em>');
});

test('renderInlineMarkdown decorates ***both*** as <strong><em>', () => {
  assert.equal(renderInlineMarkdown('***both***'), '<strong><em>both</em></strong>');
});

test('renderInlineMarkdown leaves underscore variants __bold__ and _italic_ literal', () => {
  // Underscore notation is intentionally not decorated (R-21) so common text
  // such as `__init__` / `file_name` renders verbatim.
  assert.equal(renderInlineMarkdown('__bold__'), '__bold__');
  assert.equal(renderInlineMarkdown('_italic_'), '_italic_');
});

test('renderInlineMarkdown leaves ___both___ (underscore) literal', () => {
  assert.equal(renderInlineMarkdown('___both___'), '___both___');
});

test('renderInlineMarkdown leaves an unclosed marker literal', () => {
  assert.equal(renderInlineMarkdown('*lonely'), '*lonely');
  assert.equal(renderInlineMarkdown('lonely_'), 'lonely_');
});

// ─── parseEmphasis: asterisk-only toggle recognition (R-21) ────────────────

test('parseEmphasis recognizes asterisk emphasis markers', () => {
  assert.deepEqual(parseEmphasis('**bold**'), { bold: true, italic: false, inner: 'bold' });
  assert.deepEqual(parseEmphasis('*italic*'), { bold: false, italic: true, inner: 'italic' });
  assert.deepEqual(parseEmphasis('***both***'), { bold: true, italic: true, inner: 'both' });
});

test('parseEmphasis does NOT treat underscores as emphasis', () => {
  // `__init__` must stay intact — no bold/italic detected, inner unchanged.
  assert.deepEqual(parseEmphasis('__init__'), { bold: false, italic: false, inner: '__init__' });
  assert.deepEqual(parseEmphasis('_italic_'), { bold: false, italic: false, inner: '_italic_' });
  assert.deepEqual(parseEmphasis('___both___'), { bold: false, italic: false, inner: '___both___' });
});

// ─── renderInlineMarkdown / escapeHtml: HTML injection safety (R-21-02) ────

test('renderInlineMarkdown escapes a <script> tag so no raw tag survives', () => {
  const out = renderInlineMarkdown('<script>alert(1)</script>');
  assert.ok(!out.includes('<script>'));
  assert.ok(out.includes('&lt;script&gt;'));
});

test('escapeHtml escapes &, <, >, ", and \' correctly', () => {
  assert.equal(
    escapeHtml(`& < > " '`),
    '&amp; &lt; &gt; &quot; &#39;'
  );
});

test('renderInlineMarkdown escapes ampersand/quote characters embedded in text', () => {
  assert.equal(
    renderInlineMarkdown(`Tom & Jerry's "great" day`),
    'Tom &amp; Jerry&#39;s &quot;great&quot; day'
  );
});

// ─── renderInlineMarkdown: mixed / edge cases ──────────────────────────────

test('renderInlineMarkdown only decorates the marked-up portion of mixed text', () => {
  assert.equal(
    renderInlineMarkdown('plain **bold** plain'),
    'plain <strong>bold</strong> plain'
  );
});

test('renderInlineMarkdown does not throw on empty string or undefined input', () => {
  assert.equal(renderInlineMarkdown(''), '');
  assert.equal(renderInlineMarkdown(undefined as unknown as string), '');
});
