import * as vscode from 'vscode';
import * as path from 'path';
import { parseMarkdown, extractCollapsedPaths, applyCollapsedPaths } from './markdownParser';
import { serializeToMarkdown } from './markdownSerializer';
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
  private lastBodyItemCollapsePaths: string[] = [];

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
    const { root, frontmatter, preamble, bodyItemCollapsePaths } = parseMarkdown(
      doc.getText(),
      doc.uri.fsPath
    );
    this.lastRoot = root;
    this.lastFrontmatter = frontmatter;
    this.lastPreamble = preamble;
    this.lastBodyItemCollapsePaths = bodyItemCollapsePaths;
    this.panel.webview.postMessage({ type: 'update', root, bodyItemCollapsePaths });
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
          this.lastRoot = webRoot;
          const collapsed = extractCollapsedPaths(webRoot);
          const newContent = serializeToMarkdown(
            webRoot,
            this.lastFrontmatter,
            this.lastPreamble,
            collapsed,
            this.lastBodyItemCollapsePaths
          );
          await this.applyDocumentEdit(newContent);
        } finally {
          this.isOperating = false;
        }
        // Re-sync: Markdown is authoritative — picks up any concurrent external edits.
        this.syncFromDocument(this.document);
        break;
      }

      case 'editBody': {
        this.isOperating = true;
        try {
          const { id, body } = msg as { type: string; id: string; body: string };
          if (!this.lastRoot) break;
          const node = findNodeById(this.lastRoot, id);
          if (!node) break;
          node.body = body;
          const collapsed = extractCollapsedPaths(this.lastRoot);
          const newContent = serializeToMarkdown(
            this.lastRoot,
            this.lastFrontmatter,
            this.lastPreamble,
            collapsed,
            this.lastBodyItemCollapsePaths
          );
          await this.applyDocumentEdit(newContent);
        } finally {
          this.isOperating = false;
        }
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
            collapsed,
            this.lastBodyItemCollapsePaths
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
        applyCollapsedPaths(this.lastRoot, collapsedPaths, '');
        const newContent = serializeToMarkdown(
          this.lastRoot,
          this.lastFrontmatter,
          this.lastPreamble,
          collapsedPaths,
          this.lastBodyItemCollapsePaths
        );
        await this.applyDocumentEdit(newContent);
        break;
      }

      case 'saveBodyItemCollapseState': {
        const { paths } = msg as { type: string; paths: string[] };
        this.lastBodyItemCollapsePaths = paths;
        if (!this.lastRoot) break;
        const collapsed = extractCollapsedPaths(this.lastRoot);
        const newContent = serializeToMarkdown(
          this.lastRoot,
          this.lastFrontmatter,
          this.lastPreamble,
          collapsed,
          paths
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
    <span id="checkbox-progress"></span>
    <span style="flex:1"></span>
    <span id="save-indicator">✓ 保存済</span>
    <button id="btn-help" title="キーボードショートカット一覧を表示">?</button>
  </div>
  <div id="help-popup" class="hidden">
    <div class="help-section">見出しノード</div>
    <table class="help-table">
      <tr><td>矢印キー</td><td>ノード間移動</td></tr>
      <tr><td>F2 / ダブルクリック</td><td>ノード名を編集</td></tr>
      <tr><td>Enter</td><td>兄弟ノードを追加</td></tr>
      <tr><td>Tab</td><td>子ノードを追加</td></tr>
      <tr><td>Del</td><td>ノードを削除</td></tr>
      <tr><td>Alt+↑/↓</td><td>兄弟間の上下入れ替え</td></tr>
      <tr><td>Ctrl+Z</td><td>元に戻す</td></tr>
      <tr><td>Ctrl+C</td><td>コピー（複数選択対応）</td></tr>
      <tr><td>Ctrl+X</td><td>カット（複数選択対応）</td></tr>
      <tr><td>Ctrl+V</td><td>子階層にペースト</td></tr>
      <tr><td>Ctrl+S</td><td>保存</td></tr>
      <tr><td>F</td><td>画面にフィット</td></tr>
    </table>
    <div class="help-section">本文項目</div>
    <table class="help-table">
      <tr><td>Enter</td><td>同階層に本文項目を追加</td></tr>
      <tr><td>Tab</td><td>子本文項目を追加</td></tr>
      <tr><td>F2 / ダブルクリック</td><td>本文テキストを編集</td></tr>
      <tr><td>Del</td><td>本文行を削除</td></tr>
    </table>
    <div class="help-section">共通</div>
    <table class="help-table">
      <tr><td>右クリック</td><td>コンテキストメニュー</td></tr>
      <tr><td>Ctrl+クリック</td><td>複数選択</td></tr>
      <tr><td>Ctrl++/-</td><td>ズームイン/アウト</td></tr>
      <tr><td>ドラッグ</td><td>ノード/本文の移動（複数選択対応）</td></tr>
    </table>
  </div>
  <div id="stage">
    <svg id="svg-layer"></svg>
    <div id="node-layer"></div>
    <div id="drop-indicator"></div>
  </div>
  <ul id="context-menu" class="hidden">
    <!-- dynamically built by mindmap.js -->
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
