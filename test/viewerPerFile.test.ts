import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (...parts: string[]): string =>
  readFileSync(join(process.cwd(), ...parts), 'utf8');

const panelSource = read('src', 'mindmapPanel.ts');
const extensionSource = read('src', 'extension.ts');
const packageJson = JSON.parse(read('package.json')) as {
  contributes: {
    configuration: {
      properties: Record<string, { type?: string; enum?: string[]; default?: unknown }>;
    };
  };
};

const sliceBlock = (source: string, start: string, end: string): string => {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `expected to find ${start}`);
  const to = source.indexOf(end, from);
  assert.ok(to > from, `expected to find ${end} after ${start}`);
  return source.slice(from, to);
};

test('R-19-11: mindmap.viewerMode is contributed as perFile/shared with perFile default', () => {
  const props = packageJson.contributes.configuration.properties;
  const viewerMode = props['mindmap.viewerMode'];

  assert.ok(viewerMode, 'mindmap.viewerMode must be contributed');
  assert.equal(viewerMode.type, 'string');
  assert.deepEqual(viewerMode.enum, ['perFile', 'shared']);
  assert.equal(viewerMode.default, 'perFile');

  // Backward compatibility: the legacy key must remain (deprecated, not removed).
  assert.ok(
    props['mindmap.followActiveEditor'],
    'mindmap.followActiveEditor must be kept for backward compatibility'
  );
});

test('R-19-11: resolveViewerMode uses explicit viewerMode with followActiveEditor fallback', () => {
  assert.ok(panelSource.includes('public static resolveViewerMode()'));

  const block = sliceBlock(
    panelSource,
    'public static resolveViewerMode()',
    'public static revealExistingFor'
  );

  // Explicit-setting detection via inspect(), not get() with a default.
  assert.ok(block.includes("inspect<'perFile' | 'shared'>('viewerMode')"));
  assert.ok(block.includes('globalValue'));
  assert.ok(block.includes('workspaceValue'));
  assert.ok(block.includes('workspaceFolderValue'));

  // Legacy fallback: only an explicit `true` maps to shared.
  assert.ok(block.includes("inspect<boolean>('followActiveEditor')"));
  assert.ok(/legacyExplicit === true\)\s*return 'shared'/.test(block));

  // Default is perFile.
  assert.ok(/return 'perFile';\s*\}/.test(block));
});

test('R-19-09: revealExistingFor only fronts an existing panel for the same URI', () => {
  const block = sliceBlock(
    panelSource,
    'public static revealExistingFor',
    'shared mode only (R-19-01)'
  );

  assert.ok(block.includes('MindMapPanel.panels.get(uri.toString())'));
  // No panel for that URI → do nothing (never auto-open a new panel).
  assert.ok(/if \(!existing\) return;/.test(block));
  // preserveFocus = true so the editor keeps focus.
  assert.ok(block.includes('existing.panel.reveal(vscode.ViewColumn.Beside, true)'));
  // Must never retarget an existing panel to another document.
  assert.ok(!block.includes('switchDocument'));
});

test('R-19-08/R-19-01: active-editor handler branches on the viewer mode', () => {
  const block = sliceBlock(
    extensionSource,
    'vscode.window.onDidChangeActiveTextEditor',
    'context.subscriptions.push(followListener)'
  );

  // R-19-02: non-Markdown editors are ignored before anything else happens.
  assert.ok(block.includes("if (editor.document.languageId !== 'markdown') return;"));

  // shared mode is the only path that retargets a panel.
  const sharedGuard = block.indexOf("MindMapPanel.resolveViewerMode() === 'shared'");
  assert.ok(sharedGuard >= 0, 'handler must consult MindMapPanel.resolveViewerMode()');
  const followCall = block.indexOf('MindMapPanel.followActiveDocument(');
  const revealCall = block.indexOf('MindMapPanel.revealExistingFor(');
  assert.ok(followCall > sharedGuard, 'followActiveDocument must be inside the shared branch');
  assert.ok(revealCall > followCall, 'perFile branch must call revealExistingFor');
  assert.ok(block.includes('} else {'), 'perFile must be the else branch of the shared check');
  assert.ok(block.includes('MindMapPanel.revealExistingFor(editor.document.uri)'));
});

test('R-19-10: dispose releases the URI entry, follow target and subscriptions', () => {
  const block = sliceBlock(panelSource, 'public dispose()', 'function generateNonce');

  assert.ok(block.includes('MindMapPanel.panels.delete(this.document.uri.toString())'));
  assert.ok(block.includes('MindMapPanel.activePanel === this'));
  assert.ok(block.includes('MindMapPanel.panels.values().next()'));
  assert.ok(block.includes('this.docChangeListener = null'));
  assert.ok(block.includes('this.panel.dispose()'));
  assert.ok(block.includes('for (const d of this.disposables) d.dispose()'));
  assert.ok(block.includes('this.disposables = []'));
});
