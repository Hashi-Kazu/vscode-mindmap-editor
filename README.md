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
Drag an H1 node (a direct child of the filename root) onto the left or right half of the root to lay out branches on both sides. The side assignment is persisted to frontmatter.

ファイル名ルート直下のH1ノードをルートの左半分／右半分にドラッグ＆ドロップすることで、枝を左右両側に振り分けて配置できます。左右の割り当てはフロントマターに保存されます。

### 🅱️ Inline Emphasis / インライン強調表示
`**bold**`, `*italic*`, and `***both***` in labels render as styled text. Toggle emphasis on the selected node(s) with the toolbar buttons or `Ctrl+B` / `Ctrl+I`. Only asterisk notation is decorated — underscore notation (`_italic_`, `__bold__`) is left as-is, so text like `__init__` or `file_name` is shown verbatim.

ラベル内の `**太字**`・`*斜体*`・`***太字斜体***` が装飾表示されます。ツールバーのボタンまたは `Ctrl+B` / `Ctrl+I` で選択中のノードに強調のオン／オフを切り替えられます。装飾されるのはアスタリスク記法のみで、アンダースコア記法（`_斜体_`・`__太字__`）はそのまま表示されるため、`__init__` や `file_name` などのテキストがそのまま表示されます。

### ☑️ Checkbox Progress & Filter / チェックボックス進捗・フィルタ
A progress widget shows the completed / total checkbox count. The toolbar filter (**All / ✓ On only / ▢ Off only**) narrows which top-level checkbox items are shown — display only, the Markdown is never changed.

進捗ウィジェットがチェックボックスの完了数／総数を表示します。ツールバーのフィルタ（**すべて／✓ ONのみ／▢ OFFのみ**）でトップレベルのチェックボックス項目の表示を絞り込めます（表示のみで、Markdownは変更されません）。

### ☑️ Multi-Selection / 複数選択
`Ctrl+Click` sibling nodes to select several at once. Cut, copy, paste, move, delete, heading⇄body conversion, and checkbox toggling all work on the entire selection.

`Ctrl+クリック`で兄弟ノードを複数選択できます。カット・コピー・ペースト・移動・削除・見出し⇄本文変換・チェックボックス切替がまとめて実行できます。

### 🗂️ Per-File Viewers / ファイルごとのビューア
By default (`mindmap.viewerMode: perFile`), each Markdown file gets its own independent mind map viewer, so you can open and edit several files' mind maps side by side at the same time. Switching editor focus to a different `.md` file only brings its viewer to the front if it is already open — it does **not** open automatically. If you prefer the old behavior — a single viewer that always follows the active editor — set `mindmap.viewerMode` to `shared`.

既定（`mindmap.viewerMode: perFile`）では、ファイル（URI）ごとに独立したビューアが開くため、複数ファイルのマインドマップを同時に並べて表示・編集できます。エディタのフォーカスを別の `.md` ファイルに移しても、そのファイルのビューアが**既に開いている場合はタブが前面化されるだけ**で、開いていなければ自動では開きません。従来どおり「1枚のビューアがアクティブエディタに追従」する動作にしたい場合は、`mindmap.viewerMode` を `shared` に設定してください。

### 🔀 Conflict Detection / 競合検知
When the text editor and the mind map are edited concurrently, changes are **not** auto-merged. Instead, a modal dialog asks you to choose: **"Load latest (discard my edits)"** or **"Overwrite with my changes (discard the other edits)"**. Whichever side is discarded is backed up first — to `<filename>.conflict-mine-<timestamp>.md` or `.conflict-remote-<timestamp>.md` in the same folder — so no edit is ever lost outright.

テキストエディタとマインドマップで同時編集が発生した場合、自動マージは行われません。代わりにモーダルダイアログが表示され、**「最新を読み込む（自分の編集は破棄）」**または**「自分の変更で上書き（他者の変更は破棄）」**のどちらかを選択します。破棄される側は先にバックアップされ、同じフォルダ内に `<ファイル名>.conflict-mine-<日時>.md` または `.conflict-remote-<日時>.md` として保存されるため、編集内容が完全に失われることはありません。

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
| `Ctrl+Y` / `Ctrl+Shift+Z` | Redo | やり直し |
| `Ctrl+C` / `Ctrl+V` | Copy / Paste node (with subtree) | コピー／貼り付け（サブツリーごと） |
| `Ctrl+X` | Cut node (with subtree) | カット（サブツリーごと） |
| `Ctrl+S` | Save | 保存 |
| `F` | Fit view | ビューをフィット |
| `Ctrl++` / `Ctrl+-` | Zoom in / out | ズームイン／アウト |

### 🔍 Pan & Zoom / パン＆ズーム
Drag the background to pan. Mouse wheel to zoom (centered on cursor). Toolbar buttons for zoom in/out and fit view.

背景をドラッグしてパン操作、マウスホイールでズーム（カーソル中心）できます。ツールバーのボタンからもズームイン／アウト・フィットビューが使えます。

### 🧰 Toolbar / ツールバー
The toolbar provides: zoom in / zoom out / fit view, bold `B` / italic `I` toggles, **expand all** / **collapse all**, a checkbox progress widget, a checkbox filter (All / ✓ On only / ▢ Off only), a save indicator, and a `?` button that opens a popup listing all keyboard shortcuts.

ツールバーには、ズームイン／ズームアウト／フィット、太字 `B`・斜体 `I` の切り替え、**全展開**／**全折畳**、チェックボックス進捗ウィジェット、チェックボックスフィルタ（すべて／✓ ONのみ／▢ OFFのみ）、保存インジケータ、そして `?` ボタン（クリックでショートカット一覧のポップアップを表示）があります。

### 🖱️ Context Menu / 右クリックメニュー
Right-click a **heading node** for: add child node, add sibling node, add body item, move up / down, demote to body item, delete.

見出しノードを右クリックすると、次の操作ができます: 子ノード追加、兄弟ノード追加、本文項目を追加、上下移動、本文項目へ降格、削除。

Right-click a **body item** for: add child item, add sibling item (same level), move up / down, toggle checkbox ⇄ bullet, promote to heading, delete.

本文項目を右クリックすると、次の操作ができます: 子項目を追加、同階層に項目を追加、上下移動、チェックボックス⇄箇条書きの切替、見出しへ昇格、削除。

### 💾 State Persistence / 状態の保持
Collapse/expand state (for both headings and body items) and left/right layout are saved to Markdown frontmatter and restored on next open. The original EOL (CRLF/LF) of the file is preserved.

見出し・本文項目の折りたたみ／展開状態と左右レイアウトはMarkdownのフロントマターに保存され、次回オープン時に復元されます。ファイル元の改行コード（CRLF/LF）も保持されます。

---

## Getting Started / はじめ方

1. Open a Markdown file in VS Code / VS CodeでMarkdownファイルを開く
2. Open it as a mind map in one of three ways / 次の3通りのいずれかでマインドマップとして開きます:
   - Click the **mind map icon** in the editor title bar / エディタタイトルバーの**マインドマップアイコン**をクリック
   - Press `Ctrl+Shift+M` (Mac: `Cmd+Shift+M`) / ショートカットキー `Ctrl+Shift+M`（Mac: `Cmd+Shift+M`）を押す
   - Right-click a `.md` file in the Explorer and choose **"マインドマップとして開く"** / エクスプローラで `.md` ファイルを右クリックし「マインドマップとして開く」を選択
3. The mind map opens beside the editor — edit freely. With the default `perFile` viewer mode, you can open several files' mind maps at once this way / マインドマップがエディタの横に開くので、自由に編集できます。既定の `perFile` モードでは、この操作を繰り返すことで複数ファイルのマインドマップを同時に開けます

---

## Markdown Format / Markdownの書き方

### Headings and Mind Map Structure / 見出しとマインドマップの対応

The filename (without its extension) is always the level-0 root. Markdown headings H1 through H6 appear beneath it at levels 1 through 6.

拡張子を除いたファイル名が常にlevel-0ルートとなり、MarkdownのH1〜H6はその下のlevel 1〜6に対応します。

| Source | Mind Map | Role |
|--------|----------|------|
| Filename without extension / 拡張子なしファイル名 | Root (Level 0) | 1 file = 1 root node / 1ファイルに1つのルートノード |
| `#` (H1) | Level 1 node | 第1階層ノード |
| `##` (H2) | Level 2 node | 第2階層ノード |
| `###` (H3) | Level 3 node | 第3階層ノード |
| `####` (H4) | Level 4 node | 第4階層ノード |
| `#####` (H5) | Level 5 node | 第5階層ノード |
| `######` (H6) | Level 6 node | 第6階層ノード |

Headings deeper than H6 are not supported.  
H6 より深い見出しはサポートされません。

For a file named `project-plan.md`, the root is `project-plan` (this virtual root is not written into the Markdown):<br>
`project-plan.md` の場合、ルートは `project-plan` です（この仮想ルートはMarkdownへ書き込まれません）。

```markdown
# Project Title          ← Level 1 / 第1階層
## Planning              ← Level 2 / 第2階層
### Requirements         ← Level 3 / 第3階層
#### Design              ← Level 4 / 第4階層
##### Backend            ← Level 5 / 第5階層
###### API               ← Level 6 / 第6階層
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
| `mindmap.viewerMode` | `perFile` | `perFile`: an independent viewer per file (default). `shared`: a single viewer follows the active editor | `perFile`: ファイルごとに独立したビューア（既定）。`shared`: 1枚のビューアがアクティブエディタに追従 |
| `mindmap.followActiveEditor` (**Deprecated**) | `true` | Superseded by `mindmap.viewerMode`. Set `mindmap.viewerMode` to `shared` if you want the viewer to follow the active editor | **非推奨**。`mindmap.viewerMode` に統合されました。追従させたい場合は `mindmap.viewerMode` を `shared` に設定してください |
| `mindmap.fontSize` | `14` | Font size (px) for mind map nodes (8–32) | ノードのフォントサイズ（px、8〜32） |
| `mindmap.edgeWidth` | `1.5` | Connection line width (px) (0.5–8) | ノード間接続線の太さ（px、0.5〜8） |

---

## Known Issues / 既知の問題

- Nodes deeper than H6 are not supported (Markdown limitation) / H6より深い階層のノードはサポートされません（Markdownの仕様による制限）
- Very large Markdown files (1000+ headings) may render slowly / 非常に大きなMarkdownファイル（見出し1000個以上）は描画が遅くなる場合があります
- ツールバーアイコンは16px表示のため細かいデザインは見えにくい場合がある
- Underscore emphasis (`_italic_`, `__bold__`) is intentionally not rendered; use asterisks (`*italic*`, `**bold**`) instead / アンダースコアによる強調（`_斜体_`・`__太字__`）は意図的に装飾されません。アスタリスク（`*斜体*`・`**太字**`）を使用してください

---

## Release Notes / リリースノート

See [CHANGELOG](changelog.md) for the full release history. / 全リリース履歴は [CHANGELOG](changelog.md) を参照してください。

### 2.23.x
- Added per-file independent viewers (view multiple files' mind maps at once) and the `mindmap.viewerMode` setting; deprecated `mindmap.followActiveEditor` / ファイル単位の独立ビューア（複数ファイル同時表示）と `mindmap.viewerMode` 設定を追加、`mindmap.followActiveEditor` を非推奨化

### 2.22.x
- Improved visibility of checked checkbox body items (accent color); fixed insertion position for new body child items; fixed drag & drop for body items nested under left-side branches; excluded underscore emphasis from decoration / チェックボックス本文項目の視認性向上（アクセント色）、本文子項目の追加位置修正、左枝ネスト本文項目のD&D修正、アンダースコア強調を装飾対象外に

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
