export interface MindMapNode {
  id: string;
  text: string;
  level: number;  // 0=root(filename), 1=H1, 2=H2 ... 6=H6
  children: MindMapNode[];
  collapsed: boolean;
  body: string;   // non-heading content lines after this heading
  side?: 'left' | 'right';  // layout side (root's direct H1 children only)
}

// Messages: extension → webview
export type ExtensionMessage =
  | {
      type: 'update';
      root: MindMapNode;
      bodyItemCollapsePaths: string[];
      // Sync generation of this tree snapshot + the document it came from.
      // Echoed back on structuralEdit so stale/wrong-document edits are
      // detected (R-11-09 / R-19-04).
      generation: number;
      docUri: string;
    };

// Messages: webview → extension
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'save' }
  | {
      type: 'structuralEdit';
      root: MindMapNode;
      // Generation/document the webview tree was based on (optional for
      // backward compatibility with older webview scripts).
      baseGeneration?: number;
      docUri?: string;
    }
  | { type: 'saveCollapseState'; collapsedPaths: string[] }
  | { type: 'saveBodyItemCollapseState'; paths: string[] }
  | { type: 'setSide'; id: string; side: 'left' | 'right' };
