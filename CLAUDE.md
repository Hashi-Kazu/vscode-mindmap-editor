# vscode-mindmap-editor

VS Code拡張機能。TypeScript + esbuild + VS Code API 構成。

## 技術スタック

- TypeScript + esbuild
- VS Code Extension API（@types/vscode ^1.85.0）
- エントリポイント: `src/extension.ts`
- ビルド出力: `dist/extension.js`

## コマンド

```bash
npm run build     # 開発ビルド → dist/
npm run package   # .vsix 生成（vsce package）
npm run watch     # ウォッチモード
```

## ディレクトリ構成

```
src/              # TypeScript ソース
docs/             # 要求仕様書（USDM形式）
media/            # アイコン・CSS・JS
dist/             # ビルド出力（自動生成）
```

## 開発ルール

**コード修正・機能追加・バグ修正など、あらゆる開発タスクは必ず `feature-dev` エージェントを通して行うこと。**

- `feature-dev` がコード修正・仕様書更新・バージョンバンプを一括で行う
- バグ調査が必要な場合は `debugger` を呼ぶ（親が起動する。サブエージェントは他エージェントを起動できないため、`feature-dev` は「debugger 必要」と報告するだけ）
- 開発完了後、「ビルドしてプッシュして」で `publisher` を呼ぶ
- バージョンポリシー: 要件変更あり → マイナーアップ / コード修正のみ → パッチアップ

## エージェント一覧

| エージェント | 役割 |
|---|---|
| `feature-dev` | 開発全部（コード・仕様書・バージョン） |
| `debugger` | バグ調査のみ（読み取り専用） |
| `publisher` | .vsix ビルド＋git push |

> **エージェント定義の管理**: `.claude/agents/*.md` は `C:\Claude Code\_agent-templates`（正本）から同期されたコピー。**直接編集せず**、正本を編集して `_agent-templates\sync-agents.ps1` を実行すること（直接編集は次回同期で上書きされる）。プロジェクト固有の事情はエージェントではなくこの CLAUDE.md に書く。

## 実装メモ（feature-dev / debugger 向け）

- **コード地図**: `src/mindmapPanel.ts` が WebviewPanel 管理・双方向同期・全文置換書き込み・コンフリクト検知/解決（`applyDocumentEdit` / `_editQueue` / `isOperating` / `applyingEdit`）。Markdown 変換は `src/markdown{Parser,Serializer}.ts`、純粋ロジック（テスト対象）は `src/conflictDetection.ts`・`src/bodyItems.ts`、Webview 側操作は `media/mindmap.js`。
- **二重管理に注意**: 本文項目ロジックは `media/mindmap.js`（バンドル対象外）と `src/bodyItems.ts`（テスト対象）に複製されている。片方を変えたら必ず両方を同期させる。
- **検証**: `npm run build` と `npm test`。純粋ロジックを変えたら `test/` も更新する。
- ユーザーの Markdown 本文（見出し以外）やフロントマター（折りたたみ状態）を失わない／書き換えない（NF-03）。

## 注意事項

- Marketplace への公開は GitHub Actions が自動で行う（main push 時。`publisher` は push まで担当）
