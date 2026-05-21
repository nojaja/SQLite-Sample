import { test, expect, Page } from '@playwright/test';
import { fillSqlEditor, getSqlEditorValue } from '../../../helpers/monacoEditor';

const TREE_ITEM_TRANSFER_TYPE = 'application/x-sqlite-webclient-tree-item-name';

/**
 * 新規DBを作成して Results タブに結果を表示する
 */
async function openResultsWithSampleQuery(page: Page): Promise<void> {
  await page.goto('/');
  await page.click('#new-db-button');
  await fillSqlEditor(page, 'SELECT col1, col2 FROM test LIMIT 1;');
  await page.click('#run-button');

  await expect(page.locator('#results-grid .tabulator-col[tabulator-field="col1"]').first()).toBeVisible();
}

/**
 * Results のカラムヘッダをクエリエディタへ D&D する
 * dragstart ハンドラが DataTransfer へデータを積むことを前提に、
 * テスト側では setData を行わない。
 */
async function dragResultsColumnToEditor(page: Page, columnName: string) {
  return page.evaluate(({ targetColumn, transferType }) => {
    const editor = document.getElementById('query-editor');
    if (!editor) throw new Error('#query-editor が見つかりません');

    const allHeaders = Array.from(document.querySelectorAll('#results-grid .tabulator-col'));
    const source = allHeaders.find((el) => {
      const field = (el as HTMLElement).getAttribute('tabulator-field') ?? '';
      if (field === targetColumn) return true;
      const title = (el.querySelector('.tabulator-col-title') as HTMLElement | null)?.innerText?.trim() ?? '';
      return title === targetColumn;
    }) as HTMLElement | undefined;

    if (!source) throw new Error(`Results カラム '${targetColumn}' が見つかりません`);

    const dataTransfer = new DataTransfer();
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));

    const dragTypes = Array.from(dataTransfer.types);
    const customTypeValue = dataTransfer.getData(transferType);
    const plainTextValue = dataTransfer.getData('text/plain');

    const eventOptions = {
      bubbles: true,
      cancelable: true,
      dataTransfer,
      clientX: 420,
      clientY: 280,
    };

    editor.dispatchEvent(new DragEvent('dragenter', eventOptions));
    editor.dispatchEvent(new DragEvent('dragover', eventOptions));
    editor.dispatchEvent(new DragEvent('drop', eventOptions));
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer }));

    return {
      isDraggable: source.draggable,
      dragTypes,
      customTypeValue,
      plainTextValue,
    };
  }, { targetColumn: columnName, transferType: TREE_ITEM_TRANSFER_TYPE });
}

test.describe('Results カラム名 D&D (v1.6.5)', () => {
  test.beforeEach(async ({ page }) => {
    await openResultsWithSampleQuery(page);
  });

  test('AC-1: Results のカラムヘッダは draggable で dragstart 時にカラム名を転送する', async ({ page }) => {
    const dragInfo = await dragResultsColumnToEditor(page, 'col1');

    expect(dragInfo.isDraggable).toBe(true);
    expect(dragInfo.dragTypes).toContain(TREE_ITEM_TRANSFER_TYPE);
    expect(dragInfo.customTypeValue).toBe('col1');
  });

  test('AC-2: Results のカラムヘッダをクエリエディタへ D&D するとカラム名が挿入される', async ({ page }) => {
    await fillSqlEditor(page, 'SELECT ');

    const dragInfo = await dragResultsColumnToEditor(page, 'col2');
    expect(dragInfo.customTypeValue || dragInfo.plainTextValue).toBe('col2');

    const sql = await getSqlEditorValue(page);
    expect(sql).toContain('col2');
  });
});
