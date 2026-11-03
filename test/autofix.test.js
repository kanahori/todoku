'use strict';
// 使う人の側で、その場で自動で直す所（src/main/autofix.js）の試し。
// Electron の窓の代わりに、ページで動かす文を見て決まった答えを返す偽の窓を使う。Claude も偽物（createClaudeCaller と同じ形）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createOverrideStore, applyOverrides, isConfident, withTimeout, proposeAutoRepair, runCardWithAutoRepair, autoRepairReasonText,
} = require('../src/main/autofix');
const { sourceOpenedMessage } = require('../src/main/messages');

// 偽の窓。page(script) が、ページで動かす文ごとの答えを返す。
function fakeBrowserWindow(page) {
  const scripts = [];
  class FakeWindow {
    constructor(options = {}) {
      this.url = '';
      this.visible = false;
      this.focusable = options.focusable !== false;
      this.loads = 0;
      this.webContents = {
        setWindowOpenHandler() {},
        getURL: () => this.url,
        loadURL: async (u) => { this.url = u; this.loads += 1; },
        executeJavaScript: async (script) => {
          scripts.push(script);
          return page(script);
        },
      };
    }
    async loadURL(u) { return this.webContents.loadURL(u); }
    isDestroyed() { return false; }
    isVisible() { return this.visible; }
    showInactive() { this.visible = true; }
    hide() { this.visible = false; }
    isFocusable() { return this.focusable; }
    setFocusable(v) { this.focusable = v; }
    on() {}
  }
  return { BrowserWindow: FakeWindow, scripts };
}

// ページで動かす文の、最初の引数（selector）を取り出す。
const argOf = (script) => JSON.parse(script.slice(script.lastIndexOf(')(') + 2).split(', ')[0].replace(/\)$/, ''));
const SKELETON = 'body\n  div.hero\n    div.vis-track\n      div.vis-item.is-active (文字あり)';

let seq = 0;
function makeConfig(cards) {
  seq += 1;
  return { id: `autofix-test-${seq}`, name: '作り物のアプリ', url: 'https://example.com/', cards };
}

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autofix-test-'));
  return { store: createOverrideStore(path.join(dir, 'repairs')), dir };
}

test('上書きのファイル: 足す・読む・外す。外して空になればファイルを消す', () => {
  const { store, dir } = tmpStore();
  try {
    assert.deepEqual(store.load('city'), []);
    store.add('city', { cardId: 'news', field: 'selector', before: '.old', after: '.new', reason: 'r', at: 't' });
    assert.equal(store.load('city').length, 1);
    assert.ok(fs.existsSync(path.join(dir, 'repairs', 'city.json')));
    // 直しをさらに直したときは、元の値に最初の直しの前の値を残す。
    store.add('city', { cardId: 'news', field: 'selector', before: '.new', after: '.newer', reason: 'r2', at: 't2' });
    assert.deepEqual(store.load('city').map((r) => [r.before, r.after]), [['.old', '.newer']]);
    const removed = store.remove('city', 'news');
    assert.equal(removed.after, '.newer');
    assert.ok(!fs.existsSync(path.join(dir, 'repairs', 'city.json')));
    assert.equal(store.remove('city', 'news'), null);
    assert.throws(() => store.load('../etc'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('上書きを当てる: 設定ファイルの値が元の値のままのカードにだけ当て、元の中身は変えない', () => {
  const config = makeConfig([
    { id: 'a', title: 'A', action: 'read', selector: '.a' },
    { id: 'b', title: 'B', action: 'list', selector: '.b2' },
  ]);
  const repairs = [
    { cardId: 'a', field: 'selector', before: '.a', after: '.a-new' },
    { cardId: 'b', field: 'selector', before: '.b', after: '.b-new' }, // 配られた設定ファイルで変わったので古い
    { cardId: 'gone', field: 'selector', before: '.x', after: '.y' },
  ];
  const { config: next, active, stale } = applyOverrides(config, repairs);
  assert.equal(next.cards[0].selector, '.a-new');
  assert.equal(next.cards[1].selector, '.b2');
  assert.deepEqual(active.map((r) => r.cardId), ['a']);
  assert.deepEqual(stale.map((r) => r.cardId), ['b', 'gone']);
  assert.equal(config.cards[0].selector, '.a');
});

test('確からしいの目安: read は1以上で文字あり、list は1件以上、click はちょうど1', () => {
  assert.equal(isConfident('read', { count: 1, hasText: true }), true);
  assert.equal(isConfident('read', { count: 2, hasText: true }), true);
  assert.equal(isConfident('read', { count: 1, hasText: false }), false);
  assert.equal(isConfident('read', { count: 0, hasText: false }), false);
  assert.equal(isConfident('list', { count: 4, hasText: false }), true);
  assert.equal(isConfident('list', { count: 0, hasText: false }), false);
  assert.equal(isConfident('click', { count: 1, hasText: false }), true);
  assert.equal(isConfident('click', { count: 2, hasText: true }), false);
  assert.equal(isConfident('click', { count: -1, hasText: false }), false);
});

test('時間切れでは、待つのをやめて中断の合図を出す', async () => {
  const controller = new AbortController();
  await assert.rejects(withTimeout(new Promise(() => {}), 30, controller), /時間切れ/);
  assert.equal(controller.signal.aborted, true);
  assert.equal(await withTimeout(Promise.resolve(7), 1000), 7);
});

test('案を作る: いまのページ（読み込み直さない）の構造だけを送り、確からしければ採る', async () => {
  const config = makeConfig([{ id: 'carousel', title: '大きな画像のお知らせを全部読む', action: 'list', selector: '.hero .slide' }]);
  const { BrowserWindow, scripts } = fakeBrowserWindow((script) => {
    if (script.includes('pageSkeleton')) return { skeleton: SKELETON, nodes: 4, truncated: false };
    if (script.includes('pageTry')) return { count: 4, hasText: true };
    throw new Error('想定していない文');
  });
  let sent = null;
  const callModel = async (req) => {
    sent = req;
    return { proposals: [{ where: 'cards[0].selector', selector: '.hero .vis-item:not(.is-clone)', reason: '作りが変わったため。' }] };
  };
  const at = new Date('2026-11-03T04:00:00Z');
  const r = await proposeAutoRepair({ BrowserWindow, config, index: 0, callModel, now: () => at });
  assert.equal(r.ok, true);
  assert.deepEqual(
    { ...r.repair },
    { cardId: 'carousel', field: 'selector', before: '.hero .slide', after: '.hero .vis-item:not(.is-clone)', reason: '作りが変わったため。', at: at.toISOString(), action: 'list', title: '大きな画像のお知らせを全部読む', matches: 4 },
  );
  assert.ok(sent.user.includes('cards[0].selector') && sent.user.includes('div.vis-item.is-active (文字あり)'));
  assert.ok(sent.signal instanceof AbortSignal);
  assert.equal(scripts.length, 2);
});

test('案を作る: 構造に文字が混ざったら Claude を呼ばない', async () => {
  const config = makeConfig([{ id: 'c', title: '題', action: 'read', selector: '.x' }]);
  const { BrowserWindow } = fakeBrowserWindow(() => ({ skeleton: 'div.box 締め切り', nodes: 1, truncated: false }));
  let called = 0;
  const r = await proposeAutoRepair({ BrowserWindow, config, index: 0, callModel: async () => { called += 1; return { proposals: [] }; } });
  assert.deepEqual([r.ok, r.reason, called], [false, 'text-in-structure', 0]);
});

test('案を作る: 確からしくない・案が無い・Claude が失敗した・時間切れは採らない', async () => {
  const run = async (action, probe, callModel, timeoutMs) => {
    const config = makeConfig([{ id: 'c', title: '題', action, selector: '.x' }]);
    const { BrowserWindow } = fakeBrowserWindow((script) => (script.includes('pageSkeleton') ? { skeleton: SKELETON } : probe));
    return proposeAutoRepair({ BrowserWindow, config, index: 0, callModel, timeoutMs });
  };
  const answer = async () => ({ proposals: [{ where: 'cards[0].selector', selector: '.y', reason: 'r' }] });
  assert.equal((await run('click', { count: 2, hasText: true }, answer)).reason, 'not-confident');
  assert.equal((await run('read', { count: 1, hasText: false }, answer)).reason, 'not-confident');
  assert.equal((await run('read', { count: 1, hasText: true }, async () => ({ proposals: [{ where: 'cards[0].selector', selector: '', reason: '作れない' }] }))).reason, 'no-proposal');
  assert.equal((await run('read', { count: 1, hasText: true }, async () => { throw new Error('通信の誤り'); })).reason, 'model-error');
  let aborted = null;
  const slow = ({ signal }) => new Promise(() => { signal.addEventListener('abort', () => { aborted = true; }); });
  assert.equal((await run('read', { count: 1, hasText: true }, slow, 30)).reason, 'timeout');
  assert.equal(aborted, true);
});

// runCard の文（pageAction）に、selector ごとの答えを返す偽のページ。
function pageWith(answers) {
  return (script) => {
    if (script.includes('pageSkeleton')) return { skeleton: SKELETON, nodes: 4, truncated: false };
    if (script.includes('pageTry')) return answers.try;
    if (script.includes('pageAction')) return answers.action(argOf(script));
    throw new Error('想定していない文');
  };
}

test('カードを動かす: 当たらない読むカードを自動で直し、読み直して、手元に残す', async () => {
  const { store, dir } = tmpStore();
  try {
    const config = makeConfig([{ id: 'counter', title: '窓口の案内を読む', action: 'read', selector: '.counter-info' }]);
    const { BrowserWindow } = fakeBrowserWindow(pageWith({
      try: { count: 1, hasText: true },
      action: (sel) => (sel === '.counter-box' ? { found: true, text: '作り物の窓口の案内', truncated: false } : { found: false, reason: 'none' }),
    }));
    let repairing = 0;
    const r = await runCardWithAutoRepair({
      BrowserWindow, config, cardId: 'counter', store, onRepairing: () => { repairing += 1; },
      callModel: async () => ({ proposals: [{ where: 'cards[0].selector', selector: '.counter-box', reason: 'class の名前が変わったため。' }] }),
    });
    assert.equal(r.ok, true);
    assert.equal(r.text, '作り物の窓口の案内');
    assert.equal(r.repaired.after, '.counter-box');
    assert.equal(r.config.cards[0].selector, '.counter-box');
    assert.equal(config.cards[0].selector, '.counter-info');
    assert.equal(repairing, 1);
    assert.deepEqual(store.load(config.id).map((x) => [x.before, x.after]), [['.counter-info', '.counter-box']]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('カードを動かす: 押すカードは直しても押し直さない', async () => {
  const { store, dir } = tmpStore();
  try {
    const config = makeConfig([{ id: 'send', title: '送る', action: 'click', selector: '#old-send' }]);
    const pressed = [];
    const { BrowserWindow } = fakeBrowserWindow(pageWith({
      try: { count: 1, hasText: true },
      action: (sel) => { pressed.push(sel); return { found: false, reason: 'none' }; },
    }));
    const r = await runCardWithAutoRepair({
      BrowserWindow, config, cardId: 'send', store,
      callModel: async () => ({ proposals: [{ where: 'cards[0].selector', selector: '#send', reason: 'id が変わったため。' }] }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.repaired.after, '#send');
    assert.deepEqual(pressed, ['#old-send']);
    assert.equal(store.load(config.id).length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('カードを動かす: 鍵が無い・確からしくないときは、直さずに「自動で直せませんでした」の印を付ける', async () => {
  const { store, dir } = tmpStore();
  try {
    const config = makeConfig([{ id: 'news', title: '新着', action: 'list', selector: '.news li' }]);
    const { BrowserWindow } = fakeBrowserWindow(pageWith({ try: { count: 0, hasText: false }, action: () => ({ found: false, reason: 'none' }) }));
    const noKey = await runCardWithAutoRepair({ BrowserWindow, config, cardId: 'news', store, callModel: null });
    assert.deepEqual([noKey.ok, noKey.autoRepairFailed, noKey.autoRepairReason, noKey.where], [false, true, 'no-key', 'cards[0].selector']);
    assert.equal(noKey.autoRepairReasonText, 'Claude の鍵がありません');
    const weak = await runCardWithAutoRepair({
      BrowserWindow, config, cardId: 'news', store,
      callModel: async () => ({ proposals: [{ where: 'cards[0].selector', selector: '.nothing', reason: 'r' }] }),
    });
    assert.deepEqual([weak.ok, weak.autoRepairFailed, weak.autoRepairReason], [false, true, 'not-confident']);
    assert.equal(weak.autoRepairReasonText, '確かな案がありませんでした');
    assert.deepEqual(store.load(config.id), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('直せなかった理由の言い方: 鍵が無い・時間切れ・確かな案が無い・Claude が失敗した。知らない理由は添えない', () => {
  assert.equal(autoRepairReasonText('no-key'), 'Claude の鍵がありません');
  assert.equal(autoRepairReasonText('timeout'), '時間内に終わりませんでした');
  for (const r of ['no-proposal', 'same-selector', 'not-confident', 'reread-failed']) assert.equal(autoRepairReasonText(r), '確かな案がありませんでした', r);
  assert.equal(autoRepairReasonText('model-error'), 'Claude が案を作れませんでした');
  assert.equal(autoRepairReasonText('text-in-structure'), 'ページの文字を除けなかったので、Claude に頼みませんでした');
  assert.equal(autoRepairReasonText('error'), '直す途中で誤りが起きました');
  assert.equal(autoRepairReasonText('toString'), '');
  assert.equal(autoRepairReasonText(undefined), '');
});

test('カードを動かす: 時間切れ・Claude が失敗したときは、その理由の言い方を付ける', async () => {
  const { store, dir } = tmpStore();
  try {
    const config = makeConfig([{ id: 'news', title: '新着', action: 'list', selector: '.news li' }]);
    const { BrowserWindow } = fakeBrowserWindow(pageWith({ try: { count: 0, hasText: false }, action: () => ({ found: false, reason: 'none' }) }));
    const late = await runCardWithAutoRepair({ BrowserWindow, config, cardId: 'news', store, timeoutMs: 30, callModel: () => new Promise(() => {}) });
    assert.deepEqual([late.autoRepairFailed, late.autoRepairReason, late.autoRepairReasonText], [true, 'timeout', '時間内に終わりませんでした']);
    const broken = await runCardWithAutoRepair({ BrowserWindow, config, cardId: 'news', store, callModel: async () => { throw new Error('通信の誤り'); } });
    assert.deepEqual([broken.autoRepairFailed, broken.autoRepairReason, broken.autoRepairReasonText], [true, 'model-error', 'Claude が案を作れませんでした']);
    assert.deepEqual(store.load(config.id), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('カードを動かす: ログインが要るとき・書き方の誤りのときは、自動で直さない', async () => {
  const { store, dir } = tmpStore();
  try {
    let called = 0;
    const callModel = async () => { called += 1; return { proposals: [] }; };
    const login = { ...makeConfig([{ id: 'd', title: 'D', action: 'read', selector: '#d' }]), login: { selector: 'body.out' } };
    const a = fakeBrowserWindow(pageWith({ action: () => ({ found: false, reason: 'login' }) }));
    const r1 = await runCardWithAutoRepair({ BrowserWindow: a.BrowserWindow, config: login, cardId: 'd', store, callModel });
    assert.equal(r1.needLogin, true);
    const bad = makeConfig([{ id: 'e', title: 'E', action: 'read', selector: 'ul[' }]);
    const b = fakeBrowserWindow(pageWith({ action: () => ({ found: false, reason: 'invalid' }) }));
    const r2 = await runCardWithAutoRepair({ BrowserWindow: b.BrowserWindow, config: bad, cardId: 'e', store, callModel });
    assert.equal(r2.message, 'selector の書き方が正しくありません');
    assert.equal(r2.autoRepairFailed, undefined);
    assert.equal(called, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('出典のページを開いた知らせに、Todoku へ戻るキーを添える（Mac は Command キー、ほかは Alt キー）', () => {
  assert.equal(sourceOpenedMessage('win32'), '出典のページを、既定のブラウザで開きました。Todoku に戻るには Alt キーと Tab キーを押してください。');
  assert.equal(sourceOpenedMessage('darwin'), '出典のページを、既定のブラウザで開きました。Todoku に戻るには Command キーと Tab キーを押してください。');
});
