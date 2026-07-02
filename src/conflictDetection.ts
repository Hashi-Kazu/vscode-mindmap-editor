// Optimistic concurrency control for the shared-drive / Git "lost update" problem.
//
// This extension writes by serializing the whole cached tree and replacing the
// entire document — there is no per-operation merge. To avoid silently
// clobbering edits another person made to the same .md (via a shared drive or
// after a Git pull), we record the exact text the cached tree was parsed from
// (the "base" snapshot) and, before every full-document write, check that the
// live content still matches that base. If it diverged, someone edited the file
// concurrently and we must not overwrite blindly.
//
// Pure logic lives here so it can be unit-tested without the VS Code API.

/**
 * Normalize newlines so a CRLF/LF difference (common across shared drives and
 * Git autocrlf setups) is never mistaken for a real content conflict.
 * A leading UTF-8 BOM (U+FEFF) is also stripped: disk reads keep the BOM while
 * `TextDocument.getText()` drops it, so a BOM-only difference is not a conflict.
 */
export function normalizeText(text: string): string {
  return text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Decide whether writing `outgoing` over a document whose base snapshot was
 * `base` is a conflict, given the current live/disk content `current`.
 *
 * - No base recorded yet (first sync not done) → not a conflict; allow the
 *   write rather than block legitimate initial edits.
 * - current matches base → no concurrent change; safe to write.
 * - current differs from base, but already equals what we are about to write
 *   → our own edit is already on disk (echo); not a conflict.
 * - otherwise → a concurrent external change exists; conflict.
 */
export function detectConflict(
  base: string | null,
  current: string,
  outgoing: string
): boolean {
  if (base === null) return false;
  const b = normalizeText(base);
  const c = normalizeText(current);
  if (c === b) return false;
  if (c === normalizeText(outgoing)) return false;
  return true;
}
