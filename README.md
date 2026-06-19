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

## Markdown Format / Markdownの書き方

### Headings and Mind Map Structure / 見出しとマインドマップの対応

Headings map directly to the mind map tree. The depth of each heading becomes its position in the hierarchy.

見出しレベルがそのままマインドマップのツリー階層に対応します。

| Markdown | Mind Map | Role |
|----------|----------|------|
| `#` | Root node | 1 file = 1 root node / 1ファイルに1つのルートノード |
| `##` | Level 1 node | 第1階層ノード |
| `###` | Level 2 node | 第2階層ノード |
| `####` – `######` | Level 3–5 nodes | 第3〜5階層ノード |

Headings deeper than H6 are not supported.  
H6 より深い見出しはサポートされません。

```markdown
# Project Title          ← Root node / ルートノード
## Planning              ← Level 1 / 第1階層
### Requirements         ← Level 2 / 第2階層
### Design               ← Level 2 / 第2階層
## Development           ← Level 1 / 第1階層
### Backend              ← Level 2 / 第2階層
#### API                 ← Level 3 / 第3階層
```

---

### Body Items / 本文ノード（Body Items）

List items (`- item`) placed directly under a heading are displayed as **body nodes** in the mind map. They can be edited, moved, and deleted like heading nodes.

見出し直下のリスト項目（`- item`）は、マインドマップ内で**本文ノード**として表示されます。見出しノードと同様に編集・移動・削除できます。

- Plain list items / 通常のリスト項目: `- item`
- Unchecked checkbox / 未チェック: `- [ ] item`
- Checked checkbox / チェック済み: `- [x] item` — clickable directly in the mind map / マインドマップ上でクリックして切り替え可能

Other body content (paragraphs, code blocks, tables, etc.) is **not displayed** in the mind map but is **preserved** in the Markdown file.

その他の本文（段落・コードブロック・テーブルなど）はマインドマップには表示されませんが、Markdownファイルには**そのまま保持**されます。

```markdown
## Task List
- [ ] Write specification    ← Body node (unchecked) / 本文ノード（未チェック）
- [x] Set up repository      ← Body node (checked) / 本文ノード（チェック済み）
- Review PR                  ← Body node (plain) / 本文ノード（通常）

This paragraph is preserved but not shown in the mind map.
この段落は保持されますが、マインドマップには表示されません。
```

---

### Frontmatter / フロントマター

Collapse/expand state for nodes is automatically saved to the file's YAML frontmatter. You do not need to edit it manually.

ノードの折りたたみ／展開状態は、ファイルのYAMLフロントマターに自動的に保存されます。手動で編集する必要はありません。

```markdown
---
collapsed:
  - Development/Backend
  - Planning/Design
---

# Project Title
## Planning
...
```

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

### 2.6.1
- Marketplace category narrowed to Visualization / Marketplaceカテゴリをvisualizationに絞り込み

### 2.6.0
- Active editor tracking: the mind map viewer automatically follows when you switch files / アクティブエディタ切替時にビューアが自動追従するよう対応

### 2.5.0
- New body items automatically receive a checkbox (`- [ ]`) / 新規追加した本文項目にチェックボックスを自動付与

### 2.4.0
- Lost-update prevention: concurrent edits in the text editor and mind map are detected and merged without data loss / テキストエディタとマインドマップの同時編集を検知し、変更を消失させずにマージするコンフリクト検知を追加

### 2.3.8
- Fixed silent-drop bug in `editBody` / `renameNode` paths by unifying through `structuralEdit` / editBody・renameNode経路のサイレントドロップをstructuralEdit統一で根本修正

### 2.3.7
- Fixed body item and child item drag-and-drop not reflecting in Markdown / 本文項目・子項目のD&Dがmdに反映されないバグを修正

### 2.3.6
- Fixed data-drift in the `lineIdx` model after `editBody` by unifying re-sync; added unit tests for body item parsing / editBody後の再同期統一によるlineIdxモデルのデータ乖離防止、本文パースのユニットテスト追加

### 2.3.5
- Protected root node from inline editing; enlarged drag-and-drop hit area / ルートノードのインライン編集を保護、D&Dヒットエリアを拡大

### 2.3.4
- Fixed round-trip idempotency (extra blank lines on save) and collapse-state loss on rename / 保存ごとに空行が増えるround-trip問題と、リネーム時の折りたたみ状態消失を修正

### 2.3.3
- Version bump for Marketplace re-publish (no behavior change) / Marketplace再公開用バージョンバンプ（挙動変更なし）

### 2.3.2
- Internal maintenance update / 内部メンテナンスアップデート

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
