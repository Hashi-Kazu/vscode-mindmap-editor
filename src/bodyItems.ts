/**
 * Pure body-item parsing/transform logic.
 *
 * IMPORTANT: This is a TypeScript port of the same functions living in
 * `media/mindmap.js` (getBodyItems / getBodyItemTree / bodyItemLastLineIdx /
 * findBodyItemByLineIdx / reformatBodyLines / remapCollapsedBodyLinesAfterDelete /
 * toggleBodyItemType / bodyItemTreeToLines). The webview script is served as a
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
