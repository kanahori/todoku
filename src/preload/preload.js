'use strict';
// 画面（renderer）から呼べる関数を、必要な分だけ渡す。

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cardsApi', {
  loadConfigs: () => ipcRenderer.invoke('configs:load'),
  runCard: (appId, cardId) => ipcRenderer.invoke('card:run', String(appId), String(cardId)),
  showTarget: (appId) => ipcRenderer.invoke('target:show', String(appId)),
  // 出典のページを既定のブラウザで開く（URL は主の処理が設定ファイルから取る）。
  openSource: (appId) => ipcRenderer.invoke('source:open', String(appId)),
  checkCards: (appId) => ipcRenderer.invoke('cards:check', String(appId)),
  proposeRepairs: (appId) => ipcRenderer.invoke('repair:propose', String(appId)),
  applyRepairs: (appId, wheres) => ipcRenderer.invoke('repair:apply', String(appId), (wheres || []).map(String)),
  // 自動で直した所: 一覧・直す前に戻す・設定ファイルに書く（配る）。
  listRepairs: (appId) => ipcRenderer.invoke('repair:list', String(appId)),
  undoRepair: (appId, cardId) => ipcRenderer.invoke('repair:undo', String(appId), String(cardId)),
  publishRepair: (appId, cardId) => ipcRenderer.invoke('repair:publish', String(appId), String(cardId)),
  // カードが当たらず、自動で直し始めたときの知らせ。受け取るのは { appId, cardId } だけ。
  onRepairing: (callback) => ipcRenderer.on('card:repairing', (_event, r) => callback({ appId: String((r && r.appId) || ''), cardId: String((r && r.cardId) || '') })),
  // ダウンロードが終わったときの知らせ（押すカードの結果にならなかったもの）。受け取るのは { ok, message } だけ。
  onDownloadDone: (callback) => ipcRenderer.on('download:done', (_event, r) => callback({ ok: Boolean(r && r.ok), message: String((r && r.message) || '') })),
});
