'use strict';
// ウェブアプリの窓（操作する相手のページ）を開き、カードの selector を当てる所。
// 当たらなかったときは、設定ファイルのどの行かだけを返す。ページの中身は外へ送らない。

const path = require('node:path');
const { pathToFileURL } = require('node:url');

const FIXTURES_DIR = path.join(__dirname, '..', '..', 'test', 'fixtures');
const FIXTURE_NAME = /^[a-z0-9][a-z0-9-]*\.html$/;
const READ_LIMIT = 4000; // 読み上げに渡す文字数の上限
const WAIT_MS = 8000; // 後から出てくる所を待つ長さ

// 設定ファイルの url とカードの path から、窓で開く URL を作る。
// 練習のページ（fixture:）では、path は test/fixtures/ の別のファイルの名前（/名前.html）として扱う。
function resolveUrl(url, cardPath) {
  if (url.startsWith('fixture:')) {
    const name = cardPath ? cardPath.slice(1) : url.slice('fixture:'.length);
    if (!FIXTURE_NAME.test(name)) throw new Error(`練習のページの名前が正しくありません: ${name}`);
    return pathToFileURL(path.join(FIXTURES_DIR, name)).href;
  }
  if (!cardPath) return url;
  const resolved = new URL(cardPath, url);
  if (resolved.origin !== new URL(url).origin) throw new Error('path が別のサイトを指しています');
  return resolved.href;
}

// ページの中で動く関数。外の変数は使えないので、引数だけで動くようにする。
// 後から出てくる所に備えて、当たるまで少しずつ待つ。
async function pageAction(selector, action, loginSelector, limit, waitMs) {
  const readText = (el) => (el.innerText || el.textContent || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const query = (s) => {
    try {
      return { el: document.querySelector(s) };
    } catch (e) {
      return { invalid: true };
    }
  };
  const deadline = Date.now() + waitMs;
  let el = null;
  for (;;) {
    const q = query(selector);
    if (q.invalid) return { found: false, reason: 'invalid' };
    el = q.el;
    if (el && (action === 'click' || readText(el) !== '')) break;
    if (!el && loginSelector) {
      const login = query(loginSelector);
      if (login.el) return { found: false, reason: 'login' };
    }
    if (Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!el) return { found: false, reason: 'none' };
  if (action === 'click') {
    el.click();
    return { found: true };
  }
  const text = readText(el);
  return { found: true, text: text.slice(0, limit), truncated: text.length > limit };
}

// ページで動かす文を作る。selector は JSON にして埋め込み、文として解釈されないようにする。
function buildScript(selector, action, loginSelector = null, waitMs = WAIT_MS) {
  const args = [selector, action, loginSelector, READ_LIMIT, waitMs].map((v) => JSON.stringify(v)).join(', ');
  return `(${pageAction.toString()})(${args})`;
}

// アプリごとに窓を一つ持つ。
const windows = new Map();

async function openTarget(BrowserWindow, config, url) {
  let win = windows.get(config.id);
  if (!win || win.isDestroyed()) {
    win = new BrowserWindow({
      width: 1000,
      height: 760,
      show: false,
      title: config.name,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    // 新しい窓を勝手に開かせない。
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    windows.set(config.id, win);
    win.on('closed', () => windows.delete(config.id));
  }
  // 同じページにいるなら読み込み直さない（共用のデモサイトに負荷をかけないため）。
  if (win.webContents.getURL() !== url) await win.loadURL(url);
  // カードの画面からフォーカスを奪わないように、前に出さずに見せる。
  if (!win.isVisible()) win.showInactive();
  return win;
}

// カードを一枚動かす。結果は { ok, action?, text?, truncated?, needLogin?, where?, message? }。
async function runCard(BrowserWindow, config, cardId, options = {}) {
  const index = config.cards.findIndex((c) => c.id === cardId);
  if (index < 0) return { ok: false, where: '(なし)', message: `カード「${cardId}」が設定ファイルにありません` };
  const card = config.cards[index];
  const where = `cards[${index}].selector`;

  let win;
  try {
    win = await openTarget(BrowserWindow, config, resolveUrl(config.url, card.path));
  } catch (e) {
    return { ok: false, where: card.path ? `cards[${index}].path` : 'url', message: `ページを開けませんでした: ${e.message}` };
  }
  const loginSelector = config.login ? config.login.selector : null;
  const result = await win.webContents.executeJavaScript(buildScript(card.selector, card.action, loginSelector, options.waitMs));
  if (result.reason === 'login') {
    // ログインは人が手で行う。ログインの画面を開き、ウェブアプリの窓を前に出す。
    if (config.login.path) {
      try {
        const loginUrl = resolveUrl(config.url, config.login.path);
        if (win.webContents.getURL() !== loginUrl) await win.loadURL(loginUrl);
      } catch (e) {
        return { ok: false, where: 'login.path', message: `ログインの画面を開けませんでした: ${e.message}` };
      }
    }
    win.show();
    win.focus();
    return { ok: false, needLogin: true, message: 'ログインが要ります。ウェブアプリの窓でログインしてから、もう一度カードを押してください' };
  }
  if (!result.found) {
    const message = result.reason === 'invalid' ? 'selector の書き方が正しくありません' : 'ページの中に当たる所がありません';
    return { ok: false, where, message };
  }
  return { ok: true, action: card.action, text: result.text, truncated: result.truncated };
}

// ページの中で動く関数（点検用）。selector が当たるかだけを返し、中身は読まない。
function pageProbe(selectors) {
  return selectors.map((s) => {
    try {
      return document.querySelector(s) ? 'ok' : 'none';
    } catch (e) {
      return 'invalid';
    }
  });
}

// 全部のカードを点検し、当たらない行の一覧を返す。押さない・読まない。
// 結果は [{ where, message }]。ページの中身は入れない（Claude に送ってよいのはこの一覧だけ）。
async function checkCards(BrowserWindow, config, options = {}) {
  const problems = [];
  // 開くページごとにまとめて、読み込みを少なくする。
  const byUrl = new Map();
  config.cards.forEach((card, index) => {
    let url;
    try {
      url = resolveUrl(config.url, card.path);
    } catch (e) {
      problems.push({ where: card.path ? `cards[${index}].path` : 'url', message: e.message });
      return;
    }
    if (!byUrl.has(url)) byUrl.set(url, []);
    byUrl.get(url).push({ card, index });
  });
  for (const [url, items] of byUrl) {
    const win = await openTarget(BrowserWindow, config, url);
    // 後から出てくる所に備えて、少し待ってから見る。
    await new Promise((r) => setTimeout(r, options.settleMs ?? 1500));
    const selectors = items.map((i) => i.card.selector);
    const states = await win.webContents.executeJavaScript(`(${pageProbe.toString()})(${JSON.stringify(selectors)})`);
    items.forEach(({ index }, k) => {
      if (states[k] === 'none') problems.push({ where: `cards[${index}].selector`, message: 'ページの中に当たる所がありません' });
      if (states[k] === 'invalid') problems.push({ where: `cards[${index}].selector`, message: 'selector の書き方が正しくありません' });
    });
  }
  return problems;
}

module.exports = { resolveUrl, buildScript, pageAction, runCard, checkCards };
