import * as path from 'path';
import { MindMapNode } from './types';

let _idCounter = 0;
function newId(): string {
  return `n${++_idCounter}`;
}

type Section = { level: number; text: string; bodyLines: string[] };

export interface ParseResult {
  root: MindMapNode;
  frontmatter: string;            // raw frontmatter block including --- delimiters
  preamble: string;               // lines before any heading (after frontmatter)
  bodyItemCollapsePaths: string[]; // body-item-collapse paths from frontmatter
  leftPaths: string[];            // mindmap-left paths from frontmatter (root-relative)
}

export function parseMarkdown(content: string, filepath: string): ParseResult {
  _idCounter = 0;
  // Normalize CRLF → LF so \r does not break heading regex on Windows files.
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let bodyStart = 0;
  let frontmatter = '';
  let collapsedPaths: string[] = [];

  // Extract YAML frontmatter
  if (lines[0]?.trim() === '---') {
    const endIdx = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
    if (endIdx > 0) {
      frontmatter = lines.slice(0, endIdx + 1).join('\n');
      bodyStart = endIdx + 1;
      collapsedPaths = parseCollapsePaths(frontmatter);
    }
  }
  const bodyItemCollapsePathsRaw = parseBodyItemCollapsePaths(frontmatter);
  const leftPathsRaw = parseLeftPaths(frontmatter);

  // Split body into sections: each section = { level, text, bodyLines }
  const sections: Section[] = [];
  const preambleLines: string[] = [];
  let current: Section | null = null;

  // Track open code-fence state so heading-like lines inside a fenced block
  // (``` or ~~~, optionally indented / with a language label) are kept as raw
  // body and never promoted to headings. A fence is closed only by a fence of
  // the same character; a non-matching fence inside an open block is content.
  let fenceChar: '`' | '~' | null = null;
  for (let i = bodyStart; i < lines.length; i++) {
    const fence = lines[i].match(/^[ \t]*(`{3,}|~{3,})/);
    if (fence) {
      const ch = fence[1][0] as '`' | '~';
      if (fenceChar === null) {
        fenceChar = ch;
      } else if (fenceChar === ch) {
        fenceChar = null;
      }
    }

    const m = fenceChar === null ? lines[i].match(/^(#{1,6}) +(.+)$/) : null;
    if (m) {
      if (current) sections.push(current);
      current = { level: m[1].length, text: m[2].trim(), bodyLines: [] };
    } else {
      if (current) {
        current.bodyLines.push(lines[i]);
      } else {
        preambleLines.push(lines[i]);
      }
    }
  }
  if (current) sections.push(current);

  const preamble = preambleLines.join('\n');

  // Filename is always the root (level 0). All headings become children.
  const baseName = path.basename(filepath, path.extname(filepath));
  const root: MindMapNode = makeNode(baseName, 0, []);

  // On-disk paths are stored relative to the root (filename) for rename safety,
  // but the in-memory tree and the webview use filename-prefixed paths. Re-add
  // the prefix to relative (new-format) paths. Old-format paths that already
  // start with the filename are kept as-is, so existing files still resolve.
  collapsedPaths = collapsedPaths.map(p => addRootPrefix(p, baseName));
  const bodyItemCollapsePaths = bodyItemCollapsePathsRaw.map(p =>
    addBodyItemRootPrefix(p, baseName)
  );
  // mindmap-left paths: stored relative to root (without filename prefix)
  const leftPaths = leftPathsRaw.map(p => addRootPrefix(p, baseName));

  // Build tree using a stack
  const stack: MindMapNode[] = [root];

  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    const node = makeNode(sec.text, sec.level, sec.bodyLines);

    // Pop stack until we find a node with lower level
    while (stack.length > 1 && stack[stack.length - 1].level >= sec.level) {
      stack.pop();
    }

    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }

  applyCollapsedPaths(root, collapsedPaths, '');
  applyLeftPaths(root, leftPaths);

  return { root, frontmatter, preamble, bodyItemCollapsePaths, leftPaths };
}

/**
 * Re-add the root (filename) prefix to a relative heading path. A path that
 * already starts with "<rootText>/" (old format) or equals "<rootText>" is
 * returned unchanged, so both formats resolve against the prefixed tree.
 */
function addRootPrefix(p: string, rootText: string): string {
  if (p === rootText || p.startsWith(`${rootText}/`)) return p;
  return `${rootText}/${p}`;
}

/** addRootPrefix for the "<headingPath>::<itemChain>" body-item format. */
function addBodyItemRootPrefix(p: string, rootText: string): string {
  const sep = p.indexOf('::');
  if (sep === -1) return addRootPrefix(p, rootText);
  const headingPath = p.slice(0, sep);
  const rest = p.slice(sep);
  return addRootPrefix(headingPath, rootText) + rest;
}

function makeNode(text: string, level: number, bodyLines: string[]): MindMapNode {
  // Trim trailing empty lines from body
  while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trim() === '') {
    bodyLines.pop();
  }
  return {
    id: newId(),
    text,
    level,
    children: [],
    collapsed: false,
    body: bodyLines.join('\n'),
  };
}

function parseLeftPaths(frontmatter: string): string[] {
  const m = frontmatter.match(/mindmap-left:\s*\n((?:[ \t]+-[ \t]+.+\n?)*)/);
  if (!m) return [];
  return m[1]
    .split('\n')
    .map(l => l.replace(/^[ \t]+-[ \t]+/, '').replace(/^['"]|['"]$/g, '').trim())
    .filter(Boolean);
}

function parseBodyItemCollapsePaths(frontmatter: string): string[] {
  const m = frontmatter.match(/body-item-collapse:\s*\n((?:[ \t]+-[ \t]+.+\n?)*)/);
  if (!m) return [];
  return m[1]
    .split('\n')
    .map(l => l.replace(/^[ \t]+-[ \t]+/, '').replace(/^['"]|['"]$/g, '').trim())
    .filter(Boolean);
}

function parseCollapsePaths(frontmatter: string): string[] {
  const m = frontmatter.match(/mindmap-collapse:\s*\n((?:[ \t]+-[ \t]+.+\n?)*)/);
  if (!m) return [];
  return m[1]
    .split('\n')
    .map(l => l.replace(/^[ \t]+-[ \t]+/, '').replace(/^['"]|['"]$/g, '').trim())
    .filter(Boolean);
}

export function applyCollapsedPaths(node: MindMapNode, paths: string[], parentPath: string): void {
  const myPath = parentPath ? `${parentPath}/${node.text}` : node.text;
  node.collapsed = paths.includes(myPath);
  for (const child of node.children) {
    applyCollapsedPaths(child, paths, myPath);
  }
}

export function extractCollapsedPaths(node: MindMapNode, parentPath = ''): string[] {
  const myPath = parentPath ? `${parentPath}/${node.text}` : node.text;
  const result: string[] = [];
  if (node.collapsed && node.children.length > 0) {
    result.push(myPath);
  }
  for (const child of node.children) {
    result.push(...extractCollapsedPaths(child, myPath));
  }
  return result;
}

/**
 * Apply side='left' to root's direct children whose paths are in leftPaths.
 * All other direct children get side='right'. H2+ descendants inherit parent's side
 * (not set here; layout code propagates downward at render time).
 */
export function applyLeftPaths(root: MindMapNode, leftPaths: string[]): void {
  for (const child of root.children) {
    const childPath = `${root.text}/${child.text}`;
    child.side = leftPaths.includes(childPath) ? 'left' : 'right';
  }
}

/**
 * Extract the filename-prefixed paths of root's direct children that have side='left'.
 */
export function extractLeftPaths(root: MindMapNode): string[] {
  return root.children
    .filter(c => c.side === 'left')
    .map(c => `${root.text}/${c.text}`);
}
