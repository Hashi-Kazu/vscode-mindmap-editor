import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectConflict, normalizeText } from '../src/conflictDetection';

test('no base recorded yet → never a conflict (allow first write)', () => {
  assert.equal(detectConflict(null, 'anything', 'outgoing'), false);
});

test('current equals base → no conflict (safe to overwrite)', () => {
  const base = '# A\nbody\n';
  assert.equal(detectConflict(base, '# A\nbody\n', '# A\nedited\n'), false);
});

test('current differs from base → conflict (concurrent external edit)', () => {
  const base = '# A\nbody\n';
  const current = '# A\nSOMEONE ELSE EDITED THIS\n';
  const outgoing = '# A\nmy edit\n';
  assert.equal(detectConflict(base, current, outgoing), true);
});

test('current already equals our outgoing → echo, not a conflict', () => {
  // Our own previous write landed on disk; the live text matches what we are
  // about to write. This must not be flagged as someone else changing it.
  const base = '# A\nbody\n';
  const outgoing = '# A\nmy edit\n';
  assert.equal(detectConflict(base, outgoing, outgoing), false);
});

test('CRLF vs LF difference alone is not a conflict', () => {
  const base = '# A\nbody\n';
  const currentCRLF = '# A\r\nbody\r\n';
  assert.equal(detectConflict(base, currentCRLF, '# A\nmy edit\n'), false);
});

test('CRLF base vs LF current with same content is not a conflict', () => {
  const base = '# A\r\nbody\r\n';
  const current = '# A\nbody\n';
  assert.equal(detectConflict(base, current, '# A\nedit\n'), false);
});

test('conflict detection ignores newline style when comparing outgoing echo', () => {
  const base = '# A\nbody\n';
  const outgoingCRLF = '# A\r\nmy edit\r\n';
  const currentLF = '# A\nmy edit\n';
  assert.equal(detectConflict(base, currentLF, outgoingCRLF), false);
});

test('normalizeText converts CRLF and lone CR to LF', () => {
  assert.equal(normalizeText('a\r\nb\rc\nd'), 'a\nb\nc\nd');
});

test('isOperating window: external edit during operation is detected at write time', () => {
  // Simulates the gap fix: base is the snapshot the tree was built from; while
  // isOperating suppressed the sync, the live document received an external
  // edit. The pre-write check sees current != base and != outgoing → conflict.
  const base = '# Doc\n## One\n';
  const externalLive = '# Doc\n## One\n## Added by colleague\n';
  const myOutgoing = '# Doc\n## One renamed\n';
  assert.equal(detectConflict(base, externalLive, myOutgoing), true);
});

// ─── 新規追加テスト (v2.6.3) ─────────────────────────────────────────────────

// AT-11-03 / R-11-04: 空文字の base に対し current も空なら衝突しない
// （base は null ではなく空文字なので「記録なし」とは区別される）
test('empty-string base with empty current is not a conflict', () => {
  assert.equal(detectConflict('', '', '# new\n'), false);
});

// AT-11-03 / R-11-05: 空文字の base に対し current が中身を持てば、
// 外部で内容が書かれたとみなし衝突になる
test('empty-string base but non-empty current is a conflict', () => {
  assert.equal(detectConflict('', '# external\n', '# mine\n'), true);
});

// AT-11-06 / R-11-05: 末尾改行の有無だけが異なるケースは LF 正規化では
// 吸収されないため衝突として扱われる（normalizeText は CR のみ正規化）
test('trailing-newline-only difference is treated as a conflict', () => {
  const base = '# A\nbody';
  const current = '# A\nbody\n';
  const outgoing = '# A\nedited';
  assert.equal(detectConflict(base, current, outgoing), true);
});

// AT-11-06 / R-11-05: base と current が同一なら outgoing が何であっても
// 衝突しない（自分の編集を書き込んでよい）
test('identical base and current is never a conflict regardless of outgoing', () => {
  const base = '# A\nbody\n';
  assert.equal(detectConflict(base, base, 'completely different\n'), false);
});

// AT-11-06 / R-11-05: 混在改行（CRLF + lone CR + LF）でも内容が一致すれば
// 衝突しない
test('mixed CRLF/CR/LF newline styles with identical content are not a conflict', () => {
  const base = 'a\nb\nc\n';
  const current = 'a\r\nb\rc\n';
  assert.equal(detectConflict(base, current, 'a\nx\nc\n'), false);
});

// AT-11-06: normalizeText は変更が不要な純 LF 文字列をそのまま返す
test('normalizeText leaves a pure-LF string unchanged', () => {
  const s = 'a\nb\nc';
  assert.equal(normalizeText(s), s);
});

// AT-11-06: normalizeText は空文字を空文字のまま返す
test('normalizeText returns empty string unchanged', () => {
  assert.equal(normalizeText(''), '');
});

// AT-11-06: normalizeText は連続する CRLF を連続 LF に正規化する
test('normalizeText collapses consecutive CRLF into consecutive LF', () => {
  assert.equal(normalizeText('a\r\n\r\nb'), 'a\n\nb');
});
