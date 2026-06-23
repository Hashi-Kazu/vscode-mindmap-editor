---
name: esbuild-bundler
description: バンドルビルドツールとしてwebpackではなくesbuildを採用した設計判断
metadata:
  type: project
---

# ADR-0003: ビルドツールに esbuild を採用

- ステータス: 承認済み
- 確信度: 中（初期から一貫して使用されているが選定理由の明示コメントなし）
- 日付: 初期実装時（v1.0.0）

## コンテキスト

VS Code 拡張機能の TypeScript ソースを `dist/extension.js` にバンドルするビルドツールが必要だった。VS Code 公式のプロジェクトジェネレーター（Yeoman）は webpack をデフォルトで生成する。

## 決定

`esbuild` を採用し、`esbuild.js` というカスタムビルドスクリプトで制御する（`esbuild.js`）。テスト用に別途 `esbuild.test.js` も用意。

```json
"vscode:prepublish": "node esbuild.js --production",
"build": "node esbuild.js",
"watch": "node esbuild.js --watch"
```

## 理由

(要確認) コード・git log から明示的な選定理由の記述は見つからなかった。一般的には「webpack より高速、設定がシンプル」という理由で選ばれる場合が多い。VS Code の TypeScript 拡張機能テンプレートでも esbuild が推奨されるようになっており、その流れに沿った可能性が高い。

## 捨てた選択肢

- **webpack**: VS Code 公式の Yeoman テンプレートがデフォルトで生成するが、設定ファイルが煩雑になりやすい。
- **tsc のみ（バンドルなし）**: 複数ファイルに分割されたままでは `require` 解決が複雑になる。

**Why:** (要確認)
