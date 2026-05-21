# クエリタブの localStorage 永続化（Issue #9）

## 概要
v1.6.4 では、`id="query-tabs"` 内の各タブに入力されたクエリ内容を localStorage に永続化する。
キー名はタブのラベル名と同一とし、Monaco エディタの変更イベントで即時保存、ページ再読み込み時に復元、タブ閉じボタン（×）押下時にキーを削除する。

## 背景
現状ではページをリロードまたはブラウザを閉じると、クエリタブに入力した SQL がすべて失われる。
作業中の SQL を保持したままブラウザ操作ができないため、作業継続性が損なわれている。

## 対象範囲
- 対象 UI:
  - クエリタブ（`id="query-tabs"`）
  - クエリエディタ（Monaco Editor、`id="sql-editor"`）
- 対象機能:
  - タブ内容の localStorage への自動保存
  - ページ読み込み時のタブ復元
  - タブ閉じ時の localStorage エントリ削除
- 主な想定反映先:
  - `src/js/components/MainArea.vue`

## 非対象
- タブ並び順の永続化
- タブ名のリネーム機能
- IndexedDB など localStorage 以外のストレージへの保存

## 機能要件
1. Monaco エディタで内容が変更されるたびに、アクティブタブのラベル名をキーとして `window.localStorage.setItem(label, queryContent)` で保存する。
2. ページ読み込み時（`onMounted`）に、localStorage に存在するすべての保存済みタブを復元する。
   - 既定の初期タブ（`Query1`）も localStorage に保存済みのエントリが存在する場合、その内容で上書き復元する。
   - localStorage に保存済みのキーが複数存在する場合、すべてをタブとして追加する。
   - タブの表示順は localStorage への保存順（= `localStorage.key(index)` の順）に準じる（実装都合で順序が変わる場合は「不定でも可」と明記する）。
3. タブの×ボタン押下時に、そのタブのラベル名をキーとして `window.localStorage.removeItem(label)` を呼び出す。
4. タブラベルと localStorage キーの対応は **タブラベル文字列の完全一致** で管理する。
5. `window` の `storage` イベントを購読し、別ウィンドウ／タブでの localStorage 変更を検知した場合、以下を行う。
   - `event.key` と一致するラベルを持つクエリタブが存在する場合、そのタブの `query` を `event.newValue`（`null` の場合は空文字）に更新する。
   - 当該タブが現在アクティブであれば、Monaco エディタの表示内容も即時反映する。
   - イベントリスナーはコンポーネントのアンマウント時（`onBeforeUnmount`）に解除する。
6. 同一ウィンドウ内で DevTools やスクリプトから `window.localStorage.setItem/removeItem` により Query1 などのキーが直接変更された場合も、該当タブの `query` とエディタ表示に反映する。
  - この経路は `storage` イベントだけでは拾えないため、同一ページ内の localStorage 更新通知を補助的に購読する。
  - 反映時に外部変更扱いとして更新し、Monaco の変更イベントと保存処理が無限ループしないようにする。

## 非機能要件
- localStorage への書き込みは Monaco `onChange` イベントの都度行い、明示的な「保存」操作は不要とする。
- 既存のタブ操作（追加・切り替え・D&D 並べ替え・クエリ実行）の動作を変えない。
- localStorage が利用不可の環境（プライベートモード等）では、エラーを出さずに無視する（try/catch で保護する）。
- `storage` イベントによる外部更新は、自ウィンドウ内の Monaco 変更イベントとループしない。
- 同一ウィンドウ内の DevTools 直接変更については、localStorage 更新通知を別経路で拾い、同じくループしないように制御する。

## 受け入れ条件
- AC-1: クエリタブにSQL を入力後、localStorage の当該ラベルキーに入力内容が保存されている。
- AC-2: ページをリロードすると、保存済みタブ（ラベル名とクエリ内容）が復元される。
- AC-3: 複数タブを開いて各タブにSQLを入力後リロードすると、すべてのタブが復元される。
- AC-4: タブの×ボタンを押すと、localStorage から当該キーが削除される。
- AC-5: localStorage が空（保存済みタブなし）の場合、初期状態（`Query1` / 空クエリ）で起動する。
- AC-6: 既存のタブ追加・切り替え・D&D・クエリ実行の回帰が発生しない。
- AC-7: 別ウィンドウから同じキーの localStorage が更新されると、該当タブの内容がエディタに反映される。
- AC-8: 別ウィンドウから localStorage キーが削除されても、タブ自体は閉じられず内容のみ空になる（タブ削除は明示操作のみ）。
- AC-9: 同一ウィンドウ内で DevTools などから localStorage の Query1 を直接変更しても、該当タブの内容がエディタに反映される。

## テスト計画
### E2E（Playwright）
- ケース1: エディタに SQL を入力後、`localStorage.getItem(tabLabel)` に同内容が保存されていることを確認。
- ケース2: SQL 入力後にページをリロードし、同じタブラベルと内容が復元されることを確認。
- ケース3: 2つのタブにそれぞれ別の SQL を入力後リロードし、両タブが復元されることを確認。
- ケース4: タブ×を押した後、`localStorage.getItem(tabLabel)` が `null` になることを確認。
- ケース5: localStorage が空の状態でページを開くと `Query1` タブが空クエリで表示されることを確認。
- ケース6: 別ウィンドウから `storage` イベントを発火させ、該当タブの内容がエディタに反映されることを確認（AC-7）。
- ケース7: 別ウィンドウから `storage` イベント（`newValue: null`）を発火させ、タブ自体は残り内容が空になることを確認（AC-8）。
- ケース8: 同一ウィンドウで `window.localStorage.setItem('Query1', ...)` を直接呼び出し、該当タブの内容がエディタへ反映されることを確認（AC-9）。

### 回帰
- 既存のクエリ実行・タブ追加・タブ D&D 並べ替えのシナリオが通過すること。

## 品質ゲート
- `npm run build`
- `npm run depcruise`
- `npm run test:ci`
- `npm run lint`
- `npm run docs`

## 実装メモ
- `updateActiveTabQuery` 関数内で `localStorage.setItem(tab.label, value)` を呼び出す。
- `onMounted` 時に `localStorage` をスキャンし、タブを再構築する（`queryTabSerial` も正しく進める）。
- `closeQueryTab` 関数内で `localStorage.removeItem(tab.label)` を呼び出す。
- `onMounted` 時に `window.addEventListener('storage', handleStorageEvent)` を登録し、`onBeforeUnmount` で `removeEventListener` を呼ぶ。
- `handleStorageEvent` では `event.key` に一致するタブを探し、`query` を `event.newValue ?? ''` で上書きする。アクティブタブであれば Monaco エディタの値も更新する（`sqlEditorRef.value?.setValue(...)` 等）。
- 同一ウィンドウ内の `localStorage.setItem/removeItem` は、専用の補助通知経路で拾って同じ更新処理へ流す。
- localStorage キーが他の用途（DatasetDB など）と衝突しないよう、将来的にはプレフィックス付与を推奨するが、Issue の仕様（タブ名そのものをキーとする）に従い今回はプレフィックスなしとする。

## 教訓メモ
- `setInterval` で localStorage 全体を定期スキャンする方法は、Monaco の `setValue` と Vue の再リアクティブ化が重なってフリーズを誘発したため採用しない。
- `syncQueryTabsFromStorageSnapshot()` のように、localStorage 読み戻し時にエディタへ手動で `setValue()` を重ねる方法は、`:value` バインディングとの二重更新で再帰的な更新ループを作りやすい。
- `storage` イベントだけに依存すると、同一ウィンドウ内の DevTools による `localStorage.setItem/removeItem` 変更は拾えないため、AC-9 は満たせない。
- `Storage.prototype.setItem/removeItem` を同期的にフックしてその場で通知する方式は、`page.evaluate()` 自体が長時間ブロックされ、テストや画面操作がタイムアウトしやすい。
- 隠し iframe を追加して別ドキュメント側の `storage` イベントで拾う案も、同一ページ内の直接変更の検知と反映を安定化できなかったため、補助策としては不十分だった。
