/**
 * Pure body-item parsing/transform logic.
 *
 * IMPORTANT: This is a TypeScript port of the same functions living in
 * `media/mindmap.js` (getBodyItems / getBodyItemTree / bodyItemLastLineIdx /
 * findBodyItemByLineIdx / reformatBodyLines). The webview script is served as a
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
  lines.forEach((line, idx) => {
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
