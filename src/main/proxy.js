'use strict';
// 環境変数のプロキシを、Electron（Chromium）に渡す形にする所。
// 学内のネットワークでは、アプリ本体から外のページに届くのにプロキシが要る。
// https_proxy（無ければ HTTPS_PROXY）を proxy-server に、no_proxy（無ければ NO_PROXY）を proxy-bypass-list に渡す。
// 無ければ何も渡さない。

function pick(env, lower, upper) {
  const v = env[lower] ?? env[upper];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

// 結果は [[名前, 値], ...]。app.commandLine.appendSwitch に順に渡す。
function proxySwitches(env = process.env) {
  const server = pick(env, 'https_proxy', 'HTTPS_PROXY');
  if (!server) return [];
  const switches = [['proxy-server', server]];
  const bypass = pick(env, 'no_proxy', 'NO_PROXY');
  if (bypass) {
    // no_proxy はカンマ区切り。Chromium の proxy-bypass-list はセミコロン区切りにする。
    const list = bypass.split(/[,;]/).map((s) => s.trim()).filter(Boolean).join(';');
    if (list) switches.push(['proxy-bypass-list', list]);
  }
  return switches;
}

module.exports = { proxySwitches };
