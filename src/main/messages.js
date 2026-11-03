'use strict';
// 主の処理から画面に返す文のうち、OS で変わるもの。

// 出典のページを外のブラウザで開いたときの知らせ。Todoku へ戻るキーを添える（Mac は Command キー、ほかは Alt キー）。
function sourceOpenedMessage(platform = process.platform) {
  const key = platform === 'darwin' ? 'Command' : 'Alt';
  return `出典のページを、既定のブラウザで開きました。Todoku に戻るには ${key} キーと Tab キーを押してください。`;
}

module.exports = { sourceOpenedMessage };
