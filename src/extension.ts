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

  // Follow the active editor: when focus moves to a different Markdown document,
  // retarget the open mindmap viewer to show that document. Non-Markdown
  // editors (output panel, settings, images, etc.) are ignored so the viewer
  // keeps its current content rather than being cleared. Gated by a setting so
  // users can opt out of auto-follow.
  const followListener = vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (!editor) return;
    if (editor.document.languageId !== 'markdown') return;
    const enabled = vscode.workspace
      .getConfiguration('mindmap')
      .get<boolean>('followActiveEditor', true);
    if (!enabled) return;
    MindMapPanel.followActiveDocument(editor.document);
  });
  context.subscriptions.push(followListener);
}

export function deactivate(): void {}
