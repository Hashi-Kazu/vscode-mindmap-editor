# マインドマップエディタ VS Code拡張機能 アーキテクチャ設計書

**文書番号**: MME-ARCH-001  
**元文書バージョン**: 2.6.0  
**作成日**: 2026-06-19  
**ステータス**: 承認済み

---

## 6. アーキテクチャ概要

### 6.1 構成図

```
┌─────────────────────────────────────────────────────────┐
│  VS Code Extension Host (Node.js)                        │
│                                                          │
│  extension.ts ─── コマンド登録                            │
│       │                                                  │
│  mindmapPanel.ts ─── WebviewPanel 管理                   │
│       │                    │                             │
│  markdownParser.ts     postMessage / onDidReceiveMessage │
│  markdownSerializer.ts      │                            │
└─────────────────────────────────────────────────────────┘
                              │
                   (Sandboxed iframe)
┌─────────────────────────────────────────────────────────┐
│  Webview (Browser Context)                               │
│                                                          │
│  mindmap.js ─── レイアウト計算・SVGレンダリング            │
│  mindmap.css ─── スタイル                                │
└─────────────────────────────────────────────────────────┘
```

### 6.2 メッセージプロトコル

| 方向 | タイプ | ペイロード | 用途 |
|------|--------|-----------|------|
| 拡張機能 → Webview | `update` | `{ root: MindMapNode }` | ツリー更新 |
| 拡張機能 → Webview | `saved` | `{}` | ファイル保存完了通知。Webviewはインジケーターを表示する |
| Webview → 拡張機能 | `ready` | `{}` | Webview初期化完了通知。拡張機能はこれを受信してから初回ツリーを送信する |
| Webview → 拡張機能 | `structuralEdit` | `{ root: MindMapNode }` | 構造変更（移動・追加・削除・Undo復元） |
| Webview → 拡張機能 | `renameNode` | `{ id, newText }` | ノード名変更 |
| Webview → 拡張機能 | `saveCollapseState` | `{ collapsedPaths: string[] }` | 折りたたみ状態保存 |
| Webview → 拡張機能 | `save` | `{}` | ファイル保存要求（Ctrl+S / Cmd+S） |
| Webview → 拡張機能 | `editBody` | `{ id, body }` | ノードの本文のみを更新（チェックボックストグル・本文編集確定） |
| Webview → 拡張機能 | `saveBodyItemCollapseState` | `{ paths: string[] }` | 本文項目の折りたたみ状態をフロントマター（`body-item-collapse:`）へ保存 |

### 6.3 ファイル構成

```
src/                       # TypeScript ソース（Extension Host 側）
  extension.ts             # コマンド登録・アクティベーション
  mindmapPanel.ts          # WebviewPanel 管理・双方向同期・自動保存
  markdownParser.ts        # Markdown → MindMapNode（フロントマター解析含む）
  markdownSerializer.ts    # MindMapNode → Markdown（折りたたみパス書き戻し含む）
  conflictDetection.ts     # 楽観的同時実行制御の純粋ロジック（base比較・改行正規化・テスト対象）
  types.ts                 # MindMapNode・メッセージ型定義
  bodyItems.ts             # 本文項目の純粋ロジック（mindmap.js と同期・テスト対象）
media/                     # Webview アセット
  mindmap.js               # レイアウト計算・描画・操作制御（動的サイズ・D&D・編集等）
  mindmap.css              # スタイル
test/                      # ユニットテスト（node:test）
  markdownRoundTrip.test.ts   # parse→serialize の冪等性・本文/フロントマター保全
  collapsedPaths.test.ts      # 折りたたみパスの抽出・適用ロジック
  bodyItems.test.ts           # 本文項目のパース・ツリー化・indent 変換ロジック
  conflictDetection.test.ts   # コンフリクト検知（base比較・改行正規化・echo判定）ロジック
esbuild.js                 # 本体ビルド（dist/extension.js を生成）
esbuild.test.js            # test/*.test.ts を dist-test/ へトランスパイル（pretest）
```

### 6.4 ビルド手順

```bash
npm run build     # 開発ビルド（esbuild → dist/extension.js）
npm run package   # .vsix 生成（vsce package）
npm run watch     # ウォッチモード
```

### 6.5 テスト手順

```bash
npm test
# pretest: esbuild.test.js がテストをトランスパイルして dist-test/ へ出力
# test: node --test で dist-test/**/*.test.js を実行
```

**テスト対象と範囲:**

- `test/` のユニットテストは parser/serializer の round-trip・折りたたみパス・本文項目ロジック（`src/bodyItems.ts`）・コンフリクト検知ロジック（`src/conflictDetection.ts`）を自動検証する
- Webview 側の操作（D&D・編集・ズーム等）は対象外であり、受入テスト基準でマニュアル検証する
- 本文項目ロジックは Webview（`media/mindmap.js`）が素のアセットとして配信されバンドル対象外のため、`src/bodyItems.ts` に同一ロジックを複製してテストする。両者の同期が必須（mindmap.js 側にコメント明記）

---

## 7. データモデル

### 7.1 MindMapNode 型定義

```typescript
interface MindMapNode {
  id: string;         // 一意識別子（パース時に付番）
  text: string;       // 見出しテキスト
  level: number;      // 0=ルート(ファイル名), 1=H1, 2=H2 ... 6=H6
  children: MindMapNode[];
  collapsed: boolean;
  body: string;       // この見出し直後の本文（段落・コードブロック等）
}
```

### 7.2 フロントマター形式

**折りたたみ状態（見出しノード）**

```yaml
---
mindmap-collapse:
  - "ルートノード名/親ノード名"
  - "ルートノード名/別の親ノード名/孫ノード名"
---
```

- キー: `mindmap-collapse`
- 値: ルート（ファイル名）を除いた相対パス（「親/子」形式）のリスト
- 後方互換: 旧形式（ファイル名プレフィックス付き「ルート/親/子」）も読み込み可能。一度保存すると新形式へ移行する

**折りたたみ状態（本文項目）**

```yaml
---
body-item-collapse:
  - "見出し相対パス::項目チェーン"
---
```

- キー: `body-item-collapse`
- 値: `見出し相対パス::項目チェーン` 形式（見出し部はルート＝ファイル名を除いた相対パス）のリスト
- 後方互換: 旧形式（ファイル名プレフィックス付き見出しパス）も復元でき、保存時に新形式へ移行する

### 7.3 動的サイズ定数

`media/mindmap.js` 冒頭で定義:

| 定数 | 値 | 用途 |
|------|------|------|
| `NODE_MIN_W` | 100 | 見出しノード最小幅（px） |
| `NODE_MAX_W` | 400 | 見出しノード最大幅（px） |
| `NODE_H` | 46 | 見出しノード高さ（px） |
| `BODY_MIN_W` | 80 | 本文ノード最小幅（px） |
| `BODY_MAX_W` | 360 | 本文ノード最大幅（px） |
| `BODY_H` | 42 | 本文ノード高さ（px）・2行対応 |
| `TOGGLE_W` | 19 | 折りたたみトグルボタン幅（px） |
| `H_GAP` | 20 | 親右端→子左端の水平間隔（px） |
| `BODY_ITEM_GAP` | 12 | 本文項目右端→ネスト子の水平間隔（px） |
| `V_GAP` | 16 | 見出し兄弟の縦間隔（px） |
| `BODY_V_GAP` | 8 | 本文項目の縦間隔（px） |
| `DROP_TOLERANCE` | 40 | D&Dドロップ判定の許容マージン（レイアウト座標基準） |
