---
name: webview-svg-dom-hybrid-renderer
description: マインドマップの描画にVS Code WebviewPanel + SVG（接続線）+ DOM（ノード本体）のハイブリッド方式を採用した設計判断
metadata:
  type: project
---

# ADR-0002: Webview + SVG/DOM ハイブリッドによるマインドマップ描画

- ステータス: 承認済み
- 確信度: 高（コードと初期実装から明確）
- 日付: v1.0.0 初期実装（commit 8234d05〜287af18）

## コンテキスト

VS Code 拡張機能内でインタラクティブなマインドマップを表示・編集するには、VS Code のネイティブ UI（TreeView 等）ではカスタムレイアウトが不可能なため、何らかの描画基盤が必要だった。

## 決定

`vscode.window.createWebviewPanel` で HTML/CSS/JavaScript を持つ Webview を開き、その内部で：
- 接続線（エッジ）は `<svg id="svg-layer">` で描画
- ノード本体は `<div id="node-layer">` の DOM 要素で管理

というハイブリッド方式を採用した（`mindmapPanel.ts:96-105`、`media/mindmap.js`）。

## 理由

- VS Code の CSP（Content Security Policy）制約により、Webview 内部では外部スクリプトの読み込みが制限されるため、外部マインドマップライブラリ（mxGraph、d3 等）の CDN 読み込みが使えない。ローカルバンドルが必要。
- 接続線は SVG で描くと任意の曲線・方向ベクターが容易。
- ノード本体は DOM 要素にすることで CSS によるスタイル、インライン編集（`contenteditable`）、ドラッグ＆ドロップが自然に実装できる。
- ライブラリなし（バンドル対象なし）でゼロ依存を維持でき、拡張機能のサイズを最小に保てる。

## 捨てた選択肢

- **外部マインドマップライブラリ（d3/mxGraph等）のバンドル**: 数百 KB 以上の依存追加となり、CSP 設定も複雑になる。
- **VS Code TreeView**: カスタムレイアウト（接続線・ドラッグ移動）が不可能。
- **全 SVG 描画**: テキスト編集（`foreignObject` 経由）が複雑で、`contenteditable` などブラウザネイティブ機能が使いにくい。

**Why:** VS Code Webview の CSP 制約により直接 DOM 操作以外の選択肢が制限されていたため。
