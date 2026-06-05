import * as path from 'path';
import { MindMapNode } from './types';

let _idCounter = 0;
function newId(): string {
  return `n${++_idCounter}`;
}

type Section = { level: number; text: string; bodyLines: string[] };

export interface ParseResult {
  root: MindMapNode;
  frontmatter: string;  // raw frontmatter block including --- delimiters
  preamble: string;     // lines before any heading (after frontmatter)
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

  // Split body into sections: each section = { level, text, bodyLines }
  const sections: Section[] = [];
  const preambleLines: string[] = [];
  let current: Section | null = null;

  for (let i = bodyStart; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6}) +(.+)$/);
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

  return { root, frontmatter, preamble };
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
