---
name: structural-edit-unified-message
description: Webview→Extension間の書き込みメッセージをstructuralEdit（ツリー全体送信）に統一した設計判断
metadata:
  type: project
---

# ADR-0010: Webview 通信を `structuralEdit` に統一

- ステータス: 承認済み
- 確信度: 高（commit 78da2b7 に「根本修正」「統一」と明示、コード上も確認できる）
- 日付: v2.3.8（commit 78da2b7）

## コンテキスト

以前は Webview → Extension への操作通知として `editBody`、`renameNode` 等の操作別メッセージが存在し、Extension 側でそれぞれのハンドラが ID を解決してから Markdown を書き換えていた。ID 解決に失敗した場合、変更が Markdown に反映されずにサイレントドロップする不具合があった（commit 78da2b7 メッセージより）。

## 決定

すべての書き込みトリガーを `structuralEdit` メッセージ（変更後のツリー全体を `root` として送信）に統一し、Extension 側では受け取ったツリーをそのまま `commitTree()` でシリアライズする。操作別の差分計算・ID 解決は行わない。

```
Webview: 操作 → ツリー更新 → postMessage({ type: 'structuralEdit', root: <全ツリー> })
Extension: lastRoot = msg.root; commitTree(); syncFromDocument();
```

`mindmapPanel.ts:268-279` 参照。

## 理由

commit 78da2b7:
> 「editBody/renameNode経路のサイレントドロップをstructuralEdit統一で根本修正。ID解決失敗時に本文編集・改名・チェックボックス・追加削除・ペーストの変更がmdへ反映されないサイレントドロップ不具合を、structuralEdit経路へ統一することで根本修正。」

[[full-document-replacement-write]] の方針（ツリー全体を正とする）と整合する設計でもある。ツリーが Webview から Extension へ毎回丸ごと送られることで、Extension は状態を追いかける必要がなくなる。

## 捨てた選択肢

- **操作別メッセージ（editBody/renameNode等）**: ID 解決の失敗点が多く、サイレントドロップが発生していた。コミット 78da2b7 前の方式。`mindmapPanel.ts` の 47 行削除（差分より）がその複雑さを示す。

**Why:** 操作別メッセージのID解決失敗によるサイレントドロップが頻発したため、ツリー全体を毎回送る方式で根本解決した。
