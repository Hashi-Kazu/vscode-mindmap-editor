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
List items (`- [ ]`, `- [x]`, `- item`) under a heading are rendered as **body nodes** in the tree, including nested (indented) sub-items. Checkboxes are clickable and toggle directly in Markdown. Body nodes dynamically resize to fit their text.

見出し下のリスト項目（`- [ ]`, `- [x]`, `- item`）は、ネスト（インデント）した子項目も含めてツリー内の**本文ノード**として表示されます。チェックボックスはクリックで切り替え可能で、Markdown本文に直接反映されます。本文ノードはテキスト量に応じて動的にサイズ調整されます。

### 🔁 Heading ⇄ Body Item Conversion / 見出し⇄本文項目の変換
Right-click a top-level body item to **promote** it into a heading node, or right-click a leaf heading to **demote** it into a body item. Both are undoable.

トップレベルの本文項目を右クリックして見出しノードへ**昇格**、子見出しを持たない見出しを右クリックして本文項目へ**降格**できます。どちらも `Ctrl+Z` で元に戻せます。

### ↔️ Left / Right Layout / 左右展開レイアウト
Drag a top-level (H1-child) node onto the left or right half of the root to lay out branches on both sides. The side assignment is persisted to frontmatter.

ルート直下ノードをルートの左半分／右半分にドラッグ＆ドロップすることで、枝を左右両側に振り分けて配置できます。左右の割り当てはフロントマターに保存されます。

### 🅱️ Inline Emphasis / インライン強調表示
`**bold**`, `*italic*`, and `***both***` in labels render as styled text. Toggle emphasis on the selected node(s) with the toolbar buttons or `Ctrl+B` / `Ctrl+I`.

ラベル内の `**太字**`・`*斜体*`・`***太字斜体***` が装飾表示されます。ツールバーのボタンまたは `Ctrl+B` / `Ctrl+I` で選択中のノードに強調のオン／オフを切り替えられます。

### ☑️ Checkbox Progress & Filter / チェックボックス進捗・フィルタ
A progress widget shows the completed / total checkbox count. The toolbar filter (**All / ✓ On only / ▢ Off only**) narrows which top-level checkbox items are shown — display only, the Markdown is never changed.

進捗ウィジェットがチェックボックスの完了数／総数を表示します。ツールバーのフィルタ（**すべて／✓ ONのみ／▢ OFFのみ**）でトップレベルのチェックボックス項目の表示を絞り込めます（表示のみで、Markdownは変更されません）。

### ☑️ Multi-Selection / 複数選択
`Ctrl+Click` sibling nodes to select several at once. Cut, copy, paste, move, delete, heading⇄body conversion, and checkbox toggling all work on the entire selection.

`Ctrl+クリック`で兄弟ノードを複数選択できます。カット・コピー・ペースト・移動・削除・見出し⇄本文変換・チェックボックス切替がまとめて実行できます。

### 🔄 Auto-Follow & Conflict Detection / 自動追従・競合検知
The viewer automatically follows the active Markdown editor as you switch files. Concurrent edits made in the text editor and the mind map are detected and merged without losing changes (lost-update prevention).

ファイルを切り替えると、ビューアがアクティブなMarkdownエディタに自動追従します。テキストエディタとマインドマップの同時編集は検知され、変更を失わずにマージされます（Lost Update 防止）。

### ⌨️ Full Keyboard Support / キーボード操作

| Key | Action | 操作 |
|-----|--------|------|
| `Ctrl+Shift+M` | Open as Mind Map | マインドマップとして開く |
| `F2` / Double-click | Rename node | ノード名変更 |
| `Tab` | Add child node | 子ノード追加 |
| `Enter` | Add sibling node | 兄弟ノード追加 |
| `Delete` | Delete node | ノード削除 |
| `Alt+↑` / `Alt+↓` | Move node / body item up / down | ノード・本文項目を上下に移動 |
| Arrow keys | Navigate nodes | ノード間の移動 |
| `Ctrl+B` / `Ctrl+I` | Toggle bold / italic | 太字／斜体の切り替え |
| `Ctrl+Click` | Multi-select sibling nodes | 兄弟ノードを複数選択 |
| `Ctrl+Z` | Undo (50 steps) | 元に戻す（50ステップ） |
| `Ctrl+C` / `Ctrl+V` | Copy / Paste node (with subtree) | コピー／貼り付け（サブツリーごと） |
| `Ctrl+X` | Cut node (with subtree) | カット（サブツリーごと） |
| `Ctrl+S` | Save | 保存 |
| `F` | Fit view | ビューをフィット |

### 🔍 Pan & Zoom / パン＆ズーム
Drag the background to pan. Mouse wheel to zoom (centered on cursor). Toolbar buttons for zoom in/out and fit view.

背景をドラッグしてパン操作、マウスホイールでズーム（カーソル中心）できます。ツールバーのボタンからもズームイン／アウト・フィットビューが使えます。

### 💾 State Persistence / 状態の保持
Collapse/expand state (for both headings and body items) and left/right layout are saved to Markdown frontmatter and restored on next open. The original EOL (CRLF/LF) of the file is preserved.

見出し・本文項目の折りたたみ／展開状態と左右レイアウトはMarkdownのフロントマターに保存され、次回オープン時に復元されます。ファイル元の改行コード（CRLF/LF）も保持されます。

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

Collapse/expand state and left/right layout are automatically saved to the file's YAML frontmatter using dedicated, namespaced keys. You do not need to edit them manually, and your own frontmatter keys are left untouched.

折りたたみ／展開状態と左右レイアウトは、専用の名前空間付きキーでファイルのYAMLフロントマターに自動保存されます。手動で編集する必要はなく、ユーザー独自のフロントマターキーは保持されます。

| Key | Purpose | 用途 |
|-----|---------|------|
| `mindmap-collapse` | Collapsed heading nodes | 折りたたんだ見出しノード |
| `body-item-collapse` | Collapsed body-item groups | 折りたたんだ本文項目グループ |
| `mindmap-left` | Nodes placed on the left side | 左側に配置したノード |

```markdown
---
mindmap-collapse:
  - "Development/Backend"
  - "Planning/Design"
mindmap-left:
  - "Planning"
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

Works out of the box — all settings are optional.

追加設定なしで動作します。以下の設定はすべて任意です。

| Setting | Default | Description | 説明 |
|---------|---------|-------------|------|
| `mindmap.followActiveEditor` | `true` | Auto-follow the active Markdown editor when switching files | ファイル切替時にアクティブなMarkdownエディタへ自動追従する |
| `mindmap.fontSize` | `14` | Font size (px) for mind map nodes (8–32) | ノードのフォントサイズ（px、8〜32） |
| `mindmap.edgeWidth` | `1.5` | Connection line width (px) (0.5–8) | ノード間接続線の太さ（px、0.5〜8） |

---

## Known Issues / 既知の問題

- Nodes deeper than H6 are not supported (Markdown limitation) / H6より深い階層のノードはサポートされません（Markdownの仕様による制限）
- Very large Markdown files (1000+ headings) may render slowly / 非常に大きなMarkdownファイル（見出し1000個以上）は描画が遅くなる場合があります
- ツールバーアイコンは16px表示のため細かいデザインは見えにくい場合がある

---

## Release Notes / リリースノート

See [CHANGELOG](changelog.md) for the full release history. / 全リリース履歴は [CHANGELOG](changelog.md) を参照してください。

### 2.21.x
- Fixed undo for single heading⇄body promote/demote; move body items with `Alt+↑/↓` and the context menu / 見出し⇄本文の単独昇格・降格の Undo を修正、本文項目を `Alt+↑/↓`・右クリックで上下移動

### 2.20.x – 2.18.x
- Inline bold / italic display and `Ctrl+B` / `Ctrl+I` toggle / インライン太字・斜体表示と `Ctrl+B` / `Ctrl+I` トグル
- Heading ⇄ body item promote / demote / 見出し⇄本文項目の昇格・降格
- Explicit checkbox ⇄ bullet type switching (auto-conversion removed) / チェックボックス⇄箇条書きの明示切替（自動変換は廃止）

### 2.8.0
- Left / right expansion layout with `mindmap-left` frontmatter persistence / 左右展開レイアウト（`mindmap-left` フロントマターで永続化）

### 2.4.0 – 2.6.0
- Lost-update prevention (conflict detection) and active-editor auto-follow / Lost Update 防止（競合検知）とアクティブエディタ自動追従

### 2.0.0 – 2.3.x
- Body items as interactive nodes, multi-selection (`Ctrl+Click`), subtree copy/paste, dynamic node sizing / 本文項目のノード化、複数選択、サブツリーのコピー／貼り付け、動的ノードサイズ

---

## License

MIT — see [LICENSE](LICENSE)
