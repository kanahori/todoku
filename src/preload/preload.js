'use strict';
// 画面（renderer）から呼べる関数を、必要な分だけ渡す。

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cardsApi', {
  loadConfigs: () => ipcRenderer.invoke('configs:load'),
  runCard: (appId, cardId) => ipcRenderer.invoke('card:run', String(appId), String(cardId)),
  readItemTarget: (appId, cardId, index) => ipcRenderer.invoke('card:item-target', String(appId), String(cardId), Number(index)),
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
  // 設定ファイルの無いページから、Claude がカードの束を作る・作った束を消す・設定ファイルとして書き出す（支援者向け）。
  generateDeck: (url) => ipcRenderer.invoke('generate:start', String(url)),
  deleteGenerated: (appId) => ipcRenderer.invoke('generate:delete', String(appId)),
  exportGenerated: (appId) => ipcRenderer.invoke('generate:export', String(appId)),
  // 表示設定（読みやすさ・1列リフロー表示・配色）を読む・書く。書くのは三つだけ。
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', {
    preset: String((s && s.preset) || ''), reflow: Boolean(s && s.reflow), scheme: String((s && s.scheme) || ''),
  }),
  // 文字の大きさを変えたときの知らせ（主の処理がキーで変える）。受け取るのは読ませる文だけ。
  onZoom: (callback) => ipcRenderer.on('settings:zoom', (_event, r) => callback({ message: String((r && r.message) || '') })),
  // カードが当たらず、自動で直し始めたときの知らせ。受け取るのは { appId, cardId } だけ。
  onRepairing: (callback) => ipcRenderer.on('card:repairing', (_event, r) => callback({ appId: String((r && r.appId) || ''), cardId: String((r && r.cardId) || '') })),
  // ダウンロードが終わったときの知らせ（押すカードの結果にならなかったもの）。受け取るのは { ok, message } だけ。
  onDownloadDone: (callback) => ipcRenderer.on('download:done', (_event, r) => callback({ ok: Boolean(r && r.ok), message: String((r && r.message) || '') })),
});
