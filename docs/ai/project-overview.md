# Project Overview

## 概要

VS Code 拡張機能。Markdown の見出し構造をインタラクティブなマインドマップとして表示・編集する。TypeScript + esbuild + VS Code API 構成。

## 技術スタック

- TypeScript + esbuild
- VS Code Extension API（`@types/vscode` ^1.85.0）
- エントリポイント: `src/extension.ts`
- ビルド出力: `dist/extension.js`

## コマンド

```bash
npm run build     # 開発ビルド -> dist/
npm run watch     # ウォッチモード
npm run lint      # 型チェック + media/mindmap.js 構文チェック
npm test          # Node test
```

## ディレクトリ構成

```text
src/              # TypeScript ソース
docs/             # 要求仕様書（USDM形式）
media/            # アイコン・CSS・JS
dist/             # ビルド出力（自動生成）
```

## 実装メモ

- `src/mindmapPanel.ts` が WebviewPanel 管理、双方向同期、全文置換書き込み、コンフリクト検知/解決を担当する。
- Markdown 変換は `src/markdown{Parser,Serializer}.ts`。
- 純粋ロジック（テスト対象）は `src/conflictDetection.ts` と `src/bodyItems.ts`。
- Webview 側操作は `media/mindmap.js`。
- 本文項目ロジックは `media/mindmap.js`（バンドル対象外）と `src/bodyItems.ts`（テスト対象）に複製されている。片方を変えたら必ず両方を同期させる。
- ユーザーの Markdown 本文（見出し以外）やフロントマター（折りたたみ状態）を失わない／書き換えない。
