'use strict';
// Electron の主の処理: 窓を作り、設定ファイルを読んで画面に渡す。

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, net, session, shell } = require('electron');
const { loadConfigSources, loadConfigFile, externalUrl } = require('./config');
const {
  checkCards, showTarget, closeTarget, setHomeWindow, testHeadless, readItemTarget, closeAllTargets, revealTarget, currentPageUrl, readLinks,
} = require('./target');
const { browserUrl, findDeckFor } = require('./links');
const { hasApiKey, createClaudeCaller, proposeRepairs, applyRepairs, saveConfigFile } = require('./repair');
const { attachDownloads } = require('./download');
const { createOverrideStore, applyOverrides, runCardWithAutoRepair, withTimeout } = require('./autofix');

// 支援者の直しの案（repair:propose）で、Claude の一回の呼び出しを待つ長さの上限（SDK の既定は10分で、2回までやり直す。見直しの10）。
const PROPOSE_TIMEOUT_MS = 120 * 1000;
const { sourceOpenedMessage } = require('./messages');
const { localStamp } = require('./logline');
const { youtubeApiKey, createYouTubeClient, videoText, NO_KEY_MESSAGE, DEFAULT_MAX, attachEmbedReferer, youtubePageUrl } = require('./youtube');
const {
  GenerateSchema, generateDeck, createGeneratedStore, failureMessage, doneMessage, exportDeck, exportedMessage,
} = require('./generate');
const { proxySwitches, chooseSystemProxy } = require('./proxy');
const { createSettingsStore, registerSettingsHandlers, attachZoomKeys } = require('./settings');

// 環境変数にプロキシがあれば、Electron に渡す（学内のネットワークで、外のページに届くように）。窓を作る前に渡す。
for (const [name, value] of proxySwitches()) app.commandLine.appendSwitch(name, value);

const CARDS_DIR = path.join(__dirname, '..', '..', 'cards');
// 手元の設定ファイルの置き場（公開しないもの）。場所は環境変数 CARDS_LOCAL_DIR で渡す。
const CARDS_LOCAL_DIR = process.env.CARDS_LOCAL_DIR || null;

// 読めた設定ファイル（id → 中身）と、その場所（id → ファイルのパス）。
// configs は手元の自動の直しを当てた後の中身（カードを動かすときに使う）、baseConfigs は設定ファイルのままの中身。
const configs = new Map();
const baseConfigs = new Map();
const configPaths = new Map();

// 自動で直した所（手元にだけ効く上書き）。置き場は app.getPath('userData') の下の repairs/。
let overrideStore = null;
function store() {
  if (!overrideStore) overrideStore = createOverrideStore(path.join(app.getPath('userData'), 'repairs'));
  return overrideStore;
}

// 設定ファイルのままの中身に手元の直しを当てて、configs に持ち直す。当てた直しの一覧を返す。
function refreshEffective(appId) {
  const base = baseConfigs.get(appId);
  if (!base) return [];
  const { config, active } = applyOverrides(base, store().load(appId));
  configs.set(appId, config);
  return active;
}

// 設定ファイルの無いページから Claude がその場で作ったカードの束（generate.js）。置き場は app.getPath('userData') の下の generated/。
const GENERATED_LABEL = '作ったカード';
let generatedStoreCache = null;
function generatedStore() {
  if (!generatedStoreCache) generatedStoreCache = createGeneratedStore(path.join(app.getPath('userData'), 'generated'));
  return generatedStoreCache;
}
// 作った束の id（消す・書き出すは、この束にだけ許す）。
const generatedIds = new Set();
// いま作っている途中か（二つを同時には作らない）。
let generating = false;

// 画面に渡す直しの形（どのカード・前と後のセレクタ・理由・日時）。
function repairView(r) {
  return { cardId: r.cardId, title: r.title, action: r.action, before: r.before, after: r.after, reason: r.reason, at: r.at };
}
// 最後に作った直しの案（id → 案の一覧）。画面からは「どの場所の案を採るか」だけを受け取る。
const lastProposals = new Map();

// カードの画面の窓（ダウンロードの知らせを送る先）。
let mainWindow = null;

// 表示設定と文字の大きさ（settings.js）。置き場は app.getPath('userData') の下の settings.json。
let settingsStoreCache = null;
function settingsStore() {
  if (!settingsStoreCache) settingsStoreCache = createSettingsStore(path.join(app.getPath('userData'), 'settings.json'));
  return settingsStoreCache;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 760,
    title: 'Todoku',
    // 試しの台本（test/headless.js）から起こしたときだけ、窓を画面に出さない。
    show: !testHeadless(),
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  mainWindow = win;
  // カードの画面から窓は開かない。YouTube の埋め込みプレーヤーの「YouTube で見る」などは、既定のブラウザで開く。
  win.webContents.setWindowOpenHandler(({ url }) => {
    const page = youtubePageUrl(url);
    if (page) shell.openExternal(page).catch(() => {});
    return { action: 'deny' };
  });
  // ウェブアプリの窓に焦点が来てしまったときに、戻す先（target.js）。
  setHomeWindow(win);
  // Todoku の窓を閉じたら、ウェブアプリの窓も全部閉じる。残すと、窓が残ってアプリが終わらない
  // （ウェブアプリの窓があるので window-all-closed が来ない。2026-11-04 に Mac で確かめた）。
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
    closeAllTargets();
  });
  win.removeMenu();
  // メニューを外したので、文字の大きさのキー（Ctrl か Command と、プラス・マイナス・0）は主の処理で受ける。
  attachZoomKeys(win.webContents, settingsStore(), (message) => {
    if (!win.isDestroyed()) win.webContents.send('settings:zoom', { message });
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

ipcMain.handle('configs:load', () => {
  // 読めたものと、当たらない所の一覧の両方を返す。
  const sources = [{ dir: CARDS_DIR, label: 'cards' }];
  if (CARDS_LOCAL_DIR) sources.push({ dir: CARDS_LOCAL_DIR, label: 'このパソコン' });
  sources.push({ dir: generatedStore().dir, label: GENERATED_LABEL });
  const results = loadConfigSources(sources).map((r) => ({ ...r, generated: r.file.startsWith(`${GENERATED_LABEL}/`) }));
  configs.clear();
  baseConfigs.clear();
  configPaths.clear();
  generatedIds.clear();
  const repairs = new Map();
  for (const r of results) {
    if (r.config) {
      if (r.generated) generatedIds.add(r.config.id);
      baseConfigs.set(r.config.id, r.config);
      configPaths.set(r.config.id, r.path);
      repairs.set(r.config.id, refreshEffective(r.config.id).map(repairView));
    }
  }
  // ファイルのパスは画面に渡さない。設定ファイルは書いてあるままの中身を渡し、手元の直しは repairs で別に渡す。
  return results.map(({ path: _p, ...rest }) => ({ ...rest, repairs: rest.config ? repairs.get(rest.config.id) || [] : [] }));
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
    return { ok: false, message: `確認できませんでした: ${e.message}` };
  }
});

// 当たらない行について、Claude に直しの案を頼む。
ipcMain.handle('repair:propose', async (_event, appId) => {
  const config = configs.get(appId);
  if (!config) return { ok: false, message: `アプリ「${appId}」の設定ファイルがありません` };
  if (!hasApiKey()) return { ok: false, message: 'Claude の API キーが設定されていないので、直しの候補を作れません（環境変数 CARDS_ANTHROPIC_API_KEY が空です）' };
  try {
    const problems = await checkCards(BrowserWindow, config);
    if (problems.length === 0) return { ok: true, proposals: [], errors: [] };
    // Electron の通信（net.fetch）を使い、学内のプロキシの設定に従わせる。一回の呼び出しは PROPOSE_TIMEOUT_MS で止める。
    const caller = createClaudeCaller({ fetch: net.fetch.bind(net) });
    const callModel = (req) => {
      const controller = new AbortController();
      return withTimeout(caller({ ...req, signal: controller.signal }), PROPOSE_TIMEOUT_MS, controller);
    };
    const result = await proposeRepairs({ BrowserWindow, config, problems, callModel });
    lastProposals.set(appId, result.proposals);
    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, message: `直しの候補を作れませんでした: ${e.message}` };
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
  if (accepted.length === 0) return { ok: false, message: '使う直しの候補がありません' };
  // 書く・読み直す・点検し直すの途中で失敗しても、画面に理由を返す（前は try が無く、画面の側は例外だけを受けた。見直しの10）。
  try {
    const next = applyRepairs(config, accepted);
    saveConfigFile(file, next, path.join(app.getPath('userData'), 'config-backups'));
    const reloaded = loadConfigFile(file);
    if (!reloaded.config) return { ok: false, message: '書き直した設定ファイルが読めません' };
    baseConfigs.set(appId, reloaded.config);
    refreshEffective(appId);
    // 受けた案だけを除き、残りの案は残す（支援者が一件ずつ受ける・断るため。全部を捨てると、二件目から「採った案がありません」になった）。
    const rest = proposals.filter((p) => !accepted.includes(p));
    if (rest.length > 0) lastProposals.set(appId, rest);
    else lastProposals.delete(appId);
  } catch (e) {
    return { ok: false, message: `設定ファイルに書けませんでした: ${e.message}` };
  }
  try {
    const problems = await checkCards(BrowserWindow, configs.get(appId));
    return { ok: true, written: accepted.length, problems };
  } catch (e) {
    return { ok: true, written: accepted.length, problems: [], message: `書きましたが、もう一度確認できませんでした: ${e.message}` };
  }
});

// Claude を呼ぶ関数を作る。鍵が無ければ null（自動では直さず、「自動で直すこともできませんでした（Claude の鍵がありません）。」と知らせる）。
// schema（任意）は返す形（カードの束を作るときは GenerateSchema）。
function makeCallModel(schema) {
  if (!hasApiKey()) return null;
  // Electron の通信（net.fetch）を使い、学内のプロキシの設定に従わせる。
  return createClaudeCaller({ fetch: net.fetch.bind(net), ...(schema ? { schema } : {}) });
}

// 設定ファイルの無いページから、Claude がその場でカードの束を作る（generate.js）。画面からは URL の文字だけを受け取る。
// 結果は { ok: true, config, message } か { ok: false, message }（理由の一文）。
ipcMain.handle('generate:start', async (_event, url) => {
  if (generating) return { ok: false, message: failureMessage('busy') };
  generating = true;
  try {
    const r = await generateDeck({ BrowserWindow, url: String(url || ''), callModel: makeCallModel(GenerateSchema), store: generatedStore() });
    if (!r.ok) return { ok: false, reason: r.reason, message: failureMessage(r.reason) };
    baseConfigs.set(r.config.id, r.config);
    configPaths.set(r.config.id, r.file);
    generatedIds.add(r.config.id);
    refreshEffective(r.config.id);
    return { ok: true, config: r.config, message: doneMessage(r.config) };
  } catch (e) {
    return { ok: false, reason: 'error', message: failureMessage('error') };
  } finally {
    generating = false;
  }
});

// 作った束を消す（置き場の設定ファイル・手元の自動の直し・開いている窓）。作った束にだけ効く。
ipcMain.handle('generate:delete', (_event, appId) => {
  const base = baseConfigs.get(appId);
  if (!base || !generatedIds.has(appId)) return { ok: false, message: 'これは Claude が作ったカードではないので、消せません。' };
  try {
    generatedStore().remove(appId);
  } catch (e) {
    return { ok: false, message: 'カードを消せませんでした。' };
  }
  for (const r of store().load(appId)) store().remove(appId, r.cardId);
  closeTarget(appId);
  configs.delete(appId);
  baseConfigs.delete(appId);
  configPaths.delete(appId);
  generatedIds.delete(appId);
  return { ok: true, message: `「${base.name}」のカードを消しました。` };
});

// 作った束を、支援者が確かめて配れるように、ダウンロードのフォルダへ設定ファイルとして書き出す。
ipcMain.handle('generate:export', (_event, appId) => {
  const base = baseConfigs.get(appId);
  if (!base || !generatedIds.has(appId)) return { ok: false, message: 'これは Claude が作ったカードではないので、書き出せません。' };
  try {
    // 自動で直した所があれば、それも当てた中身を書き出す。
    return { ok: true, message: exportedMessage(exportDeck(configs.get(appId) || base, app.getPath('downloads'))) };
  } catch (e) {
    return { ok: false, message: '設定ファイルを書き出せませんでした。' };
  }
});

// カードを動かす。当たらなければ、その場で自動で直す（autofix.js）。
ipcMain.handle('card:run', async (event, appId, cardId) => {
  const config = configs.get(appId);
  if (!config) return { ok: false, where: '(なし)', message: `アプリ「${appId}」の設定ファイルがありません` };
  try {
    const result = await runCardWithAutoRepair({
      BrowserWindow,
      config,
      cardId,
      callModel: makeCallModel(),
      store: store(),
      onRepairing: () => { if (!event.sender.isDestroyed()) event.sender.send('card:repairing', { appId, cardId }); },
    });
    const { config: _next, repaired, ...rest } = result;
    if (repaired) {
      refreshEffective(appId);
      return { ...rest, repaired: repairView(repaired) };
    }
    return rest;
  } catch (e) {
    return { ok: false, where: '(なし)', message: `動かせませんでした: ${e.message}` };
  }
});

// 自動で直した所の一覧（支援者の保守のカードで使う）。
ipcMain.handle('repair:list', (_event, appId) => {
  if (!baseConfigs.get(appId)) return { ok: false, message: `アプリ「${appId}」の設定ファイルがありません` };
  return { ok: true, repairs: refreshEffective(appId).map(repairView) };
});

// 自動で直したカードを、直す前に戻す（手元の上書きを外す）。
ipcMain.handle('repair:undo', (_event, appId, cardId) => {
  if (!baseConfigs.get(appId)) return { ok: false, message: `アプリ「${appId}」の設定ファイルがありません` };
  const removed = store().remove(appId, cardId);
  refreshEffective(appId);
  return removed ? { ok: true, repair: repairView(removed) } : { ok: false, message: 'このカードには、自動で直した所がありません。' };
});

// 自動で直した所を、設定ファイルに書く（配る）。書き方は「採る」の流れと同じ（書く前の中身を控えに残す）。
ipcMain.handle('repair:publish', (_event, appId, cardId) => {
  const base = baseConfigs.get(appId);
  const file = configPaths.get(appId);
  if (!base || !file) return { ok: false, message: `アプリ「${appId}」の設定ファイルがありません` };
  const active = refreshEffective(appId);
  const r = active.find((x) => x.cardId === cardId);
  const index = base.cards.findIndex((c) => c.id === cardId);
  if (!r || index < 0) return { ok: false, message: 'このカードには、自動で直した所がありません。' };
  try {
    saveConfigFile(file, applyRepairs(base, [{ index, newSelector: r.after }]), path.join(app.getPath('userData'), 'config-backups'));
  } catch (e) {
    return { ok: false, message: '設定ファイルに書けませんでした。書き込める場所にある設定ファイルか、確認してください。' };
  }
  const reloaded = loadConfigFile(file);
  if (!reloaded.config) return { ok: false, message: '書き直した設定ファイルが読めません。' };
  baseConfigs.set(appId, reloaded.config);
  // 設定ファイルに書いたので、手元の上書きは外す。
  store().remove(appId, cardId);
  refreshEffective(appId);
  return { ok: true, message: `「${r.title}」の直しを、設定ファイルに書きました。` };
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
    return { ok: true, message: sourceOpenedMessage() };
  } catch (e) {
    return { ok: false, message: '出典のページを開けませんでした。' };
  }
});

// YouTube のカード: 動画を探す（youtube-search）・決まったチャンネルの新しい動画を読む（youtube-channel）。
// 公式の YouTube Data API v3 だけで取り、保存しない。キーは環境変数から読み、画面には渡さない。結果は一件ずつの文と埋め込みの URL。
ipcMain.handle('youtube:list', async (_event, appId, cardId, query) => {
  const config = configs.get(appId);
  const card = config && config.kind === 'youtube' ? config.cards.find((c) => c.id === cardId) : null;
  if (!card || !['youtube-search', 'youtube-channel'].includes(card.action)) return { ok: false, message: 'YouTube のカードが設定ファイルにありません。' };
  const key = youtubeApiKey();
  if (!key) return { ok: false, message: NO_KEY_MESSAGE };
  try {
    const client = createYouTubeClient({ fetch: net.fetch.bind(net), key });
    const max = card.maxResults || DEFAULT_MAX;
    const videos = card.action === 'youtube-search' ? await client.search(String(query || ''), max) : await client.channelLatest(card.channelId, max);
    return { ok: true, items: videos.map((v) => ({ id: v.id, title: v.title, text: videoText(v), embedUrl: v.embedUrl })) };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});

// YouTube のカードの、利用規約とプライバシーポリシーのページを既定のブラウザで開く（この二つだけ）。
const POLICY_URLS = { 'youtube-terms': 'https://www.youtube.com/t/terms', 'google-privacy': 'https://policies.google.com/privacy' };
ipcMain.handle('policy:open', async (_event, name) => {
  const url = POLICY_URLS[String(name)];
  if (!url) return { ok: false, message: '開けるページではありません。' };
  try {
    await shell.openExternal(url);
    return { ok: true, message: sourceOpenedMessage(process.platform, 'ページ') };
  } catch (e) {
    return { ok: false, message: 'ページを開けませんでした。' };
  }
});

// 一覧のカードの一件に結び付いた所を読む（itemTarget）。
ipcMain.handle('card:item-target', async (_event, appId, cardId, index, key) => {
  const config = configs.get(appId);
  if (!config) return { ok: false, where: '(なし)', message: `アプリ「${appId}」の設定ファイルがありません` };
  try {
    return await readItemTarget(BrowserWindow, config, String(cardId), Number(index), {}, typeof key === 'string' && key !== '' ? key : null);
  } catch (e) {
    return { ok: false, where: '(なし)', message: `動かせませんでした: ${e.message}` };
  }
});

// ウェブアプリの窓を前に出す（ログインのため）。
ipcMain.handle('target:show', (_event, appId) => {
  if (!configs.get(appId)) return { ok: false, message: `アプリ「${appId}」の設定ファイルがありません` };
  return showTarget(appId) ? { ok: true } : { ok: false, message: 'ウェブアプリの窓が、まだ開いていません。カードを Enterキーで読んでください。' };
});

// 元のページを、そのままの見た目で前に出す（気象庁のような複雑なページを、そのまま見せるため）。窓がまだ無ければ開いてから出す。
// 出した窓で Esc キーを押すと、Todoku の窓へ戻る。
ipcMain.handle('target:reveal', async (_event, appId) => {
  const config = configs.get(appId);
  if (!config || config.kind === 'youtube') return { ok: false, message: 'このアプリには、表示できる元のページがありません。' };
  try {
    await revealTarget(BrowserWindow, config);
    return { ok: true, message: '元のページを表示しました。元のページでEscキーを押すと、Todoku に戻ります。' };
  } catch (e) {
    return { ok: false, message: '元のページを表示できませんでした。ネットワークを確認してください。' };
  }
});

// いまのページを既定のブラウザで開く。画面からは appId だけを受け取り、URL は受け取らない（ウェブアプリの窓のいまのページか、設定ファイルの url）。
// 開くのは http:// と https:// だけ。
ipcMain.handle('page:open-external', async (_event, appId) => {
  const config = configs.get(appId);
  if (!config || config.kind === 'youtube') return { ok: false, message: 'このアプリには、ブラウザで開けるページがありません。' };
  const url = browserUrl(currentPageUrl(appId), config.url);
  if (!url) return { ok: false, message: 'このページは、既定のブラウザでは開けません。' };
  try {
    await shell.openExternal(url);
    return { ok: true, message: sourceOpenedMessage(process.platform, 'いまのページ') };
  } catch (e) {
    return { ok: false, message: 'いまのページを開けませんでした。' };
  }
});

// 「このページのリンク」のカード: 設定ファイルの url のページのリンクを読む（アプリごとに最後に読んだ一覧を控える）。
// リンクの文字は読み上げに渡すだけで、Claude には送らない。
const lastLinks = new Map();
ipcMain.handle('page:links', async (_event, appId) => {
  const config = configs.get(appId);
  if (!config || config.kind === 'youtube') return { ok: false, where: '(なし)', message: 'このアプリには、リンクを読むページがありません。' };
  try {
    const r = await readLinks(BrowserWindow, config);
    if (!r.ok) return r;
    lastLinks.set(appId, r.links);
    return { ok: true, action: 'list', items: r.links.map((l) => l.text), links: r.links, truncated: r.truncated };
  } catch (e) {
    return { ok: false, where: '(なし)', message: `動かせませんでした: ${e.message}` };
  }
});

// リンクの行き先に Todoku の束（設定ファイル・作った束）があるかを探す。結果は { appId, cardId } か null。
ipcMain.handle('link:find', (_event, url) => {
  const found = findDeckFor(String(url || ''), [...configs.values()]);
  return found ? { appId: found.config.id, cardId: found.cardId } : null;
});

// 最後に読んだリンクの一覧の index 件目（0 から）を、既定のブラウザで開く。画面からは URL を受け取らない。
ipcMain.handle('link:open-external', async (_event, appId, index) => {
  const link = (lastLinks.get(appId) || [])[Number(index)];
  const url = link ? externalUrl(link.url) : null;
  if (!url) return { ok: false, message: 'そのリンクは、もうありません。「このページのリンク」をもう一度読んでください。' };
  try {
    await shell.openExternal(url);
    return { ok: true, message: sourceOpenedMessage(process.platform, `「${link.text}」のページ`) };
  } catch (e) {
    return { ok: false, message: 'リンクのページを開けませんでした。' };
  }
});

// 一行の記録を、標準の出力と userData の log.txt に残す（Windows の包みでは標準の出力が見えないため）。
function logLine(text) {
  const line = `${localStamp()} ${text}`;
  console.log(line);
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'log.txt'), `${line}\n`);
  } catch (e) {
    // 記録できなくても、アプリは続ける。
  }
}

app.whenReady().then(async () => {
  // プロキシの入口（環境変数 https_proxy か、OS の設定）に届くかを試し、届かなければこのアプリの中だけ直に繋ぐ（学外のため）。
  // どうなっても、カードの画面の窓は作る（確かめで例外が出ると、窓が一つも出ず、何も知らせなかった。見直しの9）。
  try {
    await chooseSystemProxy({
      resolveProxy: (u) => session.defaultSession.resolveProxy(u),
      setDirect: () => session.defaultSession.setProxy({ mode: 'direct' }),
      log: logLine,
    });
  } catch (e) {
    logLine(`プロキシの確認が途中で止まりました: ${e.message}`);
  }
  registerSettingsHandlers(ipcMain, settingsStore());
  attachEmbedReferer(session.defaultSession, require('../../package.json').build.appId);
  // ウェブアプリの窓で始まったダウンロードは、ダイアログを出さずにダウンロードのフォルダに保存する。
  // 押すカードの結果にならなかったもの（押してから遅れて始まったもの）は、終わったときに画面に知らせる。
  attachDownloads(session.defaultSession, {
    getDir: () => app.getPath('downloads'),
    onDone: (result) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('download:done', result);
    },
  });
  createWindow();
  // Dock から開き直したとき（macOS）: Todoku の窓が無ければ作る（ウェブアプリの窓の数では決めない）。
  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  });
});

// 二つ目の起動は、一つ目の Todoku の窓を前に出して終わる（同じ userData を二つで書き合わないため）。
// 試しの台本（TODOKU_TEST_HEADLESS）からは、作品を同時に起こすことがあるので、この守りを掛けない。
if (!testHeadless()) {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    });
  }
}

// Todoku は窓一つのアプリなので、Mac でも窓を閉じたら終える。窓の無いまま Dock に残ると、読み上げを使う人に分かりにくい
// （2026-11-04 に Mac の包みで、窓を閉じても処理が3つ残ることを確かめた）。
app.on('window-all-closed', () => {
  app.quit();
});
