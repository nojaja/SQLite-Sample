/**
 * クエリタブ localStorage 永続化ユーティリティ
 *
 * localStorage キーはタブのラベル文字列と完全一致で対応させる。
 * すべての操作は try/catch で保護し、localStorage が利用不可でも
 * 例外をスローしない。
 */

/** クエリタブの復元データ型 */
export interface QueryTabData {
  /** タブのラベル（localStorage のキーと一致） */
  label: string;
  /** タブに入力された SQL クエリ文字列 */
  query: string;
}

/**
 * 処理名: クエリタブ用キー判定
 * 処理概要: localStorage キーがクエリタブの保存用かどうかを判定する
 * 実装理由: ページ復元時にシステムキー（Dataset DB など）を除外するため
 * @param key localStorage キー
 * @returns クエリタブ用キーの場合 true
 */
export function isQueryTabKey(key: string): boolean {
  // システムキーのプレフィックスを除外
  if (key.startsWith('sqlite-webclient.')) return false;
  // その他の将来的なシステムプレフィックスを防ぐため、英数字とハイフン、アンダースコアのみを許可
  // （通常のタブラベルは英数字のみと想定）
  return /^[a-zA-Z0-9_-]+$/.test(key);
}

/**
 * 処理名: クエリタブ保存
 * 処理概要: タブのラベルをキーとしてクエリ内容を Storage に保存する
 * 実装理由: Monaco エディタの onChange イベントから呼び出すため
 * @param storage 保存先 Storage（window.localStorage を想定）
 * @param label タブのラベル文字列（Storage キーとして使用）
 * @param query 保存するクエリ内容
 */
export function saveQueryTab(storage: Storage, label: string, query: string): void {
  try {
    storage.setItem(label, query);
  } catch {
    // localStorage 利用不可（プライベートモード等）は無視する
  }
}

/**
 * 処理名: クエリタブ削除
 * 処理概要: タブのラベルに対応する Storage エントリを削除する
 * 実装理由: タブの × ボタン押下時に Storage からエントリを除去するため
 * @param storage 対象 Storage（window.localStorage を想定）
 * @param label タブのラベル文字列（Storage キー）
 */
export function removeQueryTab(storage: Storage, label: string): void {
  try {
    storage.removeItem(label);
  } catch {
    // localStorage 利用不可は無視する
  }
}

/**
 * 処理名: クエリタブ復元
 * 処理概要: Storage に保存されたすべてのエントリからクエリタブ情報を返す。
 *           システムキー（プレフィックス付き）は除外する。
 * 実装理由: ページ読み込み時（onMounted）にタブを再構築するため
 * @param storage 読み込み元 Storage（window.localStorage を想定）
 * @returns 保存済みクエリタブデータの配列（保存順、システムキー除外）
 */
export function restoreQueryTabs(storage: Storage): QueryTabData[] {
  try {
    const result: QueryTabData[] = [];
    for (let i = 0; i < storage.length; i++) {
      const label = storage.key(i);
      if (label === null) continue;
      if (!isQueryTabKey(label)) continue; // システムキーを除外
      const query = storage.getItem(label) ?? '';
      result.push({ label, query });
    }
    return result;
  } catch {
    return [];
  }
}

/**
 * 処理名: storage イベント適用
 * 処理概要: 別ウィンドウからの storage 変更をタブ配列に反映した新配列を返す
 * 実装理由: window の storage イベントハンドラから呼び出し、
 *           他ウィンドウでの編集によるデグレードを防止するため
 * @param key 変更された localStorage キー（= タブラベル）
 * @param newValue 変更後の値（null の場合はキー削除を意味し空文字に変換）
 * @param tabs 現在のクエリタブ配列
 * @returns 更新後のクエリタブ配列（イミュータブル）
 */
export function applyStorageEvent(
  key: string,
  newValue: string | null,
  tabs: QueryTabData[],
): QueryTabData[] {
  const target = tabs.find(t => t.label === key);
  if (!target) return tabs;
  return tabs.map(t =>
    t.label === key ? { ...t, query: newValue ?? '' } : t,
  );
}
