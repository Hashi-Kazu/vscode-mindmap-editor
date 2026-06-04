import * as vscode from 'vscode';
import { MindMapPanel } from './mindmapPanel';

export function activate(context: vscode.ExtensionContext): void {
  const cmd = vscode.commands.registerCommand(
    'mindmap.openMindMap',
    (uri?: vscode.Uri) => {
      // Called from explorer context menu (uri provided) or editor title (use active editor)
      if (uri) {
        vscode.workspace.openTextDocument(uri).then((doc) => {
          MindMapPanel.createOrShow(context.extensionUri, doc);
        });
        return;
      }

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('まずMarkdownファイルを開いてください。');
        return;
      }
      if (editor.document.languageId !== 'markdown') {
        vscode.window.showErrorMessage(
          'マインドマップはMarkdownファイル（.md）にのみ対応しています。'
        );
        return;
      }
      MindMapPanel.createOrShow(context.extensionUri, editor.document);
    }
  );

  context.subscriptions.push(cmd);
}

export function deactivate(): void {}
