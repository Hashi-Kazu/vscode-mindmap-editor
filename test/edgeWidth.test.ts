import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(process.cwd(), 'src', 'mindmapPanel.ts'), 'utf8');

test('R-19-07: cfgSub handles mindmap.edgeWidth configuration changes', () => {
  const cfgSubStart = source.indexOf('const cfgSub =');
  const cfgSubEnd = source.indexOf('this.disposables.push(cfgSub)', cfgSubStart);
  const cfgSub = source.slice(cfgSubStart, cfgSubEnd);

  assert.ok(cfgSub.includes("affectsConfiguration('mindmap.edgeWidth')"));
  assert.ok(cfgSub.includes("get<number>('edgeWidth', 1.5)"));
  assert.ok(cfgSub.includes("type: 'setEdgeWidth'"));
});

test("R-19-07: case 'ready' sends the initial edgeWidth", () => {
  const readyStart = source.indexOf("case 'ready':");
  const readyEnd = source.indexOf("case 'save':", readyStart);
  const readyBlock = source.slice(readyStart, readyEnd);

  assert.ok(readyBlock.includes("get<number>('edgeWidth', 1.5)"));
  assert.ok(readyBlock.includes("postMessage({ type: 'setEdgeWidth', edgeWidth })"));
});
