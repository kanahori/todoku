'use strict';
// 主の処理から画面に返す文のうち、OS で変わるもの。

// 出典のページを外のブラウザで開いたときの知らせ。Todoku へ戻るキーを添える（Mac は Command キー、ほかは Alt キー）。
// what は開いたものの名前（既定は「出典のページ」。YouTube の利用規約などは「ページ」）。
function sourceOpenedMessage(platform = process.platform, what = '出典のページ') {
  const key = platform === 'darwin' ? 'Command' : 'Alt';
  return `${what}を、既定のブラウザで開きました。Todoku に戻るには ${key} キーと Tab キーを押してください。`;
}

module.exports = { sourceOpenedMessage };
