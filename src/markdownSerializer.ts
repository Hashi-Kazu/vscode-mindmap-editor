import { MindMapNode } from './types';

export function serializeToMarkdown(
  root: MindMapNode,
  frontmatter: string,
  preamble: string,
  collapsedPaths: string[],
  bodyItemCollapsedPaths: string[] = []
): string {
  const parts: string[] = [];

  // Build frontmatter with updated collapse state
  const fm = buildFrontmatter(frontmatter, collapsedPaths, bodyItemCollapsedPaths);
  if (fm) {
    parts.push(fm);
    parts.push('');
  }

  // Preamble (content before any heading)
  if (preamble.trim()) {
    parts.push(preamble);
    parts.push('');
  }

  // Serialize nodes
  serializeNode(root, parts);

  // Trim trailing blank lines and add single newline at end
  while (parts.length > 0 && parts[parts.length - 1].trim() === '') {
    parts.pop();
  }

  return parts.join('\n') + '\n';
}

function serializeNode(node: MindMapNode, parts: string[]): void {
  // Root level-0 nodes don't get a heading marker
  if (node.level > 0) {
    parts.push(`${'#'.repeat(node.level)} ${node.text}`);
  }

  if (node.body.trim()) {
    parts.push(node.body);
  }

  for (const child of node.children) {
    serializeNode(child, parts);
  }
}

function buildFrontmatter(
  existing: string,
  collapsedPaths: string[],
  bodyItemCollapsedPaths: string[] = []
): string {
  const collapseBlock = collapsedPaths.length > 0
    ? `mindmap-collapse:\n${collapsedPaths.map(p => `  - "${p}"`).join('\n')}`
    : '';
  const bodyCollapseBlock = bodyItemCollapsedPaths.length > 0
    ? `body-item-collapse:\n${bodyItemCollapsedPaths.map(p => `  - "${p}"`).join('\n')}`
    : '';

  if (!existing) {
    const blocks = [collapseBlock, bodyCollapseBlock].filter(Boolean).join('\n');
    return blocks ? `---\n${blocks}\n---` : '';
  }

  // Strip the --- delimiters and remove old managed blocks
  const inner = existing
    .replace(/^---\n/, '')
    .replace(/\n---$/, '')
    .replace(/mindmap-collapse:\s*\n(?:[ \t]+-[ \t]+.+\n?)*/g, '')
    .replace(/body-item-collapse:\s*\n(?:[ \t]+-[ \t]+.+\n?)*/g, '')
    .trim();

  const newInner = [inner, collapseBlock, bodyCollapseBlock].filter(Boolean).join('\n');
  return newInner ? `---\n${newInner}\n---` : '';
}

/**
 * Build a flat map of { nodeId → body } from the original tree.
 * Used to restore body content after drag-and-drop (nodes keep their IDs).
 */
export function buildBodyMapById(root: MindMapNode): Map<string, string> {
  const map = new Map<string, string>();
  collectBodies(root, map);
  return map;
}

function collectBodies(node: MindMapNode, map: Map<string, string>): void {
  map.set(node.id, node.body);
  node.children.forEach(c => collectBodies(c, map));
}

/**
 * Walk the webview tree and fill in missing body values from the id→body map.
 */
export function applyBodiesById(
  node: MindMapNode,
  bodyMap: Map<string, string>
): void {
  if (!node.body && bodyMap.has(node.id)) {
    node.body = bodyMap.get(node.id)!;
  }
  node.children.forEach(c => applyBodiesById(c, bodyMap));
}
