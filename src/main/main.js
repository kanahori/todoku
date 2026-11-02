'use strict';
// Electron の主の処理: 窓を作り、設定ファイルを読んで画面に渡す。

const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { loadConfigDir } = require('./config');

const CARDS_DIR = path.join(__dirname, '..', '..', 'cards');

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
  return loadConfigDir(CARDS_DIR).map((r) => ({
    file: path.basename(r.file),
    config: r.config ?? null,
    errors: r.errors ?? [],
  }));
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
