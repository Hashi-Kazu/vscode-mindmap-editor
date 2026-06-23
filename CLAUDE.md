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

- `feature-dev` がコード修正・仕様書更新（ステータス `■■□`）・バージョンバンプ・受け入れテスト更新を一括で行う
- バグ調査が必要な場合は `debugger` を呼ぶ（**すべてのエージェント起動は main が行う**。サブエージェント間で直接指示はできない）
- **開発完了後の自動フロー**（すべて main が順に起動する）:
  1. `feature-dev` が成功報告（lint/build 通過、ステータス `■■□` 更新済み）
  2. **受け入れテストはユーザーから明示的に指示があった場合のみ実行する。** 指示がない場合はスキップして手順 3 へ進む。実行する場合: main が `acceptance-test` を起動 → テスト実行・ステータス `■■■` 反映・結果返却
     - **FAIL あり**: main が `feature-dev` を再起動して修正させる（FAIL 詳細を渡す）
     - **PASS / SKIP のみ**: 手順 3 へ進む
  3. main が `publisher` を起動 → .vsix ビルド〜commit〜push まで完了
  - 停止するケース: `feature-dev` が失敗・中断、または「`debugger` 必要」と報告した場合は以降を起動せず停止して報告する
  - 最終ゲート（バージョン整合・lint/build 失敗時は push せず停止）は `publisher` 側で従来どおり機能する
- バージョンポリシー: 要件変更あり → マイナーアップ / コード修正のみ → パッチアップ
- **`feature-dev` はテストを実行しない**（`npm test` 等の実行は `acceptance-test` の責務。テストコードの更新・追加は行ってよいが、実行はしない）

## エージェント一覧

| エージェント | 役割 |
|---|---|
| `feature-dev` | 開発全部（コード・仕様書・バージョン・受け入れテスト更新） |
| `debugger` | バグ調査のみ（読み取り専用） |
| `acceptance-test` | 受け入れテスト実行・ステータス `■■■` 反映 |
| `publisher` | .vsix ビルド＋git push |

> **エージェント定義の管理**: `.claude/agents/*.md` は `C:\Claude Code\_agent-templates`（正本）から同期されたコピー。**直接編集せず**、正本を編集して `_agent-templates\sync-agents.ps1` を実行すること（直接編集は次回同期で上書きされる）。プロジェクト固有の事情はエージェントではなくこの CLAUDE.md に書く。

## 実装メモ（feature-dev / debugger 向け）

- **コード地図**: `src/mindmapPanel.ts` が WebviewPanel 管理・双方向同期・全文置換書き込み・コンフリクト検知/解決（`applyDocumentEdit` / `_editQueue` / `isOperating` / `applyingEdit`）。Markdown 変換は `src/markdown{Parser,Serializer}.ts`、純粋ロジック（テスト対象）は `src/conflictDetection.ts`・`src/bodyItems.ts`、Webview 側操作は `media/mindmap.js`。
- **二重管理に注意**: 本文項目ロジックは `media/mindmap.js`（バンドル対象外）と `src/bodyItems.ts`（テスト対象）に複製されている。片方を変えたら必ず両方を同期させる。
- **検証**: `npm run build` と `npm test`。純粋ロジックを変えたら `test/` も更新する。
- ユーザーの Markdown 本文（見出し以外）やフロントマター（折りたたみ状態）を失わない／書き換えない（NF-03）。

## 注意事項

- Marketplace への公開は GitHub Actions が自動で行う（main push 時。`publisher` は push まで担当）
