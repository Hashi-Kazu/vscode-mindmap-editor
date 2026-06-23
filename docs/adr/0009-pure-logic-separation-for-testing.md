---
name: pure-logic-separation-for-testing
description: VS Code APIに依存しない純粋ロジックをsrc/*.tsに分離し、node:testベースのユニットテストを可能にした設計判断
metadata:
  type: project
---

# ADR-0009: 純粋ロジック分離による Node.js テスト基盤

- ステータス: 承認済み
- 確信度: 高（commit 25ed87d のメッセージと `test/` ディレクトリ構成から明確）
- 日付: v2.3.3（commit 25ed87d）

## コンテキスト

VS Code 拡張機能のコアロジック（Markdown パース、シリアライズ、競合検知、本文項目処理）は VS Code API を必要としないが、`mindmapPanel.ts` と密結合していると VS Code 環境なしではテストできない。拡張機能のユニットテストには通常 VS Code の拡張テストランナーが必要で、起動コストが高い。

## 決定

VS Code API に依存しない純粋なロジックを独立したモジュールに分離し、`node:test` + `node:assert` でテストできるようにした。

分離されたモジュール:
- `src/markdownParser.ts` — Markdown → ツリー変換
- `src/markdownSerializer.ts` — ツリー → Markdown 変換
- `src/conflictDetection.ts` — 競合検知ロジック
- `src/bodyItems.ts` — 本文項目のチェックボックス処理

テストは `test/` 以下に配置し、`esbuild.test.js` でトランスパイルして `dist-test/` に出力。`node --test "dist-test/**/*.test.js"` で実行する（`package.json` の `test` スクリプト）。

## 理由

commit 25ed87d より「node:test/node:assertベースのテスト基盤を追加」。VS Code 拡張テストランナーを使わずに純粋ロジックをテストすることで、テスト実行が高速・軽量になる。

`conflictDetection.ts` 冒頭コメント: 「Pure logic lives here so it can be unit-tested without the VS Code API.」

## 捨てた選択肢

- **VS Code Extension Test Runner**: `@vscode/test-electron` によるフルスタックテスト。起動が重く、CI での実行コストが高い。マインドマップの純粋ロジックには過剰。
- **Jest / Vitest**: 外部テストフレームワークの依存追加を避け、Node.js 組み込みの `node:test` を選択した（依存最小化ポリシーと整合）。

**How to apply:** 純粋ロジックを変えたら必ず `test/` も更新すること（CLAUDE.md の「検証」セクション参照）。`media/mindmap.js` と `src/bodyItems.ts` の二重管理に注意。
