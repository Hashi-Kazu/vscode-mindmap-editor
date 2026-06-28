import * as vscode from 'vscode';
import * as path from 'path';
import { parseMarkdown, extractCollapsedPaths, applyCollapsedPaths, extractLeftPaths } from './markdownParser';
import { serializeToMarkdown } from './markdownSerializer';
import { detectConflict, normalizeText } from './conflictDetection';
import { normalizeTreeCheckboxes } from './bodyItems';
import { MindMapNode } from './types';

export class MindMapPanel {
  private static readonly panels = new Map<string, MindMapPanel>();
  // The panel most recently created or interacted with. Used as the target for
  // "follow the active editor": when the user focuses a different .md file we
  // retarget this panel instead of spawning a duplicate.
  private static activePanel: MindMapPanel | null = null;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private document: vscode.TextDocument;
  private disposables: vscode.Disposable[] = [];
  // Disposable for the per-document onDidChangeTextDocument listener. Recreated
  // whenever the panel retargets a new document so the sync follows the swap.
  private docChangeListener: vscode.Disposable | null = null;

  // Parsed state cache — kept in sync WITHOUT re-parsing after our own edits
  private lastPreamble = '';
  private lastFrontmatter = '';
  private lastRoot: MindMapNode | null = null;
  private lastBodyItemCollapsePaths: string[] = [];
  private lastLeftPaths: string[] = [];

  // The exact document text (newline-normalized) the cached tree above was last
  // parsed from. Used as the optimistic-concurrency "base": before a full
  // document overwrite we verify the live/disk content still equals this, so a
  // concurrent external edit (shared drive / Git pull) is detected instead of
  // being silently clobbered. null until the first sync.
  private baseText: string | null = null;

  // Guard against echo loops: skip onDidChangeTextDocument while we apply our own edit
  private applyingEdit = false;
  // True while processing a webview message — external MD changes are deferred
  private isOperating = false;
  // Set to true once the webview sends its 'ready' signal
  private webviewReady = false;
  // True until the body-item checkbox migration has run once for this panel.
  // The migration converts legacy top-level plain bullets to empty checkboxes
  // on first load and writes back if anything changed.
  private needsCheckboxMigration = true;
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
      MindMapPanel.activePanel = existing;
      existing.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }
    MindMapPanel.activePanel = new MindMapPanel(extensionUri, document);
  }

  /**
   * Follow the active editor: when the user focuses a different Markdown
   * document, retarget the active mindmap panel to that document instead of
   * leaving the viewer stuck on the document it was opened with. No-op when:
   *  - there is no open panel,
   *  - the target document is already shown by some panel (just track it),
   *  - a panel keyed to the same URI already exists (avoid two panels for one
   *    doc — retarget that one instead).
   * Non-Markdown editors (output panel, settings, etc.) never reach here; the
   * caller filters on languageId, so the viewer keeps its current content.
   */
  public static followActiveDocument(document: vscode.TextDocument): void {
    const key = document.uri.toString();

    // Already the target of some panel — just make it the active one.
    const sameDocPanel = MindMapPanel.panels.get(key);
    if (sameDocPanel) {
      MindMapPanel.activePanel = sameDocPanel;
      return;
    }

    const target = MindMapPanel.activePanel;
    if (!target) return; // no viewer open — nothing to follow

    target.switchDocument(document);
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

    this.registerDocChangeListener();

    const cfgSub = vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('mindmap.fontSize')) {
        const fs = vscode.workspace.getConfiguration('mindmap').get<number>('fontSize', 14);
        this.panel.webview.postMessage({ type: 'setFontSize', fontSize: fs });
      }
      if (e.affectsConfiguration('mindmap.edgeWidth')) {
        const edgeWidth = vscode.workspace.getConfiguration('mindmap').get<number>('edgeWidth', 1.5);
        this.panel.webview.postMessage({ type: 'setEdgeWidth', edgeWidth });
      }
    });
    this.disposables.push(cfgSub);

    // Track focus into this panel so it becomes the active follow target.
    this.panel.onDidChangeViewState(
      (e) => {
        if (e.webviewPanel.active) MindMapPanel.activePanel = this;
      },
      null,
      this.disposables
    );

    // Fallback: if the webview never sends 'ready' within 2 s, push anyway.
    // (e.g., retainContextWhenHidden restores a hidden webview without re-running JS)
    const fallbackTimer = setTimeout(() => {
      if (!this.webviewReady) {
        this.syncFromDocument(document);
        void this.maybeMigrateCheckboxes();
      }
    }, 2000);
    this.disposables.push({ dispose: () => clearTimeout(fallbackTimer) });
  }

  /**
   * (Re)create the onDidChangeTextDocument listener bound to the CURRENT
   * this.document. Must be called again after switchDocument so external-edit
   * sync follows the new target. The previous listener (if any) is disposed.
   */
  private registerDocChangeListener(): void {
    this.docChangeListener?.dispose();
    this.docChangeListener = vscode.workspace.onDidChangeTextDocument((e) => {
      if (
        !this.applyingEdit &&
        !this.isOperating &&
        e.document.uri.toString() === this.document.uri.toString()
      ) {
        this.syncFromDocument(e.document);
      }
    });
    this.disposables.push(this.docChangeListener);
  }

  /**
   * Retarget this panel to a different Markdown document (follow the active
   * editor). Safe against the in-flight edit machinery: writes for the previous
   * document are serialized through _editQueue, so we wait for the queue to
   * drain before swapping document-scoped state. All per-document caches/flags
   * are reset so the new document is treated as a fresh open (base snapshot,
   * collapse paths, checkbox migration), and the panels Map key + title follow
   * the swap. Never touches file contents — purely a view retarget (NF-03).
   */
  public switchDocument(document: vscode.TextDocument): void {
    if (document.uri.toString() === this.document.uri.toString()) return;

    // Defer the actual swap until any queued write for the OLD document has
    // completed, so we don't reset baseText/lastRoot out from under a pending
    // applyDocumentEdit (which would corrupt its concurrency check / write).
    this._editQueue = this._editQueue.then(
      () => this.performSwitch(document),
      () => this.performSwitch(document)
    );
  }

  private performSwitch(document: vscode.TextDocument): void {
    // Re-key the panels Map.
    MindMapPanel.panels.delete(this.document.uri.toString());
    this.document = document;
    MindMapPanel.panels.set(document.uri.toString(), this);
    MindMapPanel.activePanel = this;

    // Reset all document-scoped state so the new doc is a clean open.
    this.lastPreamble = '';
    this.lastFrontmatter = '';
    this.lastRoot = null;
    this.lastBodyItemCollapsePaths = [];
    this.lastLeftPaths = [];
    this.baseText = null;
    this.applyingEdit = false;
    this.isOperating = false;
    this.needsCheckboxMigration = true;

    this.panel.title = `Mind Map — ${path.basename(document.uri.fsPath)}`;

    // Rebind the external-edit listener to the new document, then render it.
    this.registerDocChangeListener();
    this.syncFromDocument(document);
    void this.maybeMigrateCheckboxes();
  }

  private syncFromDocument(doc: vscode.TextDocument): void {
    const text = doc.getText();
    const { root, frontmatter, preamble, bodyItemCollapsePaths, leftPaths } = parseMarkdown(
      text,
      doc.uri.fsPath
    );
    // Record the base snapshot the cached tree derives from, so the next write
    // can detect concurrent external edits against it.
    this.baseText = normalizeText(text);
    this.lastRoot = root;
    this.lastFrontmatter = frontmatter;
    this.lastPreamble = preamble;
    this.lastBodyItemCollapsePaths = bodyItemCollapsePaths;
    this.lastLeftPaths = leftPaths;
    this.panel.webview.postMessage({ type: 'update', root, bodyItemCollapsePaths });
    // Keep the on-disk file in sync with what the webview displays.
    // Without this, source-editor edits remain in the dirty in-memory document
    // but never reach disk — closing and reopening the file shows stale content.
    if (doc.isDirty) {
      void doc.save();
    }
  }

  /**
   * One-shot on-open migration: convert legacy top-level plain bullet body
   * items (`- text`) into empty checkboxes (`- [ ] text`) so they can be edited
   * as checkboxes, then write the result back through the normal save path.
   * Runs at most once per panel; skips the write entirely when nothing changed
   * to avoid touching the file (and dirtying it) needlessly. Guarded by
   * isOperating so the resulting document change does not trigger a redundant
   * external-edit sync.
   */
  private async maybeMigrateCheckboxes(): Promise<void> {
    if (!this.needsCheckboxMigration) return;
    this.needsCheckboxMigration = false;
    if (!this.lastRoot) return;

    const changed = normalizeTreeCheckboxes(this.lastRoot);
    if (!changed) return;

    this.isOperating = true;
    try {
      await this.commitTree();
    } finally {
      this.isOperating = false;
    }
    // Re-sync so the cached tree and webview reflect the migrated, saved file.
    this.syncFromDocument(this.document);
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
        await this.maybeMigrateCheckboxes();
        const fontSize = vscode.workspace.getConfiguration('mindmap').get<number>('fontSize', 14);
        this.panel.webview.postMessage({ type: 'setFontSize', fontSize });
        const edgeWidth = vscode.workspace.getConfiguration('mindmap').get<number>('edgeWidth', 1.5);
        this.panel.webview.postMessage({ type: 'setEdgeWidth', edgeWidth });
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
          await this.commitTree();
        } finally {
          this.isOperating = false;
        }
        // Re-sync: Markdown is authoritative — picks up any concurrent external edits.
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
        // Collapse state lives entirely in managed frontmatter and the written
        // content is regenerated from the freshly-parsed cached tree, so this
        // write must not be discarded by a false concurrent-change detection
        // (which previously left the file expanded and the re-sync reverted the
        // collapse). Suppress the conflict check for this managed-only write.
        this.isOperating = true;
        try {
          await this.commitTree(collapsedPaths, true);
        } finally {
          this.isOperating = false;
        }
        // Re-sync: keep the cached tree aligned with the serialized file.
        this.syncFromDocument(this.document);
        break;
      }

      case 'saveBodyItemCollapseState': {
        const { paths } = msg as { type: string; paths: string[] };
        this.lastBodyItemCollapsePaths = paths;
        await this.commitTree();
        // Re-sync: keep the cached tree aligned with the serialized file.
        this.syncFromDocument(this.document);
        break;
      }

      case 'setSide': {
        const { id, side } = msg as { type: string; id: string; side: 'left' | 'right' };
        if (!this.lastRoot) break;
        // Apply side to the matching root-direct child and update leftPaths
        for (const child of this.lastRoot.children) {
          if (child.id === id) {
            child.side = side;
            break;
          }
        }
        this.lastLeftPaths = extractLeftPaths(this.lastRoot);
        this.isOperating = true;
        try {
          await this.commitTree();
        } finally {
          this.isOperating = false;
        }
        this.syncFromDocument(this.document);
        break;
      }
    }
  }

  /**
   * Re-fetch the live TextDocument from its (immutable) URI before edit/save.
   * When the source editor is closed, VS Code may dispose the backing
   * TextDocument, leaving this.document a stale/closed reference whose save()
   * is a no-op. openTextDocument returns the already-loaded instance if present
   * and loads (without revealing an editor) otherwise, so save() lands on the
   * current instance and applyEdit targets the loaded doc rather than forcing a
   * fresh editor to open.
   */
  private async refreshDocument(): Promise<void> {
    this.document = await vscode.workspace.openTextDocument(this.document.uri);
  }

  private async commitTree(
    collapsedPaths?: string[],
    skipConflictCheck = false
  ): Promise<void> {
    if (!this.lastRoot) return;
    const collapsed = collapsedPaths ?? extractCollapsedPaths(this.lastRoot);
    const leftPaths = extractLeftPaths(this.lastRoot);
    this.lastLeftPaths = leftPaths;
    const newContent = serializeToMarkdown(
      this.lastRoot,
      this.lastFrontmatter,
      this.lastPreamble,
      collapsed,
      this.lastBodyItemCollapsePaths,
      leftPaths
    );
    await this.applyDocumentEdit(newContent, skipConflictCheck);
  }

  private applyDocumentEdit(newContent: string, skipConflictCheck = false): Promise<void> {
    // Chain onto the queue so writes execute one at a time. Each write
    // re-computes fullRange from the live document, preventing the stale-range
    // bug where a concurrent write with the pre-edit length would leave tail
    // content behind and duplicate nodes in the parsed tree.
    const run = async (): Promise<void> => {
      // Re-acquire the live document: if the source editor was closed, our
      // cached this.document may be a disposed instance whose save() no-ops,
      // and applyEdit against its URI would force a fresh editor to open.
      await this.refreshDocument();
      // Optimistic concurrency check BEFORE overwriting: if the file changed
      // out from under us (another person on a shared drive / after a Git pull,
      // or an external edit that arrived while isOperating suppressed the sync),
      // do not blindly clobber it.
      // Managed-frontmatter-only writes (collapse state) are regenerated from
      // the freshly-parsed cached tree and never touch user body/other
      // frontmatter (NF-03), so a concurrent-change check here would only ever
      // produce false positives that silently drop the collapse write. Skip it.
      if (!skipConflictCheck && (await this.hasConcurrentChange(newContent))) {
        const resolved = await this.resolveConflict(newContent);
        if (!resolved) return; // user chose "load latest" — abandon this write
      }

      this.applyingEdit = true;
      try {
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
          this.document.positionAt(0),
          this.document.positionAt(this.document.getText().length)
        );
        edit.replace(this.document.uri, fullRange, newContent);
        const applied = await vscode.workspace.applyEdit(edit);
        if (!applied) return;
        await this.document.save();
        // The write succeeded — this content is now the base for the next edit.
        this.baseText = normalizeText(newContent);
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

  /**
   * True when the live document or the on-disk file no longer matches the base
   * snapshot the cached tree was parsed from — i.e. a concurrent external edit
   * exists. The disk is read in addition to the in-memory TextDocument because
   * on shared drives VS Code's TextDocument can lag behind the actual file.
   */
  private async hasConcurrentChange(outgoing: string): Promise<boolean> {
    if (this.baseText === null) return false;

    const liveText = this.document.getText();
    if (detectConflict(this.baseText, liveText, outgoing)) return true;

    // Also consult the disk: the TextDocument may be stale relative to a file
    // replaced by another writer (shared drive / git checkout).
    let diskText: string;
    try {
      const bytes = await vscode.workspace.fs.readFile(this.document.uri);
      diskText = Buffer.from(bytes).toString('utf8');
    } catch {
      // File missing/unreadable (e.g. deleted) — treat as no detectable
      // conflict and let the normal write path recreate it.
      return false;
    }
    return detectConflict(this.baseText, diskText, outgoing);
  }

  /**
   * Concurrent edit detected. Ask the user how to resolve, prioritizing "no
   * silent data loss". Returns true if the caller should proceed with the
   * overwrite ("keep mine"), false if the write must be abandoned ("load
   * latest"). The discarded side is backed up to a sibling file first.
   */
  private async resolveConflict(outgoing: string): Promise<boolean> {
    const loadLatest = '最新を読み込む（自分の編集は破棄）';
    const overwrite = '自分の変更で上書き（他者の変更は破棄）';

    const choice = await vscode.window.showWarningMessage(
      `別の場所で「${path.basename(this.document.uri.fsPath)}」が変更されています。` +
        'マインドマップの編集をそのまま保存すると、他の変更が失われる可能性があります。',
      { modal: true },
      loadLatest,
      overwrite
    );

    if (choice === overwrite) {
      // Back up the other person's version before we discard it.
      await this.backupConflict('remote', this.document.getText());
      return true;
    }

    // Default (including dismissal): keep remote, discard our edit — the safe
    // choice. Back up our serialized edit so it is not lost outright.
    await this.backupConflict('mine', outgoing);
    await this.reloadFromDisk();
    return false;
  }

  /** Write a timestamped backup beside the document so neither side is lost. */
  private async backupConflict(which: 'mine' | 'remote', content: string): Promise<void> {
    try {
      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, '-')
        .replace('T', '_')
        .slice(0, 19);
      const dir = path.dirname(this.document.uri.fsPath);
      const ext = path.extname(this.document.uri.fsPath);
      const base = path.basename(this.document.uri.fsPath, ext);
      const backupName = `${base}.conflict-${which}-${stamp}${ext}`;
      const backupUri = vscode.Uri.file(path.join(dir, backupName));
      await vscode.workspace.fs.writeFile(
        backupUri,
        Buffer.from(content, 'utf8')
      );
    } catch {
      // Backup is best-effort; never let it block conflict resolution.
    }
  }

  /** Reload the document from disk and re-sync the mindmap to that state. */
  private async reloadFromDisk(): Promise<void> {
    try {
      // Refresh first so applyEdit/save below act on the live document, not a
      // disposed reference left behind by a closed source editor.
      await this.refreshDocument();
      const bytes = await vscode.workspace.fs.readFile(this.document.uri);
      const diskText = Buffer.from(bytes).toString('utf8');
      // Bring the in-memory TextDocument up to date if it lags the disk.
      if (normalizeText(this.document.getText()) !== normalizeText(diskText)) {
        this.applyingEdit = true;
        try {
          const edit = new vscode.WorkspaceEdit();
          const fullRange = new vscode.Range(
            this.document.positionAt(0),
            this.document.positionAt(this.document.getText().length)
          );
          edit.replace(this.document.uri, fullRange, diskText);
          await vscode.workspace.applyEdit(edit);
          await this.document.save();
        } finally {
          this.applyingEdit = false;
        }
      }
    } catch {
      // If the disk read fails, fall back to the current TextDocument state.
    }
    this.syncFromDocument(this.document);
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
    <button id="btn-expand-all" title="すべてのノードを展開">▶ 全展開</button>
    <button id="btn-collapse-all" title="すべてのノードを折りたたむ">▼ 全折畳</button>
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
    if (MindMapPanel.activePanel === this) {
      // Fall back to any other open panel so follow-mode keeps working.
      const next = MindMapPanel.panels.values().next();
      MindMapPanel.activePanel = next.done ? null : next.value;
    }
    this.docChangeListener = null;
    this.panel.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
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
