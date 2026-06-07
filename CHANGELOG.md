# Changelog

All notable changes to this project will be documented in this file.

## [2.0.0] - 2026-06-08

### Fixed
- Body item drag & drop now moves the full subtree (item + all child items) together — R-13-10
- After moving a body item, indentation is automatically adjusted: top-level (indent=0) becomes checkbox format (`- [ ] text`), nested (indent>0) becomes plain bullet (`- text`) — R-13-10
- Dropping "after" a body item now inserts after the item's entire subtree, not just the parent line
- `deleteBodyItem` now removes the item and all its descendant lines together

### Added
- Ctrl+C / Cmd+C: copy selected heading node (with full subtree) or body item (with child items) to internal clipboard — US-17
- Ctrl+V / Cmd+V: paste clipboard content as sibling after the current selection; level and checkbox/bullet format adjusted automatically — US-17

## [1.9.0] - 2026-06-08

### Changed
- Version bump to 1.9.0

## [1.8.5] - 2026-06-07

### Fixed
- Body child items now show connection lines correctly — `drawBodyItemConnections` was passing `child.children` to the recursive call, skipping the parent→child level draw. Fixed by moving the recursive call outside the inner loop and passing `item.children`.

## [1.8.4] - 2026-06-05

### Added
- Body item collapse state now persists across file sessions via frontmatter (`body-item-collapse:` key) — R-15-05 updated
  - Toggle triggers `saveBodyItemCollapseState` message → extension serializes paths to frontmatter
  - On file open, `body-item-collapse:` is parsed and sent in the `update` message → webview restores the Map
  - Path format: `headingPath::bodyItemText` (or `headingPath::parentText::childText` for nested)
  - `markdownParser.ts`: added `parseBodyItemCollapsePaths`, extended `ParseResult`
  - `markdownSerializer.ts`: added `bodyItemCollapsedPaths` param to `buildFrontmatter`
  - `types.ts`: added `saveBodyItemCollapseState` message type

## [1.8.3] - 2026-06-05

### Added
- Body items with child items can now be collapsed/expanded via the ▼/▶ toggle button — R-15-05
  - Collapse state is stored in a session-level `Map` (key: `nodeId:lineIdx`) and survives re-renders
  - Deleted items are cleaned up from the map automatically
  - `computeBodyItemSubtreeH`, `assignBodyItemPositions`, `drawBodyItemConnections`, `countBodyTree` all respect the collapsed flag

## [1.8.2] - 2026-06-05

### Fixed
- Nested body items no longer overlap their parent body items: `BODY_H_SPACE` changed from 220 px to `NODE_W + 12` = 272 px — R-15-01

### Changed
- Toolbar hint text removed; keyboard shortcuts are now accessible via the **?** button (click to open / close a floating popup) — R-16-04
- Checkbox progress widget: added `min-width: 92px` and `flex-shrink: 0` to prevent truncation with 4-digit counts — R-16-01

## [1.8.1] - 2026-06-05

### Fixed
- "↑ ノード化" is now disabled for body items that have nested child items — converting such items would orphan their children in the Markdown body

### Docs
- REQUIREMENTS.md updated to document all previously undocumented requirements:
  R-13-09 (Enter adds sibling body item), R-13-10 (body item drag & drop),
  US-15 (nested body items hierarchy), US-16 (checkbox progress widget),
  R-14-02 updated to include "no children" restriction

## [1.7.0] - 2026-06-05

### Added
- Body list items (`- [ ] item`, `- [x] item`, `- item`) are now rendered as **body nodes directly in the mindmap tree**, positioned to the right of the parent heading node — US-13
- Body node design: dashed border, semi-transparent background, 12 px font, 30 px height — clearly distinct from heading nodes
- Connections to body nodes use dashed gray lines; heading-to-heading connections unchanged
- Checkbox body nodes: click toggles `[ ]` ↔ `[x]` and saves to Markdown immediately; checked items show strikethrough text and reduced opacity — R-13-03
- Bullet body nodes (`- item`): displayed with a dash (–) indicator — R-13-04
- Body node inline editing: double-click or F2 opens text-only input; `- [ ] ` prefix is added automatically — R-13-05
- Delete key removes the selected body item — R-13-06
- Collapse toggle (▼/▶) appears on heading nodes that have body items — R-13-07
- Non-list body text (paragraphs, code blocks) continues to show as a dot indicator on the heading node — R-13-08
- Context menu "本文項目を追加" on heading nodes: adds a new `- [ ] ` line and auto-starts inline editing — R-13-05
- Body node right-click menu: "↑ ノード化 (→ 見出し)" and "本文行を削除" — R-14-02
- Context menu is now built dynamically with event delegation (no static HTML items)

### Changed
- Bottom body panel removed; body content is integrated into the tree view — US-13 redesign
- `Ctrl+B` shortcut removed (body editing is now inline in the tree)
- `structuralEdit` handler no longer calls `buildBodyMapById`/`applyBodiesById`; eliminates incorrect body restoration on undo and conversion

## [1.6.0] - 2026-06-05 *(superseded by 1.7.0)*

### Added
- Body panel (bottom, 180 px): selected node's body displayed with checkbox rendering, inline textarea editing — US-13 (initial implementation, replaced in 1.7.0)
- `editBody` webview → extension message: updates a node's body without a full tree rebuild

## [1.5.0] - 2026-06-05

### Added
- Auto-save on every Markdown reflect: `document.save()` is called after each `applyDocumentEdit` — R-01-07
- Save indicator: "✓ 保存済" fades in/out in the toolbar for 1.8 s after each save — R-09-03
- Webview-side Undo stack (max 50 entries, `Ctrl+Z`): covers structural edits, renames, collapse changes, drag-and-drop — US-10 / R-12-10
- `Enter` key adds a sibling node below the selected node and starts inline editing immediately — R-12-04
- Body-text indicator dot on nodes that have non-heading body content in Markdown; hover shows body as tooltip — R-01-08

### Changed
- Node width 220 → 260 px, height 52 → 46 px
- Node design: removed per-level background tints and full border; replaced with a 3 px left accent bar (`::before`) per level colour
- `Enter` no longer starts inline editing (use `F2` or double-click instead) — R-12-04b
- `saved` message added to extension → webview protocol to trigger the save indicator

## [1.4.5] - 2026-06-05

### Fixed
- View position and zoom are now preserved during collapse/expand and node move operations
- Auto-fit now only triggers on initial load; subsequent operations no longer reset the viewport

## [1.4.4] - 2026-06-05

### Added
- Auto inline editing immediately after adding a node (context menu and Tab key) — R-04-04
- Keyboard navigation: arrow keys to move between nodes, Enter/F2 to edit, Tab to add child, Escape to deselect — US-12
- Auto-scroll to bring keyboard-selected nodes into view — R-12-08

### Fixed
- Extension `update` messages no longer interrupt active inline editing

## [1.4.3] - 2026-06-05

### Changed
- Increased node width (180→220px) and height (36→52px) to display approximately 2× characters
- Label now wraps up to 2 lines (-webkit-line-clamp: 2) with ellipsis for overflow

## [1.4.1] - 2026-06-05

### Changed
- Extracted `_applyFit` helper to remove duplicated fit-view calculation between `render()` and `fitView()`
- Extracted `zoomBy(factor)` helper to unify toolbar buttons and keyboard shortcuts
- Unified `moveNodeUp`/`moveNodeDown` into single `moveNode(node, delta)` function
- Moved `Section` type to module level in `markdownParser.ts`
- Unified `applyCollapseState` and `applyCollapsedPaths` into a single exported `applyCollapsedPaths` in `markdownParser.ts`

## [1.4.0] - 2026-06-04

### Changed
- Updated message protocol documentation to include `ready` and `save` messages (aligned with implementation)

## [1.3.0] - 2026-06-05

### Added
- D&D drop indicator (blue line for before/after, highlight for inside) — R-02-07
- H6 node drop restriction with `not-allowed` cursor — R-02-08
- Ctrl+S / Cmd+S save from Mindmap view — US-09
- Undo/Redo via VS Code WorkspaceEdit — US-10
- Bidirectional sync conflict management — US-11

## [1.2.0] - 2026-06-05

### Added
- Tooltip on hover for truncated node text — R-01-06
- Expand/Collapse toolbar buttons operate on selected node — R-06-05, R-06-06

## [1.1.0] - 2026-06-05

### Added
- Node reorder (move up/down) via context menu and Alt+↑/↓ — US-08

### Changed
- Pan behavior extended to work over connection lines — US-07

## [1.0.0] - 2026-06-04

### Added
- Initial release: Mindmap display from Markdown headings — US-01
- Drag & drop node reorder and reparent — US-02
- Inline node editing (double-click) — US-03
- Add child/sibling nodes via context menu — US-04
- Delete nodes with confirmation — US-05
- Collapse/expand with frontmatter persistence — US-06
- Pan and zoom — US-07
