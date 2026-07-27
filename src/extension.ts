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

  // Active-editor reaction, gated by `mindmap.viewerMode` (R-19-11):
  //  - 'perFile' (default): each file keeps its own viewer (R-19-08). Focusing a
  //    .md only brings that file's existing panel to the front (R-19-09); the
  //    target document of an open panel is never swapped and no panel is opened
  //    implicitly.
  //  - 'shared': legacy behaviour — retarget the active viewer to the focused
  //    document (R-19-01).
  // Non-Markdown editors (output panel, settings, images, etc.) are ignored so
  // the viewer keeps its current content rather than being cleared (R-19-02).
  const followListener = vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (!editor) return;
    if (editor.document.languageId !== 'markdown') return;
    if (MindMapPanel.resolveViewerMode() === 'shared') {
      MindMapPanel.followActiveDocument(editor.document);
    } else {
      MindMapPanel.revealExistingFor(editor.document.uri);
    }
  });
  context.subscriptions.push(followListener);
}

export function deactivate(): void {}
