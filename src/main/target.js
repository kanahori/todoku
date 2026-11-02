'use strict';
// ウェブアプリの窓（操作する相手のページ）を開き、カードの selector を当てる所。
// 当たらなかったときは、設定ファイルのどの行かだけを返す。ページの中身は外へ送らない。

const path = require('node:path');
const { pathToFileURL } = require('node:url');

const FIXTURES_DIR = path.join(__dirname, '..', '..', 'test', 'fixtures');
const READ_LIMIT = 4000; // 読み上げに渡す文字数の上限

// 設定ファイルの url を、窓で開く URL にする。
function resolveUrl(url) {
  if (url.startsWith('fixture:')) {
    return pathToFileURL(path.join(FIXTURES_DIR, url.slice('fixture:'.length))).href;
  }
  return url;
}

// ページの中で動く関数。外の変数は使えないので、引数だけで動くようにする。
function pageAction(selector, action, limit) {
  let el;
  try {
    el = document.querySelector(selector);
  } catch (e) {
    return { found: false, reason: 'invalid' };
  }
  if (!el) return { found: false, reason: 'none' };
  if (action === 'click') {
    el.click();
    return { found: true };
  }
  const text = (el.innerText || el.textContent || '').replace(/\s+\n/g, '\n').trim();
  return { found: true, text: text.slice(0, limit), truncated: text.length > limit };
}

// ページで動かす文を作る。selector は JSON にして埋め込み、文として解釈されないようにする。
function buildScript(selector, action) {
  return `(${pageAction.toString()})(${JSON.stringify(selector)}, ${JSON.stringify(action)}, ${READ_LIMIT})`;
}

// アプリごとに窓を一つ持つ。
const windows = new Map();

async function openTarget(BrowserWindow, config) {
  const url = resolveUrl(config.url);
  let win = windows.get(config.id);
  if (win && !win.isDestroyed()) {
    if (win.webContents.getURL() !== url) await win.loadURL(url);
    return win;
  }
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
  await win.loadURL(url);
  // カードの画面からフォーカスを奪わないように、前に出さずに見せる。
  win.showInactive();
  return win;
}

// カードを一枚動かす。結果は { ok, text?, truncated?, where?, message? }。
async function runCard(BrowserWindow, config, cardId) {
  const index = config.cards.findIndex((c) => c.id === cardId);
  if (index < 0) return { ok: false, where: '(なし)', message: `カード「${cardId}」が設定ファイルにありません` };
  const card = config.cards[index];
  const where = `cards[${index}].selector`;

  let win;
  try {
    win = await openTarget(BrowserWindow, config);
  } catch (e) {
    return { ok: false, where: 'url', message: `ページを開けませんでした: ${e.message}` };
  }
  const result = await win.webContents.executeJavaScript(buildScript(card.selector, card.action));
  if (!result.found) {
    const message = result.reason === 'invalid' ? 'selector の書き方が正しくありません' : 'ページの中に当たる所がありません';
    return { ok: false, where, message };
  }
  return { ok: true, action: card.action, text: result.text, truncated: result.truncated };
}

module.exports = { resolveUrl, buildScript, pageAction, runCard };
