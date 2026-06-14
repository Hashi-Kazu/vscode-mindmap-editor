# Markdown Mind Map Editor

Visualize and edit your Markdown headings as an interactive mind map — directly inside VS Code.

MarkdownファイルをインタラクティブなマインドマップとしてVS Code内で可視化・編集できる拡張機能です。

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![VS Code](https://img.shields.io/badge/VS%20Code-1.85%2B-blue)

---

## Features / 機能一覧

### 📊 Instant Mind Map from Markdown / Markdownから即座にマインドマップ
Open any Markdown file as a mind map with one click (or `Ctrl+Shift+M`). Heading structure (`#`, `##`, `###` …) is automatically converted into a tree.

ワンクリック（または `Ctrl+Shift+M`）でMarkdownファイルをマインドマップとして開けます。見出し構造（`#`, `##`, `###` …）が自動的にツリーに変換されます。

### ✏️ Bidirectional Editing / 双方向編集
Edit in the mind map — changes are immediately written back to Markdown. Edit in the text editor — the mind map updates live.

マインドマップ上の編集内容はMarkdownに即時反映されます。テキストエディタで編集すると、マインドマップもリアルタイムに更新されます。

### 🖱️ Drag & Drop / ドラッグ＆ドロップ
Drag nodes to rearrange them or move them to a different parent. Drop indicators show exactly where the node will land.

ノードをドラッグして並び替えたり、別の親ノードへ移動できます。ドロップインジケーターで移動先を正確に確認できます。

### 📋 Body Items as Nodes / 本文リスト項目のノード化
List items (`- [ ]`, `- [x]`, `- item`) under a heading are rendered as **body nodes** in the tree. Checkboxes are clickable and toggle directly in Markdown. Body nodes dynamically resize to fit their text.

見出し下のリスト項目（`- [ ]`, `- [x]`, `- item`）はツリー内の**本文ノード**として表示されます。チェックボックスはクリックで切り替え可能で、Markdown本文に直接反映されます。本文ノードはテキスト量に応じて動的にサイズ調整されます。

### ☑️ Multi-Selection / 複数選択
`Ctrl+Click` to select multiple nodes. Cut, copy, paste, move, and delete operations all work on the entire selection at once.

`Ctrl+クリック`で複数のノードを選択できます。カット・コピー・ペースト・移動・削除がまとめて実行できます。

### ⌨️ Full Keyboard Support / キーボード操作

| Key | Action | 操作 |
|-----|--------|------|
| `Ctrl+Shift+M` | Open as Mind Map | マインドマップとして開く |
| `F2` / Double-click | Rename node | ノード名変更 |
| `Tab` | Add child node | 子ノード追加 |
| `Enter` | Add sibling node | 兄弟ノード追加 |
| `Delete` | Delete node | ノード削除 |
| `Alt+↑` / `Alt+↓` | Move node up / down | ノードを上下に移動 |
| Arrow keys | Navigate nodes | ノード間の移動 |
| `Ctrl+Click` | Multi-select nodes | 複数ノードを選択 |
| `Ctrl+Z` | Undo (50 steps) | 元に戻す（50ステップ） |
| `Ctrl+C` / `Ctrl+V` | Copy / Paste node (with subtree) | コピー／貼り付け（サブツリーごと） |
| `Ctrl+X` | Cut node (with subtree) | カット（サブツリーごと） |
| `Ctrl+S` | Save | 保存 |
| `F` | Fit view | ビューをフィット |

### 🔍 Pan & Zoom / パン＆ズーム
Drag the background to pan. Mouse wheel to zoom (centered on cursor). Toolbar buttons for zoom in/out and fit view.

背景をドラッグしてパン操作、マウスホイールでズーム（カーソル中心）できます。ツールバーのボタンからもズームイン／アウト・フィットビューが使えます。

### 💾 State Persistence / 状態の保持
Collapse/expand state is saved to Markdown frontmatter and restored on next open.

ノードの折りたたみ／展開状態はMarkdownのフロントマターに保存され、次回オープン時に復元されます。

---

## Getting Started / はじめ方

1. Open a Markdown file in VS Code / VS CodeでMarkdownファイルを開く
2. Click the **mind map icon** in the editor title bar, or press `Ctrl+Shift+M` (Mac: `Cmd+Shift+M`) / エディタタイトルバーの**マインドマップアイコン**をクリック、またはショートカットキーを押す
3. The mind map opens in a side panel — edit freely / サイドパネルにマインドマップが開くので、自由に編集できます

---

## Requirements / 動作要件

- VS Code 1.85 or later / VS Code 1.85 以降
- A Markdown file with heading structure (`#`, `##`, `###` …) / 見出し構造を持つMarkdownファイル

---

## Extension Settings / 拡張機能の設定

No configuration required. Works out of the box.

設定不要です。インストール後すぐに使用できます。

---

## Known Issues / 既知の問題

- Nodes deeper than H6 are not supported (Markdown limitation) / H6より深い階層のノードはサポートされません（Markdownの仕様による制限）
- Very large Markdown files (1000+ headings) may render slowly / 非常に大きなMarkdownファイル（見出し1000個以上）は描画が遅くなる場合があります
- ツールバーアイコンは16px表示のため細かいデザインは見えにくい場合がある

---

## Release Notes / リリースノート

See [CHANGELOG](changelog.md) for full release history. / 全リリース履歴は [CHANGELOG](changelog.md) を参照してください。

### 2.3.1
- Icon image updated / アイコン画像を更新

### 2.3.0
- Dynamic node sizing and 2-line display for body items / 本文ノードの動的サイズ調整と2行表示に対応

### 2.2.0
- Multi-selection with `Ctrl+Click` / `Ctrl+クリック`による複数選択機能
- Cut (`Ctrl+X`), copy, paste, move, and delete for multi-selection / 複数選択状態でのカット・コピー・ペースト・移動・削除に対応

### 2.0.1
- README updated to support both English and Japanese / READMEを英日バイリンガル対応に更新

### 2.0.0
- Body item drag & drop now moves the full subtree together / 本文アイテムのドラッグ＆ドロップでサブツリーごと移動可能に
- Copy/Paste support (`Ctrl+C` / `Ctrl+V`) for nodes with subtrees / サブツリーを含むノードのコピー／貼り付けをサポート

### 1.9.0 – 1.7.0
- Body list items rendered as interactive nodes in the tree
- Checkbox toggle, inline editing, and delete for body items
- Collapse/expand body item groups

### 1.5.0
- Auto-save on every edit
- Undo stack (50 steps, `Ctrl+Z`)
- Save indicator in toolbar

---

## License

MIT — see [LICENSE](LICENSE)
