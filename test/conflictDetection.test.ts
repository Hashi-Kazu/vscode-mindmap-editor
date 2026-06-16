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
