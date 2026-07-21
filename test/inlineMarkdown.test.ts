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

function extractBlockAfter(marker: string): string {
  const start = webviewSource.indexOf(marker);
  assert.ok(start >= 0, `marker "${marker}" not found in media/mindmap.js`);
  const bodyStart = webviewSource.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < webviewSource.length; i++) {
    const ch = webviewSource[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return webviewSource.slice(bodyStart, i + 1);
    }
  }
  assert.fail(`block after "${marker}" braces are unbalanced`);
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

const toggleEmphasis = new Function(`
  ${extractWebviewFunction('parseEmphasis')}
  ${extractWebviewFunction('toggleEmphasis')}
  return toggleEmphasis;
`)() as (text: string, kind: 'bold' | 'italic', forceState?: boolean) => string;

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

test('R-21-04: toolbar and guarded shortcuts toggle bold and italic', () => {
  assert.equal(toggleEmphasis('plain', 'bold'), '**plain**');
  assert.equal(toggleEmphasis('**plain**', 'bold'), 'plain');
  assert.equal(toggleEmphasis('plain', 'italic'), '*plain*');
  assert.equal(toggleEmphasis('*plain*', 'bold'), '***plain***');
  assert.equal(toggleEmphasis('**plain**', 'italic'), '***plain***');
  assert.equal(toggleEmphasis('***plain***', 'bold'), '*plain*');

  assert.ok(webviewSource.includes("getElementById('btn-bold').addEventListener('click', () => applyEmphasisToSelection('bold'))"));
  assert.ok(webviewSource.includes("getElementById('btn-italic').addEventListener('click', () => applyEmphasisToSelection('italic'))"));
  const keydown = extractBlockAfter("document.addEventListener('keydown'");
  const guardIdx = keydown.indexOf('if (editingId || bodyEditing) return;');
  const boldIdx = keydown.indexOf("applyEmphasisToSelection('bold')");
  const italicIdx = keydown.indexOf("applyEmphasisToSelection('italic')");
  assert.ok(guardIdx >= 0 && boldIdx > guardIdx && italicIdx > guardIdx,
    'Ctrl/Cmd+B and Ctrl/Cmd+I must stay behind the editing guard');
});

interface EmphasisSelectionHarness {
  apply(kind: 'bold' | 'italic'): void;
  readonly headings: Array<{ text: string }>;
  readonly undoCount: number;
  readonly structuralCount: number;
}

function makeEmphasisSelectionHarness(texts: string[]): EmphasisSelectionHarness {
  return new Function(`
    const headings = ${JSON.stringify(texts.map(text => ({ text })))};
    let undoCount = 0, structuralCount = 0;
    function getSelectionEmphasisTexts() { return { headings, bodyItems: [] }; }
    function pushUndo() { undoCount++; }
    function setBodyItemText() {}
    function postStructuralEdit() { structuralCount++; }
    function render() {}
    ${extractWebviewFunction('parseEmphasis')}
    ${extractWebviewFunction('toggleEmphasis')}
    ${extractWebviewFunction('applyEmphasisToSelection')}
    return {
      apply(kind) { applyEmphasisToSelection(kind); },
      get headings() { return headings; },
      get undoCount() { return undoCount; },
      get structuralCount() { return structuralCount; },
    };
  `)() as EmphasisSelectionHarness;
}

test('R-21-05: same-kind multi-selection applies or removes normalized asterisk emphasis', () => {
  const allBold = makeEmphasisSelectionHarness(['**one**', '***two***']);
  allBold.apply('bold');
  assert.deepEqual(allBold.headings.map(node => node.text), ['one', '*two*'],
    'when every label is bold, bold is removed from all labels');
  assert.equal(allBold.undoCount, 1);
  assert.equal(allBold.structuralCount, 1);

  const mixed = makeEmphasisSelectionHarness(['plain', '**bold**', '__init__']);
  mixed.apply('bold');
  assert.deepEqual(mixed.headings.map(node => node.text), ['**plain**', '**bold**', '**__init__**'],
    'mixed selection is uniformly applied and underscore text remains literal content');
});

test('R-21-06: body emphasis preserves indentation, bullet and checkbox state; blank labels are no-ops', () => {
  const setBodyItemText = new Function(`
    ${extractWebviewFunction('setBodyItemText')}
    return setBodyItemText;
  `)() as (parent: { body: string }, lineIdx: number, text: string, indent: number) => void;
  const parent = { body: '  - nested\n    - [ ] todo\n    - [x] done' };

  setBodyItemText(parent, 0, toggleEmphasis('nested', 'bold'), 2);
  setBodyItemText(parent, 1, toggleEmphasis('todo', 'italic'), 4);
  setBodyItemText(parent, 2, toggleEmphasis('done', 'bold'), 4);
  assert.equal(parent.body, '  - **nested**\n    - [ ] *todo*\n    - [x] **done**');
  assert.equal(toggleEmphasis('', 'bold'), '');
  assert.equal(toggleEmphasis('   ', 'italic'), '   ');
});

test('R-21-07: emphasis buttons are active only when every selected label has the style', () => {
  const makeHarness = () => new Function(`
    const state = { headings: [], bodyItems: [] };
    const classes = { bold: false, italic: false };
    const buttons = {
      'btn-bold': { classList: { toggle(_name, value) { classes.bold = value; } } },
      'btn-italic': { classList: { toggle(_name, value) { classes.italic = value; } } },
    };
    const document = { getElementById(id) { return buttons[id]; } };
    function getSelectionEmphasisTexts() { return state; }
    ${extractWebviewFunction('parseEmphasis')}
    ${extractWebviewFunction('updateEmphasisButtons')}
    return { state, classes, update: updateEmphasisButtons };
  `)() as {
    state: { headings: Array<{ text: string }>; bodyItems: Array<{ item: { text: string } }> };
    classes: { bold: boolean; italic: boolean };
    update(): void;
  };

  const h = makeHarness();
  h.update();
  assert.deepEqual(h.classes, { bold: false, italic: false }, 'no selection is inactive');
  h.state.headings = [{ text: '***one***' }, { text: '**two**' }];
  h.update();
  assert.deepEqual(h.classes, { bold: true, italic: false }, 'all-bold, mixed-italic selection');
  h.state.headings = [{ text: '***one***' }];
  h.state.bodyItems = [{ item: { text: '***body***' } }];
  h.update();
  assert.deepEqual(h.classes, { bold: true, italic: true }, 'all selected labels have both styles');
  h.state.headings = [{ text: '**one**' }, { text: 'plain' }];
  h.state.bodyItems = [];
  h.update();
  assert.deepEqual(h.classes, { bold: false, italic: false }, 'mixed selection is inactive');
});
