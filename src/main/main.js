'use strict';
// Electron の主の処理: 窓を作り、設定ファイルを読んで画面に渡す。

const path = require('node:path');
const { app, BrowserWindow, ipcMain, net, session, shell } = require('electron');
const { loadConfigSources, loadConfigFile, externalUrl } = require('./config');
const { runCard, checkCards, showTarget } = require('./target');
const { hasApiKey, createClaudeCaller, proposeRepairs, applyRepairs, saveConfigFile } = require('./repair');
const { attachDownloads } = require('./download');
const { proxySwitches } = require('./proxy');

// 環境変数にプロキシがあれば、Electron に渡す（学内のネットワークで、外のページに届くように）。窓を作る前に渡す。
for (const [name, value] of proxySwitches()) app.commandLine.appendSwitch(name, value);

const CARDS_DIR = path.join(__dirname, '..', '..', 'cards');
// 手元の設定ファイルの置き場（公開しないもの）。場所は環境変数 CARDS_LOCAL_DIR で渡す。
const CARDS_LOCAL_DIR = process.env.CARDS_LOCAL_DIR || null;

// 読めた設定ファイル（id → 中身）と、その場所（id → ファイルのパス）。
const configs = new Map();
const configPaths = new Map();
// 最後に作った直しの案（id → 案の一覧）。画面からは「どの場所の案を採るか」だけを受け取る。
const lastProposals = new Map();

// カードの画面の窓（ダウンロードの知らせを送る先）。
let mainWindow = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 760,
    title: 'Todoku',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  mainWindow = win;
  win.on('closed', () => { if (mainWindow === win) mainWindow = null; });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

ipcMain.handle('configs:load', () => {
  // 読めたものと、当たらない所の一覧の両方を返す。
  const sources = [{ dir: CARDS_DIR, label: 'cards' }];
  if (CARDS_LOCAL_DIR) sources.push({ dir: CARDS_LOCAL_DIR, label: '手元' });
  const results = loadConfigSources(sources);
  configs.clear();
  configPaths.clear();
  for (const r of results) {
    if (r.config) {
      configs.set(r.config.id, r.config);
      configPaths.set(r.config.id, r.path);
    }
  }
  // ファイルのパスは画面に渡さない。
  return results.map(({ path: _p, ...rest }) => rest);
});

// 全部のカードを点検し、当たらない行の一覧を返す。
ipcMain.handle('cards:check', async (_event, appId) => {
  const config = configs.get(appId);
  if (!config) return { ok: false, message: `アプリ「${appId}」の設定ファイルがありません` };
  try {
    const problems = await checkCards(BrowserWindow, config);
    const withTitles = problems.map((p) => {
      const m = /^cards\[(\d+)\]/.exec(p.where);
      return { ...p, title: m ? config.cards[Number(m[1])]?.title : undefined };
    });
    return { ok: true, problems: withTitles };
  } catch (e) {
    return { ok: false, message: `点検できませんでした: ${e.message}` };
  }
});

// 当たらない行について、Claude に直しの案を頼む。
ipcMain.handle('repair:propose', async (_event, appId) => {
  const config = configs.get(appId);
  if (!config) return { ok: false, message: `アプリ「${appId}」の設定ファイルがありません` };
  if (!hasApiKey()) return { ok: false, message: '鍵が無いので案を作れません（環境変数 CARDS_ANTHROPIC_API_KEY が空です）' };
  try {
    const problems = await checkCards(BrowserWindow, config);
    if (problems.length === 0) return { ok: true, proposals: [], errors: [] };
    // Electron の通信（net.fetch）を使い、学内のプロキシの設定に従わせる。
    const callModel = createClaudeCaller({ fetch: net.fetch.bind(net) });
    const result = await proposeRepairs({ BrowserWindow, config, problems, callModel });
    lastProposals.set(appId, result.proposals);
    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, message: `案を作れませんでした: ${e.message}` };
  }
});

// 人が採った案（場所の一覧）を設定ファイルに書く。
ipcMain.handle('repair:apply', async (_event, appId, acceptedWheres) => {
  const config = configs.get(appId);
  const file = configPaths.get(appId);
  const proposals = lastProposals.get(appId) || [];
  if (!config || !file) return { ok: false, message: `アプリ「${appId}」の設定ファイルがありません` };
  const wanted = new Set((Array.isArray(acceptedWheres) ? acceptedWheres : []).map(String));
  const accepted = proposals.filter((p) => wanted.has(p.where) && p.newSelector);
  if (accepted.length === 0) return { ok: false, message: '採った案がありません' };
  const next = applyRepairs(config, accepted);
  saveConfigFile(file, next, path.join(app.getPath('userData'), 'config-backups'));
  const reloaded = loadConfigFile(file);
  if (!reloaded.config) return { ok: false, message: '書き直した設定ファイルが読めません' };
  configs.set(appId, reloaded.config);
  lastProposals.delete(appId);
  const problems = await checkCards(BrowserWindow, reloaded.config);
  return { ok: true, written: accepted.length, problems };
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

// 出典のページ（設定ファイルの sourceUrl）を既定のブラウザで開く。画面からは appId だけを受け取り、URL は受け取らない。
// 開くのは http:// と https:// だけ。
ipcMain.handle('source:open', async (_event, appId) => {
  const config = configs.get(appId);
  if (!config || config.sourceUrl === undefined) return { ok: false, message: '出典のページが設定ファイルにありません。' };
  const url = externalUrl(config.sourceUrl);
  if (!url) return { ok: false, message: '出典のページの書き方が正しくありません。' };
  try {
    await shell.openExternal(url);
    return { ok: true, message: '出典のページを、既定のブラウザで開きました。' };
  } catch (e) {
    return { ok: false, message: '出典のページを開けませんでした。' };
  }
});

// ウェブアプリの窓を前に出す（ログインのため）。
ipcMain.handle('target:show', (_event, appId) => {
  if (!configs.get(appId)) return { ok: false, message: `アプリ「${appId}」の設定ファイルがありません` };
  return showTarget(appId) ? { ok: true } : { ok: false, message: 'ウェブアプリの窓が、まだ開いていません。カードを Enterキーで読んでください。' };
});

app.whenReady().then(() => {
  // ウェブアプリの窓で始まったダウンロードは、ダイアログを出さずにダウンロードのフォルダに保存する。
  // 押すカードの結果にならなかったもの（押してから遅れて始まったもの）は、終わったときに画面に知らせる。
  attachDownloads(session.defaultSession, {
    getDir: () => app.getPath('downloads'),
    onDone: (result) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('download:done', result);
    },
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
