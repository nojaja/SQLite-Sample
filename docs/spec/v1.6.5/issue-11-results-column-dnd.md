# Resultsのカラム名をエディタにD&D可能にする（Issue #11）

## 概要
v1.6.5 では、Resultsグリッド（Tabulator）のカラムヘッダをドラッグし、クエリエディタへドロップすることでカラム名を挿入できるようにする。

本仕様は、既存の Databases/Dataset ツリーで提供している tree-item D&D と同等の操作体験を、Results のカラムヘッダにも拡張することを目的とする。

## 背景
現状は Results のカラムヘッダがドラッグ可能ではなく、クエリエディタへ直接 D&D してカラム名を挿入できない。

そのため、結果確認後にSQLを組み立て直す際、カラム名を手入力または別UI経由でコピーする必要があり、操作効率が下がっている。

## 対象範囲
- 対象UI:
  - Results グリッド（`id="results-grid"`）
  - クエリエディタ（`id="query-editor"`）
- 対象機能:
  - Results カラムヘッダのドラッグ開始
  - D&D 時の DataTransfer へのカラム名設定
  - クエリエディタへのドロップ時カラム名挿入
- 主な想定反映先:
  - `src/js/components/MainArea.vue`
  - （必要に応じて）Tabulator列定義生成処理

## 非対象
- Results グリッドの列幅変更、並び替え、ソート仕様の変更
- SQLフォーマッター、実行エンジン、DBツリー仕様の変更
- クエリエディタの既存ファイルD&D仕様（`.sql`ドロップ）の変更

## 機能要件
1. Results カラムヘッダはドラッグ可能（`draggable=true`）であること。
2. `dragstart` 時に、D&Dデータへ対象カラム名を設定すること。
3. D&DデータのカスタムMIMEタイプは既存 tree-item と同じ `application/x-sqlite-webclient-tree-item-name` を使用すること。
4. 互換性のため `text/plain` にも同じカラム名を設定すること。
5. クエリエディタへドロップした場合、既存 tree-item D&D と同じ経路でカラム名が挿入されること。
6. ファイルD&D（`.sql`）の判定と競合しないこと。

## 非機能要件
- 既存の DBツリー / Datasetツリーの D&D 回帰を発生させないこと。
- 既存の Results 描画性能を大きく劣化させないこと（列定義時に不要な重処理を追加しない）。
- 複数ブラウザ（Chromium/Firefox/WebKit）で同一動作になること。

## 受け入れ条件
- AC-1: Results のカラムヘッダが draggable であり、`dragstart` 後の DataTransfer にカラム名が入る。
- AC-2: Results のカラムヘッダをクエリエディタへ D&D すると、エディタへ当該カラム名が挿入される。
- AC-3: AC-2 実行後も Monaco エディタがフリーズしない（既存 tree-item D&D と同等に操作継続できる）。
- AC-4: 既存の `.sql` ファイルD&D（有効/無効インジケータ含む）が回帰しない。

## テスト計画
### E2E（Playwright）
- ケース1: Results表示後、`col1` ヘッダを dragstart し、DataTransfer に `application/x-sqlite-webclient-tree-item-name=col1` が設定されることを確認。
- ケース2: `SELECT ` をエディタへ設定後、`col2` ヘッダを `#query-editor` へドロップし、エディタ値に `col2` が含まれることを確認。
- ケース3: D&D 後に追加で入力/実行が可能で、エディタが操作不能にならないことを確認。
- ケース4: 既存SQLファイルD&Dテストが通過することを確認。

### 追加済みspec
- `tests/spec/behavior/v1.6.5/results-column-dnd-to-editor.spec.ts`
  - AC-1 / AC-2 を先行で定義済み。

## 品質ゲート
- `npm run build`
- `npm run depcruise`
- `npm run test:ci`
- `npm run lint`
- `npm run docs`

## 実装メモ
- Results列定義生成時に、ヘッダDOMへ `draggable` と `dragstart` ハンドラを紐づける。
- `dragstart` ハンドラ内で以下を設定する:
  - `dataTransfer.setData('application/x-sqlite-webclient-tree-item-name', columnName)`
  - `dataTransfer.setData('text/plain', columnName)`
- クエリエディタ側は既存 `isTreeItemDragEvent` / `getDraggedTreeItemName` の分岐を流用し、新規分岐を極力増やさない。
- tree-item D&D と同じ MIME を使うことで、MainArea の drop 処理を再利用する。
