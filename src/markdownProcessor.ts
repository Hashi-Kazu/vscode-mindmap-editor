export interface MindMapNode {
  id: string;
  text: string;
  children: MindMapNode[];
  collapsed: boolean;
  bodyLines: string[];
}

export interface ParseResult {
  root: MindMapNode;
  frontmatterLines: string[];
  baseLevel: number; // 1 if root came from H1, 0 if virtual root
}

let idCounter = 0;

function makeId(): string {
  return `n${++idCounter}_${Date.now()}`;
}

export function parseMarkdown(content: string): ParseResult {
  idCounter = 0;
  const lines = content.split('\n');

  let frontmatterLines: string[] = [];
  let startIndex = 0;
  const collapsedSet = new Set<string>();

  // Parse YAML frontmatter
  if (lines[0]?.trim() === '---') {
    const endIdx = lines.slice(1).findIndex(l => l.trim() === '---' || l.trim() === '...');
    if (endIdx >= 0) {
      frontmatterLines = lines.slice(0, endIdx + 2);
      startIndex = endIdx + 2;
      // Extract mindmap-collapsed list
      let inCollapsed = false;
      for (const fmLine of frontmatterLines) {
        if (/^mindmap-collapsed\s*:/.test(fmLine)) {
          inCollapsed = true;
          continue;
        }
        if (inCollapsed) {
          const m = fmLine.match(/^\s+-\s+"?(.+?)"?\s*$/);
          if (m) {
            collapsedSet.add(m[1]);
          } else if (/^\S/.test(fmLine)) {
            inCollapsed = false;
          }
        }
      }
    }
  }

  const virtualRoot: MindMapNode = {
    id: 'root',
    text: 'Document',
    children: [],
    collapsed: false,
    bodyLines: [],
  };

  // Stack of [node, headingLevel]. stack[0] = virtual root at level 0
  const stack: Array<{ node: MindMapNode; level: number }> = [
    { node: virtualRoot, level: 0 },
  ];
  let lastNode: MindMapNode = virtualRoot;

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^(#{1,6})\s+(.+)$/);
    if (m) {
      const level = m[1].length;
      const text = m[2].trim();
      const node: MindMapNode = {
        id: `n_${i}`,
        text,
        children: [],
        collapsed: false,
        bodyLines: [],
      };

      // Pop until parent has lower level
      while (stack.length > 1 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }

      stack[stack.length - 1].node.children.push(node);
      stack.push({ node, level });
      lastNode = node;
    } else {
      lastNode.bodyLines.push(line);
    }
  }

  // Promote single H1 to root
  let root = virtualRoot;
  let baseLevel = 0;

  if (
    virtualRoot.children.length === 1 &&
    stack.some(s => s.node === virtualRoot.children[0] && s.level === 1)
  ) {
    const h1 = virtualRoot.children[0];
    root = {
      id: 'root',
      text: h1.text,
      children: h1.children,
      collapsed: false,
      bodyLines: [...virtualRoot.bodyLines, ...h1.bodyLines],
    };
    baseLevel = 1;
  }

  // Apply collapse state from frontmatter
  function applyCollapse(node: MindMapNode, path: string) {
    if (collapsedSet.has(path)) {
      node.collapsed = true;
    }
    for (const child of node.children) {
      applyCollapse(child, path ? `${path} > ${child.text}` : child.text);
    }
  }

  applyCollapse(root, root.text);

  return { root, frontmatterLines, baseLevel };
}

export function serializeMarkdown(result: ParseResult): string {
  const { root, frontmatterLines, baseLevel } = result;
  const lines: string[] = [];

  // Collect collapsed paths
  const collapsedPaths: string[] = [];
  function collectCollapsed(node: MindMapNode, path: string) {
    if (node.collapsed && node.children.length > 0) {
      collapsedPaths.push(path);
    }
    for (const child of node.children) {
      collectCollapsed(child, path ? `${path} > ${child.text}` : child.text);
    }
  }
  collectCollapsed(root, root.text);

  // Build updated frontmatter
  const newFm = buildFrontmatter(frontmatterLines, collapsedPaths);
  lines.push(...newFm);

  // Write root as H1 if it was originally H1
  if (baseLevel === 1) {
    lines.push(`# ${root.text}`);
    // Trim trailing empty lines from bodyLines but preserve content
    const body = trimTrailingEmpty(root.bodyLines);
    if (body.length > 0) {
      lines.push(...body);
    }
  } else {
    // Virtual root: write its bodyLines before headings
    const body = trimTrailingEmpty(root.bodyLines);
    if (body.length > 0) {
      lines.push(...body);
    }
  }

  function writeNode(node: MindMapNode, depth: number) {
    const level = Math.min(depth + baseLevel, 6);
    lines.push(`${'#'.repeat(level)} ${node.text}`);
    const body = trimTrailingEmpty(node.bodyLines);
    if (body.length > 0) {
      lines.push(...body);
    }
    for (const child of node.children) {
      writeNode(child, depth + 1);
    }
  }

  for (const child of root.children) {
    writeNode(child, 1);
  }

  // Ensure single trailing newline
  const result2 = lines.join('\n');
  return result2.endsWith('\n') ? result2 : result2 + '\n';
}

function trimTrailingEmpty(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === '') {
    end--;
  }
  return lines.slice(0, end);
}

function buildFrontmatter(
  original: string[],
  collapsedPaths: string[]
): string[] {
  if (original.length === 0 && collapsedPaths.length === 0) {
    return [];
  }

  if (original.length === 0) {
    // Create new frontmatter
    const fm: string[] = ['---'];
    fm.push('mindmap-collapsed:');
    for (const p of collapsedPaths) {
      fm.push(`  - "${p}"`);
    }
    fm.push('---');
    return fm;
  }

  // Remove existing mindmap-collapsed block from frontmatter
  const cleaned: string[] = [];
  let inBlock = false;
  for (const line of original) {
    if (/^mindmap-collapsed\s*:/.test(line)) {
      inBlock = true;
      continue;
    }
    if (inBlock) {
      if (/^\s+-/.test(line)) continue;
      if (/^\S/.test(line)) inBlock = false;
    }
    if (!inBlock) cleaned.push(line);
  }

  // Insert mindmap-collapsed block before closing ---
  const closeIdx = cleaned.lastIndexOf('---');
  const insertIdx = closeIdx >= 0 ? closeIdx : cleaned.length;
  const inserted: string[] = [];

  if (collapsedPaths.length > 0) {
    inserted.push('mindmap-collapsed:');
    for (const p of collapsedPaths) {
      inserted.push(`  - "${p}"`);
    }
  }

  return [
    ...cleaned.slice(0, insertIdx),
    ...inserted,
    ...cleaned.slice(insertIdx),
  ];
}
