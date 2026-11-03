'use strict';
// smoke の試しで、カードの画面（src/renderer）を本物のウェブアプリなしで動かすための preload。
// 本物の cardsApi の代わりに、決まった結果を決まった時間で返す偽物を渡す。アプリの名前と文は全部作り物。
// fast で始まるカードは、同じアプリの二枚目からのように、すぐ（20ミリ秒で）結果を返す。slow は 1.2秒かかる。

// node --test は test/ の中の .js を全部動かすので、Electron の外では飛ばす（smoke.js と同じ）。
if (!process.versions.electron) {
  require('node:test')('カードの画面の試しの preload（Electron の上でだけ動く）', { skip: 'npm run smoke から使う' }, () => {});
  return;
}

const { contextBridge } = require('electron');

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
  ],
};

const opened = [];
const undone = [];
const repaired = { cardId: 'fixed-read', title: '画面が変わった読む所', action: 'read', before: '#d', after: '#d2', reason: 'id が変わったため。', at: '2026-11-03T04:05:00.000Z' };
let fixedOnce = false;

const answers = {
  'fast-read': { delay: 20, result: { ok: true, action: 'read', text: 'すぐ返った一つ目\nすぐ返った二つ目' } },
  'fast-list': { delay: 20, result: { ok: true, action: 'list', items: ['一覧の一件目', '一覧の二件目'] } },
  'slow-read': { delay: 1200, result: { ok: true, action: 'read', text: '遅れて返った一つ目' } },
  'unfixed-read': { delay: 20, result: { ok: false, where: 'cards[5].selector', message: 'ページの中に当たる所がありません', autoRepairFailed: true } },
};

contextBridge.exposeInMainWorld('cardsApi', {
  loadConfigs: async () => [{ file: 'fake-app.json', config, errors: [] }],
  runCard: (appId, cardId) => new Promise((resolve) => {
    // 画面が変わった読む所: 一度目は自動で直して読んだ結果、二度目からはふつうに読んだ結果。
    if (cardId === 'fixed-read') {
      const result = fixedOnce
        ? { ok: true, action: 'read', text: '直した所の文' }
        : { ok: true, action: 'read', text: '直した所の文', repaired };
      fixedOnce = true;
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
    return { ok: true, repair: repaired };
  },
  listRepairs: async () => ({ ok: true, repairs: undone.length > 0 ? [] : [repaired] }),
  publishRepair: async () => ({ ok: true, message: '「画面が変わった読む所」の直しを、設定ファイルに書きました。' }),
});

// 試しから、出典のページを開くように頼まれた回数と appId を見るため。
contextBridge.exposeInMainWorld('fakeLog', { opened: () => opened.slice(), undone: () => undone.slice() });
