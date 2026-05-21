import {
  saveQueryTab,
  removeQueryTab,
  restoreQueryTabs,
  applyStorageEvent,
  isQueryTabKey,
} from '../../src/js/queryTabStorage';

// ---- localStorage モック ----
/**
 * テスト用 Storage モックを生成する
 * @returns インメモリ Storage 実装
 */
function createMockStorage(): Storage {
  const store: Record<string, string> = {};
  return {
    get length() { return Object.keys(store).length; },
    key: (index: number) => Object.keys(store)[index] ?? null,
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
  };
}

describe('saveQueryTab', () => {
  it('ラベルをキーとしてクエリを保存する', () => {
    const storage = createMockStorage();
    saveQueryTab(storage, 'Query1', 'SELECT 1;');
    expect(storage.getItem('Query1')).toBe('SELECT 1;');
  });

  it('同一キーで上書き保存できる', () => {
    const storage = createMockStorage();
    saveQueryTab(storage, 'Query1', 'SELECT 1;');
    saveQueryTab(storage, 'Query1', 'SELECT 2;');
    expect(storage.getItem('Query1')).toBe('SELECT 2;');
  });

  it('storage が利用不可でもエラーをスローしない', () => {
    const broken: Storage = {
      length: 0,
      key: () => null,
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceeded'); },
      removeItem: () => { throw new Error('SecurityError'); },
      clear: () => { throw new Error('SecurityError'); },
    };
    expect(() => saveQueryTab(broken, 'Query1', 'SELECT 1;')).not.toThrow();
  });
});

describe('removeQueryTab', () => {
  it('ラベルに対応するキーを削除する', () => {
    const storage = createMockStorage();
    saveQueryTab(storage, 'Query1', 'SELECT 1;');
    removeQueryTab(storage, 'Query1');
    expect(storage.getItem('Query1')).toBeNull();
  });

  it('存在しないキーを削除してもエラーをスローしない', () => {
    const storage = createMockStorage();
    expect(() => removeQueryTab(storage, 'NoSuchKey')).not.toThrow();
  });

  it('storage が利用不可でもエラーをスローしない', () => {
    const broken: Storage = {
      length: 0,
      key: () => null,
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceeded'); },
      removeItem: () => { throw new Error('SecurityError'); },
      clear: () => { throw new Error('SecurityError'); },
    };
    expect(() => removeQueryTab(broken, 'Query1')).not.toThrow();
  });
});

describe('restoreQueryTabs', () => {
  it('storage が空のときは空配列を返す', () => {
    const storage = createMockStorage();
    expect(restoreQueryTabs(storage)).toEqual([]);
  });

  it('保存済みのタブをすべて復元する', () => {
    const storage = createMockStorage();
    saveQueryTab(storage, 'Query1', 'SELECT 1;');
    saveQueryTab(storage, 'Query2', 'SELECT 2;');
    const result = restoreQueryTabs(storage);
    expect(result).toHaveLength(2);
    expect(result).toContainEqual({ label: 'Query1', query: 'SELECT 1;' });
    expect(result).toContainEqual({ label: 'Query2', query: 'SELECT 2;' });
  });

  it('storage が利用不可のときは空配列を返す', () => {
    const broken: Storage = {
      length: 0,
      key: () => { throw new Error('SecurityError'); },
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceeded'); },
      removeItem: () => { throw new Error('SecurityError'); },
      clear: () => { throw new Error('SecurityError'); },
    };
    expect(restoreQueryTabs(broken)).toEqual([]);
  });

  it('key(i) が null を返すエントリはスキップする', () => {
    // length=1 だが key() が null を返す Storage
    const storage: Storage = {
      length: 1,
      key: () => null,
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
    };
    expect(restoreQueryTabs(storage)).toEqual([]);
  });

  it('getItem が null を返すエントリはクエリを空文字として復元する', () => {
    const store: Record<string, string | null> = { Query1: null };
    const storage: Storage = {
      get length() { return 1; },
      key: (i: number) => Object.keys(store)[i] ?? null,
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      clear: () => { Object.keys(store).forEach(k => delete store[k]); },
    };
    const result = restoreQueryTabs(storage);
    expect(result).toEqual([{ label: 'Query1', query: '' }]);
  });

  it('sqlite-webclient プレフィックスのシステムキーを除外する', () => {
    const store: Record<string, string> = {
      'Query1': 'SELECT 1;',
      'sqlite-webclient.dataset-db.v1': 'base64data',
      'Query2': 'SELECT 2;',
    };
    const storage: Storage = {
      get length() { return 3; },
      key: (i: number) => Object.keys(store)[i] ?? null,
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      clear: () => { Object.keys(store).forEach(k => delete store[k]); },
    };
    const result = restoreQueryTabs(storage);
    expect(result).toHaveLength(2);
    expect(result).toContainEqual({ label: 'Query1', query: 'SELECT 1;' });
    expect(result).toContainEqual({ label: 'Query2', query: 'SELECT 2;' });
    expect(result.every(t => !t.label.startsWith('sqlite-webclient.'))).toBe(true);
  });

  it('特殊文字を含むキーを除外する', () => {
    const store: Record<string, string> = {
      'Query1': 'SELECT 1;',
      'my.custom.key': 'data',
      'Query@2': 'data',
      'Query 3': 'data',
    };
    const storage: Storage = {
      get length() { return 4; },
      key: (i: number) => Object.keys(store)[i] ?? null,
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      clear: () => { Object.keys(store).forEach(k => delete store[k]); },
    };
    const result = restoreQueryTabs(storage);
    expect(result).toEqual([{ label: 'Query1', query: 'SELECT 1;' }]);
  });
});

describe('applyStorageEvent', () => {
  it('一致するラベルのタブを newValue で更新する', () => {
    const tabs = [
      { label: 'Query1', query: 'SELECT 1;' },
      { label: 'Query2', query: 'SELECT 2;' },
    ];
    const result = applyStorageEvent('Query1', 'SELECT updated;', tabs);
    expect(result.find(t => t.label === 'Query1')?.query).toBe('SELECT updated;');
    expect(result.find(t => t.label === 'Query2')?.query).toBe('SELECT 2;');
  });

  it('newValue が null のとき対象タブのクエリを空文字にする', () => {
    const tabs = [{ label: 'Query1', query: 'SELECT 1;' }];
    const result = applyStorageEvent('Query1', null, tabs);
    expect(result.find(t => t.label === 'Query1')?.query).toBe('');
  });

  it('一致するラベルがない場合は元の配列をそのまま返す', () => {
    const tabs = [{ label: 'Query1', query: 'SELECT 1;' }];
    const result = applyStorageEvent('Query99', 'anything', tabs);
    expect(result).toEqual(tabs);
  });

  it('元の配列を変更せず新しい配列を返す (immutable)', () => {
    const tabs = [{ label: 'Query1', query: 'OLD' }];
    const result = applyStorageEvent('Query1', 'NEW', tabs);
    expect(tabs[0].query).toBe('OLD'); // 元は不変
    expect(result[0].query).toBe('NEW');
  });
});

describe('isQueryTabKey', () => {
  it('通常のクエリタブキー（英数字）を許可する', () => {
    expect(isQueryTabKey('Query1')).toBe(true);
    expect(isQueryTabKey('query')).toBe(true);
    expect(isQueryTabKey('Query_1')).toBe(true);
    expect(isQueryTabKey('query-2')).toBe(true);
  });

  it('sqlite-webclient プレフィックスのキーを除外する', () => {
    expect(isQueryTabKey('sqlite-webclient.dataset-db.v1')).toBe(false);
    expect(isQueryTabKey('sqlite-webclient.anything')).toBe(false);
  });

  it('ドットを含むキーを除外する', () => {
    expect(isQueryTabKey('my.custom.key')).toBe(false);
    expect(isQueryTabKey('Query.1')).toBe(false);
  });

  it('特殊文字を含むキーを除外する', () => {
    expect(isQueryTabKey('Query@1')).toBe(false);
    expect(isQueryTabKey('Query/1')).toBe(false);
    expect(isQueryTabKey('Query 1')).toBe(false);
  });
});
