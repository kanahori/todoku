'use strict';
// 画面（renderer）から呼べる関数を、必要な分だけ渡す。

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cardsApi', {
  loadConfigs: () => ipcRenderer.invoke('configs:load'),
  runCard: (appId, cardId) => ipcRenderer.invoke('card:run', String(appId), String(cardId)),
  showTarget: (appId) => ipcRenderer.invoke('target:show', String(appId)),
  checkCards: (appId) => ipcRenderer.invoke('cards:check', String(appId)),
  proposeRepairs: (appId) => ipcRenderer.invoke('repair:propose', String(appId)),
  applyRepairs: (appId, wheres) => ipcRenderer.invoke('repair:apply', String(appId), (wheres || []).map(String)),
  // ダウンロードが終わったときの知らせ（押すカードの結果にならなかったもの）。受け取るのは { ok, message } だけ。
  onDownloadDone: (callback) => ipcRenderer.on('download:done', (_event, r) => callback({ ok: Boolean(r && r.ok), message: String((r && r.message) || '') })),
});
