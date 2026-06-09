# Markdown Mind Map Editor

Visualize and edit your Markdown headings as an interactive mind map — directly inside VS Code.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![VS Code](https://img.shields.io/badge/VS%20Code-1.85%2B-blue)

---

## Features

### 📊 Instant Mind Map from Markdown
Open any Markdown file as a mind map with one click (or `Ctrl+Shift+M`). Heading structure (`#`, `##`, `###` …) is automatically converted into a tree.

### ✏️ Bidirectional Editing
Edit in the mind map — changes are immediately written back to Markdown. Edit in the text editor — the mind map updates live.

### 🖱️ Drag & Drop
Drag nodes to rearrange them or move them to a different parent. Drop indicators show exactly where the node will land.

### 📋 Body Items as Nodes
List items (`- [ ]`, `- [x]`, `- item`) under a heading are rendered as **body nodes** in the tree. Checkboxes are clickable and toggle directly in Markdown.

### ⌨️ Full Keyboard Support
| Key | Action |
|-----|--------|
| `Ctrl+Shift+M` | Open as Mind Map |
| `F2` / Double-click | Rename node |
| `Tab` | Add child node |
| `Enter` | Add sibling node |
| `Delete` | Delete node |
| `Alt+↑` / `Alt+↓` | Move node up / down |
| Arrow keys | Navigate nodes |
| `Ctrl+Z` | Undo (50 steps) |
| `Ctrl+C` / `Ctrl+V` | Copy / Paste node (with subtree) |
| `Ctrl+S` | Save |
| `F` | Fit view |

### 🔍 Pan & Zoom
Drag the background to pan. Mouse wheel to zoom (centered on cursor). Toolbar buttons for zoom in/out and fit view.

### 💾 State Persistence
Collapse/expand state is saved to Markdown frontmatter and restored on next open.

---

## Getting Started

1. Open a Markdown file in VS Code
2. Click the **mind map icon** in the editor title bar, or press `Ctrl+Shift+M` (Mac: `Cmd+Shift+M`)
3. The mind map opens in a side panel — edit freely

---

## Requirements

- VS Code 1.85 or later
- A Markdown file with heading structure (`#`, `##`, `###` …)

---

## Extension Settings

No configuration required. Works out of the box.

---

## Known Issues

- Nodes deeper than H6 are not supported (Markdown limitation)
- Very large Markdown files (1000+ headings) may render slowly

---

## Release Notes

See [CHANGELOG](changelog.md) for full release history.

### 2.0.0
- Body item drag & drop now moves the full subtree together
- Copy/Paste support (`Ctrl+C` / `Ctrl+V`) for nodes with subtrees

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
