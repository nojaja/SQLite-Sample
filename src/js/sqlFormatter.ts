import * as monaco from 'monaco-editor';
import { format } from 'sql-formatter';

/**
 * 処理名: SQL 文整形
 * 処理概要: sql-formatter ライブラリを使用して SQL テキストを整形する
 * 実装理由: 確立されたフォーマッターを使用することで、安定した高品質なフォーマットを実現するため
 * @param text 整形対象テキスト
 * @param eol 改行コード
 * @returns 整形済み SQL
 */
export const formatSqlText = (text: string, eol = '\n'): string => {
  try {
    const formatted = format(text, {
      language: 'sqlite',
      tabWidth: 2,
      useTabs: false,
      keywordCase: 'upper',
    });
    return formatted.replace(/\r\n/g, eol).replace(/\n/g, eol);
  } catch {
    return text;
  }
};

let formattingProviderRegistered = false;

/**
 * 処理名: SQL 整形プロバイダ登録
 * 処理概要: Monaco の sql 言語に document formatting provider を登録する
 * 実装理由: editor.action.formatDocument から SQL 整形を実行可能にするため
 * @returns Disposable インスタンスまたは undefined
 */
export const registerSqlFormattingProvider = (): monaco.IDisposable | undefined => {
  if (formattingProviderRegistered) return undefined;
  formattingProviderRegistered = true;

  return monaco.languages.registerDocumentFormattingEditProvider('sql', {
    /* eslint-disable-next-line jsdoc/require-jsdoc */
    provideDocumentFormattingEdits(model) {
      const formatted = formatSqlText(model.getValue(), model.getEOL());
      if (formatted === model.getValue()) return [];
      return [
        {
          range: model.getFullModelRange(),
          text: formatted,
        },
      ];
    },
  });
};
