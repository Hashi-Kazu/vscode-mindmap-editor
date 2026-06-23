# Architecture Decision Records (ADR)

このディレクトリには、vscode-mindmap-editor のアーキテクチャ判断を MADR 形式で記録する。

新機能実装や既存コードの変更前に、関連する ADR を確認すること。

## ADR 一覧

| 番号 | タイトル | 1行要約 | 確信度 |
|------|---------|---------|--------|
| [0001](0001-filename-as-root-node.md) | ファイル名を常にルートノードとする | H1ルート方式を廃止し、ファイル名を level-0 に統一 | 高 |
| [0002](0002-webview-svg-dom-hybrid-renderer.md) | Webview + SVG/DOM ハイブリッド描画 | 外部ライブラリなしで SVG（線）+ DOM（ノード）を組み合わせ | 高 |
| [0003](0003-esbuild-bundler.md) | ビルドツールに esbuild を採用 | webpack ではなく esbuild で高速バンドル | 中 |
| [0004](0004-full-document-replacement-write.md) | 全文置換による Markdown 書き込み | 差分更新ではなくツリー全再シリアライズ＋全文置換 | 高 |
| [0005](0005-optimistic-concurrency-control.md) | baseText スナップショットによる楽観的排他制御 | 共有ドライブ/Git pull 後の Lost Update を OCC で防止 | 高 |
| [0006](0006-body-items-in-mindmap-tree.md) | 本文項目をマインドマップツリーに統合 | 下部パネルを廃止し見出しノード横に本文ノードとして描画 | 高 |
| [0007](0007-collapse-state-in-frontmatter.md) | 折りたたみ状態を YAML フロントマターに永続化 | ファイル内 frontmatter に状態を埋め込みポータブルに保つ | 中 |
| [0008](0008-ci-marketplace-publish.md) | GitHub Actions による Marketplace 自動公開 | main push をトリガーに CI が vsce publish まで実行 | 高 |
| [0009](0009-pure-logic-separation-for-testing.md) | 純粋ロジック分離による Node.js テスト基盤 | VS Code API 非依存モジュールを分離し node:test でテスト | 高 |
| [0010](0010-structural-edit-unified-message.md) | Webview 通信を `structuralEdit` に統一 | 操作別メッセージを廃止しツリー全体を毎回送る方式に | 高 |

## 要確認項目

以下の項目は根拠が推測の域を出ず、作成者によるレビューが必要：

- **ADR-0003**: esbuild を webpack より選んだ具体的理由
- **ADR-0006**: 下部パネル廃止に至った具体的なユーザーフィードバック
- **ADR-0007**: frontmatter 選択の具体的な動機（vs `globalState`/サイドカーファイル）

## 新しい ADR の追加方法

1. `0011-xxx.md` という連番ファイルを作成
2. 既存 ADR のテンプレート形式に従う
3. この README の一覧に追記する
4. `CLAUDE.md` の「アーキテクチャ判断」セクションを更新する（必要に応じて）
