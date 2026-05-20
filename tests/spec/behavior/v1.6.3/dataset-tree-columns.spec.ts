import { test, expect, Page } from '@playwright/test';
import path from 'path';
import fs from 'fs/promises';
import { fillSqlEditor, getSqlEditorValue } from '../../../helpers/monacoEditor';

const TREE_ITEM_TRANSFER_TYPE = 'application/x-sqlite-webclient-tree-item-name';
const csvFixture = path.resolve(__dirname, '../../../fixtures/dataset-upload.csv');

async function dropDatasetCsv(page: Page) {
  const bytes = Array.from(await fs.readFile(csvFixture));
  await page.evaluate((payload) => {
    const datasetTree = document.getElementById('dataset-tree');
    if (!datasetTree) throw new Error('#dataset-tree が見つかりません');

    const dataTransfer = new DataTransfer();
    const file = new File([new Uint8Array(payload.bytes)], payload.name, { type: 'text/csv' });
    dataTransfer.items.add(file);

    datasetTree.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer }));
    datasetTree.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
    datasetTree.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
  }, {
    name: 'dataset-upload.csv',
    bytes,
  });
}

async function ensureDatasetColumnsVisible(page: Page, tableName: string) {
  const firstColumn = page.locator(`#dataset-tree .tree-label.Columns[data-db-alias="dataset"][data-table-name="${tableName}"]`).first();
  if (!await firstColumn.isVisible()) {
    await page.locator(`#dataset-tree .tree-label.dataset[data-name="${tableName}"]`).first().click();
  }
}

async function dispatchTreeItemDropToEditor(page: Page, itemName: string): Promise<void> {
  await page.evaluate(({ name, type }) => {
    const editor = document.getElementById('query-editor');
    if (!editor) throw new Error('#query-editor が見つかりません');
    const dt = new DataTransfer();
    dt.setData(type, name);
    const opts = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 400, clientY: 300 };
    editor.dispatchEvent(new DragEvent('dragenter', opts));
    editor.dispatchEvent(new DragEvent('dragover', opts));
    editor.dispatchEvent(new DragEvent('drop', opts));
  }, { name: itemName, type: TREE_ITEM_TRANSFER_TYPE });
}

test.describe('Datasetツリーのカラム表示と操作 (v1.6.3)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.click('#new-db-button');
    await dropDatasetCsv(page);
    await expect(page.locator('#dataset-tree')).toContainText('dataset-upload');
  });

  test('データセットテーブル配下にカラム一覧が表示される', async ({ page }) => {
    await ensureDatasetColumnsVisible(page, 'dataset-upload');

    await expect(page.locator('#dataset-tree .tree-label.Columns[data-db-alias="dataset"][data-table-name="dataset-upload"][data-column-name="id"]')).toBeVisible();
    await expect(page.locator('#dataset-tree .tree-label.Columns[data-db-alias="dataset"][data-table-name="dataset-upload"][data-column-name="name"]')).toBeVisible();
    await expect(page.locator('#dataset-tree .tree-label.Columns[data-db-alias="dataset"][data-table-name="dataset-upload"][data-column-name="created_at"]')).toBeVisible();
  });

  test('データセットカラムのコンテキストメニューでSQLを追記できる', async ({ page }) => {
    await ensureDatasetColumnsVisible(page, 'dataset-upload');
    await fillSqlEditor(page, 'SELECT 0;');

    await page.locator('#dataset-tree .tree-label.Columns[data-db-alias="dataset"][data-table-name="dataset-upload"][data-column-name="id"]').first().click({ button: 'right' });
    await expect(page.locator('#db-object-show-ddl-menu')).toHaveCount(0);
    await page.click('#db-object-insert-select-menu');

    await page.locator('#dataset-tree .tree-label.Columns[data-db-alias="dataset"][data-table-name="dataset-upload"][data-column-name="id"]').first().click({ button: 'right' });
    await page.click('#db-object-insert-update-menu');

    await page.locator('#dataset-tree .tree-label.Columns[data-db-alias="dataset"][data-table-name="dataset-upload"][data-column-name="id"]').first().click({ button: 'right' });
    await page.click('#db-object-insert-insert-menu');

    await page.locator('#dataset-tree .tree-label.Columns[data-db-alias="dataset"][data-table-name="dataset-upload"][data-column-name="id"]').first().click({ button: 'right' });
    await page.click('#db-object-insert-delete-menu');

    const sql = await getSqlEditorValue(page);
    expect(sql).toContain('SELECT 0;');
    expect(sql).toMatch(/SELECT\s+id\s+FROM\s+dataset\."dataset-upload"\s+LIMIT 100;/i);
    expect(sql).toMatch(/UPDATE\s+dataset\."dataset-upload"\s+SET\s+id\s*=\s*\?\s+WHERE\s*;/i);
    expect(sql).toMatch(/INSERT\s+INTO\s+dataset\."dataset-upload"\s+\(id\)\s+VALUES\s*\(\?\);/i);
    expect(sql).toMatch(/DELETE\s+FROM\s+dataset\."dataset-upload"\s+WHERE\s+id\s*=\s*\?;/i);
  });

  test('データセットカラムをクエリエディタへD&Dするとカラム名が挿入される', async ({ page }) => {
    await ensureDatasetColumnsVisible(page, 'dataset-upload');
    await fillSqlEditor(page, 'SELECT ');

    await dispatchTreeItemDropToEditor(page, 'id');

    const sql = await getSqlEditorValue(page);
    expect(sql).toContain('id');
  });
});
