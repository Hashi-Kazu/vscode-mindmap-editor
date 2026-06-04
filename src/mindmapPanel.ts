import * as vscode from 'vscode';
import * as path from 'path';
import { parseMarkdown, extractCollapsedPaths } from './markdownParser';
import { serializeToMarkdown, buildBodyMapById, applyBodiesById } from './markdownSerializer';
import { MindMapNode } from './types';

export class MindMapPanel {
  private static readonly panels = new Map<string, MindMapPanel>();

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private document: vscode.TextDocument;
  private disposables: vscode.Disposable[] = [];

  // Parsed state cache — kept in sync WITHOUT re-parsing after our own edits
  private lastPreamble = '';
  private lastFrontmatter = '';
  private lastRoot: MindMapNode | null = null;

  // Guard against echo loops
  private applyingEdit = false;
  // Set to true once the webview sends its 'ready' signal
  private webviewReady = false;

  public static createOrShow(
    extensionUri: vscode.Uri,
    document: vscode.TextDocument
  ): void {
    const key = document.uri.toString();
    const existing = MindMapPanel.panels.get(key);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }
    new MindMapPanel(extensionUri, document);
  }

  private constructor(extensionUri: vscode.Uri, document: vscode.TextDocument) {
    this.extensionUri = extensionUri;
    this.document = document;

    this.panel = vscode.window.createWebviewPanel(
      'mindmapEditor',
      `Mind Map — ${path.basename(document.uri.fsPath)}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
        retainContextWhenHidden: true,
      }
    );

    MindMapPanel.panels.set(document.uri.toString(), this);

    this.panel.webview.html = this.buildHtml();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (msg) => this.handleWebviewMessage(msg),
      null,
      this.disposables
    );

    const docChangeListener = vscode.workspace.onDidChangeTextDocument((e) => {
      if (
        !this.applyingEdit &&
        e.document.uri.toString() === document.uri.toString()
      ) {
        this.syncFromDocument(e.document);
      }
    });
    this.disposables.push(docChangeListener);

    // Fallback: if the webview never sends 'ready' within 2 s, push anyway.
    // (e.g., retainContextWhenHidden restores a hidden webview without re-running JS)
    const fallbackTimer = setTimeout(() => {
      if (!this.webviewReady) this.syncFromDocument(document);
    }, 2000);
    this.disposables.push({ dispose: () => clearTimeout(fallbackTimer) });
  }

  private syncFromDocument(doc: vscode.TextDocument): void {
    const { root, frontmatter, preamble } = parseMarkdown(
      doc.getText(),
      doc.uri.fsPath
    );
    this.lastRoot = root;
    this.lastFrontmatter = frontmatter;
    this.lastPreamble = preamble;
    this.panel.webview.postMessage({ type: 'update', root });
  }

  private async handleWebviewMessage(msg: {
    type: string;
    [key: string]: unknown;
  }): Promise<void> {
    switch (msg.type) {
      case 'ready': {
        // Webview script has loaded and is listening — send the initial tree.
        this.webviewReady = true;
        this.syncFromDocument(this.document);
        break;
      }

      case 'structuralEdit': {
        const webRoot = msg.root as MindMapNode;
        // Restore body content using ID-based lookup from the previous lastRoot.
        if (this.lastRoot) {
          const bodyMap = buildBodyMapById(this.lastRoot);
          applyBodiesById(webRoot, bodyMap);
        }
        // The webview's tree is now the authoritative version — adopt its IDs.
        this.lastRoot = webRoot;
        const collapsed = extractCollapsedPaths(webRoot);
        const newContent = serializeToMarkdown(
          webRoot,
          this.lastFrontmatter,
          this.lastPreamble,
          collapsed
        );
        await this.applyDocumentEdit(newContent);
        break;
      }

      case 'renameNode': {
        const { id, newText } = msg as { type: string; id: string; newText: string };
        if (!this.lastRoot) break;
        const node = findNodeById(this.lastRoot, id);
        if (!node) break;
        // Update in-place so IDs stay stable for the next round-trip.
        node.text = newText;
        const collapsed = extractCollapsedPaths(this.lastRoot);
        const newContent = serializeToMarkdown(
          this.lastRoot,
          this.lastFrontmatter,
          this.lastPreamble,
          collapsed
        );
        await this.applyDocumentEdit(newContent);
        break;
      }

      case 'saveCollapseState': {
        const { collapsedPaths } = msg as {
          type: string;
          collapsedPaths: string[];
        };
        if (!this.lastRoot) break;
        // Update collapse flags in lastRoot without re-parsing.
        applyCollapsedPaths(this.lastRoot, collapsedPaths, '');
        const newContent = serializeToMarkdown(
          this.lastRoot,
          this.lastFrontmatter,
          this.lastPreamble,
          collapsedPaths
        );
        await this.applyDocumentEdit(newContent);
        break;
      }
    }
  }

  private async applyDocumentEdit(newContent: string): Promise<void> {
    this.applyingEdit = true;
    try {
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(
        this.document.positionAt(0),
        this.document.positionAt(this.document.getText().length)
      );
      edit.replace(this.document.uri, fullRange, newContent);
      await vscode.workspace.applyEdit(edit);
      // Do NOT re-parse here — each message handler updates lastRoot in-place
      // so IDs remain consistent across multiple webview round-trips.
    } finally {
      this.applyingEdit = false;
    }
  }

  private buildHtml(): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'mindmap.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'mindmap.css')
    );
    const nonce = generateNonce();

    return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             style-src ${webview.cspSource} 'unsafe-inline';
             script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}">
  <title>Mind Map</title>
</head>
<body>
  <div id="toolbar">
    <button id="btn-zoom-in" title="拡大 (Ctrl++)">＋</button>
    <button id="btn-zoom-out" title="縮小 (Ctrl+-)">－</button>
    <button id="btn-fit" title="画面にフィット (F)">⊡</button>
    <span class="sep"></span>
    <button id="btn-expand-all" title="すべて展開">↕ 展開</button>
    <button id="btn-collapse-all" title="すべて折りたたむ">↕ 折畳</button>
    <span class="sep"></span>
    <span id="hint">ダブルクリック: 編集　右クリック: ノード操作　ドラッグ: 移動　Alt+↑↓: 上下入替</span>
  </div>
  <div id="stage">
    <svg id="svg-layer"></svg>
    <div id="node-layer"></div>
    <div id="drop-indicator"></div>
  </div>
  <ul id="context-menu" class="hidden">
    <li id="ctx-add-child">子ノードを追加</li>
    <li id="ctx-add-sibling">兄弟ノードを追加</li>
    <li class="divider"></li>
    <li id="ctx-move-up">↑ 上へ移動</li>
    <li id="ctx-move-down">↓ 下へ移動</li>
    <li class="divider"></li>
    <li id="ctx-delete" class="danger">削除</li>
  </ul>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  public dispose(): void {
    MindMapPanel.panels.delete(this.document.uri.toString());
    this.panel.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}

function applyCollapsedPaths(
  node: MindMapNode,
  paths: string[],
  parentPath: string
): void {
  const myPath = parentPath ? `${parentPath}/${node.text}` : node.text;
  node.collapsed = paths.includes(myPath);
  for (const child of node.children) {
    applyCollapsedPaths(child, paths, myPath);
  }
}

function findNodeById(node: MindMapNode, id: string): MindMapNode | null {
  if (node.id === id) return node;
  for (const c of node.children) {
    const found = findNodeById(c, id);
    if (found) return found;
  }
  return null;
}

function generateNonce(): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}
