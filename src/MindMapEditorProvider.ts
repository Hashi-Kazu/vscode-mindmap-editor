import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { parseMarkdown, serializeMarkdown, MindMapNode, ParseResult } from './markdownProcessor';

export class MindMapEditorProvider implements vscode.CustomTextEditorProvider {

  public static readonly viewType = 'mindmap.editor';

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new MindMapEditorProvider(context);
    const registration = vscode.window.registerCustomEditorProvider(
      MindMapEditorProvider.viewType,
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }
    );
    return registration;
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
      ],
    };

    webviewPanel.webview.html = this.getHtmlForWebview(
      webviewPanel.webview,
      document
    );

    // Track if we caused the document change to avoid re-render loops
    let ignoreNextChange = false;

    const updateWebview = () => {
      const parsed = parseMarkdown(document.getText());
      webviewPanel.webview.postMessage({ type: 'update', data: parsed });
    };

    const changeSubscription = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.toString() !== document.uri.toString()) return;
      if (ignoreNextChange) {
        ignoreNextChange = false;
        return;
      }
      updateWebview();
    });

    webviewPanel.onDidDispose(() => changeSubscription.dispose());

    webviewPanel.webview.onDidReceiveMessage(async message => {
      switch (message.type) {
        case 'updateTree': {
          const currentParsed = parseMarkdown(document.getText());
          currentParsed.root = message.root;
          const newContent = serializeMarkdown(currentParsed);
          ignoreNextChange = true;
          const edit = new vscode.WorkspaceEdit();
          edit.replace(
            document.uri,
            new vscode.Range(
              new vscode.Position(0, 0),
              new vscode.Position(document.lineCount, 0)
            ),
            newContent
          );
          await vscode.workspace.applyEdit(edit);
          break;
        }
        case 'openTextEditor': {
          await vscode.commands.executeCommand(
            'vscode.openWith',
            document.uri,
            'default'
          );
          break;
        }
        case 'showConfirm': {
          const answer = await vscode.window.showWarningMessage(
            message.text,
            { modal: true },
            'Delete'
          );
          webviewPanel.webview.postMessage({
            type: 'confirmResult',
            id: message.id,
            confirmed: answer === 'Delete',
          });
          break;
        }
      }
    });

    updateWebview();
  }

  private getHtmlForWebview(
    webview: vscode.Webview,
    document: vscode.TextDocument
  ): string {
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'mindmap.css')
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'mindmap.js')
    );

    const nonce = getNonce();
    const fileName = path.basename(document.uri.fsPath);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${cssUri}">
  <title>Mind Map: ${fileName}</title>
</head>
<body>
  <div id="toolbar">
    <span id="file-name" class="file-name">${fileName}</span>
    <div class="toolbar-actions">
      <button id="btn-fit" title="Fit to screen">⊞</button>
      <button id="btn-zoom-in" title="Zoom in">+</button>
      <button id="btn-zoom-out" title="Zoom out">−</button>
      <button id="btn-text-editor" title="Open as text">⌨ Text</button>
    </div>
  </div>
  <div id="svg-container">
    <svg id="mindmap-svg" xmlns="http://www.w3.org/2000/svg">
      <g id="tree-group"></g>
    </svg>
  </div>
  <div id="edit-overlay" style="display:none;">
    <input id="edit-input" type="text" autocomplete="off" spellcheck="true">
  </div>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
