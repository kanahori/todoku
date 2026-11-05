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

// ?fake=click で開いたときは、押すカードが二枚だけの作り物のアプリにする（押すときの知らせの試し）。
// すぐ終わる押す所は 20ミリ秒、時間のかかる押す所は 1.2秒で「押した」を返す。
const clickMode = typeof location !== 'undefined' && /(^|[?&])fake=click(&|$)/.test(location.search);
const clickConfig = {
  id: 'fake-click',
  name: '作り物の押す所',
  url: 'fixture:practice.html',
  cards: [
    { id: 'fast-click', title: 'すぐ終わる押す所', action: 'click', selector: '#g' },
    { id: 'slow-click', title: '時間のかかる押す所', action: 'click', selector: '#h' },
  ],
};

// ?fake=review で開いたときは、当たらない行が二つある作り物のアプリにする（支援者向けの点検と直しの案の試し）。
// &nokey=1 を足すと、鍵が無いときの答え（案を作れない）を返す。受けた案の場所は applied に控える。
const reviewMode = typeof location !== 'undefined' && /(^|[?&])fake=review(&|$)/.test(location.search);
const reviewNoKey = typeof location !== 'undefined' && /(^|[?&])nokey=1(&|$)/.test(location.search);
// &slowcheck=1 を足すと、確認に 5.6秒かかったことにする（確認の間の知らせの試し）。
const reviewSlowCheck = typeof location !== 'undefined' && /(^|[?&])slowcheck=1(&|$)/.test(location.search);
const reviewConfig = {
  id: 'fake-review',
  name: '作り物の講座（画面が変わった後）',
  url: 'fixture:course-after.html',
  cards: [
    { id: 'deadlines', title: '締め切りを読む', action: 'list', selector: '.deadline-list li' },
    { id: 'notices', title: 'お知らせを読む', action: 'read', selector: '.announcement' },
    { id: 'courses', title: '講座の一覧を読む', action: 'list', selector: '#courses li' },
  ],
};
const reviewProblems = [
  { where: 'cards[0].selector', message: 'ページの中に読む場所が見つかりません', title: '締め切りを読む' },
  { where: 'cards[1].selector', message: 'ページの中に読む場所が見つかりません', title: 'お知らせを読む' },
];
const applied = [];

// ?fake=youtube で開いたときは、YouTube のカード（作り物の API の答え）だけのアプリにする。
// 動画の埋め込みは、本物の YouTube の代わりに作り物のプレーヤー（test/fixtures/yt-fake-player.html）を指す。&ytnokey=1 で API キーが無いときの答え。
const youtubeMode = typeof location !== 'undefined' && /(^|[?&])fake=youtube(&|$)/.test(location.search);
const youtubeNoKey = typeof location !== 'undefined' && /(^|[?&])ytnokey=1(&|$)/.test(location.search);
const youtubeConfig = {
  id: 'fake-youtube',
  name: '作り物の授業の動画',
  kind: 'youtube',
  description: '出典：YouTube（作り物の答え）。',
  cards: [
    { id: 'search', title: '動画を探す', action: 'youtube-search' },
    { id: 'latest', title: '授業の動画の新しいものを読む', action: 'youtube-channel', channelId: 'UCabcdefghijklmnopqrstuv' },
    { id: 'player', title: '再生中の動画を操作する', action: 'youtube-player' },
  ],
};
const ytQueries = [];
const fakePlayer = (id) => (typeof location !== 'undefined' ? new URL(`../../test/fixtures/yt-fake-player.html?v=${id}`, location.href).href : '');
const ytVideos = [
  { id: 'aaaaaaaaaaa', title: '作り物の授業 第1回', text: '作り物の授業 第1回、長さ 12分34秒、公開日 2026年11月3日、作り物の大学' },
  { id: 'bbbbbbbbbbb', title: '作り物の授業 第2回', text: '作り物の授業 第2回、長さ 1時間2分3秒、公開日 2026年11月4日、作り物の大学' },
];

const opened = [];
// 元のページを表示する・いまのページを既定のブラウザで開く・リンクの一件を既定のブラウザで開く、を頼まれた appId（と番号）。
const revealed = [];
const pagesOpened = [];
const linksOpened = [];
// 「このページのリンク」の作り物の答え。一件目は Todoku の束がある行き先、二件目は無い行き先（作り物の町のページ）、三件目は作れない行き先。
const fakeLinks = [
  { text: '読めるページ（作り物）', url: 'https://example.com/known/' },
  { text: '作り物の町のページ', url: 'https://example.com/town' },
  { text: '作れないページ（作り物）', url: 'https://example.com/fail-link' },
];
const undone = [];
const generated = [];
const exported = [];
const deleted = [];
// 作った束（作り物）。URL に fail を含むときは、作れなかった答えを返す。
const madeDeck = {
  id: 'page-test',
  name: '作り物の町のページ',
  url: 'https://example.com/town',
  description: 'このカードは、Claude がページの構造から作ったものです。このパソコンの中だけにあります。',
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
  'unfixed-read': { delay: 20, result: { ok: false, where: 'cards[4].selector', message: 'ページの中に読む場所が見つかりません', autoRepairFailed: true, autoRepairReason: 'timeout', autoRepairReasonText: '時間内に終わりませんでした' } },
  'fast-click': { delay: 20, result: { ok: true, action: 'click' } },
  'slow-click': { delay: 1200, result: { ok: true, action: 'click' } },
  'unfixed-click': { delay: 20, result: { ok: false, where: 'cards[5].selector', message: 'ページの中に読む場所が見つかりません', autoRepairFailed: true, autoRepairReason: 'no-key', autoRepairReasonText: 'Claude の API キーがありません' } },
};

contextBridge.exposeInMainWorld('cardsApi', {
  loadConfigs: async () => {
    if (chatMode) return [{ file: 'fake-chat.json', config: chatConfig, errors: [] }];
    if (clickMode) return [{ file: 'fake-click.json', config: clickConfig, errors: [] }];
    if (reviewMode) return [{ file: 'fake-review.json', config: reviewConfig, errors: [] }];
    if (youtubeMode) return [{ file: 'fake-youtube.json', config: youtubeConfig, errors: [] }];
    return [{ file: 'fake-app.json', config, errors: [] }];
  },
  // 一件に結び付いた所: 1件目と2件目は返事があり、3件目は一覧を読んだ後に画面が変わっていて、4件目は返事がまだ無い。
  readItemTarget: async (appId, cardId, index, key) => {
    itemTargets.push(`${appId}/${cardId}/${index}/${key}`);
    const replies = ['一つ目の返事の一行目\n一つ目の返事の二行目', '二つ目の返事の一行目\n二つ目の返事の二行目'];
    if (index < replies.length) return { ok: true, action: 'read', text: replies[index] };
    if (key === 'k3') return { ok: false, where: 'cards[1].selector', message: '一覧を読んだ後に、ページが変わりました', changed: true };
    return { ok: false, where: 'cards[1].itemTarget', message: '選んだ項目に結び付いた場所がありません', notFound: true };
  },
  runCard: (appId, cardId) => new Promise((resolve) => {
    // 主の処理で例外が起きたときの答え（main.js の card:run の catch と同じ形）。
    if (chatMode && cardId === 'last') {
      setTimeout(() => resolve({ ok: false, where: '(なし)', message: '動かせませんでした: 窓が閉じられていました' }), 20);
      return;
    }
    if (chatMode && cardId === 'questions') {
      setTimeout(() => resolve({
        ok: true, action: 'list', items: ['一つ目の質問', '二つ目の質問', '三つ目の質問（画面が変わった後）', '四つ目の質問（返事はまだ）'], keys: ['k1', 'k2', 'k3', 'k4'],
      }), 20);
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
  revealPage: async (appId) => {
    revealed.push(appId);
    return { ok: true, message: '元のページを表示しました。元のページでEscキーを押すと、Todoku に戻ります。' };
  },
  openPageExternal: async (appId) => {
    pagesOpened.push(appId);
    return { ok: true, message: 'いまのページを、既定のブラウザで開きました。Todoku に戻るには Command キーと Tab キーを押してください。' };
  },
  readLinks: async () => {
    await new Promise((r) => setTimeout(r, 20));
    return { ok: true, action: 'list', items: fakeLinks.map((l) => l.text), links: fakeLinks.slice(), truncated: false };
  },
  // 読めるページの行き先だけ、試しのアプリの「すぐ返る一覧」のカードがあることにする。
  findDeckForLink: async (url) => (url === 'https://example.com/known/' ? { appId: 'fake-app', cardId: 'fast-list' } : null),
  openLinkExternal: async (appId, index) => {
    linksOpened.push(`${appId}/${index}`);
    return { ok: true, message: `「${fakeLinks[index].text}」のページを、既定のブラウザで開きました。` };
  },
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
    return { ok: true, message: 'ダウンロードのフォルダに「todoku-page-test.json」として書き出しました。支援者が確認してから、設定ファイルとして配ってください。' };
  },
  deleteGenerated: async (appId) => {
    deleted.push(appId);
    return { ok: true, message: `「${madeDeck.name}」のカードを消しました。` };
  },
  // 点検と直しの案（支援者向け）: 点検は当たらない行を二つ返す。案は二つ（鍵が無いときは、案を作れない理由）。受けると書いたことにする。
  checkCards: async () => {
    await new Promise((r) => setTimeout(r, reviewSlowCheck ? 5600 : 50));
    return { ok: true, problems: reviewProblems.filter((p) => !applied.includes(p.where)) };
  },
  proposeRepairs: async () => {
    await new Promise((r) => setTimeout(r, 50));
    if (reviewNoKey) return { ok: false, message: 'Claude の API キーが設定されていないので、直しの候補を作れません（環境変数 CARDS_ANTHROPIC_API_KEY が空です）' };
    return {
      ok: true,
      errors: [],
      proposals: [
        { where: 'cards[0].selector', index: 0, title: '締め切りを読む', action: 'list', oldSelector: '.deadline-list li', newSelector: '[data-region="deadline-list"] li', reason: '一覧の作りが data-region に変わったためです。', matches: 3 },
        { where: 'cards[1].selector', index: 1, title: 'お知らせを読む', action: 'read', oldSelector: '.announcement', newSelector: '[data-region="announcement"]', reason: 'お知らせの作りが data-region に変わったためです。', matches: 1 },
      ],
    };
  },
  // 書くのに 0.8秒かかったことにする（0.5秒を越えたら「書いています。」と知らせるかの試し）。
  // YouTube のカード: 作り物の API の答え（探す言葉と、どのカードかを控える）。
  youtubeList: async (appId, cardId, query) => {
    ytQueries.push(`${cardId}:${query}`);
    await new Promise((r) => setTimeout(r, 50));
    if (youtubeNoKey) return { ok: false, message: 'YouTube の API キーが設定されていません。' };
    return { ok: true, items: ytVideos.map((v) => ({ ...v, embedUrl: fakePlayer(v.id) })) };
  },
  openPolicy: async (name) => ({ ok: true, message: `${name} を、既定のブラウザで開きました。` }),
  applyRepairs: async (appId, wheres) => {
    await new Promise((r) => setTimeout(r, 800));
    applied.push(...wheres);
    return { ok: true, written: wheres.length, problems: [] };
  },
  publishRepair: async () => ({ ok: true, message: '「画面が変わった読む所」の直しを、設定ファイルに書きました。' }),
  // 表示設定は偽物にせず、smoke が本物の settings.js の口（一時のフォルダの settings.json）につなぐ。
  // フォルダ・表示名・メモは偽物にせず、smoke が本物の bookmarks.js の口（一時のフォルダの bookmarks.json）につなぐ。
  loadBookmarks: () => ipcRenderer.invoke('bookmarks:load'),
  saveBookmarks: (b) => ipcRenderer.invoke('bookmarks:save', b),
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', {
    preset: String((s && s.preset) || ''), reflow: Boolean(s && s.reflow), scheme: String((s && s.scheme) || ''),
  }),
  onZoom: (callback) => ipcRenderer.on('settings:zoom', (_event, r) => callback({ message: String((r && r.message) || '') })),
});

// 試しから、出典のページを開くように頼まれた回数と appId を見るため。
contextBridge.exposeInMainWorld('fakeLog', {
  opened: () => opened.slice(),
  revealed: () => revealed.slice(),
  pagesOpened: () => pagesOpened.slice(),
  linksOpened: () => linksOpened.slice(),
  undone: () => undone.slice(),
  generated: () => generated.slice(),
  exported: () => exported.slice(),
  deleted: () => deleted.slice(),
  itemTargets: () => itemTargets.slice(),
  applied: () => applied.slice(),
  ytQueries: () => ytQueries.slice(),
});
