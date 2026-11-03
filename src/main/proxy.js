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

// ---- システムのプロキシに届かないときは、直に繋ぐ ----
// 学外で、Windows の全体のプロキシが学内の入口を指したままだと、Electron（Chromium）はページを開けない
// （Node の fetch はシステムのプロキシを使わないので、直に届く）。2026-11-03 の Windows の確かめ。
// 起動のときに、外のページに使われるプロキシの入口を Chromium に尋ね（環境変数 https_proxy があればそれ、無ければ OS の設定）、
// 短い時間切れで繋いでみる。入口のどれにも届かなければ、この作品の中だけ直に繋ぐ（session.setProxy）。
// OS の設定（インターネットのオプション・winhttp）は読むだけで、書き換えない。学内（入口に届く）では、これまでどおり。
// 入口の名前はコードに書かない（公開のリポジトリに入るため）。
const net = require('node:net');

const PROBE_URL = 'https://www.example.com/';
const CONNECT_TIMEOUT_MS = 2000;

// Chromium の resolveProxy の答え（"PROXY host:port; DIRECT" など）から、入口の一覧を取り出す。
function parseProxyList(text) {
  const proxies = [];
  let direct = false;
  for (const entry of String(text || '').split(';').map((e) => e.trim()).filter(Boolean)) {
    if (/^DIRECT$/i.test(entry)) {
      direct = true;
      continue;
    }
    const m = /^(?:PROXY|HTTPS?|SOCKS[45]?|QUIC)\s+\[?([^\]\s]+?)\]?:(\d+)$/i.exec(entry);
    if (m) proxies.push({ host: m[1], port: Number(m[2]) });
  }
  return { proxies, direct };
}

// host:port に、時間内に繋がるか。
// 範囲外の port などで net.connect が同期で投げたときも、届かない入口として false を返す（投げると起動が止まり、窓が出なかった。見直しの9）。
function canConnect(host, port, timeoutMs = CONNECT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let socket;
    try {
      socket = net.connect({ host, port });
    } catch (e) {
      resolve(false);
      return;
    }
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

// 結果は 'none'（もともと直）・'proxy'（入口に届いた）・'direct'（届かないので直にした）・'direct-failed'（直に繋ぐ設定が失敗した）・
// 'unknown'（尋ねられなかった）。どの場合も例外を投げない（起動の途中で投げると、窓が一つも出なかった）。
async function chooseSystemProxy({ resolveProxy, setDirect, connect = canConnect, log = () => {}, probeUrl = PROBE_URL, timeoutMs = CONNECT_TIMEOUT_MS }) {
  let answer;
  try {
    answer = await resolveProxy(probeUrl);
  } catch (e) {
    return 'unknown';
  }
  const { proxies } = parseProxyList(answer);
  if (proxies.length === 0) return 'none';
  // 入口が幾つあっても同時に試し、起動を止めるのは時間切れの一回分（2秒）までにする。
  const reached = await Promise.all(proxies.map((p) => connect(p.host, p.port, timeoutMs)));
  if (reached.some(Boolean)) return 'proxy';
  const where = proxies.map((p) => `${p.host}:${p.port}`).join('、');
  try {
    await setDirect();
  } catch (e) {
    log(`システムのプロキシの入口（${where}）に届きませんでしたが、直に繋げませんでした: ${e.message}`);
    return 'direct-failed';
  }
  log(`システムのプロキシの入口（${where}）に届かないので、直に繋ぎます。`);
  return 'direct';
}

module.exports = { proxySwitches, parseProxyList, canConnect, chooseSystemProxy };
