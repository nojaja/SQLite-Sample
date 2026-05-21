<template>
  <div id="main-area" class="main-area" v-show="queryTabs.length > 0">
    <!-- クエリタブ -->
    <div id="query-tabs" class="query-tabs">
      <div
        v-for="tab in queryTabs"
        :key="tab.id"
        class="query-tab"
        :class="{ active: tab.id === activeQueryTabId }"
        :data-tab-id="tab.id"
        @click="switchQueryTab(tab.id)"
        draggable="true"
        @dragstart="onQueryTabDragStart($event, tab.id)"
        @dragover.prevent="onQueryTabDragOver($event)"
        @drop.prevent="onQueryTabDrop(tab.id)"
        @dragend="onQueryTabDragEnd"
      >
        {{ tab.label }}<span class="close-tab" @click.stop="closeQueryTab(tab.id)">×</span>
      </div>
    </div>

    <!-- クエリエリア（単一MonacoEditorをアクティブタブで共有） -->
    <div
      id="query-editor"
      class="query-editor"
      ref="queryEditorEl"
      :class="{ 'drop-target-active': isQueryDropActive, 'drop-target-invalid': isQueryDropInvalid }"
      @dragenter.prevent="onQueryEditorDragEnter"
      @dragleave.prevent="onQueryEditorDragLeave"
      @dragover.capture.prevent="onQueryEditorDragOver"
      @drop.capture.prevent="onQueryEditorDrop"
    >
      <div v-if="isQueryDropActive" class="query-drop-indicator" :class="{ invalid: isQueryDropInvalid }">
        {{ isQueryDropInvalid ? 'この場所には .sql のみドロップできます' : 'SQLファイルをドロップしてクエリを読み込む' }}
      </div>
      <MonacoEditor
        id="sql-editor"
        :value="activeTabQuery"
        @editorDidMount="onEditorMounted"
        language="sql"
        :options="monacoOptions"
        style="width: 100%; height: 100%;"
      />
      <iframe
        ref="storageSyncFrameEl"
        aria-hidden="true"
        tabindex="-1"
        style="display: none;"
      />
    </div>

    <!-- 水平スプリッター -->
    <div class="row-splitter" ref="rowSplitterEl"></div>

    <!-- パネルエリア -->
    <div class="panel-area">
      <!-- 結果タブ -->
      <div class="results-tabs">
        <div
          v-for="tab in displayedResultTabs"
          :key="tab.id"
          class="result-tab"
          :class="{ active: tab.id === activeResultTabId }"
          @click="switchResultTab(tab.id)"
          draggable="true"
          @dragstart="onResultTabDragStart($event, tab.id)"
          @dragover.prevent="onResultTabDragOver($event)"
          @drop.prevent="onResultTabDrop(tab.id)"
          @dragend="onResultTabDragEnd"
        >
          {{ tab.label }}
          <span v-if="tab.closable" class="close-tab" @click.stop="closeDisplayedResultTab(tab)">×</span>
        </div>
      </div>

      <!-- 結果エリア -->
      <div id="results-area" class="results-area" :style="{ display: showResultsArea ? '' : 'none' }">
        <NormalResultsPanel
          :visible="isNormalResultsPanelVisible"
          :result-tabs="resultTabs"
          :active-result-tab-id="activeResultTabId"
          :show-results-menu-bar="showResultsMenuBar"
          :has-result-grid-data="hasResultGridData"
          @register-dataset="$emit('register-dataset')"
          @download-csv="$emit('download-csv')"
        />
        <EditableGridViewPanel
          :visible="isEditableGridPanelVisible"
          :editable-grid-tabs="editableGridTabs"
          :active-result-tab-id="activeResultTabId"
          @query-generated="onEditableGridQueryGenerated"
          @update-query-generated="onEditableGridUpdateQueryGenerated"
        />

      </div>

      <!-- メッセージエリア -->
      <div
        id="messages-area"
        class="messages-area"
        v-show="showMessagesArea"
      >
        <div class="results-toolbar">
          <button id="messages-clear-button" class="toolbar-button" @click="clearMessages">
            <span class="material-symbols-outlined">clear_all</span> Clear Messages
          </button>
        </div>
        <div class="messages-log">
          <div v-for="(msg, i) in messages" :key="i">{{ msg }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, nextTick, onMounted, onBeforeUnmount } from 'vue';
import MonacoEditor from 'monaco-editor-vue3';
import * as monaco from 'monaco-editor';
import { formatSqlText } from '../sqlFormatter';
import { formatIdentifier } from '../datasetDb';
import { saveQueryTab, removeQueryTab, restoreQueryTabs, isQueryTabKey } from '../queryTabStorage';
import { TabulatorFull as Tabulator } from 'tabulator-tables';
import 'tabulator-tables/dist/css/tabulator.min.css';
import { useRowSplitter } from '../composables/useRowSplitter';
import EditableGridViewPanel from './EditableGridViewPanel.vue';
import NormalResultsPanel from './NormalResultsPanel.vue';

const emit = defineEmits<{
  'register-dataset': [];
  'download-csv': [];
  'run-query': [];
  'drop-query': [files: File[]];
  'save-query': [];
}>();

defineOptions({ name: 'AppMainArea' });

// ---- クエリタブ ----
interface QueryTab {
  id: string;
  label: string;
  query: string;
}

const queryTabs = ref<QueryTab[]>([{ id: 'query1', label: 'Query1', query: '' }]);
const activeQueryTabId = ref('query1');
let queryTabSerial = 2;
const sqlEditorRef = ref<monaco.editor.IStandaloneCodeEditor | null>(null);
const storageSyncFrameEl = ref<HTMLIFrameElement | null>(null);
const draggedQueryTabId = ref<string | null>(null);
let isApplyingExternalQueryChange = false;
let queryStorageSyncTimer: number | undefined;
let storageSyncFrameWindow: Window | null = null;
const LOCAL_STORAGE_DIRECT_CHANGE_EVENT = 'sqlite-webclient:local-storage-direct-change';
let restoreLocalStorageInterceptors: (() => void) | null = null;

/** Monacoエディタの設定オプション */
const monacoOptions = {
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  wordWrap: 'on' as const,
  fontSize: 14,
  lineNumbers: 'on' as const,
  automaticLayout: true,
  dragAndDrop: false,
};

/**
 * 処理名: アクティブタブのクエリ取得 (computed)
 * 処理概要: 現在アクティブなタブの SQL 文字列を返す computed
 * 実装理由: Monacoエディタの :value バインディングに使用するため
 */
const activeTabQuery = computed<string>(
  () => queryTabs.value.find(t => t.id === activeQueryTabId.value)?.query ?? ''
);

/**
 * 処理名: アクティブクエリタブ取得
 * 処理概要: 現在アクティブなクエリタブを返す
 * 実装理由: クエリ更新処理の参照先を 1 箇所に集約するため
 * @returns アクティブなクエリタブ。存在しない場合は undefined
 */
const getActiveQueryTab = (): QueryTab | undefined => {
  return queryTabs.value.find(t => t.id === activeQueryTabId.value);
};

/**
 * 処理名: 外部変更エディタ反映
 * 処理概要: 外部同期で確定した SQL 文字列を Monaco エディタへ反映する
 * 実装理由: storage 同期時に change ハンドラの再保存ループを防ぐため
 * @param value エディタへ反映する SQL 文字列
 */
const applyQueryToEditor = (value: string): void => {
  const editor = sqlEditorRef.value;
  if (!editor) return;
  if (editor.getValue() === value) return;
  isApplyingExternalQueryChange = true;
  try {
    editor.setValue(value);
  } finally {
    isApplyingExternalQueryChange = false;
  }
};
/**
 * 処理名: アクティブタブのクエリ更新
 * 処理概要: Monacoエディタの内容変更時にアクティブタブの query を更新し localStorage に保存する
 * 実装理由: Monacoの onDidChangeModelContent イベントハンドラとして使用するため
 * @param value Monacoエディタの現在内容
 */
const updateActiveTabQuery = (value: string) => {
  const tab = getActiveQueryTab();
  if (!tab) return;
  if (isApplyingExternalQueryChange) {
    tab.query = value;
    return;
  }
  tab.query = value;
  saveQueryTab(window.localStorage, tab.label, value);
};

/**
 * 処理名: クエリタブ切り替え
 * 処理概要: 指定 ID のクエリタブをアクティブにする
 * 実装理由: タブクリック時にアクティブタブを切り替えるため
 * @param id タブ ID
 */
const switchQueryTab = (id: string) => {
  activeQueryTabId.value = id;
};

/**
 * 処理名: 配列要素移動
 * 処理概要: 配列内の要素を指定位置に移動した新配列を返す
 * 実装理由: タブ D&D 並べ替えのロジックを共通化するため
 * @param list 元配列
 * @param fromId 移動元ID
 * @param toId 移動先ID
 * @returns 並べ替え後の配列
 */
const reorderById = <T extends { id: string }>(list: T[], fromId: string, toId: string): T[] => {
  if (fromId === toId) return list;
  const fromIndex = list.findIndex((item) => item.id === fromId);
  const toIndex = list.findIndex((item) => item.id === toId);
  if (fromIndex === -1 || toIndex === -1) return list;
  const next = [...list];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
};

/**
 * 処理名: クエリタブドラッグ開始
 * 処理概要: 並べ替え対象のクエリタブIDを保持する
 * 実装理由: drop 時に移動元タブを特定するため
 * @param e ドラッグイベント
 * @param tabId タブID
 */
const onQueryTabDragStart = (e: DragEvent, tabId: string) => {
  draggedQueryTabId.value = tabId;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', tabId);
  }
};

/**
 * 処理名: クエリタブドラッグオーバー
 * 処理概要: 並べ替え対象に move ドロップ効果を設定する
 * 実装理由: UI フィードバックを明示するため
 * @param e ドラッグイベント
 */
const onQueryTabDragOver = (e: DragEvent) => {
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
};

/**
 * 処理名: クエリタブドロップ
 * 処理概要: クエリタブ配列を並べ替える
 * 実装理由: タブ順を左右移動で変更できるようにするため
 * @param targetTabId ドロップ先タブID
 */
const onQueryTabDrop = (targetTabId: string) => {
  const sourceTabId = draggedQueryTabId.value;
  if (!sourceTabId) return;
  queryTabs.value = reorderById(queryTabs.value, sourceTabId, targetTabId);
};

/**
 * 処理名: クエリタブドラッグ終了
 * 処理概要: 並べ替え状態を初期化する
 * 実装理由: 次回ドラッグ操作に前回状態を持ち越さないため
 */
const onQueryTabDragEnd = () => {
  draggedQueryTabId.value = null;
};

/**
 * 処理名: クエリタブ閉じる
 * 処理概要: 指定 ID のクエリタブを削除し localStorage エントリも除去する。必要に応じて隣接タブにフォーカスを移す
 * 実装理由: タブ閉じるボタン操作に対応するため
 * @param id 閉じるタブ ID
 */
const closeQueryTab = (id: string) => {
  const idx = queryTabs.value.findIndex(t => t.id === id);
  if (idx === -1) return;
  const tab = queryTabs.value[idx];
  removeQueryTab(window.localStorage, tab.label);
  queryTabs.value.splice(idx, 1);
  if (activeQueryTabId.value === id) {
    const next = queryTabs.value[Math.max(0, idx - 1)];
    if (next) activeQueryTabId.value = next.id;
  }
};

/**
 * 処理名: クエリタブ追加
 * 処理概要: 新規クエリタブをシリアル番号付きで追加しアクティブにする
 * 実装理由: メニューの「New Query」ボタンからタブを追加するため
 * @param label タブラベル（デフォルト: 'Query'）
 */
const addQueryTab = (label = 'Query') => {
  const id = `query${queryTabSerial++}`;
  const num = id.replace('query', '');
  queryTabs.value.push({ id, label: `${label}${num}`, query: '' });
  activeQueryTabId.value = id;
};

/**
 * 処理名: アクティブタブのクエリ取得
 * 処理概要: 現在アクティブなクエリタブの SQL 文字列を返す
 * 実装理由: 親コンポーネントのクエリ実行に使用するため
 * @returns アクティブタブの SQL 文字列
 */
const getActiveQuery = (): string => {
  return queryTabs.value.find(t => t.id === activeQueryTabId.value)?.query ?? '';
};

/**
 * 処理名: アクティブタブのクエリ設定
 * 処理概要: 現在アクティブなクエリタブの SQL 文字列を展開または書き換える
 * 実装理由: SQLファイル読み込み時にエディタ内容を設定するため
 * @param value 設定する SQL 文字列
 */
const setActiveQuery = (value: string) => {
  const tab = getActiveQueryTab();
  if (!tab) return;
  tab.query = value;
};

/**
 * 処理名: アクティブタブへクエリ追記
 * 処理概要: 現在のクエリ末尾に SQL 文字列を追記する
 * 実装理由: サイドバーのコンテキストメニュー操作で SQL を追記するため
 * @param value 追記する SQL 文字列
 */
const appendActiveQuery = (value: string) => {
  const tab = getActiveQueryTab();
  if (!tab || !value) return;
  const needsSeparator = tab.query.trim().length > 0 && !tab.query.endsWith('\n');
  tab.query = `${tab.query}${needsSeparator ? '\n' : ''}${value}\n`;
};

// ---- 結果タブ ----
interface ResultData {
  columns: string[];
  data: Record<string, unknown>[];
}

const resultGridData = reactive<Map<string, ResultData>>(new Map());

const tabulatorInstances = reactive<Map<string, Tabulator>>(new Map());

const tabulatorOptions = {
  layout: 'fitDataStretch',
  pagination: true,
  paginationMode: 'local' as const,
  paginationSize: 50,
  selectableRows: false,
};

const RESULT_COLUMN_HEADER_BOUND_ATTR = 'data-results-column-dnd-bound';

/**
 * 処理名: Tabulator表示要素取得
 * 処理概要: 指定テーブルIDに対応するTabulator表示要素を返す
 * 実装理由: 結果タブごとにTabulatorインスタンスを生成するため
 * @param tableId 結果テーブル ID
 * @returns Tabulator を描画する HTML 要素
 */
const getTabulatorHostElement = (tableId: string): HTMLElement | null => {
  return document.getElementById(`tabulator-${tableId}`);
};

/**
 * 処理名: ResultsヘッダD&D開始ハンドラ
 * 処理概要: Resultsカラムの dragstart 時にクエリエディタ挿入用データを設定する
 * 実装理由: DBツリー/Datasetツリーと同じ drop 経路を再利用してカラム名を挿入するため
 * @param e ドラッグイベント
 * @param columnName カラム名
 */
const onResultsColumnDragStart = (e: DragEvent, columnName: string): void => {
  if (!e.dataTransfer) return;
  const name = columnName.trim();
  if (!name) return;
  e.dataTransfer.setData('application/x-sqlite-webclient-tree-item-name', name);
  e.dataTransfer.setData('text/plain', name);
  e.dataTransfer.effectAllowed = 'copy';
};

/**
 * 処理名: Resultsヘッダdragstartハンドラ生成
 * 処理概要: 指定カラム名を転送する dragstart ハンドラを返す
 * 実装理由: 無名関数を避けてJSDoc要件を満たしつつ処理を再利用するため
 * @param columnName カラム名
 * @returns dragstart イベントハンドラ
 */
const createResultsHeaderDragStartHandler = (columnName: string) => {
  return (event: Event) => {
    onResultsColumnDragStart(event as DragEvent, columnName);
  };
};

/**
 * 処理名: ResultsヘッダDOMへD&Dを関連付ける
 * 処理概要: `.tabulator-col` 要素を draggable にし dragstart ハンドラを登録する
 * 実装理由: Resultsカラム名をクエリエディタへ直接D&Dできるようにするため
 * @param hostElement Tabulatorホスト要素
 */
const bindResultsColumnDragSources = (hostElement: HTMLElement) => {
  const headerElements = Array.from(hostElement.querySelectorAll('.tabulator-col[tabulator-field]')) as HTMLElement[];
  headerElements.forEach((headerElement) => {
    if (headerElement.getAttribute(RESULT_COLUMN_HEADER_BOUND_ATTR) === '1') return;
    const fieldName = String(headerElement.getAttribute('tabulator-field') ?? '').trim();
    const titleName = String((headerElement.querySelector('.tabulator-col-title') as HTMLElement | null)?.innerText ?? '').trim();
    const columnName = fieldName || titleName;
    if (!columnName) return;

    headerElement.draggable = true;
    const handleDragStart = createResultsHeaderDragStartHandler(columnName);
    headerElement.addEventListener('dragstart', handleDragStart);
    headerElement.setAttribute(RESULT_COLUMN_HEADER_BOUND_ATTR, '1');
  });
};

/**
 * 処理名: Tabulator列定義生成
 * 処理概要: 列名配列からTabulator用の列定義配列を生成する
 * 実装理由: クエリ結果の列構成に応じて動的にテーブルを描画するため
 * @param columns 列名配列
 * @returns Tabulator 用列定義配列
 */
const buildTabulatorColumns = (columns: string[]) => {
  return columns.map((column) => ({
    title: column,
    field: column,
    formatter: 'textarea',
    variableHeight: true,
  }));
};

/**
 * 処理名: Tabulatorインスタンス破棄
 * 処理概要: 指定テーブルIDのTabulatorインスタンスを破棄する
 * 実装理由: タブ削除時や再描画時のメモリリークを防止するため
 * @param tableId 結果テーブル ID
 */
const destroyTabulatorInstance = (tableId: string) => {
  const instance = tabulatorInstances.get(tableId);
  if (!instance) return;
  instance.destroy();
  tabulatorInstances.delete(tableId);
};

/**
 * 処理名: Tabulator再描画
 * 処理概要: 指定テーブルIDに対応するTabulatorを生成し結果データを反映する
 * 実装理由: 列構成が変わるケースを確実に反映するため都度再生成を行う
 * @param tableId 結果テーブル ID
 */
const renderTabulatorForTable = (tableId: string) => {
  const hostElement = getTabulatorHostElement(tableId);
  const tableData = resultGridData.get(tableId);
  if (!hostElement || !tableData) return;

  destroyTabulatorInstance(tableId);
  const instance = new Tabulator(hostElement, {
    ...tabulatorOptions,
    columns: buildTabulatorColumns(tableData.columns),
    data: tableData.data,
  });
  bindResultsColumnDragSources(hostElement);
  instance.on('tableBuilt', () => {
    bindResultsColumnDragSources(hostElement);
  });
  tabulatorInstances.set(tableId, instance);
};

/**
 * 処理名: Tabulator再描画予約
 * 処理概要: DOM更新完了後にTabulator描画処理を実行する
 * 実装理由: タブ追加直後でも描画先要素を確実に取得するため
 * @param tableId 結果テーブル ID
 */
const scheduleTabulatorRender = async (tableId: string) => {
  await nextTick();
  renderTabulatorForTable(tableId);
};

/**
 * 処理名: Tabulator全破棄
 * 処理概要: 保持中のTabulatorインスタンスを全て破棄する
 * 実装理由: タブ全削除時およびコンポーネント破棄時の後始末を共通化するため
 */
const destroyAllTabulatorInstances = () => {
  Array.from(tabulatorInstances.keys()).forEach(destroyTabulatorInstance);
};

/**
 * 処理名: 結果データ存在確認
 * 処理概要: 指定タブ ID に結果データが存在するか確認する
 * 実装理由: Tabulator 描画前にデータの有無を判定するため
 * @param tableId 結果テーブル ID
 * @returns データが存在する場合 true
 */
const hasResultGridData = (tableId: string): boolean => resultGridData.has(tableId);
interface ResultTab {
  id: string;
  label: string;
  resultsId: string;
  closable: boolean;
}

interface DisplayResultTab {
  id: string;
  label: string;
  closable: boolean;
  kind: 'result' | 'editable';
}

const resultTabs = ref<ResultTab[]>([
  { id: 'messages-tab', label: 'Messages', resultsId: 'messages-area', closable: false },
]);
const activeResultTabId = ref('messages-tab');
const showResultsArea = ref(false);
const showMessagesArea = ref(true);
const showResultsMenuBar = ref(false);
const resultTabOrder = ref<string[]>(['messages-tab']);
const draggedResultTabId = ref<string | null>(null);

/**
 * 処理名: 結果タブ順序同期
 * 処理概要: 現在存在する結果タブIDのみを順序配列へ同期する
 * 実装理由: タブ追加/削除後に並べ替え順序の整合を維持するため
 */
const syncResultTabOrder = () => {
  const allIds = [
    ...resultTabs.value.map((tab) => tab.id),
    ...editableGridTabs.value.map((tab) => tab.id),
  ];
  const existing = resultTabOrder.value.filter((id) => allIds.includes(id));
  const additions = allIds.filter((id) => !existing.includes(id));
  resultTabOrder.value = [...existing, ...additions];
};

/**
 * 処理名: メッセージタブ前挿入
 * 処理概要: 指定タブIDを Messages タブの手前に挿入する
 * 実装理由: 新規結果/編集タブをメッセージタブより左側に並べるため
 * @param tabId 挿入するタブID
 */
const insertBeforeMessagesTab = (tabId: string) => {
  const withoutTarget = resultTabOrder.value.filter((id) => id !== tabId);
  const messagesIndex = withoutTarget.indexOf('messages-tab');
  if (messagesIndex === -1) {
    resultTabOrder.value = [...withoutTarget, tabId];
    return;
  }
  const next = [...withoutTarget];
  next.splice(messagesIndex, 0, tabId);
  resultTabOrder.value = next;
};

/**
 * 処理名: 表示用結果タブ一覧
 * 処理概要: 通常結果タブと編集タブを順序配列に従って統合する
 * 実装理由: results-tabs の D&D 並べ替えを単一配列で扱うため
 */
const displayedResultTabs = computed<DisplayResultTab[]>(() => {
  const tabs: DisplayResultTab[] = [
    ...resultTabs.value.map((tab) => ({
      id: tab.id,
      label: tab.label,
      closable: tab.closable,
      kind: 'result' as const,
    })),
    ...editableGridTabs.value.map((tab) => ({
      id: tab.id,
      label: tab.label,
      closable: true,
      kind: 'editable' as const,
    })),
  ];

  const tabById = new Map(tabs.map((tab) => [tab.id, tab]));
  const orderedTabs = resultTabOrder.value
    .map((id) => tabById.get(id))
    .filter((tab): tab is DisplayResultTab => tab !== undefined);
  const remainingTabs = tabs.filter((tab) => !resultTabOrder.value.includes(tab.id));
  return [...orderedTabs, ...remainingTabs];
});

/**
 * 処理名: 結果タブ切り替え
 * 処理概要: 指定タブをアクティブにし、Messages/結果エリアの表示状態を切り替える
 * 実装理由: タブクリック時に対応するエリアの表示切り替えを行うため
 * @param id タブ ID
 */
const switchResultTab = (id: string) => {
  activeResultTabId.value = id;
  if (id === 'messages-tab') {
    showResultsArea.value = false;
    showMessagesArea.value = true;
    showResultsMenuBar.value = false;
    return;
  }

  if (id.startsWith('editable-grid-tab-')) {
    showResultsArea.value = true;
    showMessagesArea.value = false;
    showResultsMenuBar.value = false;
    return;
  }

  if (resultTabs.value.some((tab) => tab.id === id)) {
    showResultsArea.value = true;
    showMessagesArea.value = false;
    showResultsMenuBar.value = true;
  } else {
    switchResultTab('messages-tab');
  }
};

/**
 * 処理名: 結果タブドラッグ開始
 * 処理概要: 並べ替え対象の結果タブIDを保持する
 * 実装理由: drop 時に移動元タブを特定するため
 * @param e ドラッグイベント
 * @param tabId タブID
 */
const onResultTabDragStart = (e: DragEvent, tabId: string) => {
  draggedResultTabId.value = tabId;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', tabId);
  }
};

/**
 * 処理名: 結果タブドラッグオーバー
 * 処理概要: 並べ替え対象に move ドロップ効果を設定する
 * 実装理由: UI フィードバックを明示するため
 * @param e ドラッグイベント
 */
const onResultTabDragOver = (e: DragEvent) => {
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
};

/**
 * 処理名: 結果タブドロップ
 * 処理概要: 結果タブ順序配列を並べ替える
 * 実装理由: 結果タブ群を左右移動で並べ替え可能にするため
 * @param targetTabId ドロップ先タブID
 */
const onResultTabDrop = (targetTabId: string) => {
  const sourceTabId = draggedResultTabId.value;
  if (!sourceTabId || sourceTabId === targetTabId) return;
  const order = resultTabOrder.value;
  if (!order.includes(sourceTabId) || !order.includes(targetTabId)) return;
  resultTabOrder.value = reorderById(order.map((id) => ({ id })), sourceTabId, targetTabId).map((item) => item.id);
};

/**
 * 処理名: 結果タブドラッグ終了
 * 処理概要: 並べ替え状態を初期化する
 * 実装理由: 次回ドラッグ操作に前回状態を持ち越さないため
 */
const onResultTabDragEnd = () => {
  draggedResultTabId.value = null;
};

/**
 * 処理名: 表示タブクローズ
 * 処理概要: 表示用タブの種別に応じて削除処理を振り分ける
 * 実装理由: 統合タブ描画で通常結果/編集タブを同じUIから閉じるため
 * @param tab 表示タブ情報
 */
const closeDisplayedResultTab = (tab: DisplayResultTab) => {
  if (!tab.closable) return;
  if (tab.kind === 'editable') {
    closeEditableGridTab(tab.id);
    return;
  }
  removeResultTab(tab.id);
};

/**
 * 処理名: 結果タブ削除
 * 処理概要: 指定タブと結果データを削除し次のタブにフォーカスを移す
 * 実装理由: タブの × ボタン操作に対応するため
 * @param id 削除するタブ ID
 */
const removeResultTab = (id: string) => {
  const tab = resultTabs.value.find(t => t.id === id);
  if (!tab) return;
  destroyTabulatorInstance(tab.resultsId);
  resultGridData.delete(tab.resultsId);
  const idx = resultTabs.value.findIndex(t => t.id === id);
  resultTabs.value.splice(idx, 1);
  syncResultTabOrder();
  const remaining = resultTabs.value.filter(t => t.closable);
  switchResultTab(remaining.length > 0 ? remaining[0].id : 'messages-tab');
};

/**
 * 処理名: 結果タブ追加
 * 処理概要: 新規結果タブを Messages タブの手前に挿入しアクティブにする
 * 実装理由: クエリ実行結果をタブで表示するため
 * @param label タブの表示ラベル
 * @param tableId 結果テーブル ID
 */
const addResultTab = (label: string, tableId: string) => {
  const id = `result-tab-${tableId}`;
  const msgTabIdx = resultTabs.value.findIndex(t => t.id === 'messages-tab');
  const tab: ResultTab = { id, label, resultsId: tableId, closable: true };
  if (msgTabIdx !== -1) {
    resultTabs.value.splice(msgTabIdx, 0, tab);
  } else {
    resultTabs.value.push(tab);
  }
  syncResultTabOrder();
  insertBeforeMessagesTab(id);
  switchResultTab(id);
};

/**
 * 処理名: 結果タブ全クリア
 * 処理概要: 閉じることができる結果タブとデータをすべて削除し初期状態に戻す
 * 実装理由: 新規クエリ実行前に前回結果をクリアするため
 */
const clearResultTabs = () => {
  destroyAllTabulatorInstances();
  resultTabs.value.filter(t => t.closable).forEach(t => resultGridData.delete(t.resultsId));
  resultTabs.value = resultTabs.value.filter(t => t.id === 'messages-tab');
  syncResultTabOrder();
  showResultsArea.value = false;
  showMessagesArea.value = true;
  showResultsMenuBar.value = false;
  activeResultTabId.value = 'messages-tab';
};

// ---- 編集可能グリッド管理 ----
interface EditableGridState {
  mode: 'table-definition' | 'table-data';
  alias: string;
  tableName: string;
  columns: Array<{
    title: string;
    field: string;
    editor?: string;
    editorParams?: Record<string, unknown>;
  }>;
  data: Record<string, unknown>[];
  primaryKeyField?: string;
}

interface EditableGridTab {
  id: string;
  label: string;
  state: EditableGridState;
}

const editableGridTabs = ref<EditableGridTab[]>([]);

const isEditableGridPanelVisible = computed(() =>
  activeResultTabId.value.startsWith('editable-grid-tab-')
);

const isNormalResultsPanelVisible = computed(() => {
  if (activeResultTabId.value === 'messages-tab') return false;
  return !isEditableGridPanelVisible.value;
});

/**
 * 処理名: 編集可能グリッドタブID生成
 * 処理概要: モード/DB/テーブル名から一意な編集タブIDを生成する
 * 実装理由: 同一画面で複数の編集可能グリッドを共存させるため
 * @param state 編集可能グリッド状態
 * @returns 編集可能グリッドタブID
 */
const buildEditableGridTabId = (state: EditableGridState): string => {
  const modePrefix = state.mode === 'table-definition' ? 'def' : 'data';
  return `editable-grid-tab-${modePrefix}-${state.alias}-${state.tableName}`;
};

/**
 * 処理名: 編集可能グリッドタブ表示
 * 処理概要: 編集タブを追加または更新してアクティブ化する
 * 実装理由: テーブル定義表示と単表編集を同時に複数保持するため
 * @param state 編集可能グリッド状態
 */
const openEditableGridTab = (state: EditableGridState): void => {
  const id = buildEditableGridTabId(state);
  const modeLabel = state.mode === 'table-definition' ? 'テーブル定義' : '単表編集';
  const label = `${modeLabel}: ${state.tableName}`;
  const index = editableGridTabs.value.findIndex((tab) => tab.id === id);

  if (index >= 0) {
    editableGridTabs.value[index] = { id, label, state };
  } else {
    editableGridTabs.value.push({ id, label, state });
  }

  syncResultTabOrder();
  insertBeforeMessagesTab(id);

  showResultsArea.value = true;
  showMessagesArea.value = false;
  showResultsMenuBar.value = false;
  activeResultTabId.value = id;
};

/**
 * 処理名: 編集可能グリッドタブ閉じる
 * 処理概要: 指定された編集可能グリッドタブを閉じる
 * 実装理由: 編集タブを通常結果タブと同様に複数管理するため
 * @param id 閉じるタブID
 */
const closeEditableGridTab = (id: string) => {
  const index = editableGridTabs.value.findIndex((tab) => tab.id === id);
  if (index === -1) return;

  editableGridTabs.value.splice(index, 1);
  syncResultTabOrder();

  if (activeResultTabId.value === id) {
    const fallback = editableGridTabs.value[editableGridTabs.value.length - 1];
    if (fallback) {
      switchResultTab(fallback.id);
      return;
    }

    const normalResultTabs = resultTabs.value.filter((tab) => tab.closable);
    if (normalResultTabs.length > 0) {
      switchResultTab(normalResultTabs[0].id);
    } else {
      switchResultTab('messages-tab');
    }
  }
};

/**
 * 処理名: テーブル定義表示
 * 処理概要: 指定テーブルのスキーマをDBから取得して編集可能グリッドで表示する
 * 実装理由: Sidebar のテーブル右クリックメニュー「テーブル定義の表示」に対応するため
 * @param alias DBエイリアス
 * @param tableName テーブル名
 * @param dbManager SQLiteManager インスタンス
 */
const showTableDefinition = async (alias: string, tableName: string, dbManager: any) => {
  try {
    const schemaPrefix = alias === 'main' ? '' : `${formatIdentifier(alias)}.`;
    const pragmaTable = formatIdentifier(tableName);
    const results = dbManager.db.exec(`PRAGMA ${schemaPrefix}table_info(${pragmaTable})`);
    const foreignKeyResults = dbManager.db.exec(`PRAGMA ${schemaPrefix}foreign_key_list(${pragmaTable})`);
    
    if (!results.length || !results[0].values) {
      setMessages(`テーブル ${tableName} のスキーマ取得に失敗しました`);
      return;
    }

    // PRAGMA table_info の戻り値は：[cid, name, type, notnull, dflt_value, pk]
    const columns = results[0].values.map((row: unknown[]) => ({
      cid: row[0],
      name: row[1],
      type: row[2],
      notnull: row[3],
      dflt_value: row[4],
      pk: row[5]
    }));

    const foreignKeyColumnNames = new Set(
      (foreignKeyResults[0]?.values ?? [])
        .map((row: unknown[]) => row[3])
        .filter((name): name is string => typeof name === 'string' && name.length > 0)
    );

    // Tabulator用の列定義を生成
    const tabulatorColumns = [
      { title: 'Field', field: 'name', editor: 'input' },
      {
        title: 'Type',
        field: 'type',
        editor: 'list',
        editorParams: {
          values: getSQLiteDataTypes(),
          autocomplete: true,
          listOnEmpty: true,
          clearable: true,
        },
      },
      {
        title: 'NOT NULL',
        field: 'notnull',
        formatter: 'tickCross',
        editor: 'tickCross',
        hozAlign: 'center',
        editorParams: {
          trueValue: true,
          falseValue: false,
        },
      },
      {
        title: 'PK',
        field: 'isPk',
        formatter: 'tickCross',
        editor: 'tickCross',
        hozAlign: 'center',
        editorParams: {
          trueValue: true,
          falseValue: false,
        },
      },
      {
        title: 'FK',
        field: 'isFk',
        formatter: 'tickCross',
        editor: 'tickCross',
        hozAlign: 'center',
        editorParams: {
          trueValue: true,
          falseValue: false,
        },
      },
      { title: 'Default', field: 'dflt_value', editor: 'input' },
      { title: 'Comment', field: 'comment', editor: 'input' }
    ];

    const gridData = columns.map((col: Record<string, unknown>) => ({
      name: col.name,
      type: col.type || 'TEXT',
      notnull: col.notnull === 1,
      isPk: Number(col.pk) > 0,
      isFk: foreignKeyColumnNames.has(String(col.name)),
      dflt_value: col.dflt_value,
      comment: '',
      cid: col.cid,
      pk: col.pk
    }));

    openEditableGridTab({
      mode: 'table-definition',
      alias,
      tableName,
      columns: tabulatorColumns,
      data: gridData
    });
  } catch (error) {
    setMessages(`テーブル定義取得エラー: ${error}`);
  }
};

/**
 * 処理名: 数値系カラム判定
 * 処理概要: SQLite の宣言型から数値系カラムかを判定する
 * 実装理由: 単表編集で数値列に数値専用エディタを割り当てるため
 * @param declaredType PRAGMA table_info の type 値
 * @returns 数値系であれば true
 */
const isNumericColumnType = (declaredType: unknown): boolean => {
  const normalizedType = String(declaredType ?? '').toUpperCase().trim();
  if (!normalizedType) return false;
  if (normalizedType.includes('INT')) return true;
  if (normalizedType.includes('REAL')) return true;
  if (normalizedType.includes('FLOA')) return true;
  if (normalizedType.includes('DOUB')) return true;
  if (normalizedType.includes('NUMERIC')) return true;
  if (normalizedType.includes('DECIMAL')) return true;
  return false;
};

/**
 * 処理名: 数値セルバリデーション
 * 処理概要: 入力値が数値かを判定する
 * 実装理由: 数値系カラムで非数値や空文字の確定を防止するため
 * @param _cell Tabulator セル（未使用）
 * @param value 入力値
 * @returns 数値なら true
 */
const validateNumericOrEmpty = (_cell: unknown, value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'number') return !Number.isNaN(value);
  const trimmed = String(value).trim();
  if (trimmed.length === 0) return false;
  return !Number.isNaN(Number(trimmed));
};

/**
 * 処理名: テーブルデータ編集表示
 * 処理概要: 指定テーブルの全データをDBから取得して編集可能グリッドで表示する
 * 実装理由: Sidebar のテーブル右クリックメニュー「単表編集」に対応するため
 * @param alias DBエイリアス
 * @param tableName テーブル名
 * @param dbManager SQLiteManager インスタンス
 */
const editTableData = async (alias: string, tableName: string, dbManager: any) => {
  try {
    // ROWIDを含めてデータ取得
    const qualifiedTableName = alias === 'main' 
      ? formatIdentifier(tableName)
      : `${formatIdentifier(alias)}.${formatIdentifier(tableName)}`;
    const selectQuery = `SELECT rowid, * FROM ${qualifiedTableName}`;
    const schemaPrefix = alias === 'main' ? '' : `${formatIdentifier(alias)}.`;
    const pragmaQuery = `PRAGMA ${schemaPrefix}table_info(${formatIdentifier(tableName)})`;
    
    const results = dbManager.db.exec(selectQuery);
    const schemaResults = dbManager.db.exec(pragmaQuery);
    if (!results.length) {
      setMessages(`テーブル ${tableName} のデータ取得に失敗しました`);
      return;
    }

    const columns = results[0].columns;
    const values = results[0].values;
    const schemaRows = schemaResults[0]?.values ?? [];
    const columnTypeMap = new Map<string, unknown>(
      schemaRows.map((row: unknown[]) => [String(row[1]), row[2]])
    );

    // Tabulator用の列定義を生成
    const tabulatorColumns = columns.map((colName: string) => {
      if (colName === 'rowid') {
        return {
          title: colName,
          field: colName,
          editor: undefined,
          cssClass: 'rowid-column'
        };
      }

      if (isNumericColumnType(columnTypeMap.get(colName))) {
        return {
          title: colName,
          field: colName,
          editor: 'number',
          editorParams: {
            step: 'any',
          },
          validator: validateNumericOrEmpty,
          cssClass: ''
        };
      }

      return {
        title: colName,
        field: colName,
        editor: 'input',
        cssClass: ''
      };
    });

    const gridData = values.map((row: unknown[]) =>
      Object.fromEntries(columns.map((col: string, idx: number) => [col, row[idx]]))
    );

    openEditableGridTab({
      mode: 'table-data',
      alias,
      tableName,
      columns: tabulatorColumns,
      data: gridData,
      primaryKeyField: 'rowid'
    });
  } catch (error) {
    setMessages(`テーブルデータ取得エラー: ${error}`);
  }
};

/**
 * 処理名: SQLite データ型一覧取得
 * 処理概要: SQLiteで利用可能なデータ型の一覧を返す
 * 実装理由: 編集可能グリッドの型セレクタに使用するため
 * @returns SQLiteで利用可能な型名一覧
 */
const getSQLiteDataTypes = (): string[] => [
  '',
  'NULL', 'INTEGER', 'REAL', 'TEXT', 'BLOB',
  'NUMERIC', 'BOOLEAN', 'DATE', 'TIME', 'DATETIME',
  'DECIMAL', 'DOUBLE', 'FLOAT', 'CHAR', 'VARCHAR'
];

/**
 * 処理名: 編集可能グリッド閉じる
 * 処理概要: 編集可能グリッドを閉じて通常の結果表示に戻す
 * 実装理由: グリッド表示の終了時に呼び出すため
 */
const closeEditableGrid = () => {
  if (!activeResultTabId.value.startsWith('editable-grid-tab-')) {
    switchResultTab('messages-tab');
    return;
  }
  closeEditableGridTab(activeResultTabId.value);
};

/**
 * 処理名: 編集可能グリッド クエリ生成ハンドラ
 * 処理概要: EditableGridPanel からの query-generated イベントを処理
 * 実装理由: 「クエリを生成」ボタンのクリック時にCREATE/INSERT文をエディタに追記するため
 * @param query 生成されたクエリ
 */
const onEditableGridQueryGenerated = (query: string) => {
  appendActiveQuery(query);
  setMessages(`クエリを生成しました: ${query.split('\n')[0]}`);
};

/**
 * 処理名: 編集可能グリッド 変更クエリ生成ハンドラ
 * 処理概要: EditableGridPanel からの update-query-generated イベントを処理
 * 実装理由: 「変更クエリを生成」ボタンのクリック時にUPDATE/ALTER文をエディタに追記するため
 * @param query 生成されたクエリ
 */
const onEditableGridUpdateQueryGenerated = (query: string) => {
  appendActiveQuery(query);
  setMessages(`変更クエリを生成しました: ${query.split('\n')[0]}`);
};

// ---- メッセージ ----
const messages = ref<string[]>([]);

/**
 * 処理名: メッセージ設定
 * 処理概要: Messages エリアに表示するメッセージを更新する
 * 実装理由: クエリ実行結果やエラー内容をユーザーに表示するため
 * @param msg 表示するメッセージ（文字列または配列）
 */
const setMessages = (msg: string | string[]) => {
  messages.value = Array.isArray(msg) ? msg : [msg];
};

/**
 * 処理名: メッセージクリア
 * 処理概要: Messages タブに表示中のメッセージを全消去する
 * 実装理由: Messages ツールバーのクリアボタン要件に対応するため
 */
const clearMessages = () => {
  messages.value = [];
};

// ---- 結果グリッドデータ管理 ----
/**
 * 処理名: 結果グリッドデータ設定
 * 処理概要: 指定タブに結果データをセットし Tabulator を描画する
 * 実装理由: クエリ結果をタブ単位の Tabulator に反映するため
 * @param tableId 結果テーブル ID
 * @param data 結果データオブジェクト
 * @param data.columns 列名配列
 * @param data.results 行データ配列
 */
const setResultGridData = (tableId: string, data: { columns: string[]; results: Record<string, unknown>[] }) => {
  const columns = [...data.columns];
  const normalizedRows = data.results.map((row) => {
    const normalizedRow: Record<string, unknown> = {};
    columns.forEach((column) => {
      const value = Object.prototype.hasOwnProperty.call(row, column) ? row[column] : null;
      normalizedRow[column] = value === undefined ? null : value;
    });
    return normalizedRow;
  });

  resultGridData.set(tableId, { columns, data: normalizedRows });
  void scheduleTabulatorRender(tableId);
};

/**
 * 処理名: アクティブ結果データ取得
 * 処理概要: アクティブな結果タブのデータを返す（CSVダウンロード・データセット登録に使用）
 * 実装理由: アクティブタブの結果を親コンポーネントに渡すため
 * @returns 結果データまたはアクティブタブがない場合 null
 */
const getCurrentResultData = (): ResultData | null => {
  const activeTab = resultTabs.value.find(t => t.id === activeResultTabId.value && t.closable);
  if (!activeTab) return null;
  return resultGridData.get(activeTab.resultsId) ?? null;
};

/**
 * 処理名: クエリ実行ショートカット処理
 * 処理概要: Ctrl+Enter でクエリ実行イベントを発火する
 * 実装理由: addAction の無名関数を避けて可読性と JSDoc 要件を満たすため
 */
const runQueryShortcut = () => {
  emit('run-query');
};

/**
 * 処理名: クエリ保存ショートカット処理
 * 処理概要: Ctrl+S で Save Query イベントを発火する
 * 実装理由: エディタ上での保存ショートカット要件に対応するため
 */
const saveQueryShortcut = () => {
  emit('save-query');
};

/**
 * 処理名: 位置指定テキスト挿入
 * 処理概要: ツリー項目のドロップ時にアクティブタブ末尾へテキストを追記する
 * 実装理由: Monaco の executeEdits を直接呼ぶと Language Worker が起動し
 *           Playwright のテストや drop イベントハンドラ内でハングするため、
 *           Vue リアクティブ状態経由の appendActiveQuery を使用する
 * @param text 挿入する文字列
 * @param _clientX ドロップ座標X（将来の位置指定挿入実装のために予約）
 * @param _clientY ドロップ座標Y（将来の位置指定挿入実装のために予約）
 */
const insertTextAtClientPoint = (text: string, _clientX: number, _clientY: number) => {
  if (!text) return;
  appendActiveQuery(text);
};

/**
 * 処理名: Monacoエディタマウント時ハンドラ
 * 処理概要: Ctrl+Enter ショートカットでクエリ実行イベントを発火する
 * 実装理由: query-editor フォーカス中にキーボードからクエリを実行できるようにするため
 * @param editor Monacoエディタインスタンス
 */
const onEditorMounted = (editor: monaco.editor.IStandaloneCodeEditor) => {
  sqlEditorRef.value = editor;
  editor.onDidChangeModelContent(() => {
    const value = editor.getValue();
    updateActiveTabQuery(value);
  });
  editor.addAction({
    id: 'run-query-shortcut',
    label: 'Run Query',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
    run: runQueryShortcut,
  });
  editor.addAction({
    id: 'save-query-shortcut',
    label: 'Save Query',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
    run: saveQueryShortcut,
  });
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space, () => {
    editor.trigger('keyboard', 'editor.action.triggerSuggest', {});
  });
  editor.addAction({
    id: 'format-document-menu',
    label: 'ドキュメントのフォーマット',
    contextMenuGroupId: '1_modification',
    /* eslint-disable-line jsdoc/require-jsdoc */run: () => {
      formatQuery();
    },
  });
};

/**
 * 処理名: SQL クエリフォーマット
 * 処理概要: アクティブなエディタに対して SQL フォーマット機能を実行する
 * 実装理由: App.vue の format-query イベントハンドラから呼び出されるため
 */
const formatQuery = () => {
  const original = getActiveQuery();
  const formatted = formatSqlText(original);
  if (formatted !== original) {
    setActiveQuery(formatted);
  }
};

/**
 * 処理名: コンテキストメニュー形式フォーマット実行
 * 処理概要: Monacoの「ドキュメントのフォーマット」アクションを直接実行する
 * 実装理由: テストからコンテキストメニューと同一経路を安定して呼び出すため
 * @returns Promise<void>
 */
const runFormatMenuAction = async (): Promise<void> => {
  const action = sqlEditorRef.value?.getAction('format-document-menu');
  if (action) {
    await action.run();
    return;
  }
  formatQuery();
};
// ---- クエリエディタ D&D ----
const SQL_FILE_NAME_PATTERN = /\.sql$/i;
const TREE_ITEM_TRANSFER_TYPE = 'application/x-sqlite-webclient-tree-item-name';
const PLAIN_TEXT_TRANSFER_TYPE = 'text/plain';
const isQueryDropActive = ref(false);
const isQueryDropInvalid = ref(false);
let queryDragDepth = 0;

/**
 * 処理名: ファイルドラッグ判定
 * 処理概要: DragEvent がファイルを含むドラッグかどうかを判定する
 * 実装理由: テキストやリンクのドラッグにはドロップ表示を出さないため
 * @param e ドラッグイベント
 * @returns ファイルドラッグであれば true
 */
const isFileDragEvent = (e: DragEvent): boolean => {
  const items = Array.from(e.dataTransfer?.items ?? []);
  return items.some(item => item.kind === 'file');
};

/**
 * 処理名: ツリー項目ドラッグ判定
 * 処理概要: DragEvent がツリー項目ドラッグかどうかを判定する
 * 実装理由: ファイル D&D と tree-item D&D の挙動を分岐するため
 * @param e ドラッグイベント
 * @returns ツリー項目ドラッグであれば true
 */
const isTreeItemDragEvent = (e: DragEvent): boolean => {
  const types = Array.from(e.dataTransfer?.types ?? []);
  if (types.includes(TREE_ITEM_TRANSFER_TYPE)) return true;
  // 一部ブラウザ操作では custom MIME が欠落し text/plain のみ残ることがある。
  // ファイルD&Dでない text/plain は tree-item として扱う。
  return !isFileDragEvent(e) && types.includes(PLAIN_TEXT_TRANSFER_TYPE);
};

/**
 * 処理名: ツリー項目名抽出
 * 処理概要: DragEvent から挿入対象の項目名を取り出す
 * 実装理由: ドロップ時に挿入文字列を取得するため
 * @param e ドラッグイベント
 * @returns 挿入対象の文字列
 */
const getDraggedTreeItemName = (e: DragEvent): string => {
  if (!e.dataTransfer) return '';
  const customName = e.dataTransfer.getData(TREE_ITEM_TRANSFER_TYPE).trim();
  if (customName) return customName;
  return e.dataTransfer.getData(PLAIN_TEXT_TRANSFER_TYPE).trim();
};

/**
 * 処理名: SQLファイル判定
 * 処理概要: DragEvent 内にサポート対象の .sql ファイルが含まれるか判定する
 * 実装理由: ドロップ可否に応じて視覚表示と dropEffect を切り替えるため
 * @param e ドラッグイベント
 * @returns .sql ファイルが含まれる場合 true
 */
const hasSupportedSqlFile = (e: DragEvent): boolean => {
  const files = Array.from(e.dataTransfer?.files ?? []);
  if (files.length > 0) return files.some(f => SQL_FILE_NAME_PATTERN.test(f.name));
  const items = Array.from(e.dataTransfer?.items ?? []).filter(i => i.kind === 'file');
  if (items.length === 0) return false;
  let hasUnknown = false;
  for (const item of items) {
    const file = item.getAsFile();
    if (!file) { hasUnknown = true; continue; }
    if (SQL_FILE_NAME_PATTERN.test(file.name)) return true;
  }
  return hasUnknown;
};

/**
 * 処理名: クエリエディタドロップ状態更新
 * 処理概要: クエリエディタのドロップ可視状態と可否状態を更新する
 * 実装理由: dragenter/dragover/drop で状態遷移を共通化するため
 * @param active ドロップ状態を有効化するか
 * @param invalid サポート外ファイル状態か
 */
const setQueryDropState = (active: boolean, invalid = false) => {
  isQueryDropActive.value = active;
  isQueryDropInvalid.value = active && invalid;
};

/**
 * 処理名: クエリエディタドラッグエンターハンドラ
 * 処理概要: SQLファイルドラッグ進入時にドロップ可能表示を有効化する
 * 実装理由: ドロップ対象であることを明示し操作性を高めるため
 * @param e ドラッグイベント
 */
const onQueryEditorDragEnter = (e: DragEvent) => {
  if (!isFileDragEvent(e)) return;
  queryDragDepth += 1;
  setQueryDropState(true, !hasSupportedSqlFile(e));
};

/**
 * 処理名: クエリエディタドラッグリーブハンドラ
 * 処理概要: ファイルドラッグ離脱時にドロップ可能表示を解除する
 * 実装理由: 子要素をまたぐ dragleave でも表示がちらつかないよう深度管理するため
 * @param e ドラッグイベント
 */
const onQueryEditorDragLeave = (e: DragEvent) => {
  if (!isFileDragEvent(e)) return;
  queryDragDepth = Math.max(0, queryDragDepth - 1);
  if (queryDragDepth === 0) setQueryDropState(false);
};

/**
 * 処理名: クエリエディタドラッグオーバーハンドラ
 * 処理概要: SQLドラッグ中のドロップ可否表示を更新し dropEffect を設定する
 * 実装理由: 利用者に copy/none のフィードバックを即時に返すため
 * @param e ドラッグイベント
 */
const onQueryEditorDragOver = (e: DragEvent) => {
  if (isTreeItemDragEvent(e)) {
    e.stopPropagation(); // Monacoの内部dragoverハンドラに伝播させず、dnd-drag-over状態に入らせない
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    setQueryDropState(false);
    return;
  }
  if (!isFileDragEvent(e)) return;
  const canDrop = hasSupportedSqlFile(e);
  setQueryDropState(true, !canDrop);
  if (e.dataTransfer) e.dataTransfer.dropEffect = canDrop ? 'copy' : 'none';
};

/**
 * 処理名: クエリエディタドロップハンドラ
 * 処理概要: .sql ファイルドロップ時に親コンポーネントへファイル一覧を通知する
 * 実装理由: open-query-button と同等の SQL 読み込みを D&D で可能にするため
 * @param e ドラッグイベント
 */
const onQueryEditorDrop = (e: DragEvent) => {
  if (isTreeItemDragEvent(e)) {
    e.stopPropagation(); // Monacoのdropハンドラに伝播させない
    queryDragDepth = 0;
    setQueryDropState(false);
    const droppedText = getDraggedTreeItemName(e);
    if (!droppedText) return;
    insertTextAtClientPoint(droppedText, e.clientX, e.clientY);
    return;
  }

  queryDragDepth = 0;
  setQueryDropState(false);
  const dropped = Array.from(e.dataTransfer?.files ?? []).filter(f => SQL_FILE_NAME_PATTERN.test(f.name));
  if (dropped.length) emit('drop-query', dropped);
};

// ---- rowSplitter ----
const rowSplitterEl = ref<HTMLElement | null>(null);
const queryEditorEl = ref<HTMLElement | null>(null);
/**
 * 処理名: クエリエディタ要素取得
 * 処理概要: 行スプリッターが参照するクエリエディタ要素を返す
 * 実装理由: 無名関数を避けて可読性と JSDoc 要件を満たすため
 * @returns クエリエディタ要素
 */
const getQueryEditorElement = (): HTMLElement | null => queryEditorEl.value;
useRowSplitter(rowSplitterEl, getQueryEditorElement);

/**
 * 処理名: storage イベントハンドラ
 * 処理概要: 別ウィンドウからの localStorage 変更を検知し該当タブのクエリを更新する
 * 実装理由: 複数ウィンドウ編集時に内容がデグレードしないよう同期するため
 * @param event StorageEvent
 */
const applyStorageChange = (event: StorageEvent): void => {
  if (!event.key || !isQueryTabKey(event.key)) return;
  const newQuery = event.newValue ?? '';
  applyStorageChangeByKey(event.key, newQuery);
};

/**
 * 処理名: storage 変更適用
 * 処理概要: 指定キーと値をクエリタブへ反映する
 * 実装理由: storage イベントと direct-change イベントで共通化するため
 * @param key localStorage キー
 * @param newQuery 変更後クエリ
 */
const applyStorageChangeByKey = (key: string, newQuery: string): void => {
  const tab = queryTabs.value.find(t => t.label === key);
  if (!tab || tab.query === newQuery) return;
  tab.query = newQuery;
};

/**
 * 処理名: direct-storage-change イベントハンドラ
 * 処理概要: 同一ページで発生した localStorage 変更通知を適用する
 * 実装理由: storage イベントが同一ドキュメントへ届かないため
 * @param event CustomEvent
 */
const handleDirectStorageChange = (event: Event): void => {
  const detail = (event as CustomEvent<{ key: string; newValue: string | null }>).detail;
  if (!detail?.key) return;
  applyStorageChangeByKey(detail.key, detail.newValue ?? '');
};

/**
 * 処理名: storage イベントハンドラ
 * 処理概要: 別ウィンドウまたは隠し iframe からの localStorage 変更を検知し該当タブのクエリを更新する
 * 実装理由: DevTools による同一ページ変更も別ドキュメント側で受けるため
 * @param event StorageEvent
 */
const handleStorageEvent = (event: StorageEvent): void => {
  applyStorageChange(event);
};

/**
 * 処理名: フォーカス時ストレージ同期
 * 処理概要: ウィンドウがフォーカスを取得した際に localStorage の最新値をタブへ反映する
 * 実装理由: DevTools など同一ウィンドウ内の変更は storage イベントが届かないため
 */
const syncFromStorageSnapshot = (): void => {
  for (const tab of queryTabs.value) {
    const stored = window.localStorage.getItem(tab.label) ?? '';
    if (tab.query === stored) continue;
    tab.query = stored;
  }
};

/**
 * 処理名: storage 同期 iframe 接続
 * 処理概要: 隠し iframe に storage イベントリスナを接続する
 * 実装理由: 同一ページの DevTools localStorage 編集を別ドキュメント経由で受けるため
 */
const attachStorageSyncFrame = (): void => {
  const frameWindow = storageSyncFrameEl.value?.contentWindow ?? null;
  if (!frameWindow || storageSyncFrameWindow === frameWindow) return;
  if (storageSyncFrameWindow) {
    storageSyncFrameWindow.removeEventListener('storage', handleStorageEvent);
  }
  storageSyncFrameWindow = frameWindow;
  storageSyncFrameWindow.addEventListener('storage', handleStorageEvent);
};

/**
 * 処理名: storage 同期 iframe 切断
 * 処理概要: 隠し iframe の storage イベントリスナを解除する
 * 実装理由: コンポーネント破棄後に不要な参照を残さないため
 */
const detachStorageSyncFrame = (): void => {
  if (!storageSyncFrameWindow) return;
  storageSyncFrameWindow.removeEventListener('storage', handleStorageEvent);
  storageSyncFrameWindow = null;
};

/**
 * 処理名: localStorage 直接変更監視開始
 * 処理概要: setItem/removeItem をフックし同一ページ変更をカスタムイベントで通知する
 * 実装理由: Playwright と同一ページ内操作で即時同期するため
 */
const startDirectLocalStorageSync = (): void => {
  if (restoreLocalStorageInterceptors) return;
  const storagePrototype = Storage.prototype as Storage & {
    setItem: (key: string, value: string) => void;
    removeItem: (key: string) => void;
  };
  const originalSetItem = storagePrototype.setItem;
  const originalRemoveItem = storagePrototype.removeItem;

  /**
   * 処理名: localStorage setItem フック
   * 処理概要: 同一ページの setItem 実行後に direct-change イベントを非同期通知する
   * 実装理由: setItem 呼び出し自体をブロックしないため
   * @param key localStorage キー
   * @param value 保存値
   */
  storagePrototype.setItem = function setItemPatched(key: string, value: string): void {
    originalSetItem.call(this, key, value);
    if (this !== window.localStorage || !isQueryTabKey(key)) return;
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent(LOCAL_STORAGE_DIRECT_CHANGE_EVENT, {
        detail: { key, newValue: value },
      }));
    }, 0);
  };
  /**
   * 処理名: localStorage removeItem フック
   * 処理概要: 同一ページの removeItem 実行後に direct-change イベントを非同期通知する
   * 実装理由: removeItem 呼び出し自体をブロックしないため
   * @param key localStorage キー
   */
  storagePrototype.removeItem = function removeItemPatched(key: string): void {
    originalRemoveItem.call(this, key);
    if (this !== window.localStorage || !isQueryTabKey(key)) return;
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent(LOCAL_STORAGE_DIRECT_CHANGE_EVENT, {
        detail: { key, newValue: null },
      }));
    }, 0);
  };

  /**
   * 処理名: localStorage フック復元
   * 処理概要: setItem/removeItem を元の実装へ戻す
   * 実装理由: コンポーネント破棄時にグローバル変更を残さないため
   */
  restoreLocalStorageInterceptors = () => {
    storagePrototype.setItem = originalSetItem;
    storagePrototype.removeItem = originalRemoveItem;
  };
};

/**
 * 処理名: localStorage 直接変更監視停止
 * 処理概要: setItem/removeItem のフックを解除する
 * 実装理由: コンポーネント破棄時にグローバル変更を元へ戻すため
 */
const stopDirectLocalStorageSync = (): void => {
  restoreLocalStorageInterceptors?.();
  restoreLocalStorageInterceptors = null;
};

/**
 * 処理名: Query Storage 同期開始
 * 処理概要: storage スナップショット同期の定期監視と補助イベントを開始する
 * 実装理由: storage イベント未達時でもクエリ内容を継続同期するため
 */
const startQueryStorageSync = (): void => {
  if (queryStorageSyncTimer === undefined) {
    queryStorageSyncTimer = window.setInterval(syncFromStorageSnapshot, 500);
  }
  window.addEventListener('storage', handleStorageEvent);
  window.addEventListener(LOCAL_STORAGE_DIRECT_CHANGE_EVENT, handleDirectStorageChange);
  window.addEventListener('focus', syncFromStorageSnapshot);
  document.addEventListener('visibilitychange', syncFromStorageSnapshot);
  attachStorageSyncFrame();
  startDirectLocalStorageSync();
};

/**
 * 処理名: Query Storage 同期停止
 * 処理概要: storage スナップショット同期の定期監視と補助イベントを停止する
 * 実装理由: コンポーネント破棄後に不要な監視を残さないため
 */
const stopQueryStorageSync = (): void => {
  if (queryStorageSyncTimer !== undefined) {
    window.clearInterval(queryStorageSyncTimer);
    queryStorageSyncTimer = undefined;
  }
  window.removeEventListener('storage', handleStorageEvent);
  window.removeEventListener(LOCAL_STORAGE_DIRECT_CHANGE_EVENT, handleDirectStorageChange);
  window.removeEventListener('focus', syncFromStorageSnapshot);
  document.removeEventListener('visibilitychange', syncFromStorageSnapshot);
  detachStorageSyncFrame();
  stopDirectLocalStorageSync();
};

onMounted(() => {
  const saved = restoreQueryTabs(window.localStorage);
  if (saved.length > 0) {
    queryTabs.value = saved.map((d, i) => ({
      id: `query${i + 1}`,
      label: d.label,
      query: d.query,
    }));
    queryTabSerial = saved.length + 1;
    activeQueryTabId.value = queryTabs.value[0].id;
  }
  startQueryStorageSync();
  nextTick(() => {
    attachStorageSyncFrame();
  });
});

onBeforeUnmount(() => {
  destroyAllTabulatorInstances();
  stopQueryStorageSync();
});

syncResultTabOrder();

defineExpose({
  addQueryTab,
  closeQueryTab,
  getActiveQuery,
  setActiveQuery,
  appendActiveQuery,
  addResultTab,
  clearResultTabs,
  setMessages,
  switchResultTab,
  setResultGridData,
  getCurrentResultData,
  showTableDefinition,
  editTableData,
  formatQuery,
  runFormatMenuAction,
  clearMessages,
});
</script>
