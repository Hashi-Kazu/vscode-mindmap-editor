---
name: full-document-replacement-write
description: Markdownへの書き戻しをツリー全体からの全文生成・全文置換で行う設計判断（差分更新を採用しない）
metadata:
  type: project
---

# ADR-0004: 全文置換による Markdown 書き込み

- ステータス: 承認済み
- 確信度: 高（コード内コメントに明示）
- 日付: v1.3.0 頃（e4abf6a）から一貫。`_editQueue` 直列化は v2.3.6（a15244c）で強化

## コンテキスト

マインドマップ上の操作（ノード追加・削除・リネーム・移動・本文編集）を Markdown ファイルに反映するとき、操作の差分だけを計算してテキストを部分更新する方法と、ツリー全体を再シリアライズして全文を置き換える方法の二択があった。

## 決定

ツリーを `serializeToMarkdown()` で完全再生成し、`vscode.WorkspaceEdit` の `replace(fullRange, newContent)` で全文置換する（`mindmapPanel.ts:336-342`）。差分計算・パッチ適用は行わない。

コメント引用（`conflictDetection.ts:6-8`）:
> "This extension writes by serializing the whole cached tree and replacing the entire document — there is no per-operation merge."

## 理由

- マインドマップのツリー操作（ノード移動など）は文書のどの行に影響するか予測が難しく、差分計算が複雑になる。
- 全文置換であれば「シリアライズ結果が正しい」ことを保証するだけでよく、シリアライザーのテストが容易。
- 「Markdown が唯一の正（source of truth）」という原則（`structuralEdit` ハンドラ後に必ず `syncFromDocument` で再読み込み）と整合する。
- 全文置換に伴う競合（concurrent edit）は別途楽観的排他制御（[[optimistic-concurrency-control]]）で対処。
- 書き込みの直列化（`_editQueue`）により、連続操作での stale range 問題を防止（`mindmapPanel.ts:319-355`）。

## 捨てた選択肢

- **差分パッチ方式**: 操作ごとの影響行を正確に計算する必要があり、移動・レベル変更などで複雑なテキスト変換ロジックが必要になる。バグのリスクが高い。

**Why:** ツリー構造の変更に対して行ベースの差分計算が困難なため、シリアライズ全体を正として扱う方が実装の正確性を保ちやすい。
