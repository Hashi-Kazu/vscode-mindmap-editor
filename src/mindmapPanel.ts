import * as vscode from 'vscode';
import * as path from 'path';
import { parseMarkdown, extractCollapsedPaths, applyCollapsedPaths } from './markdownParser';
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

  // Guard against echo loops: skip onDidChangeTextDocument while we apply our own edit
  private applyingEdit = false;
  // True while processing a webview message — external MD changes are deferred
  private isOperating = false;
  // Set to true once the webview sends its 'ready' signal
  private webviewReady = false;
  // Serializes document writes — prevents concurrent applyDocumentEdit calls from
  // computing stale fullRange values, which would leave tail content and duplicate nodes.
  private _editQueue: Promise<void> = Promise.resolve();

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
        !this.isOperating &&
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

      case 'save': {
        // Ctrl+S from the webview — save the backing Markdown document.
        await this.document.save();
        break;
      }

      case 'structuralEdit': {
        this.isOperating = true;
        try {
          const webRoot = msg.root as MindMapNode;
          if (this.lastRoot) {
            const bodyMap = buildBodyMapById(this.lastRoot);
            applyBodiesById(webRoot, bodyMap);
          }
          this.lastRoot = webRoot;
          const collapsed = extractCollapsedPaths(webRoot);
          const newContent = serializeToMarkdown(
            webRoot,
            this.lastFrontmatter,
            this.lastPreamble,
            collapsed
          );
          await this.applyDocumentEdit(newContent);
        } finally {
          this.isOperating = false;
        }
        // Re-sync: Markdown is authoritative — picks up any concurrent external edits.
        this.syncFromDocument(this.document);
        break;
      }

      case 'renameNode': {
        this.isOperating = true;
        try {
          const { id, newText } = msg as { type: string; id: string; newText: string };
          if (!this.lastRoot) break;
          const node = findNodeById(this.lastRoot, id);
          if (!node) break;
          node.text = newText;
          const collapsed = extractCollapsedPaths(this.lastRoot);
          const newContent = serializeToMarkdown(
            this.lastRoot,
            this.lastFrontmatter,
            this.lastPreamble,
            collapsed
          );
          await this.applyDocumentEdit(newContent);
        } finally {
          this.isOperating = false;
        }
        // Re-sync: ensures webview reflects the saved Markdown state.
        this.syncFromDocument(this.document);
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

  private applyDocumentEdit(newContent: string): Promise<void> {
    // Chain onto the queue so writes execute one at a time. Each write
    // re-computes fullRange from the live document, preventing the stale-range
    // bug where a concurrent write with the pre-edit length would leave tail
    // content behind and duplicate nodes in the parsed tree.
    const run = async (): Promise<void> => {
      this.applyingEdit = true;
      try {
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
          this.document.positionAt(0),
          this.document.positionAt(this.document.getText().length)
        );
        edit.replace(this.document.uri, fullRange, newContent);
        await vscode.workspace.applyEdit(edit);
        await this.document.save();
        this.panel.webview.postMessage({ type: 'saved' });
      } finally {
        this.applyingEdit = false;
      }
    };
    const next = this._editQueue.then(run, run);
    // Keep the queue alive even if a write fails.
    this._editQueue = next.then(() => {}, () => {});
    return next;
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
    <button id="btn-expand-all" title="選択ノードを展開">▶ 展開</button>
    <button id="btn-collapse-all" title="選択ノードを折りたたむ">▼ 折畳</button>
    <span class="sep"></span>
    <span id="hint">矢印キー: 移動　Enter: 兄弟追加　F2/ダブルクリック: 編集　Tab: 子追加　Alt+↑↓: 上下入替　Del: 削除　Ctrl+Z: 元に戻す</span>
    <span id="save-indicator">✓ 保存済</span>
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
