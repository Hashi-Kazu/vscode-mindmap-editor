/**
 * Pure body-item parsing/transform logic.
 *
 * IMPORTANT: This is a TypeScript port of the same functions living in
 * `media/mindmap.js` (getBodyItems / getBodyItemTree / bodyItemLastLineIdx /
 * findBodyItemByLineIdx / reformatBodyLines / remapCollapsedBodyLinesAfterDelete /
 * remapCollapsedBodyLinesAfterMove / moveBodyItemLines / toggleBodyItemType /
 * bodyItemTreeToLines). The webview script is served as a
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
 * Locate a body item's sibling array (the `children` of its immediate parent,
 * or the top-level `roots`) and its index within that array. Returns null when
 * the lineIdx is not found anywhere in the tree.
 */
export function findBodyItemSiblings(
  tree: BodyItem[],
  lineIdx: number
): { siblings: BodyItem[]; index: number } | null {
  const idx = tree.findIndex((it) => it.lineIdx === lineIdx);
  if (idx !== -1) return { siblings: tree, index: idx };
  for (const item of tree) {
    const found = findBodyItemSiblings(item.children, lineIdx);
    if (found) return found;
  }
  return null;
}

/**
 * Remap a collapsed-line set after two adjacent sibling blocks have been
 * swapped. `a` is the earlier block (lines aStart..aEnd, length aLen) and `b`
 * the later block (bStart..bEnd, length bLen); b immediately follows a
 * (bStart === aEnd + 1). After the swap, a-block lines shift down by bLen and
 * b-block lines shift up by aLen; lines outside [aStart, bEnd] are unchanged.
 */
export function remapCollapsedBodyLinesAfterMove(
  collapsedSet: Set<number> | undefined,
  aStart: number,
  aEnd: number,
  aLen: number,
  bStart: number,
  bEnd: number,
  bLen: number
): Set<number> | undefined {
  if (!collapsedSet) return collapsedSet;
  const remapped = new Set<number>();
  for (const lineIdx of collapsedSet) {
    if (lineIdx >= aStart && lineIdx <= aEnd) remapped.add(lineIdx + bLen);
    else if (lineIdx >= bStart && lineIdx <= bEnd) remapped.add(lineIdx - aLen);
    else remapped.add(lineIdx);
  }
  return remapped;
}

/**
 * Move a body item up or down among its same-indent siblings by swapping its
 * whole line block (its own line through bodyItemLastLineIdx, i.e. including
 * nested children) with the adjacent sibling's block. Indentation and markers
 * are preserved verbatim — this is a pure sibling reorder, never a re-indent.
 *
 * Returns { body, newLineIdx } with the moved item's new source line index, or
 * null when the move is a boundary no-op (already first/last sibling) or the
 * lineIdx is not found.
 */
export function moveBodyItemLines(
  bodyText: string,
  lineIdx: number,
  delta: number
): { body: string; newLineIdx: number } | null {
  const tree = getBodyItemTree(bodyText);
  const located = findBodyItemSiblings(tree, lineIdx);
  if (!located) return null;
  const { siblings, index } = located;
  const j = index + delta;
  if (j < 0 || j >= siblings.length) return null;

  const a = siblings[Math.min(index, j)];
  const b = siblings[Math.max(index, j)];
  const aStart = a.lineIdx;
  const aEnd = bodyItemLastLineIdx(a);
  const bStart = b.lineIdx;
  const bEnd = bodyItemLastLineIdx(b);
  const bLen = bEnd - bStart + 1;

  const lines = (bodyText || '').split('\n');
  const before = lines.slice(0, aStart);
  const aBlock = lines.slice(aStart, aEnd + 1);
  const bBlock = lines.slice(bStart, bEnd + 1);
  const after = lines.slice(bEnd + 1);
  const newLines = [...before, ...bBlock, ...aBlock, ...after];

  // Moving up: the dragged item is `b`, now starting at aStart.
  // Moving down: the dragged item is `a`, now starting at aStart + bLen.
  const newLineIdx = delta < 0 ? aStart : aStart + bLen;

  return { body: newLines.join('\n'), newLineIdx };
}

/**
 * Reformat body lines when moving between indent levels.
 * The existing marker (checkbox `[ ]`/`[x]`/`[X]`, or plain bullet) is
 * preserved as-is; only the indentation is shifted. No automatic
 * checkbox/bullet conversion is performed based on the resulting indent.
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
    const marker = m[2] ? `${m[2].trimEnd()} ` : '';
    return `${indStr}- ${marker}${m[3]}`;
  });
}

/**
 * Explicitly toggle a single body item's type (checkbox <-> bullet) by
 * lineIdx. This is the only supported way to change a body item's type;
 * there is no automatic conversion based on indentation elsewhere.
 *
 * Converting to `checkbox` always starts unchecked (`- [ ] `); any existing
 * checked state is discarded. Converting to `bullet` simply drops the
 * checkbox marker while preserving indentation.
 *
 * Returns the bodyText unchanged if lineIdx is out of range or the target
 * line is not a list item.
 */
export function toggleBodyItemType(
  bodyText: string,
  lineIdx: number,
  targetType: BodyItemType
): string {
  const lines = (bodyText || '').split('\n');
  if (lineIdx < 0 || lineIdx >= lines.length) return bodyText;
  const m = lines[lineIdx].match(/^(\s*)-\s+(?:\[[ xX]\]\s+)?(.*)$/);
  if (!m) return bodyText;
  const [, indent, text] = m;
  lines[lineIdx] = targetType === 'checkbox' ? `${indent}- [ ] ${text}` : `${indent}- ${text}`;
  return lines.join('\n');
}

/**
 * Serialize a body item tree back into Markdown list lines, 2 spaces per
 * depth level. Used when promoting/demoting between body items and heading
 * nodes so nested items can be re-indented starting from a given depth.
 */
export function bodyItemTreeToLines(items: BodyItem[], depth = 0): string[] {
  const lines: string[] = [];
  for (const item of items) {
    const indent = '  '.repeat(depth);
    const marker = item.type === 'checkbox' ? `[${item.checked ? 'x' : ' '}] ` : '';
    lines.push(`${indent}- ${marker}${item.text}`);
    lines.push(...bodyItemTreeToLines(item.children, depth + 1));
  }
  return lines;
}
