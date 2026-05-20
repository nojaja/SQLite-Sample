import { expect, test } from '@playwright/test';
import { fillSqlEditor, getSqlEditorValue } from './helpers/monacoEditor';

test.describe('SQL フォーマット機能', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('Format ボタンで SQL を整形する', async ({ page }) => {
    const inputSql = 'SELECT ID, LEVEL, PARENT, NAME, TYPE, ORIGINAL_ID, DESCRIPTION, FUNCTION, BRIEF_DESCRIPTION, DOMAIN, CATEGORY, MATURITY_LEVEL, FRAMEWORX_STATUS FROM ETOM LIMIT 100;';
    const expected = `SELECT
  ID,
  LEVEL,
  PARENT,
  NAME,
  TYPE,
  ORIGINAL_ID,
  DESCRIPTION,
  FUNCTION,
  BRIEF_DESCRIPTION,
  DOMAIN,
  CATEGORY,
  MATURITY_LEVEL,
  FRAMEWORX_STATUS
FROM
  ETOM
LIMIT
  100;`;

    await fillSqlEditor(page, inputSql);
    await page.locator('#format-query-button').click({ noWaitAfter: true });

    await expect.poll(async () => getSqlEditorValue(page)).toBe(expected);
  });

  test('コンテキストメニューからドキュメントをフォーマットする', async ({ page }) => {
    const inputSql = 'SELECT ID, LEVEL, PARENT, NAME, TYPE, ORIGINAL_ID, DESCRIPTION, FUNCTION, BRIEF_DESCRIPTION, DOMAIN, CATEGORY, MATURITY_LEVEL, FRAMEWORX_STATUS FROM ETOM LIMIT 100;';
    await fillSqlEditor(page, inputSql);

    // 「ドキュメントのフォーマット」と同一 action id を直接実行して検証する
    await page.evaluate(async () => {
      await (window as any).__sqlEditorBridge.runFormatMenuAction();
    });

    await expect.poll(async () => getSqlEditorValue(page)).not.toBe(inputSql);
    await expect.poll(async () => getSqlEditorValue(page)).toContain('\n');
  });

  test('複雑な SQL でも整形できる', async ({ page }) => {
    const inputSql = 'CREATE TABLE End_to_End_Business_Flows (ID INTEGER PRIMARY KEY, LEVEL INTEGER NOT NULL, PARENT TEXT, NAME TEXT NOT NULL, TYPE TEXT, DESCRIPTION TEXT, DOMAIN TEXT, CATEGORY TEXT, MATURITY_LEVEL TEXT);';
    await fillSqlEditor(page, inputSql);

    await page.locator('#format-query-button').click({ noWaitAfter: true });

    await expect.poll(async () => getSqlEditorValue(page)).toContain('CREATE TABLE');
    await expect.poll(async () => getSqlEditorValue(page)).toContain('PRIMARY KEY');
    await expect.poll(async () => getSqlEditorValue(page)).toContain('\n');
  });

  test('== 演算子が保持されてフォーマットできる', async ({ page }) => {
    const inputSql = 'SELECT * FROM table WHERE id == 1;';
    await fillSqlEditor(page, inputSql);

    await page.locator('#format-query-button').click({ noWaitAfter: true });

    // == が = = に分割されないことを確認
    const result = await getSqlEditorValue(page);
    expect(result).toContain('id == 1');
    expect(result).not.toContain('= =');
  });

  test('複数の == 演算子が保持されてフォーマットできる', async ({ page }) => {
    const inputSql = 'SELECT a, b FROM table WHERE a == 1 AND b == 2;';
    await fillSqlEditor(page, inputSql);

    await page.locator('#format-query-button').click({ noWaitAfter: true });

    const result = await getSqlEditorValue(page);
    expect(result).toContain('a == 1');
    expect(result).toContain('b == 2');
    expect(result).not.toContain('= =');
  });
});
