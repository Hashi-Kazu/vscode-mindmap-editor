# Changelog

All notable changes to this project will be documented in this file.

## [2.22.9] - 2026-07-21

### Fixed
- 左右展開レイアウトの左枝（`side: 'left'`）で2階層以上ネストした本文項目をドラッグ&ドロップすると、ドロップ先インジケーターがマウス位置と離れた場所に表示され、重なった項目を正しくドロップできない不具合を修正した（R-15-01・S20-04）。
  - 原因は `assignBodyItemPositions` の左方向配置で、直接の子の `_x` のみ再配置後に左側へ上書きしており、孫以下の `_x` が再帰呼び出し時に渡した右側の座標のまま取り残されていたこと。子ループを見出しノードの左方向配置と同じ「子幅を確定→最終xを算出→その位置で再帰」パターンに統一し、孫以下も再帰的に段階的な左配置になるようにした。

## [2.22.8] - 2026-07-17

### Changed
- ビューアのラベル装飾をアスタリスク記法のみに限定した（R-21-01・R-21-05）。
  - `*italic*` / `**bold**` / `***both***` は従来どおり装飾表示するが、アンダースコア記法（`_a_` / `__a__` / `___a___`）は装飾せずそのまま表示するようにした。`__init__` や `file_name` などのテキストが意図せず斜体・太字化される問題を防止する。
  - `Ctrl+B` / `Ctrl+I` トグルの既存強調状態の判定（`parseEmphasis`）もアスタリスクのみを認識するようにし、アンダースコアを含むテキストをトグルしても下線が壊れないようにした。
  - 公開 README（インライン強調セクション・Known Issues）にも制約として明記した。

### Fixed
- ノード・本文項目の選択を切り替えてもツールバーの太字・斜体ボタンのアクティブ状態が前の状態のまま固まり、選択対象に追従しない不具合を修正した（R-21-07 新設）。
  - 原因は、選択のみを変更する経路（クリック選択・`selectNode` / `selectBodyItem` によるキーボード移動など）がパフォーマンスのため `render()` を呼ばず、ボタン状態を同期する `updateEmphasisButtons()` が `render()` 末尾からしか呼ばれていなかったこと。各選択経路の末尾で `updateEmphasisButtons()` を明示的に呼ぶようにした。

## [2.22.6] - 2026-07-17

### Changed
- チェックボックス付き本文項目のアクセント色（未チェック／チェック済み）を、固定の青/緑からビューア起動時のランダム色に変更（R-13-03）。
  - 起動のたびに未チェック用・チェック済み用それぞれランダムな色を選定し、CSS 変数（`--task-accent` / `--task-bg` / `--task-done-accent` / `--task-done-bg`）を上書きする（`media/mindmap.js` の `randomCheckboxColors`）。
  - ラベルの文字色（テーマの前景色）を鑑みて見えにくい色を除外するため、明度を中間域（HSL 45〜60%）に制限してライト/ダーク双方で視認可能とし、背景色は低アルファ（0.14）に抑えて文字を潰さないようにした。
  - 未チェック用・チェック済み用の色相は 60° 以上離し、両状態を区別できるようにした。CSS 側のテーマ変数ベースの既定値は JS 未実行時のフォールバックとして維持。

## [2.22.5] - 2026-07-17

### Added
- チェックボックス付き本文項目を箇条書き項目・見出しノードと区別しやすいデザインに変更（R-13-03）。
  - 未チェック: 左端に青系アクセントの縦線＋薄い青背景（`--task-accent` / `--task-bg`）。
  - チェック済み: 左端に緑系アクセントの縦線＋薄い緑背景（`--task-done-accent` / `--task-done-bg`、既存の取り消し線・半透明化はそのまま維持）。
  - いずれもVS Codeテーマ変数（`inputValidation.infoBackground` / `diffEditor.insertedTextBackground` / `charts.blue` / `charts.green`）ベースで、ライト/ダーク/ハイコントラストテーマに自動追随する。

## [2.22.4] - 2026-07-15

### Fixed
- 本文項目に子項目を追加すると、既存の子項目の**先頭**に挿入され、下の階層の1番上に追加される不具合を修正（Issue #46 / R-15-03・R-15-04）。
  - Webview（`media/mindmap.js`）の「Tab キーで子項目を追加」および右クリックメニュー「子項目を追加」（`body-add-child`）が、親本文項目自身の `lineIdx` を挿入基準として渡していたため、`addBodyItem` が親行の直後（＝既存の子サブツリーの手前）に挿入していた。
  - 兄弟追加（`body-add-sibling`）と同様に `getBodyItemTree` / `findBodyItemByLineIdx` / `bodyItemLastLineIdx` で親サブツリーの末尾行を求め、その直後へ挿入するよう変更。これにより新しい子項目が既存の子項目の**末尾**（下の階層の1番下）に追加される。

## [2.21.4] - 2026-07-13

### Fixed
- 閉じた本文項目をドラッグ&ドロップで移動すると、フロントマターの `body-item-collapse` エントリが追随できず、想定外の行が閉じた状態として書き込まれる不具合を修正（Issue #40 / R-15-05）。
  - Webview（`media/mindmap.js`）の `performBodyDrop()` が移動元/移動先の `body`（Markdown行）を書き換える一方、対応する `collapsedBodyLines`（折りたたみ行インデックスの Set）を全く更新していなかった。移動元に残る後続項目のインデックスがずれたまま、移動した項目自身（および折りたたまれた子孫）の折りたたみ状態は消失したまま保存されていた。
  - 移動元は既存の `remapCollapsedBodyLinesAfterDelete` で削除範囲の除去とシフトを適用し、移動先は新設の `remapCollapsedBodyLinesAfterInsert` で挿入位置以降を挿入行数分シフトしたうえで、移動した項目自身の折りたたみ状態を新しい行インデックスへ再適用するようにした。`remapCollapsedBodyLinesAfterInsert` は `src/bodyItems.ts` にも同名関数としてミラーし、`media/mindmap.js` 側の `performBodyDrop` を実行するテストハーネスを `test/dragDrop.test.ts` に追加して検証した。

## [2.21.3] - 2026-07-13

### Fixed
- 閉じた本文項目（`body-item-collapse`）を持つ見出しノードを移動・削除・リネーム・左右変更しても、フロントマターの `body-item-collapse` エントリが更新されず旧パスが残る不具合を修正（Issue #38 / R-15-05）。
  - Webview（`media/mindmap.js`）の `postStructuralEdit()` が構造変更後のツリー基準で再計算した `bodyItemCollapsePaths`（`extractBodyItemCollapsePaths()`）を `structuralEdit` メッセージに同梱するようにした。
  - 拡張側（`src/mindmapPanel.ts`）の `structuralEdit` ハンドラで、配列ガード付きで `lastBodyItemCollapsePaths` キャッシュを受信値で更新してから `commitTree` を呼ぶようにした。旧 Webview（フィールドなし）では従来どおりキャッシュ値を使用（後方互換）。

## [2.21.2] - 2026-07-13

### Fixed
- 本文項目⇔見出しノードの単独昇格・降格（右クリックメニュー「見出しにする」「本文項目にする」）が `Ctrl+Z` で元に戻せない不具合を修正 — R-14-06。`promoteBodyItemToNode` / `demoteNodeToBodyItem` が Undo スナップショットを変更「後」に取得していたため復元できなかったのを、変更「前」に取得するよう修正（一括版 `promoteBodyItemsToNodes` / `demoteNodesToBodyItems` と順序を統一）。専用テスト `test/promoteDemote.test.ts` を追加し、R-14-01〜R-14-06 の検証を自動化。

## [2.21.1] - 2026-07-13

### Fixed
- 本文項目を D&D で下方向に移動し、子項目を持つ項目の直後（`after`）へドロップしたとき、ドロップ先の子孫が移動項目側に付け替わり親子関係が壊れる不具合を修正 — R-13-10。`performBodyDrop` の `after` 挿入位置を、フラット項目（`children` 常に空）ではなく `getBodyItemTree` / `findBodyItemByLineIdx` で解決したツリー項目の `bodyItemLastLineIdx`（サブツリー末尾）から算出し、常にドロップ先サブツリー末尾の直後へ挿入するようにした。上方向（`before`）挙動は不変。

## [2.21.0] - 2026-07-12

### Added
- 本文項目（子項目含む）の上下移動を、右クリックメニューの「↑ 上へ移動」「↓ 下へ移動」および `Alt+↑` / `Alt+↓` から操作可能にした — R-13-17（新設）。見出しノードの R-08 と同列で、同一親・同一インデントの兄弟本文項目間の順序を変更する。
  - 移動対象は自身の行ブロック（`bodyItemLastLineIdx` までの子項目を含む）とし、隣接する兄弟ブロックと入れ替える。インデント・種別（チェックボックス/箇条書き）は変更しない（純粋な兄弟スワップ、NF-03）。折りたたみ状態（`collapsedBodyLines`）は移動後の行番号へ再マップする。
  - 先頭項目の「上へ移動」・末尾項目の「下へ移動」はメニューでグレーアウト。複数選択中はメニュー項目を無効化。`Alt+↑/↓` は本文項目選択中は本文移動を優先し、見出し選択中は従来の見出し移動（R-08-02）。
  - 純粋ロジックを `src/bodyItems.ts`（`moveBodyItemLines` / `findBodyItemSiblings` / `remapCollapsedBodyLinesAfterMove`）に実装し `test/bodyItems.test.ts` でユニットテストを追加。`media/mindmap.js` にも同一ロジックをミラー（SYNC REQUIRED コメント更新）。

### Fixed
- 本文項目（子項目含む）を D&D で移動・並び替えしても `.md` に即時反映されない不具合を修正 — R-13-10（改訂）。
  - 原因: `media/mindmap.js` の `collectBodyDropCandidates` 内 `tagOwner` が全可視本文項目に `item._owner = node`（node = 所有見出しノード、`node._bodyItems` に item を含む）を代入して `root` を循環参照化していた。ドロップ判定は `performBodyDrop` 冒頭の `getBodyDropTarget` で走るため、`postStructuralEdit()` が `postMessage(root)` する時点で `root` は循環構造となり、VS Code の webview メッセージングがシリアライズできず例外に。構造変更が拡張機能へ届かず `.md` が更新されず、例外で末尾の `render()` もスキップされビューも無反応だった。見出しノードの D&D は `_owner` を付与しないため正常だったのが非対称性の理由。
  - 修正: `_owner` 逆参照を廃止し、owner（所有見出しノード）を `collectBodyDropFromItems` / `collectBodyDropCandidates` へパラメータとして受け渡すことで循環を根本から除去。`postStructuralEdit` の posted `root` を常にシリアライズ可能に保つ。`test/dragDrop.test.ts` に「ドロップ判定後も `root` が JSON シリアライズ可能（非循環）」の回帰テストを追加。

## [2.20.2] - 2026-07-12

### Fixed
- `.md` ソースエディタでの編集がマインドマップビューアへ「時々」リアルタイム反映されない不具合を修正 — R-11-09 / R-13-14。`media/mindmap.js` の `render()` が `nodeLayer.innerHTML = ''` で進行中のインライン `<input>` を DOM から除去する際、`blur`（commit/cancel）が発火しないため見出し編集の `editingId` や既存本文項目編集の `bodyEditing` が解放されず、保留された外部 update（`pendingUpdate`）が恒久的に取りこぼされていた（例: 編集中に `setFontSize` / `setEdgeWidth` が無条件 `render()` を呼ぶ経路）。
  - `render()` に、`drawNodes` 後に live なインライン編集入力（`input.edit-input`）が存在しないのに `editingId` / `bodyEditing` が立っている状態を検出して解放し、`applyPendingUpdate()` で保留 update を適用する汎用処理を追加。
  - 本文項目「追加」時に非同期（`requestAnimationFrame`）で入力を開く `_pendingBodyEdit` のケースは `hadPendingBodyEdit` フラグで除外し、誤解放しないようにした。既存の未描画 `_pendingBodyEdit` 解放挙動（R-13-14）は維持。

## [2.20.1] - 2026-07-11

### Fixed
- ドラッグ＆ドロップでノードを移動・並び替えしても `.md` に反映されないケースを修正 — R-02-03 / R-02-10（#33）。`media/mindmap.js` の `performDrop` / `performMultiDrop` が、ツリーを変更した後で早期リターンして `postStructuralEdit()`（構造変更の即時書き込み通知）をスキップし得る分岐を解消した。
  - `performMultiDrop`: ドロップ先の親が解決できない before/after を除去後に判定していた早期リターン（ノードが除去されたまま再挿入されず、かつ書き込みも行われない経路）を廃止。移動対象がツリーに存在しない場合は `pushUndo()` 前に抜けて、無効なドロップが幻の Undo ステップを残さないようにした。
  - `performDrop`: 挿入先をツリー変更前に解決し、解決できない並び替えは純粋なノーオペ（ノードは元の位置に留まる）とした。従来の「除去後に末尾へ再追加して並びを変えつつ書き込む」経路を除去し、変更が生じるドロップは必ず `postStructuralEdit()` に到達するようにした。

## [2.5.0] - 2026-06-17

### Added
- ビューア（WebviewPanel）を開いた時に、チェックボックス形式になっていないトップレベル（indent=0）の本文項目（プレーン箇条書き `- text`）へ空のチェックボックス（`- [ ] `）を自動付与する正規化（マイグレーション）を追加 — US-13 / R-13-11。
  - パネル初期化（Webview の `ready` 受信時、`ready` 不達時はフォールバックタイマー）で1パネルにつき1回だけ実行。トップレベルのプレーン箇条書きを `- [ ] text` に変換し、**変更があった場合のみ**既存の保存経路（`applyDocumentEdit` / `_editQueue`）で書き戻す。変換不要時は書き込みを行わずファイルをダーティにしない。
  - 既存チェックボックス（`- [ ]` / `- [x]` / `- [X]`）はチェック状態を保持してそのまま、ネスト（indent>0）のダッシュ項目はダッシュのまま、非リスト行（段落・通常文）およびコードフェンス（``` / ~~~）内のリスト風行は変更しない（NF-03 厳守）。
  - 純粋ロジックを `src/bodyItems.ts`（`normalizeBodyCheckboxes` / `normalizeTreeCheckboxes`）に実装し `test/bodyItems.test.ts` でユニットテストを追加。`media/mindmap.js` 側にも同一ロジックをミラー（SYNC REQUIRED コメント更新）。AT-13-11／AT-13-12 を追加。

## [2.4.0] - 2026-06-17

### Added
- 複数人同時編集時の変更消失（Lost Update）防止 — US-11 / R-11-04〜R-11-08。共有ドライブや Git 経由で同じ `.md` を複数人が開く前提で、楽観的同時実行制御（コンフリクト検知）を実装。リアルタイム共同編集は対象外で、目的は「他者の変更を黙って上書きして消す」ことの防止。
  - **base スナップショット追跡**（R-11-04）: `syncFromDocument` でキャッシュツリーを更新するたびに、そのパース元テキスト（改行は LF 正規化）を `baseText` として保持。書き込み成功後も書き込んだ内容で base を更新する。
  - **書き込み前コンフリクト検知**（R-11-05）: `applyDocumentEdit` の全文置換直前に、ライブの `TextDocument` と `vscode.workspace.fs.readFile` によるディスク実体の両方を base と比較。共有ドライブで TextDocument がディスクより古いケースに対応。改行コードのみの差異（CRLF/LF）と自分の書き込みエコーはコンフリクト扱いしない。
  - **コンフリクト時のモーダル選択**（R-11-06）: `showWarningMessage`（modal）で「最新を読み込む（自分の編集は破棄）」＝ディスクから再同期して書き込み中止、「自分の変更で上書き（他者の変更は破棄）」＝従来どおり全文置換、を提示。ダイアログを閉じた場合は安全側（最新読み込み）として扱う。
  - **破棄側のバックアップ退避**（R-11-07）: 破棄される側を `<file>.conflict-<mine|remote>-<timestamp>.md` として同ディレクトリに保存（ベストエフォート）。
  - **isOperating 窓の穴を塞ぐ**（R-11-08）: 操作中（`isOperating=true`）は外部変更イベントを無視するが、その間 base は更新されないため、操作完了後の書き込み前検知で必ずコンフリクトとして扱われる。既存の `_editQueue` 直列化・`applyingEdit` echo ガードは不変。
  - 判定の純粋ロジックを `src/conflictDetection.ts`（`detectConflict` / `normalizeText`）に分離し、`test/conflictDetection.test.ts` でユニットテストを追加。

## [2.3.9] - 2026-06-17

### Fixed
- コードフェンス（``` または ~~~）で囲まれたブロック内の見出し記法行（`# foo` 等）が、パース時に見出しノードへ昇格してしまい、本文項目との親子関係・本文内容が崩れる不具合を修正。`parseMarkdown` のセクション分割でフェンスの開閉状態を追跡し、フェンス内の行は見出し昇格判定の対象から外して本文(body)としてそのまま保持するようにした。serializer は body をそのまま出力するため、parse→serialize→parse のラウンドトリップが可逆になり、フェンス内コードのデータ破損を防止する。言語指定付きフェンス（```js）、~~~ フェンス、ミスマッチフェンス（``` を ~~~ で閉じない）、未クローズフェンス、インデントされたフェンス、ネスト見出し本文内のフェンスに対応。フェンス往復のユニットテストを追加。

## [2.3.8] - 2026-06-16

### Fixed
- 本文項目のチェックボックストグル・本文インライン編集・本文項目の追加/削除・本文ペースト、およびノード名のインライン編集が md ファイルに反映されないことがある不具合を修正。これらの経路は `editBody` / `renameNode`（単一ノードのみ更新）を送っていたが、拡張機能側が `findNodeById(lastRoot, id)` でノードを解決できなかった場合（webview 側 root の id と拡張機能側 lastRoot の id がずれた瞬間）に変更が黙って破棄されていた。2.3.7 のドラッグ＆ドロップ修正と同様、これら全経路を `structuralEdit`（ツリー全体送信）に統一し、id 解決に依存せず確実に永続化されるようにした。`editBody` / `renameNode` メッセージと拡張機能側の対応ハンドラ（および未使用となった `findNodeById`）を廃止し、サイレントドロップの温床を除去した。

## [2.3.7] - 2026-06-16

### Fixed
- 本文項目・子項目をドラッグ＆ドロップで移動しても md ファイルに反映されない不具合を修正。同一親内の本文項目移動で `editBody`（単一ノードの本文のみ更新）を送っていたが、拡張機能側が `findNodeById(lastRoot, id)` でノードを解決できなかった場合に本文変更が黙って破棄され、ファイルへ書き戻されないことがあった。見出しノードの移動と同じく `structuralEdit`（ツリー全体送信）に統一し、id 解決に依存せず確実に永続化されるようにした（R-13-10）。

## [2.3.6] - 2026-06-16

### Fixed
- 本文編集（editBody）/折りたたみ状態保存後にファイルを唯一の真実として再同期するよう統一。シリアライズ時の本文正規化で webview の lineIdx モデルがファイルと乖離し、後続の行操作が別の行を破壊し得る不具合を防止。インライン編集中は再同期で入力が破棄されないようガードを追加。

### Internal
- 本文項目の純粋ロジック（getBodyItems / getBodyItemTree / bodyItemLastLineIdx / findBodyItemByLineIdx / reformatBodyLines）を `src/bodyItems.ts` に移植し、`test/bodyItems.test.ts` でユニットテストを追加。

## [2.3.2] - 2026-06-14

### Changed
- バージョンを 2.3.1 → 2.3.2 にバンプ (#22)

## [2.2.11] - 2026-06-10

### Changed
- バージョンを 2.2.10 → 2.2.11 にバンプ (#16)

## [2.2.6] - 2026-06-09

### Fixed
- 子項目先頭の "ー" 表示を削除 (#8)

## [2.2.5] - 2026-06-09

### Fixed
- 本文複数選択ペースト時のインデント修正

## [2.2.4] - 2026-06-09

### Fixed
- 本文複数選択の移動・ペースト位置バグ修正

## [2.2.3] - 2026-06-09

### Fixed
- 削除確認ダイアログを削除
- 本文複数ドラッグ対応

## [2.2.2] - 2026-06-09

### Fixed
- 複数選択の移動・ペーストのバグ修正

## [2.2.1] - 2026-06-09

### Fixed
- 複数選択移動・本文ペースト・本文階層移動のバグ修正

## [2.2.0] - 2026-06-09

### Added
- ペースト先を選択ノードの子階層末尾に変更（H6上限時は無視）
- Ctrl+クリックによる複数選択機能
- 複数選択状態でのコピー・カット・ペースト・移動・削除対応

## [2.1.0] - 2026-06-09

### Changed
- コンテキストメニューの「本文行に変換」「先頭項目をノード化」「↑ ノード化」を廃止
- `convertNodeToBody` / `convertBodyLineToNode` 関数および関連未使用エクスポートを削除
- 要求仕様書から US-14 を削除

## [2.0.1] - 2026-06-09

### Changed
- ツールバーアイコンを `$(type-hierarchy)` から `media/icon.png` に変更

### Fixed
- README Known Issues にツールバーアイコンの16px表示に関する注記を追加

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
