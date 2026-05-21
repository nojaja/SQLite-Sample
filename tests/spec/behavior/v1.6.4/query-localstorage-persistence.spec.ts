import { test, expect, Page } from '@playwright/test';
import { fillSqlEditor, getSqlEditorValue } from '../../../helpers/monacoEditor';

/** localStorage から指定キーの値を取得する */
async function getLocalStorageItem(page: Page, key: string): Promise<string | null> {
  return page.evaluate((k: string) => window.localStorage.getItem(k), key);
}

/** localStorage の全キーを取得する */
async function getLocalStorageKeys(page: Page): Promise<string[]> {
  return page.evaluate(() => Object.keys(window.localStorage));
}

/** アクティブなクエリタブのラベルを取得する */
async function getActiveQueryTabLabel(page: Page): Promise<string> {
  return page.locator('#query-tabs .query-tab.active').innerText().then(t => t.replace('×', '').trim());
}

/** 指定ラベルのクエリタブのラベルテキスト一覧を取得する */
async function getQueryTabLabels(page: Page): Promise<string[]> {
  const tabs = page.locator('#query-tabs .query-tab');
  const count = await tabs.count();
  const labels: string[] = [];
  for (let i = 0; i < count; i++) {
    const text = await tabs.nth(i).innerText();
    labels.push(text.replace('×', '').trim());
  }
  return labels;
}

/** 別ページで New DB を開く */
async function openApp(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.click('#new-db-button');
}

test.describe('クエリタブ localStorage 永続化 (v1.6.4)', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
  });

  // ケース5: localStorage が空の初期状態
  test('localStorage が空のとき Query1 タブが空クエリで表示される', async ({ page }) => {
    const label = await getActiveQueryTabLabel(page);
    expect(label).toBe('Query1');

    const sql = await getSqlEditorValue(page);
    expect(sql).toBe('');

    const keys = await getLocalStorageKeys(page);
    const queryKeys = keys.filter(k => k.startsWith('Query'));
    expect(queryKeys).toHaveLength(0);
  });

  // ケース1: エディタに SQL を入力すると localStorage に保存される
  test('エディタへの入力が localStorage に保存される (AC-1)', async ({ page }) => {
    const label = await getActiveQueryTabLabel(page);

    await fillSqlEditor(page, 'SELECT 1;');

    const stored = await getLocalStorageItem(page, label);
    expect(stored).toBe('SELECT 1;');
  });

  // ケース2: リロード後にタブとクエリ内容が復元される
  test('ページリロード後に保存済みタブが復元される (AC-2)', async ({ page }) => {
    const label = await getActiveQueryTabLabel(page);
    await fillSqlEditor(page, 'SELECT 42;');

    await page.reload();

    await expect(page.locator('#query-tabs .query-tab')).toContainText(label);

    const activeLabel = await getActiveQueryTabLabel(page);
    expect(activeLabel).toBe(label);

    const sql = await getSqlEditorValue(page);
    expect(sql).toBe('SELECT 42;');
  });

  // ケース3: 複数タブの復元
  test('複数タブの内容がリロード後にすべて復元される (AC-3)', async ({ page }) => {
    // Query1 に SQL を入力
    await fillSqlEditor(page, 'SELECT 1;');

    // 新しいタブを追加してSQLを入力
    await page.click('#new-query-tab-button');
    await fillSqlEditor(page, 'SELECT 2;');
    const secondLabel = await getActiveQueryTabLabel(page);

    await page.reload();

    const tabLabels = await getQueryTabLabels(page);
    expect(tabLabels).toContain('Query1');
    expect(tabLabels).toContain(secondLabel);

    // Query1 のクエリ内容を確認
    await page.locator(`#query-tabs .query-tab`, { hasText: 'Query1' }).click();
    const sql1 = await getSqlEditorValue(page);
    expect(sql1).toBe('SELECT 1;');

    // 2つ目のタブのクエリ内容を確認
    await page.locator(`#query-tabs .query-tab`, { hasText: secondLabel }).click();
    const sql2 = await getSqlEditorValue(page);
    expect(sql2).toBe('SELECT 2;');
  });

  // ケース4: タブ×ボタン押下で localStorage キーが削除される
  test('タブ×を押すと localStorage からキーが削除される (AC-4)', async ({ page }) => {
    const label = await getActiveQueryTabLabel(page);
    await fillSqlEditor(page, 'SELECT 99;');

    // × を押下
    await page.locator('#query-tabs .query-tab.active .close-tab').click();

    const stored = await getLocalStorageItem(page, label);
    expect(stored).toBeNull();
  });

  // ケース6: 別ウィンドウからの storage イベントでエディタ内容が更新される (AC-7)
  test('別ウィンドウからの storage 変更がアクティブタブのエディタに反映される (AC-7)', async ({ page }) => {
    const label = await getActiveQueryTabLabel(page);
    await fillSqlEditor(page, 'SELECT 1;');

    // 別ウィンドウによる書き換えを模擬（storage イベントを手動発火）
    await page.evaluate(({ key, value }) => {
      window.dispatchEvent(new StorageEvent('storage', {
        key,
        newValue: value,
        oldValue: 'SELECT 1;',
        storageArea: window.localStorage,
      }));
    }, { key: label, value: 'SELECT updated;' });

    const sql = await getSqlEditorValue(page);
    expect(sql).toBe('SELECT updated;');
  });

  // ケース7: 別ウィンドウから storage キーが削除されるとタブ内容が空になる (AC-8)
  test('別ウィンドウから storage キーが削除されるとタブ内容が空になる (AC-8)', async ({ page }) => {
    const label = await getActiveQueryTabLabel(page);
    await fillSqlEditor(page, 'SELECT 1;');

    // 別ウィンドウによるキー削除を模擬
    await page.evaluate(({ key }) => {
      window.dispatchEvent(new StorageEvent('storage', {
        key,
        newValue: null,
        oldValue: 'SELECT 1;',
        storageArea: window.localStorage,
      }));
    }, { key: label });

    const sql = await getSqlEditorValue(page);
    expect(sql).toBe('');

    // タブ自体は閉じられていないことを確認
    const labels = await getQueryTabLabels(page);
    expect(labels).toContain(label);
  });

  test('2画面で空文字更新後に再入力しても相互反映が継続し、画面が停止しない', async ({ page }) => {
    const secondPage = await page.context().newPage();
    await openApp(secondPage);

    await fillSqlEditor(page, 'SELECT 1;');
    await expect.poll(async () => getSqlEditorValue(secondPage)).toBe('SELECT 1;');

    await fillSqlEditor(secondPage, '');
    await expect.poll(async () => getSqlEditorValue(page)).toBe('');

    await fillSqlEditor(secondPage, 'SELECT 2;');
    await expect.poll(async () => getSqlEditorValue(page)).toBe('SELECT 2;');

    await page.locator('#query-tabs .query-tab', { hasText: 'Query1' }).click();
    await expect(page.locator('#query-tabs .query-tab.active')).toContainText('Query1');

    await secondPage.close();
  });

  test('DevTools 相当の localStorage 直接変更でも両画面の Query1 が同期される', async ({ page }) => {
    const secondPage = await page.context().newPage();
    await openApp(secondPage);

    await secondPage.evaluate(() => {
      window.localStorage.setItem('Query1', 'SELECT devtools;');
    });
    await expect.poll(async () => getSqlEditorValue(page)).toBe('SELECT devtools;');
    await expect.poll(async () => getSqlEditorValue(secondPage)).toBe('SELECT devtools;');

    await secondPage.evaluate(() => {
      window.localStorage.setItem('Query1', '');
    });
    await expect.poll(async () => getSqlEditorValue(page)).toBe('');
    await expect.poll(async () => getSqlEditorValue(secondPage)).toBe('');

    await secondPage.close();
  });
});

test.describe('DevTools 由来の localStorage 直接変更', () => {
  test('同一ページで localStorage の Query1 を直接変更するとエディタ内容が追従する', async ({ page }) => {
    test.setTimeout(5000);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#query-tabs .query-tab.active')).toContainText('Query1');

    await page.evaluate(() => {
      window.localStorage.setItem('Query1', 'SELECT devtools direct;');
    });

    await expect.poll(async () => getSqlEditorValue(page), { timeout: 4000 }).toBe('SELECT devtools direct;');
  });
});
