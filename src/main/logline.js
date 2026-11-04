'use strict';
// 記録の一行（端末と userData の log.txt）の時刻。その機械の時刻で、UTC との差を付けて書く（例: 2026-11-04T09:30:05.123+09:00）。
// UTC（末尾 Z）で書くと、読む人が頭で時差を足すことになり、Windows の確かめで読み違えやすかった（2026-11-04）。

function localStamp(date = new Date()) {
  const p = (n, w = 2) => String(Math.abs(n)).padStart(w, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`
    + `.${p(date.getMilliseconds(), 3)}${sign}${p(Math.floor(Math.abs(offset) / 60))}:${p(Math.abs(offset) % 60)}`;
}

module.exports = { localStamp };
