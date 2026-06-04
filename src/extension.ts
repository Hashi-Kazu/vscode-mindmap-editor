import * as vscode from 'vscode';
import { MindMapEditorProvider } from './MindMapEditorProvider';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(MindMapEditorProvider.register(context));

  context.subscriptions.push(
    vscode.commands.registerCommand('mindmap.openAsMindMap', async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) {
        vscode.window.showErrorMessage('No Markdown file is open.');
        return;
      }
      await vscode.commands.executeCommand(
        'vscode.openWith',
        target,
        MindMapEditorProvider.viewType
      );
    })
  );
}

export function deactivate() {}
