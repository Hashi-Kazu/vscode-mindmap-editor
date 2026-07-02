import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyStructuralEdit } from '../src/syncGuard';

// R-19-04: ドキュメント切替後に遅延到着した structuralEdit（切替前 URI 付き）は
// 現ドキュメントへ書き込まず破棄扱いにする
test('URI 不一致の structuralEdit は discardWrongDocument', () => {
  assert.equal(
    classifyStructuralEdit({
      msgDocUri: 'file:///old.md',
      currentDocUri: 'file:///new.md',
      baseGeneration: 5,
      lastExternalGeneration: 5,
    }),
    'discardWrongDocument'
  );
});

// R-19-04: URI 不一致は世代判定より優先される（別ファイルへの上書きを絶対に避ける）
test('URI 不一致は baseGeneration が新しくても discardWrongDocument', () => {
  assert.equal(
    classifyStructuralEdit({
      msgDocUri: 'file:///old.md',
      currentDocUri: 'file:///new.md',
      baseGeneration: 10,
      lastExternalGeneration: 3,
    }),
    'discardWrongDocument'
  );
});

// R-11-09: 操作中にすり抜けた外部変更（外部世代）より古いツリーからの編集は
// コンフリクト解決フローへ乗せる
test('外部世代より古い baseGeneration は conflictStaleBase', () => {
  assert.equal(
    classifyStructuralEdit({
      msgDocUri: 'file:///doc.md',
      currentDocUri: 'file:///doc.md',
      baseGeneration: 3,
      lastExternalGeneration: 5,
    }),
    'conflictStaleBase'
  );
});

// R-11-09: 最新の外部世代と一致・それより新しい世代（コミット直後のエコー再同期）
// および世代フィールドを持たない旧形式メッセージは従来どおり適用する
test('世代一致・旧形式メッセージは apply', () => {
  // 世代一致
  assert.equal(
    classifyStructuralEdit({
      msgDocUri: 'file:///doc.md',
      currentDocUri: 'file:///doc.md',
      baseGeneration: 5,
      lastExternalGeneration: 5,
    }),
    'apply'
  );
  // 世代が新しい（自コミットのエコー再同期を基にした編集）
  assert.equal(
    classifyStructuralEdit({
      msgDocUri: 'file:///doc.md',
      currentDocUri: 'file:///doc.md',
      baseGeneration: 8,
      lastExternalGeneration: 5,
    }),
    'apply'
  );
  // 旧形式（フィールド未定義）
  assert.equal(
    classifyStructuralEdit({
      currentDocUri: 'file:///doc.md',
      lastExternalGeneration: 5,
    }),
    'apply'
  );
});
