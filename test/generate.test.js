'use strict';
// 設定ファイルの無いページから、Claude がその場でカードの束を作る所（src/main/generate.js）の試し。
// Electron の窓の代わりに、ページで動かす文を見て決まった答えを返す偽の窓を使う。Claude も偽物（同じ形の関数）。
// ページの名前・文は全部作り物。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  GenerateSchema, failureMessage, doneMessage, createGeneratedStore, newDeckId, acceptUrl, limitStructure,
  normalizeCandidates, pickCards, deckName, generateDeck, exportDeck, exportedMessage, MAX_CARDS, waitForSettle,
} = require('../src/main/generate');
const { validateConfig, loadConfigDir } = require('../src/main/config');

// 偽の窓。page(script) が、ページで動かす文ごとの答えを返す。
function fakeBrowserWindow(page, { title = '作り物の町のお知らせ', landed = null } = {}) {
  const made = [];
  class FakeWindow {
    constructor(options = {}) {
      this.url = '';
      this.visible = false;
      this.focusable = options.focusable !== false;
      this.destroyed = false;
      made.push(this);
      this.webContents = {
        setWindowOpenHandler() {},
        getURL: () => landed || this.url,
        getTitle: () => title,
        loadURL: async (u) => { this.url = u; },
        executeJavaScript: async (script) => page(script),
      };
    }
    async loadURL(u) { return this.webContents.loadURL(u); }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
    isVisible() { return this.visible; }
    showInactive() { this.visible = true; }
    hide() { this.visible = false; }
    isFocusable() { return this.focusable; }
    setFocusable(v) { this.focusable = v; }
    on() {}
  }
  return { BrowserWindow: FakeWindow, made };
}

const SKELETON = 'body\n  header.top\n    nav.menu\n      a (文字あり)\n  main\n    h2.news-title (文字あり)\n    ul.news\n      li (文字あり)';
const SETTLE = { stepMs: 1, minMs: 0, stableMs: 0, maxMs: 30 };

// ページで動かす文の種類ごとに答える。inspect は案の数だけの probe を返す。
function pageOf({ skeleton = SKELETON, probes }) {
  return (script) => {
    if (script.includes('pageSettleProbe')) return { nodes: 40, chars: 100, resources: 3, waiting: false };
    if (script.includes('pageSkeleton')) return { skeleton, nodes: 8, truncated: false };
    if (script.includes('pageInspect')) return probes;
    throw new Error(`試しに無い文: ${script.slice(0, 60)}`);
  };
}

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'generate-test-'));
  return { store: createGeneratedStore(path.join(dir, 'generated')), dir };
}

const ANSWER = {
  cards: [
    { role: 'list', action: 'list', selector: 'ul.news li', container: 'ul.news', titleSelector: 'h2.news-title', reason: '新着の一覧。' },
    { role: 'menu', action: 'list', selector: 'nav.menu a', container: '', titleSelector: '', reason: 'メニュー。' },
    { role: 'main', action: 'read', selector: 'main', container: '', titleSelector: '', reason: '本文。' },
    { role: 'button', action: 'click', selector: 'nav.menu a', container: '', titleSelector: '', reason: '当たる数が多い。' },
  ],
};
const PROBES = [
  { count: 3, hasText: true, containerOk: true, title: '町のお知らせ' },
  { count: 4, hasText: true, containerOk: false, title: '' },
  { count: 1, hasText: true, containerOk: false, title: '' },
  { count: 4, hasText: true, containerOk: false, title: 'くらし' },
];

test('入れた URL は http:// と https:// だけ通す（試しのときだけ練習のページも通す）', () => {
  assert.equal(acceptUrl(' https://example.com/a?b=1 '), 'https://example.com/a?b=1');
  assert.equal(acceptUrl('http://example.com'), 'http://example.com/');
  for (const bad of ['', 'example.com', 'javascript:alert(1)', 'file:///etc/hosts', 'ftp://example.com/', 'https://exa mple.com/']) {
    assert.equal(acceptUrl(bad), null, bad);
  }
  assert.equal(acceptUrl('fixture:city-top.html'), null);
  assert.equal(acceptUrl('fixture:city-top.html', { allowFixtures: true }), 'fixture:city-top.html');
  assert.equal(acceptUrl('fixture:../x.html', { allowFixtures: true }), null);
});

test('送る構造が上限を越えたら、行の切れ目で切り、切ったことを返す', () => {
  assert.deepEqual(limitStructure('a\nb', 10), { text: 'a\nb', cut: false });
  const r = limitStructure('body\n  div.one\n  div.two\n  div.three', 20);
  assert.equal(r.cut, true);
  assert.equal(r.text, 'body\n  div.one');
  assert.ok(r.text.length <= 20);
});

test('Claude の案をそろえる: 空のセレクタ・知らない操作は落とし、list でないカードの container は外す', () => {
  const out = normalizeCandidates({
    cards: [
      { role: 'list', action: 'list', selector: ' ul li ', container: ' ul ', titleSelector: ' h2 ' },
      { role: 'main', action: 'read', selector: '', container: '', titleSelector: '' },
      { role: 'main', action: 'type', selector: 'input', container: '', titleSelector: '' },
      { role: 'nazo', action: 'read', selector: 'main', container: 'main', titleSelector: '' },
    ],
  });
  assert.deepEqual(out, [
    { role: 'list', action: 'list', selector: 'ul li', container: 'ul', titleSelector: 'h2' },
    { role: 'other', action: 'read', selector: 'main', container: '', titleSelector: '' },
  ]);
  assert.deepEqual(normalizeCandidates(null), []);
  const many = { cards: Array.from({ length: 30 }, (_, k) => ({ role: 'main', action: 'read', selector: `#x${k}`, container: '', titleSelector: '' })) };
  assert.equal(normalizeCandidates(many).length, 16);
});

test('試した結果で残すカードを選ぶ: 当たらない・空・押す所が一つでない・重なりを落とし、題を手元で作る', () => {
  const candidates = [
    { role: 'list', action: 'list', selector: 'ul.news li', container: 'ul.news', titleSelector: 'h2' },
    { role: 'list', action: 'list', selector: 'ol li', container: 'ol', titleSelector: '' },
    { role: 'main', action: 'read', selector: '.empty', container: '', titleSelector: '' },
    { role: 'button', action: 'click', selector: 'a', container: '', titleSelector: '' },
    { role: 'button', action: 'click', selector: '#go', container: '', titleSelector: '' },
    { role: 'other', action: 'read', selector: '[[', container: '', titleSelector: '' },
    { role: 'list', action: 'list', selector: 'ul.news li', container: '', titleSelector: '' },
    { role: 'list', action: 'list', selector: '.more li', container: '', titleSelector: '' },
    { role: 'main', action: 'read', selector: '.a', container: '', titleSelector: 'h3' },
    { role: 'main', action: 'read', selector: '.b', container: '', titleSelector: 'h3' },
  ];
  const probes = [
    { count: 3, hasText: true, containerOk: true, title: '  町の\n お知らせ  ' },
    { count: 2, hasText: true, containerOk: false, title: '' },
    { count: 1, hasText: false, containerOk: false, title: '' },
    { count: 5, hasText: true, containerOk: false, title: 'リンク' },
    { count: 1, hasText: true, containerOk: false, title: '探す' },
    { count: -1, hasText: false, containerOk: false, title: '' },
    { count: 3, hasText: true, containerOk: false, title: '' },
    { count: 0, hasText: false, containerOk: false, title: '' },
    { count: 1, hasText: true, containerOk: false, title: '同じ題' },
    { count: 1, hasText: true, containerOk: false, title: '同じ題' },
  ];
  const cards = pickCards(candidates, probes);
  assert.deepEqual(cards, [
    { id: 'list-1', title: '町の お知らせ', action: 'list', selector: 'ul.news li', container: 'ul.news' },
    { id: 'list-2', title: '一覧 1', action: 'list', selector: 'ol li' },
    { id: 'button-3', title: '探す', action: 'click', selector: '#go' },
    { id: 'main-4', title: '同じ題', action: 'read', selector: '.a' },
    { id: 'main-5', title: '同じ題 2', action: 'read', selector: '.b' },
  ]);
  // 多すぎるときは上限で止める。
  const lots = Array.from({ length: 12 }, (_, k) => ({ role: 'main', action: 'read', selector: `#p${k}`, container: '', titleSelector: '' }));
  const lotsProbes = lots.map(() => ({ count: 1, hasText: true, containerOk: false, title: '' }));
  const capped = pickCards(lots, lotsProbes);
  assert.equal(capped.length, MAX_CARDS);
  assert.equal(capped[7].title, '本文 8');
});

test('題が地名の一語のカードと、題の手がかりの無い検索のカード: 中の短い文字か操作の種類を題にし、中身が一語だけのカードは作らない。押すカードの一語の題は、何をするかの分かる形にする', () => {
  const candidates = [
    { role: 'heading', action: 'read', selector: '.crumb', container: '', titleSelector: '' },
    { role: 'list', action: 'list', selector: '.towns li', container: '.towns', titleSelector: '' },
    { role: 'main', action: 'read', selector: '.today', container: '', titleSelector: '' },
    { role: 'main', action: 'read', selector: '.area', container: '', titleSelector: '' },
    { role: 'search', action: 'click', selector: '.go', container: '', titleSelector: '' },
    { role: 'search', action: 'click', selector: '.go2', container: '', titleSelector: '' },
    { role: 'menu', action: 'click', selector: '#town', container: '', titleSelector: '' },
    { role: 'main', action: 'read', selector: '.warn', container: '', titleSelector: '' },
    { role: 'menu', action: 'click', selector: '#pick', container: '', titleSelector: '' },
    { role: 'search', action: 'click', selector: '#find', container: '', titleSelector: '' },
    { role: 'search', action: 'click', selector: '#find-town', container: '', titleSelector: '' },
  ];
  const probes = [
    { count: 1, hasText: true, containerOk: false, title: '全国', body: '全国', texts: ['全国'] },
    { count: 3, hasText: true, containerOk: true, title: 'あおば県', body: 'あおば町 みどり町 さくら町', texts: ['あおば町', 'みどり町', 'さくら町'] },
    { count: 1, hasText: true, containerOk: false, title: 'あおば県', body: 'あおば県 大雨注意報が出ています。', texts: ['あおば県', '大雨注意報が出ています。'] },
    { count: 1, hasText: true, containerOk: false, title: 'みどり市', body: 'みどり市 長い説明の文だけがあります', texts: ['みどり市'] },
    { count: 1, hasText: true, containerOk: false, title: '', body: '', texts: [] },
    { count: 1, hasText: true, containerOk: false, title: '', body: '', texts: ['くわしく探す'] },
    // 押すカードの題が地名や部品の名前の一語なら、何をするカードかが分かる形にする。
    { count: 1, hasText: true, containerOk: false, title: 'さくら町', body: '', texts: ['さくら町'] },
    // 題が違っても、中身が一語だけの読むカードは作らない。
    { count: 1, hasText: true, containerOk: false, title: 'あおば県の警報・注意報', body: '全国', texts: ['全国'] },
    { count: 1, hasText: true, containerOk: false, title: '市町村選択', body: '', texts: [] },
    { count: 1, hasText: true, containerOk: false, title: '検索', body: '', texts: [] },
    { count: 1, hasText: true, containerOk: false, title: '施設検索', body: '', texts: [] },
  ];
  // 一つの束は 8枚までなので、前の7つと後の4つに分けて確かめる。
  assert.deepEqual(pickCards(candidates.slice(0, 7), probes.slice(0, 7)).map((c) => c.title),
    ['地域を選ぶ', '大雨注意報が出ています。', 'みどり市の情報', 'サイト内を検索する', 'くわしく探す', '地域を選ぶ（さくら町）']);
  assert.deepEqual(pickCards(candidates.slice(7), probes.slice(7)).map((c) => c.title),
    ['市町村を選ぶ', 'サイト内を検索する', '施設を検索する']);
});

test('題と束の名前: 長ければ語の切れ目で切り、「ページの題／サイトの名前」はページの題だけにする', () => {
  // 束の名前（40字まで）: サイトの名前を外す。
  assert.equal(deckName('路線バスのご案内／あおば町公式ウェブサイト', 'https://example.com/'), '路線バスのご案内');
  assert.equal(deckName('自転車の貸し出し | あおば町', 'https://example.com/'), '自転車の貸し出し');
  assert.equal(deckName('お知らせ - あおば町', 'https://example.com/'), 'お知らせ');
  // 語の切れ目（括弧の前・読点の前）で切る。
  const long = 'あおば町の路線バスと乗り合いタクシーのご案内と時刻表の見方（予約電話番号、利用方法）';
  assert.equal(deckName(long, 'https://example.com/'), 'あおば町の路線バスと乗り合いタクシーのご案内と時刻表の見方');
  // カードの題（30字まで）
  const candidates = [{ role: 'main', action: 'read', selector: '.a', container: '', titleSelector: '' }];
  const probes = [{ count: 1, hasText: true, containerOk: false, title: '乗り合いタクシーの使い方と予約の仕方（予約電話番号、利用方法）', body: '本文の文があります。', texts: [] }];
  assert.deepEqual(pickCards(candidates, probes).map((c) => c.title), ['乗り合いタクシーの使い方と予約の仕方']);
});

test('作った束: パンくずと「現在のページ」は作らず、目次は「目次を読む」の一枚にまとめ、重なった題は番号でなく中の見出しにする', () => {
  const card = (selector, action = 'list') => ({ role: 'list', action, selector, container: '', titleSelector: '' });
  const candidates = [card('.crumb li'), card('.here', 'read'), card('.toc li'), card('.toc2 li'), card('.s1', 'read'), card('.s2', 'read'), card('.s3', 'read')];
  const p = (o) => ({ count: 2, hasText: true, containerOk: false, body: '本文の文があります。 二つ目の文です。', texts: [], alts: [], ...o });
  const probes = [
    p({ title: 'トップ', crumb: true }),
    p({ title: '現在のページ' }),
    p({ title: '路線バスのご案内', toc: true }),
    p({ title: '資料の一覧', toc: true }),
    p({ title: '利用方法', alts: ['利用方法', '予約のしかた'] }),
    p({ title: '利用方法', alts: ['利用方法', '乗り方'] }),
    p({ title: '利用方法', alts: ['利用方法'] }),
  ];
  assert.deepEqual(pickCards(candidates, probes).map((c) => c.title), ['目次を読む', '利用方法', '乗り方', '利用方法 2']);
});

test('束の名前はページの title（長ければ切る）。無ければホスト名、それも無ければ「新しいページ」', () => {
  assert.equal(deckName('  作り物の町\n のお知らせ ', 'https://example.com/'), '作り物の町 のお知らせ');
  assert.equal(deckName('あ'.repeat(60), 'https://example.com/').length, 40);
  assert.equal(deckName('', 'https://example.com/x'), 'example.com');
  assert.equal(deckName('', 'fixture:city-top.html'), '新しいページ');
});

test('作る: 構造だけを送り、試して残ったカードを新しい束として保存する（文字・URL・題は送らない）', async () => {
  const { store, dir } = tmpStore();
  try {
    const { BrowserWindow, made } = fakeBrowserWindow(pageOf({ probes: PROBES }), { landed: 'https://example.com/news/' });
    let sent = null;
    const callModel = async (req) => { sent = req; return ANSWER; };
    const r = await generateDeck({
      BrowserWindow, url: 'https://example.com/news', callModel, store, settle: SETTLE, now: () => new Date('2026-11-03T05:00:00Z'),
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(sent.user.includes('ul.news') && sent.user.includes('<structure>'));
    assert.ok(!sent.user.includes('example.com') && !sent.user.includes('作り物の町'), sent.user);
    assert.equal(typeof sent.signal, 'object');
    assert.match(sent.system, /4〜8枚/);
    assert.deepEqual(r.config.cards.map((c) => [c.id, c.title, c.action]), [
      ['list-1', '町のお知らせ', 'list'],
      ['menu-2', 'メニュー 1', 'list'],
      ['main-3', '本文 1', 'read'],
    ]);
    assert.equal(r.dropped, 1);
    assert.equal(r.config.name, '作り物の町のお知らせ');
    assert.equal(r.config.url, 'https://example.com/news/');
    assert.match(r.config.id, /^page-[a-z0-9]+$/);
    assert.deepEqual(validateConfig(r.config), []);
    // 保存した束は、設定ファイルの読み方でそのまま読める（次の起動でも一覧に出る）。
    const loaded = loadConfigDir(store.dir);
    assert.equal(loaded.length, 1);
    assert.deepEqual(loaded[0].config, r.config);
    assert.equal(doneMessage(r.config), '「作り物の町のお知らせ」のカードを3枚作りました。');
    // 作れたときは、窓を閉じない（カードを読むときにそのまま使う）。
    assert.equal(made[0].destroyed, false);
    // 消す。
    assert.equal(store.remove(r.config.id), true);
    assert.equal(loadConfigDir(store.dir).length, 0);
    assert.equal(store.remove(r.config.id), false);
    assert.throws(() => store.remove('../x'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('作らない: URL が正しくない・鍵が無いときは、ページを開かず Claude も呼ばない', async () => {
  const { store, dir } = tmpStore();
  try {
    const { BrowserWindow, made } = fakeBrowserWindow(pageOf({ probes: PROBES }));
    let calls = 0;
    const callModel = async () => { calls += 1; return ANSWER; };
    assert.deepEqual(await generateDeck({ BrowserWindow, url: 'file:///etc/hosts', callModel, store }), { ok: false, reason: 'bad-url' });
    assert.deepEqual(await generateDeck({ BrowserWindow, url: 'https://example.com/', callModel: null, store }), { ok: false, reason: 'no-key' });
    assert.equal(made.length, 0);
    assert.equal(calls, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('作らない: 構造に文字が混ざったら送らず、窓を閉じる', async () => {
  const { store, dir } = tmpStore();
  try {
    const { BrowserWindow, made } = fakeBrowserWindow(pageOf({ skeleton: 'body\n  div.お知らせ', probes: PROBES }));
    let calls = 0;
    const r = await generateDeck({ BrowserWindow, url: 'https://example.com/', callModel: async () => { calls += 1; return ANSWER; }, store, settle: SETTLE });
    assert.equal(r.reason, 'text-in-structure');
    assert.equal(calls, 0);
    assert.equal(made[0].destroyed, true);
    assert.equal(fs.existsSync(store.dir), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('作らない: 残るカードが無ければ保存せず、窓を閉じる', async () => {
  const { store, dir } = tmpStore();
  try {
    const none = PROBES.map(() => ({ count: 0, hasText: false, containerOk: false, title: '' }));
    const { BrowserWindow, made } = fakeBrowserWindow(pageOf({ probes: none }));
    const r = await generateDeck({ BrowserWindow, url: 'https://example.com/', callModel: async () => ANSWER, store, settle: SETTLE });
    assert.equal(r.reason, 'no-cards');
    assert.equal(made[0].destroyed, true);
    assert.equal(fs.existsSync(store.dir), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('時間切れ: Claude を止め、保存しない。Claude の失敗は model-error', async () => {
  const { store, dir } = tmpStore();
  try {
    const { BrowserWindow, made } = fakeBrowserWindow(pageOf({ probes: PROBES }));
    let aborted = false;
    const slow = ({ signal }) => new Promise((resolve) => {
      signal.addEventListener('abort', () => { aborted = true; });
      setTimeout(() => resolve(ANSWER), 300);
    });
    const r = await generateDeck({ BrowserWindow, url: 'https://example.com/', callModel: slow, store, settle: SETTLE, timeoutMs: 100 });
    assert.equal(r.reason, 'timeout');
    assert.equal(aborted, true);
    await new Promise((res) => setTimeout(res, 350));
    assert.equal(fs.existsSync(store.dir), false);
    assert.equal(made[0].destroyed, true);

    const broken = await generateDeck({ BrowserWindow, url: 'https://example.com/', callModel: async () => { throw new Error('作り物の失敗'); }, store, settle: SETTLE });
    assert.equal(broken.reason, 'model-error');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('作れなかったときの理由は、どれも一文', () => {
  for (const reason of ['bad-url', 'no-key', 'open-failed', 'text-in-structure', 'timeout', 'model-error', 'no-cards', 'save-failed', 'busy', 'error', 'nazo']) {
    const m = failureMessage(reason);
    assert.match(m, /。$/, reason);
    assert.equal(m.split('。').length, 2, `${reason}: ${m}`);
  }
});

test('書き出す: ダウンロードのフォルダに todoku-<id>.json として書き、同じ名前があれば番号を付ける', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'generate-export-'));
  try {
    const config = { id: 'page-abc', name: '作り物', url: 'https://example.com/', cards: [{ id: 'main-1', title: '本文 1', action: 'read', selector: 'main' }] };
    assert.equal(exportDeck(config, dir), 'todoku-page-abc.json');
    assert.equal(exportDeck(config, dir), 'todoku-page-abc (1).json');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'todoku-page-abc.json'), 'utf8')), config);
    assert.equal(exportedMessage('todoku-page-abc.json'), 'ダウンロードのフォルダに「todoku-page-abc.json」として書き出しました。支援者が確かめてから、設定ファイルとして配ってください。');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('返させる形（GenerateSchema）と id', () => {
  assert.ok(GenerateSchema.safeParse(ANSWER).success);
  assert.ok(!GenerateSchema.safeParse({ cards: [{ ...ANSWER.cards[0], role: 'nazo' }] }).success);
  assert.ok(!GenerateSchema.safeParse({ cards: [{ ...ANSWER.cards[0], action: 'type' }] }).success);
  assert.equal(newDeckId(() => new Date(0)), 'page-0');
});

test('落ち着くまで待つ: 要素の数・文字の量・読み込んだ部品の数が変わらず、待つ印が無くなってから終わる', async () => {
  // 一回ごとのページの様子（作り物）。3回目に後から表が出て、5回目までは主な区画が空（waiting）。
  const snaps = [
    { nodes: 10, chars: 50, resources: 2, waiting: true },
    { nodes: 10, chars: 50, resources: 3, waiting: true },
    { nodes: 30, chars: 400, resources: 3, waiting: true },
    { nodes: 30, chars: 400, resources: 3, waiting: true },
    { nodes: 30, chars: 400, resources: 3, waiting: false },
    { nodes: 30, chars: 400, resources: 3, waiting: false },
    { nodes: 30, chars: 400, resources: 3, waiting: false },
  ];
  let calls = 0;
  const win = { webContents: { executeJavaScript: async () => snaps[Math.min(calls++, snaps.length - 1)] } };
  // 一回を 1ミリ秒、落ち着きは 1ミリ秒以上変わらないこととする。
  const n = await waitForSettle(win, { stepMs: 1, minMs: 0, stableMs: 1, maxMs: 5000 });
  assert.equal(n, 30);
  assert.ok(calls >= 5, `待つ印が消える5回目より前に終わった（${calls}回）`);
  assert.ok(calls <= 7, `落ち着いた後も待ち続けた（${calls}回）`);
});

test('落ち着くまで待つ: ずっと変わり続けるページでも、上限の時間で終わる', async () => {
  let calls = 0;
  const win = { webContents: { executeJavaScript: async () => ({ nodes: ++calls, chars: 0, resources: 0, waiting: false }) } };
  const started = Date.now();
  await waitForSettle(win, { stepMs: 5, minMs: 0, stableMs: 50, maxMs: 60 });
  assert.ok(Date.now() - started < 1000);
});
