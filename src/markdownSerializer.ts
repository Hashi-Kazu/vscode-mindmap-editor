import { MindMapNode } from './types';

export function serializeToMarkdown(
  root: MindMapNode,
  frontmatter: string,
  preamble: string,
  collapsedPaths: string[],
  bodyItemCollapsedPaths: string[] = []
): string {
  const parts: string[] = [];

  // Collapse paths are stored on disk relative to the root (filename) so they
  // survive a file rename. Strip the root prefix before writing to frontmatter.
  const relCollapsed = collapsedPaths.map(p => stripRootPrefix(p, root.text));
  const relBodyItem = bodyItemCollapsedPaths.map(p => stripBodyItemRootPrefix(p, root.text));

  // Build frontmatter with updated collapse state
  const fm = buildFrontmatter(frontmatter, relCollapsed, relBodyItem);
  if (fm) {
    parts.push(fm);
    parts.push('');
  }

  // Preamble (content before any heading). The blank line that separates the
  // frontmatter from the preamble (and the preamble from the first heading) is
  // added below via single '' separators, so trim both leading and trailing
  // blank lines the parser may have retained. Stripping the leading blanks is
  // essential when a frontmatter block precedes the preamble: the parser keeps
  // the blank line that follows the closing '---' as part of the preamble, and
  // without normalization it accumulates one extra blank line per round-trip.
  const trimmedPreamble = preamble.replace(/^\n+/, '').replace(/\n+$/, '');
  if (trimmedPreamble.trim()) {
    parts.push(trimmedPreamble);
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

/** Remove a leading "<root>/" segment from a slash-separated heading path. */
function stripRootPrefix(p: string, rootText: string): string {
  const prefix = `${rootText}/`;
  return p.startsWith(prefix) ? p.slice(prefix.length) : p;
}

/**
 * Body-item paths are "<headingPath>::<itemChain>". Only the headingPath part
 * carries the root (filename) prefix, so strip it just from that segment.
 */
function stripBodyItemRootPrefix(p: string, rootText: string): string {
  const sep = p.indexOf('::');
  if (sep === -1) return stripRootPrefix(p, rootText);
  const headingPath = p.slice(0, sep);
  const rest = p.slice(sep);
  return stripRootPrefix(headingPath, rootText) + rest;
}

