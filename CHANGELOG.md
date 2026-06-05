# Changelog

All notable changes to this project will be documented in this file.

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
