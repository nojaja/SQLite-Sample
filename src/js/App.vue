<template>
    <div id="app-container" class="app-container">
        <MenuBar
            @open-help="showHelpModal = true"
            @new-db="handleNewDb"
            @open-db="handleOpenDb"
            @save-db="handleSaveDb"
            @new-query="handleNewQuery"
            @open-query="handleOpenQuery"
            @save-query="handleSaveQuery"
            @run-query="handleRunQuery"
            @show-query-plan="handleShowQueryPlan"
            @format-query="handleFormatQuery"
        />
        <div class="main-layout">
            <Sidebar
                ref="sidebarRef"
                @refresh-db="handleRefreshDb"
                @detach-db="handleDetachDb"
                @add-dataset="handleAddDataset"
                @delete-dataset="handleDeleteDataset"
                @drop-files="handleDbTreeDrop"
                @drop-datasets="handleDatasetTreeDrop"
                @append-query="handleAppendQuery"
                @show-ddl="handleShowDdl"
                @show-ddl-bulk="handleShowBulkDdl"
                @show-table-definition="handleShowTableDefinition"
                @edit-table-data="handleEditTableData"
            />
            <div class="splitter" ref="splitterEl"></div>
            <MainArea
                ref="mainAreaRef"
                @register-dataset="handleRegisterDataset"
                @download-csv="handleDownloadCsv"
                @run-query="handleRunQuery"
                @drop-query="handleQueryEditorDrop"
                @save-query="handleSaveQuery"
            />
        </div>
        <StatusBar ref="statusBarRef" />
        <!-- ファイル選択用隠しinput（file picker をVueテンプレートで管理） -->
        <input type="file" ref="fileInputRef" style="display:none" @change="onFileInputChange" />
        <!-- CSVダウンロード用隠しアンカー -->
        <a ref="downloadLinkRef" style="display:none" aria-hidden="true"></a>
    </div>

    <!-- ヘルプモーダル -->
    <Teleport to="body">
        <div id="help-modal" :style="{ display: showHelpModal ? '' : 'none' }">
            <div class="modal-overlay" @click="showHelpModal = false"></div>
            <div class="modal-content">
                <h2>Help and License</h2>
                <ul>
                    <li><a href="https://github.com/nojaja/SQLite-WebClient" target="_blank">GitHub Repository</a></li>
                </ul>
                <h3>Used Libraries and Licenses</h3>
                <ul>
                    <li><a href="https://www.npmjs.com/package/@sqlite.org/sqlite-wasm" target="_blank">@sqlite.org/sqlite-wasm</a> (Apache-2.0)</li>
                    <li><a href="https://www.npmjs.com/package/tabulator-tables" target="_blank">Tabulator</a> (MIT)</li>
                    <li><a href="https://www.npmjs.com/package/dbgate-query-splitter" target="_blank">dbgate-query-splitter</a> (MIT)</li>
                </ul>
                <button @click="showHelpModal = false">閉じる</button>
            </div>
        </div>
    </Teleport>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue';
import MenuBar from './components/MenuBar.vue';
import Sidebar from './components/Sidebar.vue';
import MainArea from './components/MainArea.vue';
import StatusBar from './components/StatusBar.vue';
import { useColumnSplitter } from './composables/useColumnSplitter';
import {
    DATASET_DB_ALIAS,
    deleteDatasetTable,
    ensureDatasetDatabase,
    listDatasetTables,
    importCsvFileAsDataset,
    registerRowsAsDatasetTable,
} from './datasetDb';
import SQLiteManager from './SQLiteManager';
import { updateDbObjectSuggestions } from './sqlCompletionProvider';

// ---- Vueコンポーネント ref ----
const splitterEl = ref<HTMLElement | null>(null);
const sidebarRef = ref<InstanceType<typeof Sidebar> | null>(null);
const mainAreaRef = ref<InstanceType<typeof MainArea> | null>(null);
const statusBarRef = ref<InstanceType<typeof StatusBar> | null>(null);
const showHelpModal = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);
const downloadLinkRef = ref<HTMLAnchorElement | null>(null);

// ---- DB状態 ----
let db: SQLiteManager | null = null;
let dbReady: Promise<SQLiteManager> | null = null;
let currentDbPath = 'Untitled.db';
let mainHidden = false;
let queryExecutionSerial = 0;
const DB_FILE_ACCEPT = '.db,.sqlite,.sqlite3,.db3';
const DB_FILE_NAME_PATTERN = /\.(db|sqlite|sqlite3|db3)$/i;

/**
 * 処理名: DB インスタンス取得
 * 処理概要: 初期化済みの SQLiteManager インスタンスを返す
 * 実装理由: 未初期化時は reject し呼び出し元でエラーを捕捉できるようにするため
 * @returns SQLiteManager の Promise
 */
const getDb = (): Promise<SQLiteManager> => {
    if (dbReady) return dbReady;
    return Promise.reject(new Error('DB未初期化'));
};

// ---- UIヘルパー ----
/**
 * 処理名: エラー表示
 * 処理概要: ステータスバーにエラーメッセージを表示する
 * 実装理由: アプリ全体のエラー通知を一元化するため
 * @param msg エラーメッセージ
 * @returns void
 */
const showError = (msg: string) => statusBarRef.value?.showError(msg);
/**
 * 処理名: 成功表示
 * 処理概要: ステータスバーに成功メッセージを表示する
 * 実装理由: アプリ全体の成功通知を一元化するため
 * @param msg 成功メッセージ
 * @returns void
 */
const showSuccess = (msg: string) => statusBarRef.value?.showSuccess(msg);
/**
 * 処理名: DB 名設定
 * 処理概要: 現在の DB パスを更新しステータスバーに反映する
 * 実装理由: DB 変更時にパスとステータス表示を同期するため
 * @param name データベース名（パス）
 */
const setDbStatus = (name: string) => {
    currentDbPath = name;
    statusBarRef.value?.setDbName(name);
};

/**
 * 処理名: 表示用スキーマ取得
 * 処理概要: dataset DB と mainHidden フラグを除外したスキーマ一覧を返す
 * 実装理由: サイドバーの DB ツリー表示に不要なスキーマを隠すため
 * @param dbInst SQLiteManager インスタンス
 * @returns 表示対象のスキーマ配列
 */
const getDisplaySchemas = (dbInst: SQLiteManager) => {
    const schemas = dbInst.getAllDatabaseSchemas().filter(s => s.alias !== DATASET_DB_ALIAS);
    return mainHidden ? schemas.filter(s => s.alias !== 'main') : schemas;
};

/**
 * 処理名: データセットツリー表示データ取得
 * 処理概要: データセットテーブル名とカラム配列をサイドバー表示向けに返す
 * 実装理由: データセット配下でもテーブルごとのカラムツリーを表示するため
 * @param dbInst SQLiteManager インスタンス
 * @returns テーブル名とカラム配列の一覧
 */
const getDatasetTreeTables = (dbInst: SQLiteManager): Array<{ name: string; columns: string[] }> => {
    const schema = dbInst.getDatabaseSchema(DATASET_DB_ALIAS);
    const tableNames = schema.tables ?? [];
    return tableNames.map((name) => ({
        name,
        columns: schema.tableColumns?.[name] ?? [],
    }));
};

/**
 * 処理名: ツリー再描画
 * 処理概要: DB ツリーとデータセットツリーを最新状態で再描画する
 * 実装理由: DB 変更後に常に同一手順でサイドバーを更新するため
 */
const refreshTrees = async () => {
    try {
        const dbInst = await getDb();
        const displaySchemas = getDisplaySchemas(dbInst);
        const datasetTablesList = listDatasetTables(dbInst);
        const datasetTreeTables = getDatasetTreeTables(dbInst);
        sidebarRef.value?.updateDatabaseTree(displaySchemas);
        sidebarRef.value?.updateDatasetTree(datasetTreeTables);
        updateDbObjectSuggestions(displaySchemas, DATASET_DB_ALIAS, datasetTablesList);
    } catch { /* DB未初期化時は何もしない */ }
};

// ---- ファイルI/Oヘルパー ----
/**
 * 処理名: ファイル ArrayBuffer 読み込み
 * 処理概要: Blob を ArrayBuffer として非同期で読み込む
 * 実装理由: SQLite ファイルをバイナリデータとして取得するため
 * @param file 読み込む Blob
 * @returns ArrayBuffer の Promise
 */
const readFileAsArrayBuffer = (file: Blob): Promise<ArrayBuffer> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        /**
         * 処理名: 読み込み完了ハンドラ
         * 処理概要: ファイル読み込み完了時に ArrayBuffer を resolve に渡す
         * 実装理由: FileReader の非同期完了を Promise に変換するため
         * @returns void
         */
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });

/**
 * 処理名: ファイルテキスト読み込み
 * 処理概要: Blob をテキスト文字列として非同期で読み込む
 * 実装理由: SQL ファイルをテキストとして取得するため
 * @param file 読み込む Blob
 * @returns テキスト文字列の Promise
 */
const readFileAsText = (file: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        /**
         * 処理名: 読み込み完了ハンドラ
         * 処理概要: ファイル読み込み完了時にテキスト文字列を resolve に渡す
         * 実装理由: FileReader の非同期完了を Promise に変換するため
         * @returns void
         */
        reader.onload = () => resolve((reader.result as string) ?? '');
        reader.onerror = reject;
        reader.readAsText(file);
    });

let filePickerResolve: ((files: File[]) => void) | null = null;
/**
 * 処理名: ファイル入力変更ハンドラ
 * 処理概要: 隠し入力要素の変更イベントを捕捉し resolve コールバックにファイル一覧を渡す
 * 実装理由: ブラウザのファイル選択ダイアログを Promise 尖岡化するため
 */
const onFileInputChange = () => {
    if (filePickerResolve && fileInputRef.value) {
        filePickerResolve(Array.from(fileInputRef.value.files ?? []));
        filePickerResolve = null;
    }
};

/**
 * 処理名: ファイル選択
 * 処理概要: 隠し入力要素を活性化しファイル選択ダイアログを表示する
 * 実装理由: ファイル選択を Promise 尖岡化しイベント橋渡しを回避するため
 * @param accept 指定ファイル種別（例: '.db'）
 * @param multiple 複数選択を許可するか（デフォルト: false）
 * @returns 選択した File 配列の Promise
 */
const pickFiles = (accept: string, multiple = false): Promise<File[]> =>
    new Promise(resolve => {
        const input = fileInputRef.value;
        if (!input) return resolve([]);
        input.accept = accept;
        input.multiple = multiple;
        input.value = '';
        filePickerResolve = resolve;
        input.click();
    });

/**
 * 処理名: BLOB 保存
 * 処理概要: データを Blob に変換し隠しリンク経由でダウンロードする
 * 実装理由: DB エクスポート・クエリ保存・ CSV 保存の共通ダウンロード処理を一元化するため
 * @param filename 保存ファイル名
 * @param data 保存データ
 * @param mime MIME タイプ
 */
const saveBlob = (filename: string, data: unknown, mime: string) => {
    const a = downloadLinkRef.value;
    if (!a) return;
    const blob = new Blob([data as BlobPart], { type: mime });
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
};

/**
 * 処理名: アタッチエイリアス生成
 * 処理概要: ファイル名から重複しないエイリアス文字列を生成する
 * 実装理由: 複数 DB をアタッチする際の名前衝突を防ぐため
 * @param fileName 元にするファイル名
 * @param dbInst 重複チェックに使用する SQLiteManager インスタンス（省略時は現在の db）
 * @returns 重複しないエイリアス文字列
 */
const toAttachAlias = (fileName: string, dbInst?: SQLiteManager): string => {
    const inst = dbInst ?? db;
    const base = fileName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '_').replace(/^([0-9])/, '_$1') || 'attached_db';
    let alias = base;
    let i = 1;
    while (alias === DATASET_DB_ALIAS || inst?.hasAttachedDatabase(alias)) {
        alias = `${base}_${i++}`;
    }
    return alias;
};

// ---- クエリ実行 ----
/** クエリ実行結果 1 件の型定義 */
type QueryResultItem = { success: boolean; results?: Record<string, unknown>[]; columns?: string[]; error?: string; info?: { changes?: number } };

/**
 * 処理名: クエリ結果アイテム処理
 * 処理概要: 1 件のクエリ実行結果を解析し結果タブまたはメッセージに反映する
 * 実装理由: handleRunQuery の Cognitive Complexity を削減するため分離
 * @param result クエリ実行結果オブジェクト
 * @param idx 結果インデックス（0 始まり）
 * @param total 全クエリ数
 * @param executionId 実行シリアル ID
 * @param messages メッセージ収集配列
 * @returns 結果セットが存在する場合 true
 */
const processResultItem = (result: QueryResultItem, idx: number, total: number, executionId: number, messages: string[]): boolean => {
    if (result.success && result.results?.length) {
        const tableId = `results-table-${executionId}-${idx + 1}`;
        const label = total === 1 ? 'Results' : `Results${idx + 1}`;
        mainAreaRef.value?.addResultTab(label, tableId);
        mainAreaRef.value?.setResultGridData(tableId, result as { columns: string[]; results: Record<string, unknown>[] });
        messages.push(`クエリ${idx + 1}: ${result.results.length} 行の結果`);
        return true;
    }
    if (result.success) {
        const msg = `クエリ${idx + 1}を実行しました: ${result.info?.changes ?? 0} 行に影響`;
        showSuccess(msg);
        messages.push(msg);
        return false;
    }
    const err = `クエリ${idx + 1}エラー: ${result.error}`;
    showError(err);
    messages.push(err);
    return false;
};

/**
 * 処理名: クエリ実行ハンドラ
 * 処理概要: エディタのアクティブなクエリを実行し結果タブに表示する
 * 実装理由: ユーザーの SQL 実行リクエストに対応するため
 * @param queryModifier クエリ変換関数（例: EXPLAIN QUERY PLAN を追加）
 * @param errorMsg エラーメッセージのカスタマイズ文字列
 * @returns Promise<void>
 */
const executeQueryHandler = async (queryModifier?: (q: string) => string, errorMsg?: string) => {
    let dbInst: SQLiteManager;
    try { dbInst = await getDb(); } catch { showError('データベースが初期化されていません'); return; }
    const query = mainAreaRef.value?.getActiveQuery()?.trim();
    if (!query) { showError('実行するクエリを入力してください'); return; }

    queryExecutionSerial += 1;
    const executionId = queryExecutionSerial;
    mainAreaRef.value?.clearResultTabs();
    await nextTick();

    try {
        const execQuery = queryModifier ? queryModifier(query) : query;
        const results = dbInst.executeQuery(execQuery) as QueryResultItem[];
        const messages: string[] = [];
        let anyResult = false;

        for (let idx = 0; idx < results.length; idx++) {
            if (processResultItem(results[idx], idx, results.length, executionId, messages)) {
                anyResult = true;
            }
        }

        mainAreaRef.value?.setMessages(messages);
        if (!anyResult) {
            mainAreaRef.value?.switchResultTab('messages-tab');
        }
    } catch (error) {
        const msg = errorMsg ? `${errorMsg}: ${(error as Error).message}` : `クエリ実行中にエラーが発生しました: ${(error as Error).message}`;
        showError(msg);
        mainAreaRef.value?.setMessages(msg);
    }
};

/**
 * 処理名: クエリ実行計画表示ハンドラ
 * 処理概要: エディタのアクティブなクエリの実行計画を取得し結果タブに表示する
 * 実装理由: ユーザーの SQL 実行計画確認リクエストに対応するため
 */
const handleRunQuery = async () => {
    await executeQueryHandler();
};

/**
 * 処理名: クエリ実行計画表示ハンドラ
 * 処理概要: エディタのアクティブなクエリの実行計画を取得し結果タブに表示する
 * 実装理由: ユーザーの SQL 実行計画確認リクエストに対応するため
 */
const handleShowQueryPlan = async () => {
    await executeQueryHandler(q => `EXPLAIN QUERY PLAN\n${q}`, '実行計画取得中にエラーが発生しました');
};

// ---- DB操作 ----
/**
 * 処理名: 新規 DB 作成ハンドラ
 * 処理概要: サンプルデータ入りの新規インメモリ DB を作成する
 * 実装理由: メニューの「New DB」操作に対応するため
 */
const handleNewDb = async () => {
    try {
        const dbInst = await getDb();
        await dbInst.import(null);
        ensureDatasetDatabase(dbInst);
        dbInst.executeQuery(`CREATE TABLE IF NOT EXISTS test (col1 INTEGER PRIMARY KEY, col2 TEXT)`);
        dbInst.executeQuery(`INSERT OR IGNORE INTO test VALUES (1, '111')`);
        dbInst.executeQuery(`INSERT OR IGNORE INTO test VALUES (2, '222')`);
        setDbStatus('new_database.db');
        mainHidden = false;
        showSuccess(`新しいデータベース 'new_database.db' を作成しました`);
        refreshTrees();
    } catch (e) {
        showError(`データベース作成エラー: ${(e as Error).message}`);
    }
};

/**
 * 処理名: DB ファイルアタッチ
 * 処理概要: 1 つの DB ファイルを読み込みエイリアスを付けてアタッチする
 * 実装理由: handleOpenDb と handleDbTreeDrop の共通処理を分離するため
 * @param dbInst SQLiteManager インスタンス
 * @param file アタッチする DB ファイル
 */
const attachFileToDb = async (dbInst: SQLiteManager, file: File): Promise<void> => {
    const data = new Uint8Array(await readFileAsArrayBuffer(file));
    const alias = toAttachAlias(file.name, dbInst);
    try {
        dbInst.attachDatabase(alias, data);
        showSuccess(`'${file.name}' をエイリアス '${alias}' でアタッチしました`);
    } catch (e) {
        showError(`'${file.name}' のアタッチ失敗: ${(e as Error).message}`);
    }
};

/**
 * 処理名: 複数 DB ファイルのアタッチ
 * 処理概要: 指定インデックス以降のファイルをすべて DB にアタッチする
 * 実装理由: handleOpenDb と handleDbTreeDrop で共通利用するため分離
 * @param dbInst SQLiteManager インスタンス
 * @param files アタッチするファイル配列
 * @param startIdx 開始インデックス（省略時 0）
 */
const attachAdditionalFiles = async (dbInst: SQLiteManager, files: File[], startIdx = 0): Promise<void> => {
    for (let i = startIdx; i < files.length; i++) {
        await attachFileToDb(dbInst, files[i]);
    }
};

/**
 * 処理名: DBファイル抽出
 * 処理概要: 指定ファイル配列からサポート対象の DB ファイルのみを抽出する
 * 実装理由: Open と D&D の受け入れ条件を同一に保つため
 * @param files 判定対象のファイル配列
 * @returns サポート対象の DB ファイル配列
 */
const filterDbFiles = (files: File[]): File[] => files.filter(file => DB_FILE_NAME_PATTERN.test(file.name));

/**
 * 処理名: DBファイル一括オープン
 * 処理概要: ファイル配列を Open 操作と同一ルールでメイン読込またはアタッチする
 * 実装理由: ファイル選択と D&D で同一挙動を保証するため
 * @param files 開く対象の DB ファイル配列
 */
const openDbFiles = async (files: File[]): Promise<void> => {
    const dbFiles = filterDbFiles(files);
    if (!dbFiles.length) return;

    const dbInst = await getDb();
    const hasExisting = currentDbPath !== 'Untitled.db' || mainHidden;
    if (hasExisting) {
        await attachAdditionalFiles(dbInst, dbFiles, 0);
    } else {
        const first = dbFiles[0];
        const data = new Uint8Array(await readFileAsArrayBuffer(first));
        await dbInst.import(data);
        ensureDatasetDatabase(dbInst);
        mainHidden = false;
        setDbStatus(first.name);
        showSuccess(`データベース '${first.name}' を開きました`);
        await attachAdditionalFiles(dbInst, dbFiles, 1);
    }
    refreshTrees();
};

/**
 * 処理名: DB ファイルを開く
 * 処理概要: ファイル選択ダイアログで選択した DB ファイルを開くかアタッチする
 * 実装理由: 既存 DB がある場合はアタッチ、ない場合はメインとして開く 2 つのモードに対応
 */
const handleOpenDb = async () => {
    try {
        const files = await pickFiles(DB_FILE_ACCEPT, true);
        if (!files.length) return;
        await openDbFiles(files);
    } catch (e) {
        showError(`インポートエラー: ${(e as Error).message}`);
    }
};

/**
 * 処理名: DB 保存ハンドラ
 * 処理概要: 現在の DB をバイナリエクスポートしダウンロードする
 * 実装理由: メニューの「Save DB」操作に対応するため
 */
const handleSaveDb = async () => {
    try {
        const dbInst = await getDb();
        const data = await dbInst.export();
        saveBlob('exported.db', data, 'application/sqlite.db');
        showSuccess('データベースをエクスポートしました');
    } catch (e) {
        showError(`エクスポートエラー: ${(e as Error).message}`);
    }
};

// ---- クエリファイル操作 ----
/**
 * 処理名: 新規クエリタブハンドラ
 * 処理概要: 新規クエリタブを MainArea に追加する
 * 実装理由: メニューの「New Query」操作に対応するため
 */
const handleNewQuery = () => {
    mainAreaRef.value?.addQueryTab('Query');
};

/**
 * 処理名: SQL フォーマットハンドラ
 * 処理概要: MainArea 側のフォーマット処理を呼び出す
 * 実装理由: メニューの「Format」操作に対応するため
 */
const handleFormatQuery = () => {
    mainAreaRef.value?.formatQuery?.();
};

/**
 * 処理名: SQL ファイルを開くハンドラ
 * 処理概要: .sql ファイルを読み込んでエディタに設定する
 * 実装理由: メニューの「Open Query」操作に対応するため
 */
const handleOpenQuery = async () => {
    try {
        const files = await pickFiles('.sql');
        if (!files.length) return;
        const text = await readFileAsText(files[0]);
        mainAreaRef.value?.setActiveQuery(text);
        showSuccess(`SQLファイル '${files[0].name}' を読み込みました`);
    } catch (e) {
        showError(`SQLファイル読み込みエラー: ${(e as Error).message}`);
    }
};

/**
 * 処理名: クエリエディタへの SQL D&D ハンドラ
 * 処理概要: ドロップされた .sql ファイルを読み込んでエディタに設定する
 * 実装理由: open-query-button と同等の操作を D&D で実現するため
 * @param files ドロップされた .sql ファイル配列
 */
const handleQueryEditorDrop = async (files: File[]): Promise<void> => {
    if (!files.length) return;
    try {
        const text = await readFileAsText(files[0]);
        mainAreaRef.value?.setActiveQuery(text);
        showSuccess(`SQLファイル '${files[0].name}' を読み込みました`);
    } catch (e) {
        showError(`SQLファイル読み込みエラー: ${(e as Error).message}`);
    }
};

/**
 * 処理名: クエリ保存ハンドラ
 * 処理概要: 現在のクエリを .sql ファイルとしてダウンロードする
 * 実装理由: メニューの「Save Query」操作に対応するため
 */
const handleSaveQuery = () => {
    const query = mainAreaRef.value?.getActiveQuery() ?? '';
    if (!query.trim()) { showError('保存するSQLクエリがありません'); return; }
    saveBlob('query.sql', query, 'application/sql');
    showSuccess('クエリを query.sql として保存しました');
};

// ---- Sidebar イベント ----
/**
 * 処理名: DB ツリーリフレッシュハンドラ
 * 処理概要: サイドバーの DB ツリーとデータセットツリーを再描画する
 * 実装理由: リフレッシュボタン操作に対応するため
 */
const handleRefreshDb = () => {
    refreshTrees();
};

/**
 * 処理名: DB デタッチハンドラ
 * 処理概要: 指定エイリアスの DB をデタッチする（main の場合は陰蔽）
 * 実装理由: サイドバーのデタッチボタン操作に対応するため
 * @param alias デタッチする DB エイリアス
 */
const handleDetachDb = async (alias: string) => {
    try {
        const dbInst = await getDb();
        if (alias === 'main') {
            void dbInst;
            mainHidden = true;
            setDbStatus('Untitled.db');
            showSuccess('メインデータベースを閉じました');
        } else {
            dbInst.detachDatabase(alias);
            showSuccess(`'${alias}' をデタッチしました`);
        }
        refreshTrees();
    } catch (e) {
        showError(`デタッチ失敗: ${(e as Error).message}`);
    }
};

/**
 * 処理名: CSV データセット追加ハンドラ
 * 処理概要: CSV ファイルを選択し dataset DB にインポートする
 * 実装理由: サイドバーの「データセット追加」ボタン操作に対応するため
 */
/**
 * 処理名: CSVデータセット登録
 * 処理概要: 指定CSVファイルを dataset DB に取り込みサイドバー表示を更新する
 * 実装理由: ボタン選択と D&D で同一処理を共有するため
 * @param file 取り込む CSV ファイル
 */
const importDatasetCsv = async (file: File): Promise<void> => {
    let dbInst: SQLiteManager;
    try { dbInst = await getDb(); } catch { return; }
    try {
        const tableName = await importCsvFileAsDataset(dbInst, file);
        showSuccess(`データセット「${tableName}」を登録しました`);
        sidebarRef.value?.updateDatasetTree(getDatasetTreeTables(dbInst));
    } catch (e) {
        showError((e instanceof Error ? e.message : String(e)) || 'CSVの読み込みに失敗しました');
    }
};

/**
 * 処理名: CSV データセット追加ハンドラ
 * 処理概要: CSV ファイルを選択し dataset DB にインポートする
 * 実装理由: サイドバーの「データセット追加」ボタン操作に対応するため
 */
const handleAddDataset = async () => {
    const [file] = await pickFiles('.csv,text/csv');
    if (!file) return;
    await importDatasetCsv(file);
};

/**
 * 処理名: データセット削除ハンドラ
 * 処理概要: 指定名のデータセットテーブルを dataset DB から削除する
 * 実装理由: サイドバーのデータセット削除ボタン操作に対応するため
 * @param name 削除するデータセット名
 */
const handleDeleteDataset = async (name: string) => {
    try {
        const dbInst = await getDb();
        deleteDatasetTable(dbInst, name);
        showSuccess(`データセット「${name}」を削除しました`);
        sidebarRef.value?.updateDatasetTree(getDatasetTreeTables(dbInst));
    } catch (e) {
        showError(`データセット削除失敗: ${(e as Error).message}`);
    }
};

/**
 * 処理名: DBツリードロップハンドラ
 * 処理概要: DBツリーにドラッグアンドドロップされたファイルを開く
 * 実装理由: DBツリーへのドラッグ操作に対応するため
 * @param dropped ドロップされたファイル配列
 */
const handleDbTreeDrop = async (dropped: File[]) => {
    try {
        await openDbFiles(dropped);
    } catch (err) {
        showError(`インポートエラー: ${(err as Error).message}`);
    }
};

/**
 * 処理名: データセットツリードロップハンドラ
 * 処理概要: データセットツリーへドロップされたCSVを add-dataset と同一仕様で取り込む
 * 実装理由: データセット登録を D&D でも実行可能にするため
 * @param dropped ドロップされた CSV ファイル配列
 */
const handleDatasetTreeDrop = async (dropped: File[]) => {
    const [file] = dropped;
    if (!file) return;
    await importDatasetCsv(file);
};

/**
 * 処理名: クエリ追記ハンドラ
 * 処理概要: サイドバーから渡された SQL をエディタ末尾に追記する
 * 実装理由: ツリー項目のコンテキストメニュー操作で SQL を追記するため
 * @param query 追記する SQL 文字列
 */
const handleAppendQuery = (query: string) => {
    mainAreaRef.value?.appendActiveQuery(query);
};

/**
 * 処理名: CREATE文挿入ハンドラ
 * 処理概要: サイドバー右クリックメニューで選択された DB オブジェクトの DDL をエディタ末尾へ追記する
 * 実装理由: 既存クエリを保持したまま CREATE 文テンプレートを追加できるようにするため
 * @param payload DDL 表示対象情報
 * @param payload.alias 対象オブジェクトの DB エイリアス
 * @param payload.name 対象オブジェクト名
 * @param payload.objectType 対象オブジェクト種別
 */
const handleShowDdl = async (payload: { alias: string; name: string; objectType: 'table' | 'view' | 'index' | 'trigger' }) => {
    if (!payload?.alias || !payload?.name || !payload?.objectType) {
        showError('CREATE文表示の対象情報が不正です');
        return;
    }
    try {
        const dbInst = await getDb();
        const ddl = dbInst.getSchemaObjectDdl(payload.alias, payload.objectType, payload.name);
        const normalizedDdl = ddl.trim().endsWith(';') ? ddl.trim() : `${ddl.trim()};`;
        mainAreaRef.value?.appendActiveQuery(normalizedDdl);
        showSuccess(`CREATE文を挿入しました: ${payload.alias}.${payload.name}`);
    } catch (e) {
        showError(`CREATE文挿入失敗: ${(e as Error).message}`);
    }
};

/**
 * 処理名: CREATE文一括表示ハンドラ
 * 処理概要: 指定スキーマの全テーブル CREATE 文をエディタ末尾へまとめて追記する
 * 実装理由: Tables コンテキストメニュー「Create文の一括表示」に対応するため
 * @param payload 一括取得対象情報
 * @param payload.alias 対象DBエイリアス
 */
const handleShowBulkDdl = async (payload: { alias: string }) => {
    if (!payload?.alias) {
        showError('一括表示の対象情報が不正です');
        return;
    }
    try {
        const dbInst = await getDb();
        const schema = dbInst.getDatabaseSchema(payload.alias);
        const tableNames = schema.tables ?? [];
        if (tableNames.length === 0) {
            showError(`一括表示対象のテーブルがありません: ${payload.alias}`);
            return;
        }

        const ddls = tableNames.map((tableName) => {
            const ddl = dbInst.getSchemaObjectDdl(payload.alias, 'table', tableName).trim();
            return ddl.endsWith(';') ? ddl : `${ddl};`;
        });

        mainAreaRef.value?.appendActiveQuery(ddls.join('\n\n'));
        showSuccess(`CREATE文を一括表示しました: ${payload.alias} (${tableNames.length} tables)`);
    } catch (e) {
        showError(`CREATE文の一括表示に失敗: ${(e as Error).message}`);
    }
};

/**
 * 処理名: テーブル定義表示ハンドラ
 * 処理概要: Sidebar の「テーブル定義の表示」メニュー項目をクリック時の処理
 * 実装理由: テーブルスキーマを編集可能グリッドで表示するため
 * @param payload テーブル情報
 * @param payload.alias DBエイリアス
 * @param payload.tableName テーブル名
 */
const handleShowTableDefinition = async (payload: { alias: string; tableName: string }) => {
    if (!payload?.alias || !payload?.tableName) {
        showError('テーブル定義表示の対象情報が不正です');
        return;
    }
    try {
        const dbInst = await getDb();
        mainAreaRef.value?.showTableDefinition(payload.alias, payload.tableName, dbInst);
        showSuccess(`テーブル定義: ${payload.alias}.${payload.tableName}`);
    } catch (e) {
        showError(`テーブル定義表示失敗: ${(e as Error).message}`);
    }
};

/**
 * 処理名: テーブルデータ編集ハンドラ
 * 処理概要: Sidebar の「単表編集」メニュー項目をクリック時の処理
 * 実装理由: テーブルデータを編集可能グリッドで表示するため
 * @param payload テーブル情報
 * @param payload.alias DBエイリアス
 * @param payload.tableName テーブル名
 */
const handleEditTableData = async (payload: { alias: string; tableName: string }) => {
    if (!payload?.alias || !payload?.tableName) {
        showError('テーブル編集表示の対象情報が不正です');
        return;
    }
    try {
        const dbInst = await getDb();
        mainAreaRef.value?.editTableData(payload.alias, payload.tableName, dbInst);
        showSuccess(`テーブル編集: ${payload.alias}.${payload.tableName}`);
    } catch (e) {
        showError(`テーブル編集表示失敗: ${(e as Error).message}`);
    }
};

// ---- MainArea イベント ----
/**
 * 処理名: データセット登録ハンドラ
 * 処理概要: アクティブな結果セットをデータセットとして dataset DB に登録する
 * 実装理由: 結果エリアの「Register as Dataset」ボタン操作に対応するため
 */
const handleRegisterDataset = async () => {
    let dbInst: SQLiteManager;
    try { dbInst = await getDb(); } catch { return; }
    const resultData = mainAreaRef.value?.getCurrentResultData();
    if (!resultData) { showError('No active results tab found'); return; }
    const name = prompt('Enter dataset name', 'dataset_' + Date.now());
    if (!name) return;
    try {
        const registered = registerRowsAsDatasetTable(dbInst, name, resultData.columns, resultData.data);
        showSuccess(`Dataset '${registered}' registered`);
        sidebarRef.value?.updateDatasetTree(getDatasetTreeTables(dbInst));
    } catch (e) {
        showError((e instanceof Error ? e.message : String(e)) || 'Failed to register dataset');
    }
};

/**
 * 処理名: CSV ダウンロードハンドラ
 * 処理概要: アクティブな結果データを CSV 形式でダウンロードする
 * 実装理由: 結果エリアの「Download CSV」ボタン操作に対応するため
 */
const handleDownloadCsv = () => {
    const data = mainAreaRef.value?.getCurrentResultData();
    if (!data) { showError('ダウンロードするデータがありません'); return; }
    const { columns, data: rows } = data;
    const csvLines = [
        columns.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','),
        ...rows.map(row => columns.map(col => `"${String(row[col] ?? '').replace(/"/g, '""')}"`).join(',')),
    ];
    saveBlob('results.csv', csvLines.join('\n'), 'text/csv;charset=utf-8;');
};

// ---- splitter ----
useColumnSplitter(splitterEl, () => document.getElementById('sidebar'));

// ---- ブラウザ既定のファイルドロップ遷移を抑止 ----
const MANAGED_DROP_TARGET_SELECTOR = '#db-tree, #dataset-tree, #query-editor';

/**
 * 処理名: 管理対象ドロップエリア判定
 * 処理概要: イベントターゲットがアプリで管理している D&D エリア内かを判定する
 * 実装理由: 管理対象エリアでは個別ハンドラの dropEffect / drop 判定を優先するため
 * @param target イベントターゲット
 * @returns 管理対象エリア内なら true
 */
const isManagedDropTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest(MANAGED_DROP_TARGET_SELECTOR));
};

/**
 * 処理名: ファイルドラッグ判定
 * 処理概要: DragEvent がファイルを含むドラッグかどうかを判定する
 * 実装理由: テキスト/リンク等の通常ドラッグ操作を抑止しないため
 * @param e ドラッグイベント
 * @returns ファイルドラッグであれば true
 */
const isFileDragEvent = (e: DragEvent): boolean => {
    const types = Array.from(e.dataTransfer?.types ?? []);
    return types.includes('Files');
};

/**
 * 処理名: ドキュメント全体のドラッグオーバー抑止
 * 処理概要: D&D 対応エリア以外へのファイルドラッグ時にブラウザ既定のドロップを抑止する
 * 実装理由: ファイルをD&Dした際に意図しないページ遷移が発生しないようにするため
 * @param e ドラッグイベント
 */
const suppressBrowserDragover = (e: DragEvent): void => {
    if (!isFileDragEvent(e)) return;
    if (e.defaultPrevented || isManagedDropTarget(e.target)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
};

/**
 * 処理名: ドキュメント全体のドロップ抑止
 * 処理概要: D&D 対応エリア以外へのファイルドロップ時にブラウザ既定動作を抑止する
 * 実装理由: ファイルをD&Dした際に意図しないページ遷移が発生しないようにするため
 * @param e ドラッグイベント
 */
const suppressBrowserDrop = (e: DragEvent): void => {
    if (!isFileDragEvent(e)) return;
    if (e.defaultPrevented || isManagedDropTarget(e.target)) return;
    e.preventDefault();
};

// ---- DB初期化 ----
onMounted(async () => {
    document.addEventListener('dragover', suppressBrowserDragover);
    document.addEventListener('drop', suppressBrowserDrop);

    // SQLエディタのブリッジAPIをウィンドウに公開（テスト用）- DB初期化前に設定して即時利用可能にする
    window.__sqlEditorBridge = {
        /**
         * アクティブタブの SQL 文字列を返す
         * @returns アクティブタブの SQL 文字列
         */
        getValue: () => mainAreaRef.value?.getActiveQuery() ?? '',
        /**
         * アクティブタブに SQL 文字列をセットする
         * @param v 設定する SQL 文字列
         */
        setValue: (v: string) => { mainAreaRef.value?.setActiveQuery(v); },
        /**
         * コンテキストメニューのフォーマットアクションを実行する
         * @returns Promise<void>
         */
        runFormatMenuAction: async () => {
            await mainAreaRef.value?.runFormatMenuAction?.();
        },
    };
    const dbInitPromise = (window as { __dbInitPromise?: Promise<SQLiteManager> }).__dbInitPromise;
    if (dbInitPromise) {
        dbReady = dbInitPromise;
        db = await dbInitPromise;
        ensureDatasetDatabase(db);
        sidebarRef.value?.updateDatasetTree(getDatasetTreeTables(db));
    }
});

onBeforeUnmount(() => {
    document.removeEventListener('dragover', suppressBrowserDragover);
    document.removeEventListener('drop', suppressBrowserDrop);
});
</script>
