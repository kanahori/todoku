'use strict';
// Electron の主の処理: 窓を作り、設定ファイルを読んで画面に渡す。

const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { loadConfigSources } = require('./config');
const { runCard } = require('./target');

const CARDS_DIR = path.join(__dirname, '..', '..', 'cards');
// 手元の設定ファイルの置き場（公開しないもの）。場所は環境変数 CARDS_LOCAL_DIR で渡す。
const CARDS_LOCAL_DIR = process.env.CARDS_LOCAL_DIR || null;

// 読めた設定ファイル（id → 中身）。カードを動かすときに使う。
const configs = new Map();

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 760,
    title: 'カードの画面',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

ipcMain.handle('configs:load', () => {
  // 読めたものと、当たらない所の一覧の両方を返す。
  const sources = [{ dir: CARDS_DIR, label: 'cards' }];
  if (CARDS_LOCAL_DIR) sources.push({ dir: CARDS_LOCAL_DIR, label: '手元' });
  const results = loadConfigSources(sources);
  configs.clear();
  for (const r of results) if (r.config) configs.set(r.config.id, r.config);
  return results;
});

ipcMain.handle('card:run', async (_event, appId, cardId) => {
  const config = configs.get(appId);
  if (!config) return { ok: false, where: '(なし)', message: `アプリ「${appId}」の設定ファイルがありません` };
  try {
    return await runCard(BrowserWindow, config, cardId);
  } catch (e) {
    return { ok: false, where: '(なし)', message: `動かせませんでした: ${e.message}` };
  }
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
