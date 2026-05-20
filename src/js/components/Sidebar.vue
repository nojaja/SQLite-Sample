<template>
  <div id="sidebar" ref="sidebarEl" class="sidebar" @click.capture="closeDbObjectContextMenu">
    <!-- Databasesツリー -->
    <div ref="databasesTreeBlockEl" class="tree-block databases-tree-block">
      <div class="tree-title" style="cursor:pointer" @click="onDbTreeTitleClick">
        <span class="material-symbols-outlined tree-toggle-icon">{{ dbTreeOpen ? 'expand_more' : 'chevron_right' }}</span>
        Databases
        <button id="refresh-db-button" class="menu-button" @click.stop="$emit('refresh-db')">
          <span class="material-symbols-outlined">refresh</span>
        </button>
      </div>
      <div id="db-tree" v-show="dbTreeOpen" class="tree-view"
        :class="{ 'drop-target-active': isDbDropActive, 'drop-target-invalid': isDbDropInvalid }"
        @dragenter.prevent="onDbTreeDragEnter"
        @dragleave.prevent="onDbTreeDragLeave"
        @dragover.prevent="onDbTreeDragOver"
        @drop.prevent="onDbTreeDrop"
      >
        <div v-if="isDbDropActive" class="db-drop-indicator" :class="{ invalid: isDbDropInvalid }">
          {{ isDbDropInvalid ? 'この場所には .db / .sqlite / .sqlite3 / .db3 のみドロップできます' : 'DBファイルをドロップして開く / アタッチ' }}
        </div>
        <div v-for="schema in dbSchemas" :key="schema.alias" class="tree-item">
          <div
            class="tree-label db-node"
            :data-db-alias="schema.alias"
            style="cursor:pointer;display:flex;align-items:center;justify-content:space-between"
            @click="toggleDbNode(schema.alias, $event)"
          >
            <span style="display:flex;align-items:center;gap:4px">
              <span class="material-symbols-outlined toggle-icon">{{ dbNodeOpen[schema.alias] ? 'expand_more' : 'chevron_right' }}</span>
              <span class="material-symbols-outlined icon">database</span>
              {{ schema.alias }}
            </span>
            <button
              class="menu-button"
              :data-detach-alias="schema.alias"
              :title="schema.alias === 'main' ? 'メインDBをリセット' : `'${schema.alias}' をデタッチ`"
              style="font-size:14px"
              @click.stop="$emit('detach-db', schema.alias)"
            >
              <span class="material-symbols-outlined">link_off</span>
            </button>
          </div>
          <div class="db-children tree-items" :style="{ display: dbNodeOpen[schema.alias] ? '' : 'none' }">
            <template v-for="group in [
              { title: 'Tables', items: schema.tables || [], icon: 'table_chart' },
              { title: 'Views', items: schema.views || [], icon: 'visibility' },
              { title: 'Indexes', items: schema.indexes || [], icon: 'list' },
              { title: 'Triggers', items: schema.triggers || [], icon: 'bolt' },
            ]" :key="group.title">
              <div class="tree-group">
                <div
                  class="tree-label"
                  :class="`${group.title}-root`"
                  style="cursor:pointer"
                  @click="toggleGroupNode(schema.alias, group.title)"
                  @contextmenu.prevent="onGroupContextMenu($event, schema.alias, group.title)"
                >
                  <span class="material-symbols-outlined toggle-icon">
                    {{ groupNodeOpen[`${schema.alias}__${group.title}`] ? 'expand_more' : 'chevron_right' }}
                  </span>
                  <span class="material-symbols-outlined icon">{{ group.icon }}</span>
                  {{ group.title }}
                </div>
                <div class="tree-items" :style="{ display: groupNodeOpen[`${schema.alias}__${group.title}`] ? '' : 'none' }">
                  <template v-if="group.title === 'Tables'">
                    <div v-for="name in group.items" :key="name" class="tree-item">
                      <div
                        class="tree-label Tables"
                        :data-name="name"
                        :data-table-name="name"
                        :data-db-alias="schema.alias"
                        draggable="true"
                        @dragstart="onTreeItemDragStart($event, name)"
                        @click="toggleTableColumnsNode(schema.alias, name)"
                        @contextmenu.prevent="onTableContextMenu($event, schema.alias, name, getTableColumns(schema.alias, name))"
                      >
                        <span class="material-symbols-outlined toggle-icon">
                          {{ tableColumnNodeOpen[`${schema.alias}__${name}`] ? 'expand_more' : 'chevron_right' }}
                        </span>
                        <span class="material-symbols-outlined icon">{{ group.icon }}</span>
                        {{ name }}
                      </div>
                      <div class="tree-items" :style="{ display: tableColumnNodeOpen[`${schema.alias}__${name}`] ? '' : 'none' }">
                        <div
                          v-for="columnName in getTableColumns(schema.alias, name)"
                          :key="`${schema.alias}__${name}__${columnName}`"
                          class="tree-item"
                        >
                          <div
                            class="tree-label Columns"
                            :data-db-alias="schema.alias"
                            :data-table-name="name"
                            :data-column-name="columnName"
                            draggable="true"
                            @dragstart="onTreeItemDragStart($event, columnName)"
                            @contextmenu.prevent="onColumnContextMenu($event, schema.alias, name, columnName, getTableColumns(schema.alias, name))"
                          >
                            <span class="material-symbols-outlined icon">view_column</span>
                            {{ columnName }}
                          </div>
                        </div>
                      </div>
                    </div>
                  </template>
                  <template v-else>
                    <div v-for="name in group.items" :key="name" class="tree-item">
                      <div
                        class="tree-label"
                        :class="group.title"
                        :data-name="name"
                        :data-db-alias="schema.alias"
                        draggable="true"
                        @dragstart="onTreeItemDragStart($event, name)"
                        @contextmenu.prevent="onDbObjectContextMenu($event, schema.alias, group.title, name)"
                      >
                        <span class="material-symbols-outlined icon">{{ group.icon }}</span>
                        {{ name }}
                      </div>
                    </div>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>

    <div class="row-splitter sidebar-tree-splitter" ref="sidebarRowSplitterEl"></div>

    <!-- データセットツリー -->
    <div class="tree-block dataset-tree-block">
      <div class="tree-title" style="cursor:pointer" @click="onDatasetTreeTitleClick">
        <span class="material-symbols-outlined">{{ datasetTreeOpen ? 'expand_more' : 'chevron_right' }}</span>
        データセット
        <button id="add-dataset-button" class="menu-button" title="データセット追加" @click.stop="$emit('add-dataset')">
          <span class="material-symbols-outlined">upload_file</span>
        </button>
      </div>
      <div id="dataset-tree" v-show="datasetTreeOpen" class="tree-view"
        :class="{ 'drop-target-active': isDatasetDropActive, 'drop-target-invalid': isDatasetDropInvalid }"
        @dragenter.prevent="onDatasetTreeDragEnter"
        @dragleave.prevent="onDatasetTreeDragLeave"
        @dragover.prevent="onDatasetTreeDragOver"
        @drop.prevent="onDatasetTreeDrop"
      >
        <div v-if="isDatasetDropActive" class="dataset-drop-indicator" :class="{ invalid: isDatasetDropInvalid }">
          {{ isDatasetDropInvalid ? 'この場所には .csv のみドロップできます' : 'CSVファイルをドロップしてデータセット登録' }}
        </div>
        <div v-if="!datasetTables.length" class="tree-empty">データセットはありません</div>
        <div v-for="table in datasetTables" :key="table.name" class="tree-item">
          <div class="tree-label dataset-node" style="display:flex;align-items:center;justify-content:space-between">
            <span
              class="tree-label dataset"
              :data-name="table.name"
              :data-dataset-table-name="table.name"
              style="display:flex;align-items:center;gap:4px"
              draggable="true"
              @dragstart="onTreeItemDragStart($event, table.name)"
              @click="toggleDatasetTableColumnsNode(table.name)"
              @contextmenu.prevent="onDatasetTableContextMenu($event, table.name, table.columns)"
            >
              <span class="material-symbols-outlined toggle-icon">
                {{ datasetTableNodeOpen[table.name] ? 'expand_more' : 'chevron_right' }}
              </span>
              <span class="material-symbols-outlined icon">dataset</span>
              {{ table.name }}
            </span>
            <button
              class="menu-button"
              :data-delete-dataset-table="table.name"
              :title="`データセット '${table.name}' を削除`"
              style="font-size:14px"
              @click.stop="$emit('delete-dataset', table.name)"
            >
              <span class="material-symbols-outlined">delete</span>
            </button>
          </div>
          <div class="tree-items" :style="{ display: datasetTableNodeOpen[table.name] ? '' : 'none' }">
            <div
              v-for="columnName in table.columns"
              :key="`dataset__${table.name}__${columnName}`"
              class="tree-item"
            >
              <div
                class="tree-label Columns"
                data-db-alias="dataset"
                :data-table-name="table.name"
                :data-column-name="columnName"
                draggable="true"
                @dragstart="onTreeItemDragStart($event, columnName)"
                @contextmenu.prevent="onDatasetColumnContextMenu($event, table.name, columnName, table.columns)"
              >
                <span class="material-symbols-outlined icon">view_column</span>
                {{ columnName }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="dbObjectContextMenu.visible"
      id="db-object-context-menu"
      class="context-menu"
      :style="{ left: `${dbObjectContextMenu.x}px`, top: `${dbObjectContextMenu.y}px` }"
    >
      <button
        v-if="canShowTableSchemaMenu"
        id="db-object-show-table-definition-menu"
        class="context-menu-item"
        @click.stop="onShowTableDefinitionMenuClick"
      >
        テーブル定義の表示
      </button>
      <button
        v-if="canShowEditTableDataMenu"
        id="db-object-edit-table-data-menu"
        class="context-menu-item"
        @click.stop="onEditTableDataMenuClick"
      >
        単表編集
      </button>
      <button
        v-if="canShowDdlMenu"
        id="db-object-show-ddl-menu"
        class="context-menu-item"
        @click.stop="onShowDdlMenuClick"
      >
        CREATE文の挿入
      </button>
      <button
        v-if="canShowInsertQueryMenus"
        id="db-object-insert-select-menu"
        class="context-menu-item"
        @click.stop="onInsertQueryMenuClick('select')"
      >
        Select文の挿入
      </button>
      <button
        v-if="canShowInsertQueryMenus"
        id="db-object-insert-update-menu"
        class="context-menu-item"
        @click.stop="onInsertQueryMenuClick('update')"
      >
        Update文の挿入
      </button>
      <button
        v-if="canShowInsertQueryMenus"
        id="db-object-insert-insert-menu"
        class="context-menu-item"
        @click.stop="onInsertQueryMenuClick('insert')"
      >
        Insert文の挿入
      </button>
      <button
        v-if="canShowInsertQueryMenus"
        id="db-object-insert-delete-menu"
        class="context-menu-item"
        @click.stop="onInsertQueryMenuClick('delete')"
      >
        Delete文の挿入
      </button>
    </div>

    <div
      v-if="groupContextMenu.visible"
      id="group-context-menu"
      class="context-menu"
      :style="{ left: `${groupContextMenu.x}px`, top: `${groupContextMenu.y}px` }"
    >
      <button
        v-if="canShowGroupBulkDdlMenu"
        id="group-show-bulk-ddl-menu"
        class="context-menu-item"
        @click.stop="onShowGroupBulkDdlMenuClick"
      >
        Create文の一括表示
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onBeforeUnmount } from 'vue';
import { formatIdentifier } from '../datasetDb';
import { useSidebarRowSplitter } from '../composables/useSidebarRowSplitter';

defineOptions({ name: 'AppSidebar' });

const emit = defineEmits<{
  'refresh-db': [];
  'detach-db': [alias: string];
  'add-dataset': [];
  'delete-dataset': [name: string];
  'drop-files': [files: File[]];
  'drop-datasets': [files: File[]];
  'append-query': [query: string];
  'show-ddl': [payload: { alias: string; name: string; objectType: DbObjectType }];
  'show-ddl-bulk': [payload: { alias: string }];
  'show-table-definition': [payload: { alias: string; tableName: string }];
  'edit-table-data': [payload: { alias: string; tableName: string }];
}>();

interface GroupContextMenu {
  visible: boolean;
  x: number;
  y: number;
  alias: string;
  groupTitle: string;
}

type DbObjectType = 'table' | 'view' | 'index' | 'trigger' | 'column';
type QueryInsertMenuAction = 'select' | 'update' | 'insert' | 'delete';
type DbObjectContextSource = 'database' | 'dataset';

// ---- Databases ツリー ----
const dbTreeOpen = ref(true);
const dbSchemas = ref<Array<{
  alias: string;
  tables?: string[];
  views?: string[];
  indexes?: string[];
  triggers?: string[];
  tableColumns?: Record<string, string[]>;
}>>([]);
const dbNodeOpen = reactive<Record<string, boolean>>({});
const groupNodeOpen = reactive<Record<string, boolean>>({});
const tableColumnNodeOpen = reactive<Record<string, boolean>>({});
const dbObjectContextMenu = reactive<{
  visible: boolean;
  x: number;
  y: number;
  source: DbObjectContextSource;
  alias: string;
  tableName: string;
  columnName: string;
  columns: string[];
  name: string;
  objectType: DbObjectType;
}>({
  visible: false,
  x: 0,
  y: 0,
  source: 'database',
  alias: '',
  tableName: '',
  columnName: '',
  columns: [],
  name: '',
  objectType: 'table'
});

const groupTitleToObjectType: Record<string, DbObjectType> = {
  Tables: 'table',
  Views: 'view',
  Indexes: 'index',
  Triggers: 'trigger'
};
const DB_FILE_NAME_PATTERN = /\.(db|sqlite|sqlite3|db3)$/i;
const DATASET_FILE_NAME_PATTERN = /\.csv$/i;
const TREE_ITEM_TRANSFER_TYPE = 'application/x-sqlite-webclient-tree-item-name';
const isDbDropActive = ref(false);
const isDbDropInvalid = ref(false);
const isDatasetDropActive = ref(false);
const isDatasetDropInvalid = ref(false);
let dbDragDepth = 0;
let datasetDragDepth = 0;
const sidebarEl = ref<HTMLElement | null>(null);
const databasesTreeBlockEl = ref<HTMLElement | null>(null);
const sidebarRowSplitterEl = ref<HTMLElement | null>(null);

useSidebarRowSplitter(
  sidebarRowSplitterEl,
  () => sidebarEl.value,
  () => databasesTreeBlockEl.value,
  { minTopHeight: 180, minBottomHeight: 180 },
);

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
 * 処理名: DBファイル判定
 * 処理概要: DragEvent 内にサポート対象の DB ファイル名が含まれるか判定する
 * 実装理由: ドロップ可否に応じて視覚表示と dropEffect を切り替えるため
 * @param e ドラッグイベント
 * @returns サポート対象の DB ファイルが含まれる場合 true
 */
/**
 * 処理名: サポートファイル判定
 * 処理概要: DragEvent 内に指定パターンに一致するファイルが含まれるか判定する
 * 実装理由: DBツリーとデータセットツリーで同一判定ロジックを再利用するため
 * @param e ドラッグイベント
 * @param fileNamePattern 判定対象の拡張子パターン
 * @returns 対象ファイルが含まれる場合 true
 */
const hasSupportedFile = (e: DragEvent, fileNamePattern: RegExp): boolean => {
  const files = Array.from(e.dataTransfer?.files ?? []);
  if (files.length > 0) {
    return files.some(file => fileNamePattern.test(file.name));
  }

  const items = Array.from(e.dataTransfer?.items ?? []).filter(item => item.kind === 'file');
  if (items.length === 0) return false;

  // OS からのドラッグでは dragover 時点で getAsFile() が null の場合があるため、
  // 種別未判定時は許可寄りに扱い drop 時の最終判定に委ねる。
  let hasUnknownFile = false;
  for (const item of items) {
    const file = item.getAsFile();
    if (!file) {
      hasUnknownFile = true;
      continue;
    }
    if (fileNamePattern.test(file.name)) {
      return true;
    }
  }
  return hasUnknownFile;
};

/**
 * 処理名: DBファイル判定
 * 処理概要: DragEvent 内にサポート対象の DB ファイル名が含まれるか判定する
 * 実装理由: ドロップ可否に応じて視覚表示と dropEffect を切り替えるため
 * @param e ドラッグイベント
 * @returns サポート対象の DB ファイルが含まれる場合 true
 */
const hasSupportedDbFile = (e: DragEvent): boolean => hasSupportedFile(e, DB_FILE_NAME_PATTERN);

/**
 * 処理名: CSVファイル判定
 * 処理概要: DragEvent 内にサポート対象の CSV ファイル名が含まれるか判定する
 * 実装理由: データセットツリーへの CSV ドロップ可否を判定するため
 * @param e ドラッグイベント
 * @returns サポート対象の CSV ファイルが含まれる場合 true
 */
const hasSupportedDatasetFile = (e: DragEvent): boolean => hasSupportedFile(e, DATASET_FILE_NAME_PATTERN);

/**
 * 処理名: DBドロップ状態更新
 * 処理概要: DBツリーのドロップ可視状態と可否状態を更新する
 * 実装理由: dragenter/dragover/drop で状態遷移を共通化するため
 * @param active ドロップ状態を有効化するか
 * @param invalid サポート外ファイル状態か
 */
const setDbDropState = (active: boolean, invalid = false) => {
  isDbDropActive.value = active;
  isDbDropInvalid.value = active && invalid;
};

/**
 * 処理名: データセットドロップ状態更新
 * 処理概要: データセットツリーのドロップ可視状態と可否状態を更新する
 * 実装理由: dragenter/dragover/drop で状態遷移を共通化するため
 * @param active ドロップ状態を有効化するか
 * @param invalid サポート外ファイル状態か
 */
const setDatasetDropState = (active: boolean, invalid = false) => {
  isDatasetDropActive.value = active;
  isDatasetDropInvalid.value = active && invalid;
};

/**
 * 処理名: DBツリードラッグエンターハンドラ
 * 処理概要: ファイルドラッグ進入時にドロップ可能表示を有効化する
 * 実装理由: ドロップ対象であることを明示し操作性を高めるため
 * @param e ドラッグイベント
 */
const onDbTreeDragEnter = (e: DragEvent) => {
  if (!isFileDragEvent(e)) return;
  dbDragDepth += 1;
  setDbDropState(true, !hasSupportedDbFile(e));
};

/**
 * 処理名: DBツリードラッグリーブハンドラ
 * 処理概要: ファイルドラッグ離脱時にドロップ可能表示を解除する
 * 実装理由: 子要素をまたぐ dragleave でも表示がちらつかないよう深度管理するため
 * @param e ドラッグイベント
 */
const onDbTreeDragLeave = (e: DragEvent) => {
  if (!isFileDragEvent(e)) return;
  dbDragDepth = Math.max(0, dbDragDepth - 1);
  if (dbDragDepth === 0) {
    setDbDropState(false);
  }
};

/**
 * 処理名: DBツリードラッグオーバーハンドラ
 * 処理概要: ファイルドラッグ中のドロップ可否表示を更新し dropEffect を設定する
 * 実装理由: 利用者に copy/none のフィードバックを即時に返すため
 * @param e ドラッグイベント
 */
const onDbTreeDragOver = (e: DragEvent) => {
  if (!isFileDragEvent(e)) return;
  const canDrop = hasSupportedDbFile(e);
  setDbDropState(true, !canDrop);
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = canDrop ? 'copy' : 'none';
  }
};

/**
 * 処理名: DBツリー開閉トグル
 * 処理概要: Databases ツリーパネルの表示・非表示を切り替える
 * 実装理由: パネルタイトルのクリックイベントに対応するため
 */
const onDbTreeTitleClick = () => { dbTreeOpen.value = !dbTreeOpen.value; };

/**
 * 処理名: DBツリードロップハンドラ
 * 処理概要: .db ファイルがドロップされた際に親コンポーネントにファイル一覧を渡す
 * 実装理由: DBツリーへのドラッグアンドドロップで複数DBを開くため
 * @param e ドラッグイベント
 */
const onDbTreeDrop = (e: DragEvent) => {
  dbDragDepth = 0;
  setDbDropState(false);
  const dropped = Array.from(e.dataTransfer?.files ?? []).filter(f => DB_FILE_NAME_PATTERN.test(f.name));
  if (dropped.length) emit('drop-files', dropped);
};

/**
 * 処理名: DBノード開閉トグル
 * 処理概要: 指定エイリアスの DB ノードの展開・折りたたみを切り替える
 * 実装理由: ダブルクリックやメニューボタン操作と区別するため button クリックを除外する
 * @param alias DB エイリアス
 * @param e マウスイベント
 */
const toggleDbNode = (alias: string, e: MouseEvent) => {
  if ((e.target as HTMLElement).closest('button.menu-button')) return;
  dbNodeOpen[alias] = !dbNodeOpen[alias];
};

/**
 * 処理名: グループノード開閉トグル
 * 処理概要: 指定 DB エイリアス・グループ名のツリーグループ展開状態を切り替える
 * 実装理由: Tables / Views / Indexes / Triggers 各グループを個別に開閉するため
 * @param alias DB エイリアス
 * @param title グループタイトル
 */
const toggleGroupNode = (alias: string, title: string) => {
  const key = `${alias}__${title}`;
  groupNodeOpen[key] = !groupNodeOpen[key];
};

/**
 * 処理名: テーブルカラムノード開閉トグル
 * 処理概要: 指定テーブル配下のカラム一覧展開状態を切り替える
 * 実装理由: テーブル配下にカラムツリーを持たせる要件に対応するため
 * @param alias DB エイリアス
 * @param tableName テーブル名
 */
const toggleTableColumnsNode = (alias: string, tableName: string) => {
  const key = `${alias}__${tableName}`;
  tableColumnNodeOpen[key] = !tableColumnNodeOpen[key];
};

/**
 * 処理名: テーブルカラム一覧取得
 * 処理概要: 指定エイリアス・テーブルのカラム名配列を返す
 * 実装理由: ツリー描画時にカラムノード配列を取得するため
 * @param alias DB エイリアス
 * @param tableName テーブル名
 * @returns カラム名配列
 */
const getTableColumns = (alias: string, tableName: string): string[] => {
  const schema = dbSchemas.value.find(item => item.alias === alias);
  return schema?.tableColumns?.[tableName] ?? [];
};

/**
 * 処理名: ツリー項目ドラッグ開始
 * 処理概要: ツリー項目名を DataTransfer にセットする
 * 実装理由: エディタへの D&D で項目名を挿入するため
 * @param e ドラッグイベント
 * @param itemName 挿入対象の項目名
 */
const onTreeItemDragStart = (e: DragEvent, itemName: string) => {
  if (!e.dataTransfer) return;
  e.dataTransfer.effectAllowed = 'copy';
  e.dataTransfer.setData(TREE_ITEM_TRANSFER_TYPE, itemName);
};

/**
 * 処理名: DBオブジェクト右クリックメニュー表示
 * 処理概要: Tables / Views / Indexes / Triggers の項目右クリックでメニューを開く
 * 実装理由: DDL表示アクションをコンテキストメニュー経由で提供するため
 * @param e マウスイベント
 * @param alias DBエイリアス
 * @param groupTitle グループ名
 * @param name DBオブジェクト名
 */
const onDbObjectContextMenu = (e: MouseEvent, alias: string, groupTitle: string, name: string) => {
  const objectType = groupTitleToObjectType[groupTitle];
  if (!objectType) return;
  const columns = objectType === 'table' ? getTableColumns(alias, name) : [];
  openDbObjectContextMenu(e, {
    source: 'database',
    alias,
    name,
    objectType,
    tableName: objectType === 'table' ? name : '',
    columnName: '',
    columns,
  });
};

/**
 * 処理名: テーブル右クリックメニュー表示
 * 処理概要: テーブル項目右クリック時にコンテキストメニューを開く
 * 実装理由: テーブル向け SQL 挿入メニューを表示するため
 * @param e マウスイベント
 * @param alias DBエイリアス
 * @param tableName テーブル名
 * @param columns テーブルの全カラム配列
 */
const onTableContextMenu = (e: MouseEvent, alias: string, tableName: string, columns: string[]) => {
  openDbObjectContextMenu(e, {
    source: 'database',
    alias,
    name: tableName,
    objectType: 'table',
    tableName,
    columnName: '',
    columns,
  });
};

/**
 * 処理名: カラム右クリックメニュー表示
 * 処理概要: カラム項目右クリック時にコンテキストメニューを開く
 * 実装理由: カラム単位 SQL 挿入メニューを表示するため
 * @param e マウスイベント
 * @param alias DBエイリアス
 * @param tableName テーブル名
 * @param columnName カラム名
 * @param columns テーブルの全カラム配列
 */
const onColumnContextMenu = (
  e: MouseEvent,
  alias: string,
  tableName: string,
  columnName: string,
  columns: string[]
) => {
  openDbObjectContextMenu(e, {
    source: 'database',
    alias,
    name: columnName,
    objectType: 'column',
    tableName,
    columnName,
    columns,
  });
};

/**
 * 処理名: データセットテーブル右クリックメニュー表示
 * 処理概要: データセットツリー項目右クリック時に SQL 挿入メニューを開く
 * 実装理由: データセットテーブル向けの CRUD 文挿入を提供するため
 * @param e マウスイベント
 * @param tableName テーブル名
 * @param columns テーブルの全カラム配列
 */
const onDatasetTableContextMenu = (e: MouseEvent, tableName: string, columns: string[]) => {
  openDbObjectContextMenu(e, {
    source: 'dataset',
    alias: 'dataset',
    name: tableName,
    objectType: 'table',
    tableName,
    columnName: '',
    columns,
  });
};

/**
 * 処理名: データセットカラム右クリックメニュー表示
 * 処理概要: データセット配下のカラム項目右クリック時に SQL 挿入メニューを開く
 * 実装理由: Databases ツリーのカラムと同等の操作を提供するため
 * @param e マウスイベント
 * @param tableName テーブル名
 * @param columnName カラム名
 * @param columns テーブルの全カラム配列
 */
const onDatasetColumnContextMenu = (
  e: MouseEvent,
  tableName: string,
  columnName: string,
  columns: string[]
) => {
  openDbObjectContextMenu(e, {
    source: 'dataset',
    alias: 'dataset',
    name: columnName,
    objectType: 'column',
    tableName,
    columnName,
    columns,
  });
};

/**
 * 処理名: DBオブジェクト右クリックメニュー内部表示
 * 処理概要: コンテキストメニューの表示情報を更新する
 * 実装理由: テーブル/カラム/その他オブジェクトで同一表示処理を共通化するため
 * @param e マウスイベント
 * @param payload メニュー対象情報
 * @param payload.source メニュー対象の出所（DBツリー/データセットツリー）
 * @param payload.alias DBエイリアス
 * @param payload.name 対象名
 * @param payload.objectType オブジェクト種別
 * @param payload.tableName テーブル名
 * @param payload.columnName カラム名
 * @param payload.columns テーブルの全カラム配列
 */
const openDbObjectContextMenu = (
  e: MouseEvent,
  payload: {
    source: DbObjectContextSource;
    alias: string;
    name: string;
    objectType: DbObjectType;
    tableName: string;
    columnName: string;
    columns: string[];
  }
) => {
  dbObjectContextMenu.visible = true;
  dbObjectContextMenu.x = e.clientX;
  dbObjectContextMenu.y = e.clientY;
  dbObjectContextMenu.source = payload.source;
  dbObjectContextMenu.alias = payload.alias;
  dbObjectContextMenu.name = payload.name;
  dbObjectContextMenu.objectType = payload.objectType;
  dbObjectContextMenu.tableName = payload.tableName;
  dbObjectContextMenu.columnName = payload.columnName;
  dbObjectContextMenu.columns = payload.columns;
  updateContextMenuVisibilityFlags();
};

/**
 * 処理名: DBオブジェクト右クリックメニュー閉じる
 * 処理概要: 表示中のコンテキストメニューを閉じる
 * 実装理由: メニュー外クリックや ESC 操作でメニューを閉じるため
 */
const closeDbObjectContextMenu = () => {
  dbObjectContextMenu.visible = false;
  canShowDdlMenu.value = false;
  canShowInsertQueryMenus.value = false;
  canShowTableSchemaMenu.value = false;
  canShowEditTableDataMenu.value = false;
};

/**
 * 処理名: グループコンテキストメニュー表示状態
 * 処理概要: グループ右クリック時のメニュー表示座標と対象グループ情報を保持する
 * 実装理由: Tables グループから一括 CREATE 表示を呼び出すため
 */
const groupContextMenu = reactive<GroupContextMenu>({
  visible: false,
  x: 0,
  y: 0,
  alias: '',
  groupTitle: '',
});

/**
 * 処理名: グループコンテキストメニュー表示可否判定
 * 処理概要: グループコンテキストメニュー表示用フラグ
 * 実装理由: Tables グループのみ一括 CREATE 表示を提供するため
 */
const canShowGroupBulkDdlMenu = ref(false);

/**
 * 処理名: グループコンテキストメニュー表示
 * 処理概要: グループ右クリック時にコンテキストメニューを開く
 * 実装理由: テーブルグループレベルでメニュー操作を提供するため
 * @param e マウスイベント
 * @param alias DB エイリアス
 * @param groupTitle グループ名
 */
const onGroupContextMenu = (e: MouseEvent, alias: string, groupTitle: string) => {
  groupContextMenu.visible = true;
  groupContextMenu.x = e.clientX;
  groupContextMenu.y = e.clientY;
  groupContextMenu.alias = alias;
  groupContextMenu.groupTitle = groupTitle;
  canShowGroupBulkDdlMenu.value = groupTitle === 'Tables';
};

/**
 * 処理名: グループコンテキストメニュー閉じる
 * 処理概要: 表示中のグループコンテキストメニューを閉じる
 * 実装理由: メニュー操作完了後やメニュー外クリック時のクリーンアップ
 */
const closeGroupContextMenu = () => {
  groupContextMenu.visible = false;
  canShowGroupBulkDdlMenu.value = false;
};

/**
 * 処理名: グループ一括 DDL 表示メニュー選択
 * 処理概要: Tables グループ右クリック時に全テーブル CREATE 文をまとめて挿入する
 * 実装理由: 対象スキーマの全 CREATE 文を効率的に表示するため
 */
const onShowGroupBulkDdlMenuClick = () => {
  if (groupContextMenu.groupTitle !== 'Tables') {
    closeGroupContextMenu();
    return;
  }
  emit('show-ddl-bulk', {
    alias: groupContextMenu.alias,
  });
  closeGroupContextMenu();
};

/**
 * 処理名: テーブルスキーマメニュー表示可否判定
 * 処理概要: 現在の右クリック対象がテーブルで、DBツリーのテーブル操作が可能か判定する
 * 実装理由: テーブル定義表示と単表編集はテーブル専用機能のため
 */
const canShowTableSchemaMenu = ref(false);

/**
 * 処理名: テーブルデータ編集メニュー表示可否判定
 * 処理概要: DBツリーのテーブルまたはデータセットのテーブルで編集メニューを表示するか判定する
 * 実装理由: テーブル編集はDBテーブルとデータセットテーブル両方に対応するため
 */
const canShowEditTableDataMenu = ref(false);

/**
 * 処理名: DDLメニュー表示可否判定
 * 処理概要: 現在の右クリック対象で DDL 表示メニューを出すべきか判定する
 * 実装理由: カラムノードでは DDL 取得ができないため非表示にするため
 */
const canShowDdlMenu = ref(false);

/**
 * 処理名: クエリ挿入メニュー表示可否判定
 * 処理概要: 現在の右クリック対象で SQL 挿入メニューを出すべきか判定する
 * 実装理由: テーブルまたはカラム以外では SQL 挿入メニューを非表示にするため
 */
const canShowInsertQueryMenus = ref(false);

/**
 * 処理名: コンテキストメニュー表示可否更新
 * 処理概要: 対象オブジェクト種別に応じたメニュー表示可否を更新する
 * 実装理由: メニュー描画条件を一箇所で管理するため
 */
const updateContextMenuVisibilityFlags = () => {
  canShowTableSchemaMenu.value = 
    dbObjectContextMenu.source === 'database' && dbObjectContextMenu.objectType === 'table';
  canShowEditTableDataMenu.value =
    dbObjectContextMenu.objectType === 'table' &&
    (dbObjectContextMenu.source === 'database' || dbObjectContextMenu.source === 'dataset');
  canShowDdlMenu.value = dbObjectContextMenu.source === 'database' && dbObjectContextMenu.objectType !== 'column';
  canShowInsertQueryMenus.value =
    dbObjectContextMenu.source === 'dataset'
    || dbObjectContextMenu.objectType === 'table'
    || dbObjectContextMenu.objectType === 'view'
    || dbObjectContextMenu.objectType === 'column';
};

/**
 * 処理名: DDL表示メニュー選択
 * 処理概要: コンテキストメニューの DDL 表示を選択した際に親へ通知する
 * 実装理由: DDL 取得と表示を親コンポーネントに委譲するため
 */
const onShowDdlMenuClick = () => {
  if (dbObjectContextMenu.objectType === 'column') {
    closeDbObjectContextMenu();
    return;
  }
  emit('show-ddl', {
    alias: dbObjectContextMenu.alias,
    name: dbObjectContextMenu.name,
    objectType: dbObjectContextMenu.objectType as 'table' | 'view' | 'index' | 'trigger'
  });
  closeDbObjectContextMenu();
};

/**
 * 処理名: テーブル定義表示メニュー選択
 * 処理概要: テーブル定義を編集可能なグリッドで表示するイベントを発火する
 * 実装理由: テーブルスキーマを表示・編集するため
 */
const onShowTableDefinitionMenuClick = () => {
  emit('show-table-definition', {
    alias: dbObjectContextMenu.alias,
    tableName: dbObjectContextMenu.tableName
  });
  closeDbObjectContextMenu();
};

/**
 * 処理名: 単表編集メニュー選択
 * 処理概要: テーブル全行を編集可能なグリッドで表示するイベントを発火する
 * 実装理由: テーブルデータを直接編集するため
 */
const onEditTableDataMenuClick = () => {
  emit('edit-table-data', {
    alias: dbObjectContextMenu.alias,
    tableName: dbObjectContextMenu.tableName
  });
  closeDbObjectContextMenu();
};

/**
 * 処理名: 識別子リスト組み立て
 * 処理概要: カラム名配列を識別子フォーマットしてカンマ連結する
 * 実装理由: 各 SQL 生成で同一のカラム組み立てを再利用するため
 * @param columns カラム名配列
 * @returns カンマ連結済み識別子リスト
 */
const buildColumnList = (columns: string[]): string => columns.map(column => formatIdentifier(column)).join(', ');

/**
 * 処理名: テーブル完全修飾名生成
 * 処理概要: エイリアス付きのテーブル識別子を組み立てる
 * 実装理由: SQL 生成時に schema.table 形式を一貫して扱うため
 * @param alias DB エイリアス
 * @param tableName テーブル名
 * @returns 完全修飾テーブル識別子
 */
const buildQualifiedTableName = (alias: string, tableName: string): string => {
  if (!alias || alias === 'main') {
    return formatIdentifier(tableName);
  }
  return `${formatIdentifier(alias)}.${formatIdentifier(tableName)}`;
};

/**
 * 処理名: 対象カラム配列取得
 * 処理概要: 右クリック対象に応じて SQL 生成対象カラム配列を返す
 * 実装理由: テーブル操作は全カラム、カラム操作は対象カラムの要件を満たすため
 * @returns 対象カラム名配列
 */
const resolveTargetColumns = (): string[] => {
  if (dbObjectContextMenu.objectType === 'column') {
    return dbObjectContextMenu.columnName ? [dbObjectContextMenu.columnName] : [];
  }
  return dbObjectContextMenu.columns;
};

/**
 * 処理名: SELECT文生成
 * 処理概要: 対象テーブル/カラム向けの SELECT 文を生成する
 * 実装理由: メニュー操作でエディタに追記する SQL を生成するため
 * @returns SQL 文字列
 */
const buildSelectQuery = (): string => {
  const tableName = buildQualifiedTableName(dbObjectContextMenu.alias, dbObjectContextMenu.tableName || dbObjectContextMenu.name);
  const columns = resolveTargetColumns();
  const projection = columns.length > 0 ? buildColumnList(columns) : '*';
  return `SELECT ${projection} FROM ${tableName} LIMIT 100;`;
};

/**
 * 処理名: UPDATE文生成
 * 処理概要: 対象テーブル/カラム向けの UPDATE 文を生成する
 * 実装理由: メニュー操作で編集用 SQL のひな形を提供するため
 * @returns SQL 文字列
 */
const buildUpdateQuery = (): string => {
  const tableName = buildQualifiedTableName(dbObjectContextMenu.alias, dbObjectContextMenu.tableName || dbObjectContextMenu.name);
  const columns = resolveTargetColumns();
  const assignments = (columns.length > 0 ? columns : ['column'])
    .map(column => `${formatIdentifier(column)} = ?`)
    .join(', ');
  return `UPDATE ${tableName} SET ${assignments} WHERE ;`;
};

/**
 * 処理名: INSERT文生成
 * 処理概要: 対象テーブル/カラム向けの INSERT 文を生成する
 * 実装理由: メニュー操作で挿入用 SQL のひな形を提供するため
 * @returns SQL 文字列
 */
const buildInsertQuery = (): string => {
  const tableName = buildQualifiedTableName(dbObjectContextMenu.alias, dbObjectContextMenu.tableName || dbObjectContextMenu.name);
  const columns = resolveTargetColumns();
  const targetColumns = columns.length > 0 ? columns : ['column'];
  const columnClause = buildColumnList(targetColumns);
  const valuesClause = targetColumns.map(() => '?').join(', ');
  return `INSERT INTO ${tableName} (${columnClause}) VALUES (${valuesClause});`;
};

/**
 * 処理名: DELETE文生成
 * 処理概要: 対象テーブル/カラム向けの DELETE 文を生成する
 * 実装理由: メニュー操作で削除用 SQL のひな形を提供するため
 * @returns SQL 文字列
 */
const buildDeleteQuery = (): string => {
  const tableName = buildQualifiedTableName(dbObjectContextMenu.alias, dbObjectContextMenu.tableName || dbObjectContextMenu.name);
  if (dbObjectContextMenu.objectType === 'column' && dbObjectContextMenu.columnName) {
    return `DELETE FROM ${tableName} WHERE ${formatIdentifier(dbObjectContextMenu.columnName)} = ?;`;
  }
  return `DELETE FROM ${tableName} WHERE ;`;
};

/**
 * 処理名: メニュー種別別SQL生成
 * 処理概要: メニュー種別に応じた SQL 文字列を生成する
 * 実装理由: コンテキストメニューの SQL 挿入処理を一元化するため
 * @param action メニュー種別
 * @returns SQL 文字列
 */
const buildInsertMenuQuery = (action: QueryInsertMenuAction): string => {
  if (action === 'select') return buildSelectQuery();
  if (action === 'update') return buildUpdateQuery();
  if (action === 'insert') return buildInsertQuery();
  return buildDeleteQuery();
};

/**
 * 処理名: SQL挿入メニュー選択
 * 処理概要: 選択されたメニュー種別の SQL を生成して親へ通知する
 * 実装理由: エディタ追記処理を親コンポーネントに委譲するため
 * @param action メニュー種別
 */
const onInsertQueryMenuClick = (action: QueryInsertMenuAction) => {
  emit('append-query', buildInsertMenuQuery(action));
  closeDbObjectContextMenu();
};

/**
 * 処理名: キー押下ハンドラ
 * 処理概要: Escape 押下時にコンテキストメニューを閉じる
 * 実装理由: キーボード操作でもメニューを閉じられるようにするため
 * @param e キーボードイベント
 */
const onWindowKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    closeDbObjectContextMenu();
    closeGroupContextMenu();
  }
};

// ---- データセットツリー ----
const datasetTreeOpen = ref(true);
const datasetTables = ref<Array<{ name: string; columns: string[] }>>([]);
const datasetTableNodeOpen = reactive<Record<string, boolean>>({});

/**
 * 処理名: データセットテーブルカラムノード開閉トグル
 * 処理概要: 指定データセットテーブル配下のカラム一覧展開状態を切り替える
 * 実装理由: データセットテーブル配下にカラムツリーを表示するため
 * @param tableName テーブル名
 */
const toggleDatasetTableColumnsNode = (tableName: string) => {
  datasetTableNodeOpen[tableName] = !datasetTableNodeOpen[tableName];
};

/**
 * 処理名: データセットツリー開閉トグル
 * 処理概要: データセットツリーパネルの表示・非表示を切り替える
 * 実装理由: パネルタイトルのクリックイベントに対応するため
 */
const onDatasetTreeTitleClick = () => { datasetTreeOpen.value = !datasetTreeOpen.value; };

/**
 * 処理名: データセットツリードラッグエンターハンドラ
 * 処理概要: CSVファイルドラッグ進入時にドロップ可能表示を有効化する
 * 実装理由: データセット追加のドロップ対象を明示するため
 * @param e ドラッグイベント
 */
const onDatasetTreeDragEnter = (e: DragEvent) => {
  if (!isFileDragEvent(e)) return;
  datasetDragDepth += 1;
  setDatasetDropState(true, !hasSupportedDatasetFile(e));
};

/**
 * 処理名: データセットツリードラッグリーブハンドラ
 * 処理概要: CSVファイルドラッグ離脱時にドロップ可能表示を解除する
 * 実装理由: 子要素をまたぐ dragleave でも表示を安定させるため
 * @param e ドラッグイベント
 */
const onDatasetTreeDragLeave = (e: DragEvent) => {
  if (!isFileDragEvent(e)) return;
  datasetDragDepth = Math.max(0, datasetDragDepth - 1);
  if (datasetDragDepth === 0) {
    setDatasetDropState(false);
  }
};

/**
 * 処理名: データセットツリードラッグオーバーハンドラ
 * 処理概要: CSVドラッグ中のドロップ可否表示を更新し dropEffect を設定する
 * 実装理由: 利用者に copy/none のフィードバックを返すため
 * @param e ドラッグイベント
 */
const onDatasetTreeDragOver = (e: DragEvent) => {
  if (!isFileDragEvent(e)) return;
  const canDrop = hasSupportedDatasetFile(e);
  setDatasetDropState(true, !canDrop);
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = canDrop ? 'copy' : 'none';
  }
};

/**
 * 処理名: データセットツリードロップハンドラ
 * 処理概要: CSVファイルドロップ時に親コンポーネントへファイル一覧を通知する
 * 実装理由: add-dataset ボタンと同等のデータセット取り込みを可能にするため
 * @param e ドラッグイベント
 */
const onDatasetTreeDrop = (e: DragEvent) => {
  datasetDragDepth = 0;
  setDatasetDropState(false);
  const dropped = Array.from(e.dataTransfer?.files ?? []).filter(f => DATASET_FILE_NAME_PATTERN.test(f.name));
  if (dropped.length) emit('drop-datasets', dropped);
};

// ---- 外部から呼び出す API ----
/**
 * 処理名: DBツリー更新
 * 処理概要: サイドバーに表示する DB スキーマ一覧を外部から更新する
 * 実装理由: 親コンポーネントが DB 変更時にツリーを再描画するため
 * @param schemas 更新する DB スキーマ配列
 */
const updateDatabaseTree = (schemas: typeof dbSchemas.value) => {
  dbSchemas.value = schemas ?? [];
};

/**
 * 処理名: データセットツリー更新
 * 処理概要: サイドバーに表示するデータセットテーブル名一覧を外部から更新する
 * 実装理由: CSV登録・削除後にデータセット一覧を再描画するため
 * @param tables 更新するテーブル名配列
 */
const updateDatasetTree = (tables: string[] | Array<{ name: string; columns?: string[] }>) => {
  if (!tables?.length) {
    datasetTables.value = [];
    return;
  }

  if (typeof tables[0] === 'string') {
    datasetTables.value = (tables as string[]).map((name) => ({ name, columns: [] }));
    return;
  }

  datasetTables.value = (tables as Array<{ name: string; columns?: string[] }>).map((table) => ({
    name: table.name,
    columns: table.columns ?? [],
  }));
};

onMounted(() => {
  window.addEventListener('keydown', onWindowKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onWindowKeydown);
});

defineExpose({ updateDatabaseTree, updateDatasetTree });
</script>
