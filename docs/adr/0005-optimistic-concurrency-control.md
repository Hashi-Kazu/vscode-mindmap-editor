---
name: optimistic-concurrency-control
description: 共有ドライブ・Gitプル後の同時編集によるデータ消失（Lost Update）を防ぐため、baseTextスナップショットによる楽観的排他制御を採用した設計判断
metadata:
  type: project
---

# ADR-0005: baseText スナップショットによる楽観的排他制御

- ステータス: 承認済み
- 確信度: 高（コード内コメントとコミットメッセージに明示）
- 日付: v2.4.0（commit 6722629）

## コンテキスト

全文置換書き込み（[[full-document-replacement-write]]）の欠点として、「Webview 操作中に別の人（または Git pull）が同じ .md を変更していた場合、全文置換で相手の変更を無言で消す」リスクがあった。これは Lost Update 問題と呼ばれる。

## 決定

楽観的排他制御（OCC）を採用した。

1. **baseText スナップショット**: ドキュメントを最後にパースしたときのテキスト（newline 正規化済み）を `baseText` として記録。
2. **書き込み前チェック**: `applyDocumentEdit` 実行前に `hasConcurrentChange()` を呼び、ライブドキュメントとディスクの両方が `baseText` と一致するか確認。
3. **不一致時**: `resolveConflict()` でモーダルダイアログを表示し、ユーザーが「最新を読み込む」か「自分の変更で上書き」を選択。どちらの側も `.conflict-mine-<timestamp>.md` / `.conflict-remote-<timestamp>.md` としてバックアップ。

詳細: `mindmapPanel.ts:364-412`、`src/conflictDetection.ts`

## 理由

コード内コメント（`conflictDetection.ts:3-9`）より:
> "To avoid silently clobbering edits another person made to the same .md (via a shared drive or after a Git pull), we record the exact text the cached tree was parsed from (the 'base' snapshot) and, before every full-document write, check that the live content still matches that base."

CRLF/LF 差異を「競合」と誤検知しないよう `normalizeText` で正規化している点も設計上のポイント。

ディスクも確認する理由（`mindmapPanel.ts:370-381`）:
> "Also consult the disk: the TextDocument may be stale relative to a file replaced by another writer (shared drive / git checkout)."

## 捨てた選択肢

- **悲観的ロック（ファイルロック）**: VS Code API にファイルロック機能がなく、実装が困難。クロスプラットフォーム対応も複雑。
- **衝突を無視して上書き**: データ消失リスクがあり採用不可。
- **3-wayマージ**: 実装コストが高く、Markdown のテキスト構造に特化したマージロジックが必要。

**Why:** shared drive / Git pull シナリオでの無言データ消失を防ぐためにv2.4.0で追加。
