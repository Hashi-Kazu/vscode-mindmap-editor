export interface MindMapNode {
  id: string;
  text: string;
  level: number;  // 0=root(filename), 1=H1, 2=H2 ... 6=H6
  children: MindMapNode[];
  collapsed: boolean;
  body: string;   // non-heading content lines after this heading
}

// Messages: extension → webview
export type ExtensionMessage =
  | { type: 'update'; root: MindMapNode };

// Messages: webview → extension
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'save' }
  | { type: 'structuralEdit'; root: MindMapNode }
  | { type: 'renameNode'; id: string; newText: string }
  | { type: 'saveCollapseState'; collapsedPaths: string[] };
