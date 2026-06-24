import { BodyItem, BodyItemType, getBodyItemTree } from './bodyItems';

export type HorizontalKey = 'ArrowLeft' | 'ArrowRight';
export type HorizontalIntent = 'child' | 'parent';
export type BranchDirection = 'left' | 'right';

interface NavigationNode {
  id: string;
  text: string;
  level: number;
  body: string;
  children: NavigationNode[];
}

interface HeadingSegment {
  text: string;
  level: number;
}

interface BodyItemSegment {
  text: string;
  type: BodyItemType;
  checked: boolean;
  indent: number;
}

export interface BodyItemSelectionLocator {
  headingPath: HeadingSegment[];
  itemPath: BodyItemSegment[];
}

export interface ResolvedBodyItemSelection<TNode extends NavigationNode = NavigationNode> {
  parentNode: TNode;
  item: BodyItem;
}

/** Convert a physical horizontal key into a tree-relative action. */
export function getHorizontalIntent(
  direction: BranchDirection,
  key: HorizontalKey
): HorizontalIntent {
  const childKey = direction === 'left' ? 'ArrowLeft' : 'ArrowRight';
  return key === childKey ? 'child' : 'parent';
}

function sameHeadingSegment(node: NavigationNode, segment: HeadingSegment): boolean {
  return node.text === segment.text && node.level === segment.level;
}

function sameBodyItemSegment(item: BodyItem, segment: BodyItemSegment): boolean {
  return (
    item.text === segment.text &&
    item.type === segment.type &&
    item.checked === segment.checked &&
    item.indent === segment.indent
  );
}

function findHeadingPath(
  node: NavigationNode,
  targetId: string,
  path: HeadingSegment[]
): HeadingSegment[] | null {
  const nextPath = [...path, { text: node.text, level: node.level }];
  if (node.id === targetId) return nextPath;
  for (const child of node.children) {
    const found = findHeadingPath(child, targetId, nextPath);
    if (found) return found;
  }
  return null;
}

function findNodeById(
  node: NavigationNode,
  targetId: string
): NavigationNode | null {
  if (node.id === targetId) return node;
  for (const child of node.children) {
    const found = findNodeById(child, targetId);
    if (found) return found;
  }
  return null;
}

function findBodyItemPath(
  items: BodyItem[],
  targetLineIdx: number,
  path: BodyItemSegment[]
): BodyItemSegment[] | null {
  for (const item of items) {
    const nextPath = [
      ...path,
      { text: item.text, type: item.type, checked: item.checked, indent: item.indent },
    ];
    if (item.lineIdx === targetLineIdx) return nextPath;
    const found = findBodyItemPath(item.children, targetLineIdx, nextPath);
    if (found) return found;
  }
  return null;
}

/**
 * Capture a selection using content/ancestry identity rather than parser IDs or
 * line indexes, both of which can be renumbered after a document update.
 */
export function createBodyItemSelectionLocator(
  root: NavigationNode,
  parentNodeId: string,
  lineIdx: number
): BodyItemSelectionLocator | null {
  const headingPath = findHeadingPath(root, parentNodeId, []);
  if (!headingPath) return null;
  const parentNode = findNodeById(root, parentNodeId);
  if (!parentNode) return null;

  const itemPath = findBodyItemPath(getBodyItemTree(parentNode.body), lineIdx, []);
  return itemPath ? { headingPath, itemPath } : null;
}

function resolveHeadingCandidates(
  candidates: NavigationNode[],
  path: HeadingSegment[],
  depth: number
): NavigationNode[] {
  const matches = candidates.filter(node => sameHeadingSegment(node, path[depth]));
  if (depth === path.length - 1) return matches;
  return resolveHeadingCandidates(
    matches.flatMap(node => node.children),
    path,
    depth + 1
  );
}

function resolveBodyItemCandidates(
  candidates: BodyItem[],
  path: BodyItemSegment[],
  depth: number
): BodyItem[] {
  const matches = candidates.filter(item => sameBodyItemSegment(item, path[depth]));
  if (depth === path.length - 1) return matches;
  return resolveBodyItemCandidates(
    matches.flatMap(item => item.children),
    path,
    depth + 1
  );
}

/**
 * Resolve a captured body selection only when the heading and body ancestry
 * identify exactly one current item. Ambiguous or missing matches are rejected.
 */
export function resolveBodyItemSelection<TNode extends NavigationNode>(
  root: TNode,
  locator: BodyItemSelectionLocator
): ResolvedBodyItemSelection<TNode> | null {
  if (!locator.headingPath.length || !locator.itemPath.length) return null;
  const headings = resolveHeadingCandidates([root], locator.headingPath, 0) as TNode[];
  const matches: Array<ResolvedBodyItemSelection<TNode>> = [];

  for (const parentNode of headings) {
    const items = resolveBodyItemCandidates(
      getBodyItemTree(parentNode.body),
      locator.itemPath,
      0
    );
    for (const item of items) matches.push({ parentNode, item });
  }

  return matches.length === 1 ? matches[0] : null;
}
