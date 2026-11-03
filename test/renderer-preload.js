'use strict';
// smoke の試しで、カードの画面（src/renderer）を本物のウェブアプリなしで動かすための preload。
// 本物の cardsApi の代わりに、決まった結果を決まった時間で返す偽物を渡す。アプリの名前と文は全部作り物。
// fast で始まるカードは、同じアプリの二枚目からのように、すぐ（20ミリ秒で）結果を返す。slow は 1.2秒かかる。

// node --test は test/ の中の .js を全部動かすので、Electron の外では飛ばす（smoke.js と同じ）。
if (!process.versions.electron) {
  require('node:test')('カードの画面の試しの preload（Electron の上でだけ動く）', { skip: 'npm run smoke から使う' }, () => {});
  return;
}

const { contextBridge, ipcRenderer } = require('electron');

const config = {
  id: 'fake-app',
  name: '試しのアプリ（作り物）',
  url: 'fixture:practice.html',
  description: '出典：作り物のサイトを加工して作成。',
  sourceUrl: 'https://example.com/source/',
  cards: [
    { id: 'fast-read', title: 'すぐ返る読む所', action: 'read', selector: '#a' },
    { id: 'fast-list', title: 'すぐ返る一覧', action: 'list', selector: '#b li' },
    { id: 'slow-read', title: '時間のかかる読む所', action: 'read', selector: '#c' },
    { id: 'fixed-read', title: '画面が変わった読む所', action: 'read', selector: '#d' },
    { id: 'unfixed-read', title: '直せない読む所', action: 'read', selector: '#e' },
    { id: 'unfixed-click', title: '直せない押す所', action: 'click', selector: '#f' },
  ],
};

// ?fake=chat で開いたときは、作り物のチャットのアプリだけにする（一覧の一件から結び付いた所を読む試し）。
const chatMode = typeof location !== 'undefined' && /(^|[?&])fake=chat(&|$)/.test(location.search);
const chatConfig = {
  id: 'fake-chat',
  name: '作り物のチャット',
  url: 'fixture:chat.html',
  cards: [
    { id: 'last', title: '最後の返事を読む', action: 'read', selector: '#last' },
    { id: 'questions', title: '自分の質問を全部読む', action: 'list', selector: '#q', itemTarget: { label: '返事', next: '.ai' } },
  ],
};
const itemTargets = [];

const opened = [];
const undone = [];
const generated = [];
const exported = [];
const deleted = [];
// 作った束（作り物）。URL に fail を含むときは、作れなかった答えを返す。
const madeDeck = {
  id: 'page-test',
  name: '作り物の町のページ',
  url: 'https://example.com/town',
  description: 'このカードの束は、Claude がページの作りから作ったものです。この機械の中だけにあります。',
  cards: [
    { id: 'list-1', title: '新着', action: 'list', selector: '#n li' },
    { id: 'main-2', title: '本文 1', action: 'read', selector: 'main' },
  ],
};
const repaired = { cardId: 'fixed-read', title: '画面が変わった読む所', action: 'read', before: '#d', after: '#d2', reason: 'id が変わったため。', at: '2026-11-03T04:05:00.000Z' };
// 画面が変わった読む所の直しが、いま手元に効いているか（直す前に戻すと外れ、次に読むとまた直す）。
let repairActive = false;

const answers = {
  'fast-read': { delay: 20, result: { ok: true, action: 'read', text: 'すぐ返った一つ目\nすぐ返った二つ目' } },
  'fast-list': { delay: 20, result: { ok: true, action: 'list', items: ['一覧の一件目', '一覧の二件目'] } },
  'slow-read': { delay: 1200, result: { ok: true, action: 'read', text: '遅れて返った一つ目' } },
  'unfixed-read': { delay: 20, result: { ok: false, where: 'cards[4].selector', message: 'ページの中に当たる所がありません', autoRepairFailed: true, autoRepairReason: 'timeout', autoRepairReasonText: '時間内に終わりませんでした' } },
  'unfixed-click': { delay: 20, result: { ok: false, where: 'cards[5].selector', message: 'ページの中に当たる所がありません', autoRepairFailed: true, autoRepairReason: 'no-key', autoRepairReasonText: 'Claude の鍵がありません' } },
};

contextBridge.exposeInMainWorld('cardsApi', {
  loadConfigs: async () => (chatMode ? [{ file: 'fake-chat.json', config: chatConfig, errors: [] }] : [{ file: 'fake-app.json', config, errors: [] }]),
  // 一件に結び付いた所: 1件目と2件目は返事があり、3件目はまだ無い。
  readItemTarget: async (appId, cardId, index) => {
    itemTargets.push(`${appId}/${cardId}/${index}`);
    const replies = ['一つ目の返事の一行目\n一つ目の返事の二行目', '二つ目の返事の一行目\n二つ目の返事の二行目'];
    return index < replies.length
      ? { ok: true, action: 'read', text: replies[index] }
      : { ok: false, where: 'cards[1].itemTarget', message: '選んだ項目に結び付いた所がありません', notFound: true };
  },
  runCard: (appId, cardId) => new Promise((resolve) => {
    if (chatMode && cardId === 'questions') {
      setTimeout(() => resolve({ ok: true, action: 'list', items: ['一つ目の質問', '二つ目の質問', '三つ目の質問（返事はまだ）'] }), 20);
      return;
    }
    // 画面が変わった読む所: 直しが効いていなければ自動で直して読んだ結果、効いていればふつうに読んだ結果。
    if (cardId === 'fixed-read') {
      const result = repairActive
        ? { ok: true, action: 'read', text: '直した所の文' }
        : { ok: true, action: 'read', text: '直した所の文', repaired };
      repairActive = true;
      setTimeout(() => resolve(result), 20);
      return;
    }
    const a = answers[cardId] || { delay: 0, result: { ok: false, message: '試しに無いカード' } };
    setTimeout(() => resolve(a.result), a.delay);
  }),
  showTarget: async () => ({ ok: true }),
  // 出典のページは開かず、呼ばれた appId を控えるだけ。
  openSource: async (appId) => {
    opened.push(appId);
    return { ok: true, message: '出典のページを、既定のブラウザで開きました。' };
  },
  onDownloadDone: () => {},
  onRepairing: () => {},
  undoRepair: async (appId, cardId) => {
    undone.push(`${appId}/${cardId}`);
    repairActive = false;
    return { ok: true, repair: repaired };
  },
  listRepairs: async () => ({ ok: true, repairs: repairActive ? [repaired] : [] }),
  generateDeck: (url) => new Promise((resolve) => {
    generated.push(url);
    if (url.includes('fail')) {
      setTimeout(() => resolve({ ok: false, reason: 'open-failed', message: 'ページを開けなかったので、カードを作れませんでした。' }), 50);
      return;
    }
    setTimeout(() => resolve({ ok: true, config: madeDeck, message: `「${madeDeck.name}」のカードを${madeDeck.cards.length}枚作りました。` }), 500);
  }),
  exportGenerated: async (appId) => {
    exported.push(appId);
    return { ok: true, message: 'ダウンロードのフォルダに「todoku-page-test.json」として書き出しました。支援者が確かめてから、設定ファイルとして配ってください。' };
  },
  deleteGenerated: async (appId) => {
    deleted.push(appId);
    return { ok: true, message: `「${madeDeck.name}」のカードの束を消しました。` };
  },
  publishRepair: async () => ({ ok: true, message: '「画面が変わった読む所」の直しを、設定ファイルに書きました。' }),
  // 表示設定は偽物にせず、smoke が本物の settings.js の口（一時のフォルダの settings.json）につなぐ。
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', {
    preset: String((s && s.preset) || ''), reflow: Boolean(s && s.reflow), scheme: String((s && s.scheme) || ''),
  }),
  onZoom: (callback) => ipcRenderer.on('settings:zoom', (_event, r) => callback({ message: String((r && r.message) || '') })),
});

// 試しから、出典のページを開くように頼まれた回数と appId を見るため。
contextBridge.exposeInMainWorld('fakeLog', {
  opened: () => opened.slice(),
  undone: () => undone.slice(),
  generated: () => generated.slice(),
  exported: () => exported.slice(),
  deleted: () => deleted.slice(),
  itemTargets: () => itemTargets.slice(),
});
