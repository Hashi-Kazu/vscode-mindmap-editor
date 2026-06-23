---
name: ci-marketplace-publish
description: VS Code Marketplace への公開をGitHub Actions CIで自動化し、手動 vsce publish を廃止した設計判断
metadata:
  type: project
---

# ADR-0008: GitHub Actions による Marketplace 自動公開

- ステータス: 承認済み
- 確信度: 高（commit edd5b5c のメッセージと `.github/workflows/publish.yml` から明確）
- 日付: commit edd5b5c（`ci: GitHub Actions による Marketplace 自動公開を追加`）

## コンテキスト

拡張機能のリリースには `vsce package` → `vsce publish` の手順が必要で、手動実行だと忘れたり手順ミスが起きる可能性があった。

## 決定

`main` ブランチへの push をトリガーに `.github/workflows/publish.yml` が自動で実行され、`vsce package` → Marketplace 公開まで CI が担当する。開発者（`publisher` エージェントを含む）は `git push` するだけでよく、手動の publish 操作は不要。

`CLAUDE.md` にも明記: 「Marketplace への公開は GitHub Actions が自動で行う（main push 時）」

## 理由

- リリース手順の自動化でヒューマンエラー排除。
- `publisher` エージェントが push までを担当すれば、publish は自動で完了する（CI との責任分担が明確）。
- パスフィルター付きでパッケージ関連ファイルの変更時のみ実行するよう最適化済み（commit 8f0667c）。

## 捨てた選択肢

- **手動 vsce publish**: commit edd5b5c 以前の運用。忘れやすく、CI と別管理になる。

**How to apply:** `publisher` エージェントは push まで担当すれば足りる。Marketplace への手動 publish は行わない。
