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

const splitByBr = new Function(`
  ${extractWebviewFunction('splitByBr')}
  return splitByBr;
`)() as (text: string) => string[];

const insertBrAtCursor = new Function(`
  ${extractWebviewFunction('insertBrAtCursor')}
  return insertBrAtCursor;
`)() as (input: { value: string; selectionStart?: number; selectionEnd?: number; setSelectionRange(a: number, b: number): void }) => void;

const computeCaretScrollLeft = new Function(`
  ${extractWebviewFunction('computeCaretScrollLeft')}
  return computeCaretScrollLeft;
`)() as (caretOffset: number, clientWidth: number, currentScrollLeft: number) => number;

interface MeasureHarness {
  measureLabelLines(text: string, isBody: boolean, nodeW: number, hasToggle: boolean): number;
  measureNodeH(text: string, isBody: boolean, nodeW: number, hasToggle: boolean): number;
}

/** Fakes canvas text measurement as 1px-per-character so width comparisons are deterministic. */
function makeMeasureHarness(): MeasureHarness {
  return new Function(`
    let configFontSize = 14;
    let _measureCtx = null;
    const BODY_H_1LINE = 30;
    const BODY_H = 42;
    const NODE_H_1LINE = 32;
    const NODE_H = 46;
    const TOGGLE_W = 19;
    const fakeCtx = { font: '', measureText(s) { return { width: String(s).length }; } };
    const document = { createElement() { return { getContext() { return fakeCtx; } }; }, body: {} };
    function getComputedStyle() { return { fontFamily: 'sans-serif' }; }
    ${extractWebviewFunction('splitByBr')}
    ${extractWebviewFunction('measureLabelLines')}
    ${extractWebviewFunction('measureNodeH')}
    return { measureLabelLines, measureNodeH };
  `)() as MeasureHarness;
}

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

// ─── R-22: body-item label <br> line break ─────────────────────────────────

test('R-22-01: renderInlineMarkdown converts <br> / <br/> / <br /> (case-insensitive) to a real line break', () => {
  assert.equal(renderInlineMarkdown('a<br>b'), 'a<br>b');
  assert.equal(renderInlineMarkdown('a<BR/>b'), 'a<br>b');
  assert.equal(renderInlineMarkdown('a<br />b'), 'a<br>b');
  assert.equal(renderInlineMarkdown('a<Br/>b'), 'a<br>b');
});

test('R-22-01: <br directly followed by a space (no slash) is not recognized', () => {
  assert.equal(renderInlineMarkdown('a<br >b'), 'a<br>b');
  // A space right after "<br" (before any slash) is not part of the allowed
  // grammar and must stay literal/escaped.
  assert.equal(renderInlineMarkdown('a< br>b'), 'a&lt; br&gt;b');
});

test('R-22-01/R-22-02: attribute-bearing <br ...> is not converted and stays escaped literal text', () => {
  const out = renderInlineMarkdown('<br class="x">');
  assert.ok(!out.includes('<br>'));
  assert.ok(out.includes('&lt;br class=&quot;x&quot;&gt;'));
});

test('R-22-02: <br> conversion runs after emphasis decoration and cannot inject other tags', () => {
  assert.equal(renderInlineMarkdown('**a<br>b**'), '<strong>a<br>b</strong>');
  const out = renderInlineMarkdown('<script>alert(1)</script><br>');
  assert.ok(!out.includes('<script>'));
  assert.ok(out.includes('&lt;script&gt;'));
  assert.ok(out.endsWith('<br>'));
});

test('splitByBr splits on <br> variants and returns [text] when absent', () => {
  assert.deepEqual(splitByBr('a<br>b<BR/>c<br />d'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(splitByBr('plain'), ['plain']);
  assert.deepEqual(splitByBr(''), ['']);
  assert.deepEqual(splitByBr(undefined as unknown as string), ['']);
});

test('R-22-03: measureLabelLines returns 1 for short <br>-free text, 2 for one <br>, and an unclamped count for many segments', () => {
  const h = makeMeasureHarness();
  assert.equal(h.measureLabelLines('a', true, 200, false), 1);
  assert.equal(h.measureLabelLines('aaaa<br>bbbb', true, 200, false), 2);
  assert.equal(
    h.measureLabelLines('a<br>a<br>a<br>a<br>a', true, 200, false),
    5,
    '5 segments must NOT be clamped: body item labels have no display-line upper bound'
  );
});

test('R-22-03: measureNodeH reproduces the pre-existing 30/42 body heights for lines=1/2 (no regression), and grows unbounded beyond 2 lines', () => {
  const h = makeMeasureHarness();
  // Short text fits in one line within the available width. The 1-line
  // height (BODY_H_1LINE = 30) is unaffected by the line-height fix.
  assert.equal(h.measureNodeH('a', true, 200, false), 30);
  // Long single-segment (no <br>) text overflows the available width once
  // (2 lines). The per-line addition now matches the actual CSS line height
  // of .body-node-label (line-height: 1.4 × fontSize(12) = 16.8 → 17px),
  // not the old fixed 12px, so this no longer equals the legacy BODY_H
  // (42px) constant: 30 + (2-1)*17 = 47 (Issue #65).
  assert.equal(h.measureNodeH('a'.repeat(20), true, 59, false), 47);
  // A single segment that wraps to 3 lines must grow the node height with
  // no upper bound: 30 + (3-1)*17 = 64.
  assert.equal(h.measureNodeH('a'.repeat(30), true, 56, false), 64);
});

test("R-22-05: insertBrAtCursor inserts '<br>' at the caret, replacing a selection, and moves the caret after it", () => {
  const makeInput = (value: string, start: number, end = start) => {
    const input = {
      value,
      selectionStart: start,
      selectionEnd: end,
      setSelectionRange(a: number, b: number) { input.selectionStart = a; input.selectionEnd = b; },
    };
    return input;
  };

  const midInsert = makeInput('ab', 1);
  insertBrAtCursor(midInsert);
  assert.equal(midInsert.value, 'a<br>b');
  assert.equal(midInsert.selectionStart, 5);
  assert.equal(midInsert.selectionEnd, 5);

  const selReplace = makeInput('abcdef', 2, 4);
  insertBrAtCursor(selReplace);
  assert.equal(selReplace.value, 'ab<br>ef');
  assert.equal(selReplace.selectionStart, 6);
  assert.equal(selReplace.selectionEnd, 6);

  const endInsert = makeInput('abc', 3);
  insertBrAtCursor(endInsert);
  assert.equal(endInsert.value, 'abc<br>');
  assert.equal(endInsert.selectionStart, 7);

  const noSelectionInfo = { value: 'xyz', setSelectionRange(a: number, b: number) { (noSelectionInfo as any).selectionStart = a; (noSelectionInfo as any).selectionEnd = b; } } as any;
  insertBrAtCursor(noSelectionInfo);
  assert.equal(noSelectionInfo.value, 'xyz<br>');
});

test('R-22-05: beginBodyItemEdit handles Shift+Enter (insert <br>) before the plain-Enter commit branch', () => {
  const body = extractWebviewFunction('beginBodyItemEdit');
  const shiftEnterIdx = body.indexOf("e.shiftKey");
  const insertBrIdx = body.indexOf('insertBrAtCursor(input)');
  const blurIdx = body.indexOf('input.blur()');
  assert.ok(shiftEnterIdx >= 0 && insertBrIdx > shiftEnterIdx,
    'the Shift+Enter branch must call insertBrAtCursor');
  assert.ok(insertBrIdx < blurIdx,
    'the Shift+Enter branch must be checked before the plain-Enter commit (input.blur())');
});

test('R-22-05 / Issue #67: insertBrAtCursor uses the native execCommand pipeline when the input is focused in its owner document', () => {
  const calls: Array<{ command: string; value: string }> = [];
  const input: any = {
    value: 'ab',
    selectionStart: 1,
    selectionEnd: 1,
    setSelectionRange(a: number, b: number) { input.selectionStart = a; input.selectionEnd = b; },
  };
  input.ownerDocument = {
    activeElement: input,
    execCommand(command: string, _showUi: boolean, value: string) {
      calls.push({ command, value });
      // Emulate the browser performing the native insertion.
      const s = input.selectionStart;
      const e = input.selectionEnd;
      input.value = input.value.slice(0, s) + value + input.value.slice(e);
      const caret = s + value.length;
      input.setSelectionRange(caret, caret);
      return true;
    },
  };

  insertBrAtCursor(input);

  assert.deepEqual(calls, [{ command: 'insertText', value: '<br>' }],
    'execCommand must be invoked to go through the native editing pipeline (Issue #67)');
  assert.equal(input.value, 'a<br>b');
  assert.equal(input.selectionStart, 5);
  assert.equal(input.selectionEnd, 5);
});

test('R-22-05 / Issue #67: insertBrAtCursor falls back to manual value/selection update and dispatches an "input" event when execCommand is unavailable or fails', () => {
  const dispatched: Event[] = [];
  const input: any = {
    value: 'ab',
    selectionStart: 1,
    selectionEnd: 1,
    setSelectionRange(a: number, b: number) { input.selectionStart = a; input.selectionEnd = b; },
    dispatchEvent(ev: Event) { dispatched.push(ev); return true; },
  };
  // No ownerDocument at all: must fall back without throwing.
  insertBrAtCursor(input);
  assert.equal(input.value, 'a<br>b');
  assert.equal(input.selectionStart, 5);
  assert.equal(dispatched.length, 1, 'a synthetic input event must be dispatched to reinforce the redraw');
  assert.equal(dispatched[0].type, 'input');
  assert.equal(dispatched[0].bubbles, true);

  // execCommand present but fails/mismatches: must also fall back and dispatch.
  const dispatched2: Event[] = [];
  const input2: any = {
    value: 'cd',
    selectionStart: 1,
    selectionEnd: 1,
    setSelectionRange(a: number, b: number) { input2.selectionStart = a; input2.selectionEnd = b; },
    dispatchEvent(ev: Event) { dispatched2.push(ev); return true; },
  };
  input2.ownerDocument = {
    activeElement: input2,
    execCommand() { return false; },
  };
  insertBrAtCursor(input2);
  assert.equal(input2.value, 'c<br>d');
  assert.equal(input2.selectionStart, 5);
  assert.equal(dispatched2.length, 1,
    'a failed execCommand must not prevent the manual fallback and its redraw-reinforcing dispatch');
});

// ─── R-22-06: caret-scroll follow for the body-item edit input ─────────────

test("R-22-06: computeCaretScrollLeft keeps the caret inside the edit input's visible range", () => {
  assert.equal(computeCaretScrollLeft(50, 100, 0), 0);
  assert.equal(computeCaretScrollLeft(50, 100, 20), 20);
  assert.equal(computeCaretScrollLeft(140, 100, 0), 40);
  assert.equal(computeCaretScrollLeft(10, 100, 50), 10);
  assert.equal(computeCaretScrollLeft(0, 100, 300), 0);
});

test('R-22-06: beginBodyItemEdit syncs the caret scroll after <br> insertion and on every input event', () => {
  const body = extractWebviewFunction('beginBodyItemEdit');
  assert.ok(body.includes("addEventListener('input', () => syncEditInputCaretScroll(input))"),
    'an "input" listener must call syncEditInputCaretScroll on every keystroke');
  const shiftEnterIdx = body.indexOf('e.shiftKey');
  const insertBrIdx = body.indexOf('insertBrAtCursor(input)');
  const syncAfterBrIdx = body.indexOf('syncEditInputCaretScroll(input)', insertBrIdx);
  const blurIdx = body.indexOf('input.blur()');
  assert.ok(shiftEnterIdx >= 0 && insertBrIdx > shiftEnterIdx,
    'the Shift+Enter branch must still call insertBrAtCursor (R-22-05, unchanged)');
  assert.ok(syncAfterBrIdx > insertBrIdx,
    'syncEditInputCaretScroll must run immediately after insertBrAtCursor in the Shift+Enter branch');
  assert.ok(insertBrIdx < blurIdx,
    'the Shift+Enter branch must still be checked before the plain-Enter commit (input.blur())');

  // Fakes canvas text measurement as a fixed width-per-character so the
  // caret-follow simulation below is deterministic (mirrors makeMeasureHarness).
  const CHAR_W = 8;
  const CLIENT_WIDTH = 100;
  const harness = new Function(`
    ${extractWebviewFunction('computeCaretScrollLeft')}
    let _caretMeasureCtx = null;
    const fakeCtx = { font: '', measureText(s) { return { width: String(s).length * ${CHAR_W} }; } };
    const document = { createElement() { return { getContext() { return fakeCtx; } }; } };
    function getComputedStyle() { return { font: '14px sans-serif', paddingLeft: '4', paddingRight: '4' }; }
    ${extractWebviewFunction('syncEditInputCaretScroll')}
    return { syncEditInputCaretScroll };
  `)() as { syncEditInputCaretScroll: (input: { value: string; selectionEnd: number; clientWidth: number; scrollLeft: number }) => void };

  const effectiveClientWidth = CLIENT_WIDTH - 4 - 4; // paddingLeft and paddingRight subtracted (R-22-06)
  const input = { value: '', selectionEnd: 0, clientWidth: CLIENT_WIDTH, scrollLeft: 0 };

  // Simulate the Shift+Enter <br> insertion followed by typing one character
  // at a time; after every step the caret's pixel offset must stay inside
  // [scrollLeft, scrollLeft + clientWidth].
  const steps = ['a<br>', ...'the caret must always stay visible while typing'.split('')];
  let text = '';
  for (const chunk of steps) {
    text += chunk;
    input.value = text;
    input.selectionEnd = text.length;
    harness.syncEditInputCaretScroll(input);
    const caretOffset = text.length * CHAR_W;
    assert.ok(input.scrollLeft <= caretOffset,
      `scrollLeft (${input.scrollLeft}) must not exceed the caret offset (${caretOffset})`);
    assert.ok(caretOffset <= input.scrollLeft + effectiveClientWidth,
      `caret offset (${caretOffset}) must stay within the visible range starting at scrollLeft (${input.scrollLeft})`);
  }
});
