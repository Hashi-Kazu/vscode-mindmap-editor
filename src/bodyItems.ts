/**
 * Pure body-item parsing/transform logic.
 *
 * IMPORTANT: This is a TypeScript port of the same functions living in
 * `media/mindmap.js` (getBodyItems / getBodyItemTree / bodyItemLastLineIdx /
 * findBodyItemByLineIdx / reformatBodyLines / remapCollapsedBodyLinesAfterDelete /
 * normalizeBodyCheckboxes). The webview script is served as a
 * raw static asset and is NOT bundled by esbuild, so the logic is intentionally
 * duplicated here for unit testing. If you change the parsing rules in one
 * place, mirror the change in the other or the on-disk model and the rendered
 * model will drift (lineIdx-based operations would then corrupt data).
 */

export type BodyItemType = 'checkbox' | 'bullet';

export interface BodyItem {
  lineIdx: number;
  type: BodyItemType;
  checked: boolean;
  text: string;
  indent: number;
  children: BodyItem[];
}

/** Flat list of all body list items (for line-index-based operations). */
export function getBodyItems(bodyText: string): BodyItem[] {
  const lines = (bodyText || '').split('\n');
  const items: BodyItem[] = [];
  let fenceChar: '`' | '~' | null = null;
  lines.forEach((line, idx) => {
    const fence = line.match(/^[ \t]*(`{3,}|~{3,})/);
    if (fence) {
      const ch = fence[1][0] as '`' | '~';
      if (fenceChar === null) fenceChar = ch;
      else if (fenceChar === ch) fenceChar = null;
      return;
    }
    if (fenceChar !== null) return;

    const chk = line.match(/^(\s*)-\s+\[([ xX])\]\s+(.*)$/);
    const bul = !chk && line.match(/^(\s*)-\s+(.*)$/);
    if (chk) {
      items.push({
        lineIdx: idx,
        type: 'checkbox',
        checked: chk[2].toLowerCase() === 'x',
        text: chk[3],
        indent: chk[1].length,
        children: [],
      });
    } else if (bul) {
      items.push({
        lineIdx: idx,
        type: 'bullet',
        checked: false,
        text: bul[2],
        indent: bul[1].length,
        children: [],
      });
    }
  });
  return items;
}

/** Hierarchical tree of body list items (parent→children based on indent). */
export function getBodyItemTree(bodyText: string): BodyItem[] {
  const flat = getBodyItems(bodyText);
  const roots: BodyItem[] = [];
  const stack: BodyItem[] = [];
  for (const item of flat) {
    // pop until we find an ancestor with strictly smaller indent
    while (stack.length > 0 && stack[stack.length - 1].indent >= item.indent) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(item);
    } else {
      stack[stack.length - 1].children.push(item);
    }
    stack.push(item);
  }
  return roots;
}

/** Last lineIdx in a body item's subtree (used for sibling insertion). */
export function bodyItemLastLineIdx(item: BodyItem): number {
  if (!item.children.length) return item.lineIdx;
  return bodyItemLastLineIdx(item.children[item.children.length - 1]);
}

/** Locate a body item anywhere in the tree by its source line index. */
export function findBodyItemByLineIdx(
  tree: BodyItem[],
  lineIdx: number
): BodyItem | null {
  for (const item of tree) {
    if (item.lineIdx === lineIdx) return item;
    const found = findBodyItemByLineIdx(item.children, lineIdx);
    if (found) return found;
  }
  return null;
}

/** Remove deleted collapse entries and shift entries after the deleted range. */
export function remapCollapsedBodyLinesAfterDelete(
  collapsedSet: Set<number> | undefined,
  startLineIdx: number,
  lineCount: number
): Set<number> | undefined {
  if (!collapsedSet) return collapsedSet;
  const endLineIdx = startLineIdx + lineCount;
  const remapped = new Set<number>();
  for (const lineIdx of collapsedSet) {
    if (lineIdx < startLineIdx) remapped.add(lineIdx);
    else if (lineIdx >= endLineIdx) remapped.add(lineIdx - lineCount);
  }
  return remapped;
}

/**
 * Reformat body lines when moving between indent levels.
 * indent=0 → checkbox (- [ ] / - [x]); indent>0 → plain bullet (- text).
 */
export function reformatBodyLines(
  lines: string[],
  srcIndent: number,
  destIndent: number
): string[] {
  const delta = destIndent - srcIndent;
  return lines.map((line) => {
    const m = line.match(/^(\s*)-\s+(\[[ xX]\]\s+)?(.*)$/);
    if (!m) return line;
    const newIndent = Math.max(0, m[1].length + delta);
    const indStr = ' '.repeat(newIndent);
    const text = m[3];
    if (newIndent === 0) {
      return m[2] ? `${indStr}- ${m[2].trimEnd()} ${text}` : `${indStr}- [ ] ${text}`;
    } else {
      return `${indStr}- ${text}`;
    }
  });
}

/**
 * Normalize a heading's body so top-level (indent=0) plain bullet items become
 * empty checkboxes (`- text` → `- [ ] text`). This mirrors the editor's data
 * model where top-level body items are checkboxes and nested items (indent>0)
 * are plain bullets, so on open we migrate legacy plain lists to the checkbox
 * form the rest of the code expects.
 *
 * Strictly limited to existing top-level list items to honor NF-03:
 *  - existing checkboxes (`- [ ]` / `- [x]` / `- [X]`) are left untouched
 *    (checked state preserved);
 *  - nested bullets (indent>0) stay plain bullets;
 *  - non-list lines (paragraphs, prose, blank lines) are never touched;
 *  - lines inside fenced code blocks (``` / ~~~) are never touched.
 *
 * Returns the body string unchanged (same reference semantics via equality) when
 * nothing needs migrating, so callers can skip pointless writes.
 */
export function normalizeBodyCheckboxes(bodyText: string): string {
  if (!bodyText) return bodyText;
  const lines = bodyText.split('\n');
  let fenceChar: '`' | '~' | null = null;
  let changed = false;

  const out = lines.map((line) => {
    const fence = line.match(/^[ \t]*(`{3,}|~{3,})/);
    if (fence) {
      const ch = fence[1][0] as '`' | '~';
      if (fenceChar === null) fenceChar = ch;
      else if (fenceChar === ch) fenceChar = null;
      return line;
    }
    if (fenceChar !== null) return line; // inside a code fence — never touch

    // Top-level (indent=0) plain bullet that is NOT already a checkbox.
    const m = line.match(/^-\s+(.*)$/);
    if (!m) return line;
    if (/^\[[ xX]\]\s/.test(m[1])) return line; // already a checkbox
    changed = true;
    return `- [ ] ${m[1]}`;
  });

  return changed ? out.join('\n') : bodyText;
}

/**
 * Apply normalizeBodyCheckboxes to a node's body and recurse into children,
 * mutating bodies in place. Returns true if any body changed (so the caller
 * can decide whether a write-back is needed).
 */
export function normalizeTreeCheckboxes(
  node: { body: string; children: Array<{ body: string; children: unknown[] }> }
): boolean {
  let changed = false;
  const normalized = normalizeBodyCheckboxes(node.body);
  if (normalized !== node.body) {
    node.body = normalized;
    changed = true;
  }
  for (const child of node.children) {
    if (
      normalizeTreeCheckboxes(
        child as { body: string; children: Array<{ body: string; children: unknown[] }> }
      )
    ) {
      changed = true;
    }
  }
  return changed;
}
