'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { resolveUrl, buildScript, pageProbe } = require('../src/main/target');
const { validateConfig } = require('../src/main/config');

test('fixture: の url は test/fixtures/ のファイルになる', () => {
  const expected = pathToFileURL(path.join(__dirname, 'fixtures', 'practice.html')).href;
  assert.equal(resolveUrl('fixture:practice.html'), expected);
  assert.equal(resolveUrl('https://example.com/'), 'https://example.com/');
});

test('カードの path は同じサイトの中のページになる', () => {
  assert.equal(resolveUrl('https://example.com/', '/my/'), 'https://example.com/my/');
  assert.equal(resolveUrl('https://example.com/a/', '/my/courses.php'), 'https://example.com/my/courses.php');
  assert.throws(() => resolveUrl('https://example.com/', '//evil.example/'));
  const expected = pathToFileURL(path.join(__dirname, 'fixtures', 'practice-login.html')).href;
  assert.equal(resolveUrl('fixture:practice.html', '/practice-login.html'), expected);
  assert.throws(() => resolveUrl('fixture:practice.html', '/../secret.html'));
});

test('path と login の形を確かめる', () => {
  const base = { id: 'x', name: 'x', url: 'https://example.com/' };
  const card = { id: 'a', title: 'a', action: 'read', selector: 'main' };
  assert.deepEqual(validateConfig({ ...base, login: { selector: '#login' }, cards: [{ ...card, path: '/my/' }] }), []);
  const where = validateConfig({ ...base, login: {}, cards: [{ ...card, path: '//evil.example/' }] }).map((e) => e.where);
  assert.deepEqual(where, ['login.selector', 'cards[0].path']);
});

test('fixture: の url は、名前の形が正しいときだけ通る', () => {
  const base = { id: 'x', name: 'x', cards: [{ id: 'a', title: 'a', action: 'read', selector: 'main' }] };
  assert.deepEqual(validateConfig({ ...base, url: 'fixture:practice.html' }), []);
  assert.deepEqual(validateConfig({ ...base, url: 'fixture:../secret.html' }).map((e) => e.where), ['url']);
});

test('selector は文として解釈されないように埋め込まれる', () => {
  const tricky = '"); alert(1); ("';
  const script = buildScript(tricky, 'read');
  assert.ok(script.includes(JSON.stringify(tricky)));
});

test('container も文として解釈されないように埋め込まれる', () => {
  const tricky = '"); alert(2); ("';
  const script = buildScript('ul li', 'list', null, 500, tricky);
  assert.ok(script.includes(JSON.stringify(tricky)));
});

test('点検では、入れ物に当たれば項目が 0件でも当たる行とする', () => {
  // ページの document の代わり: 当たる selector だけを持つ偽物。
  const present = new Set(['ul.box', 'main']);
  globalThis.document = {
    querySelector(s) {
      if (s === 'ul[') throw new Error('invalid');
      return present.has(s) ? {} : null;
    },
  };
  try {
    const states = pageProbe(
      ['main', 'ul.box li', 'ul.box li', 'ol.gone li', 'ul.box li'],
      [null, 'ul.box', null, 'ol.gone', 'ul['],
    );
    assert.deepEqual(states, ['ok', 'ok', 'none', 'none', 'invalid-container']);
  } finally {
    delete globalThis.document;
  }
});

test('# から後だけが違うときは、同じページとして読み込み直さない', () => {
  const { isSamePage } = require('../src/main/target');
  const base = 'https://example.com/risk/obsdl/';
  assert.equal(isSamePage(base, base), true);
  // ページの中の動きで # が付いた後でも、# の無い設定の URL とは同じページ。
  assert.equal(isSamePage(`${base}#!table`, base), true);
  assert.equal(isSamePage('https://example.com/other/', base), false);
  assert.equal(isSamePage('https://example.com/risk/obsdl/?a=1', base), false);
  assert.equal(isSamePage('', base), false);
  // 設定の URL が # から後を持つとき（# で表を切り替えるページ）は、そこまで同じときだけ同じページ。
  const forecast = 'https://example.com/forecast/#area=tokyo';
  assert.equal(isSamePage(forecast, forecast), true);
  assert.equal(isSamePage('https://example.com/forecast/#area=kanagawa', forecast), false);
  assert.equal(isSamePage('https://example.com/forecast/', forecast), false);
});

// 偽の窓（openTarget が使う所だけ）。z の順を order に、上が後ろになるように控える。
function fakeWindows() {
  const order = [];
  const raise = (w) => { const k = order.indexOf(w); if (k >= 0) order.splice(k, 1); order.push(w); };
  class FakeWindow {
    constructor(options = {}) {
      this.title = options.title || '';
      this.url = '';
      this.visible = options.show !== false;
      this.focusable = options.focusable !== false;
      this.focused = false;
      this.webContents = { setWindowOpenHandler() {}, getURL: () => this.url, loadURL: async (u) => { this.url = u; } };
      if (this.visible) raise(this);
    }
    async loadURL(u) { return this.webContents.loadURL(u); }
    isDestroyed() { return false; }
    isVisible() { return this.visible; }
    showInactive() { this.visible = true; raise(this); }
    show() { this.visible = true; raise(this); }
    focus() { this.focused = true; }
    hide() { this.visible = false; }
    isFocused() { return this.focused; }
    isFocusable() { return this.focusable; }
    setFocusable(v) { this.focusable = v; }
    setSkipTaskbar() {}
    moveTop() { raise(this); }
    isMinimized() { return false; }
    restore() {}
    setAlwaysOnTop() {}
    destroy() {}
    on() {}
    removeListener() {}
  }
  return { FakeWindow, order };
}

test('ウェブアプリの窓は、前に出さずに見せ、Todoku の窓が前にあるときは Todoku の窓の後ろに置く（別のページを読み込むカードでも）', async () => {
  const { openTarget, setHomeWindow, showTarget, closeTarget } = require('../src/main/target');
  const { FakeWindow, order } = fakeWindows();
  const home = new FakeWindow({ title: 'Todoku' });
  home.focused = true;
  setHomeWindow(home);
  const config = { id: 'behind-test', name: '作り物の市', url: 'https://example.com/', cards: [] };
  try {
    const win = await openTarget(FakeWindow, config, 'https://example.com/');
    assert.equal(win.isVisible(), true);
    assert.equal(order[order.length - 1], home, 'トップのページ: Todoku の窓が一番上');
    // 別のページ（path のあるカード）を読み込む。
    await openTarget(FakeWindow, config, 'https://example.com/event/');
    assert.equal(win.url, 'https://example.com/event/');
    assert.equal(order[order.length - 1], home, '別のページ: Todoku の窓が一番上のまま');
    assert.equal(home.focused, true);

    // 使う人が別のアプリにいるとき（Todoku の窓が前にないとき）は、Todoku の窓を上へ動かさない。
    home.focused = false;
    win.moveTop();
    await openTarget(FakeWindow, config, 'https://example.com/');
    assert.equal(order[order.length - 1], win);

    // ログインのために前に出した窓は、後ろへ回さない。
    home.focused = true;
    showTarget('behind-test');
    assert.equal(order[order.length - 1], win);
  } finally {
    closeTarget('behind-test');
    setHomeWindow(null);
  }
});

test('Todoku の窓を閉じたときに、ウェブアプリの窓を全部閉じる（closeAllTargets）', async () => {
  const { openTarget, closeAllTargets, setHomeWindow } = require('../src/main/target');
  const { FakeWindow } = fakeWindows();
  const destroyed = [];
  class Win extends FakeWindow { destroy() { destroyed.push(this.title); this.gone = true; } isDestroyed() { return Boolean(this.gone); } }
  setHomeWindow(null);
  await openTarget(Win, { id: 'close-a', name: 'A', url: 'https://example.com/', cards: [] }, 'https://example.com/a');
  await openTarget(Win, { id: 'close-b', name: 'B', url: 'https://example.com/', cards: [] }, 'https://example.com/b');
  assert.equal(closeAllTargets(), 2);
  assert.deepEqual(destroyed.sort(), ['A', 'B']);
  assert.equal(closeAllTargets(), 0);
});

// 一覧の一件の頭の飾り（「＼Hot!／」）と、日付の無い一件の印（undatedLabel）。
test('一覧の一件: 頭の「＼…／」の記号は読まず、undatedLabel があれば、日付で始まらない一件の頭に付ける', () => {
  const { tidyListItems } = require('../src/main/target');
  const items = ['＼Hot!／学生の活躍、作り物の記事', '2026年11月04日、学生の活躍、作り物の記事', '2026.10.16 作り物の記事'];
  assert.deepEqual(tidyListItems(items), ['Hot!、学生の活躍、作り物の記事', items[1], items[2]]);
  assert.deepEqual(tidyListItems(items, '固定の記事'), ['固定の記事、Hot!、学生の活躍、作り物の記事', items[1], items[2]]);
  // 日付で始まる一件が一つも無い一覧には付けない（日付の無い一覧のカード）。
  assert.deepEqual(tidyListItems(['作り物の一件', '作り物の二件'], '固定の記事'), ['作り物の一件', '作り物の二件']);
  // 頭でない所の記号と、長い文を挟む記号はそのまま。
  assert.deepEqual(tidyListItems(['作り物の＼Hot!／記事']), ['作り物の＼Hot!／記事']);
});

test('設定ファイル: undatedLabel は list のカードだけで、20文字までの空でない文字列', () => {
  const { validateConfig } = require('../src/main/config');
  const base = (card) => ({ id: 'u', name: '作り物', url: 'https://example.com/', cards: [{ id: 'a', title: 'A', selector: 'li', ...card }] });
  assert.deepEqual(validateConfig(base({ action: 'list', undatedLabel: '固定の記事' })), []);
  assert.deepEqual(validateConfig(base({ action: 'read', undatedLabel: '固定の記事' })).map((e) => e.where), ['cards[0].undatedLabel']);
  assert.deepEqual(validateConfig(base({ action: 'list', undatedLabel: '' })).map((e) => e.where), ['cards[0].undatedLabel']);
});

// 窓を前に出す作り（bringToFront）: Windows では focus だけに頼らず、一瞬だけ最前面にして moveTop し、後で最前面を外す。
// どの OS でも、ページの中にも焦点を渡し、少し後にまだ焦点が無ければ、もう一度出し直す。
function fakeFrontWindow({ focused = false, minimized = false } = {}) {
  const calls = [];
  return {
    calls,
    focused,
    isDestroyed: () => false,
    isMinimized: () => minimized,
    isFocused() { return this.focused; },
    restore: () => calls.push('restore'),
    show: () => calls.push('show'),
    focus: () => calls.push('focus'),
    moveTop: () => calls.push('moveTop'),
    setAlwaysOnTop: (v) => calls.push(`top:${v}`),
    webContents: { focus: () => calls.push('page-focus') },
  };
}

test('前に出す: Windows では一瞬だけ最前面にして moveTop し、300ミリ秒後に最前面を外す。ページにも焦点を渡す', () => {
  const { bringToFront } = require('../src/main/target');
  const timers = [];
  const win = fakeFrontWindow({ minimized: true });
  assert.equal(bringToFront(win, { platform: 'win32', later: (fn, ms) => timers.push({ fn, ms }) }), true);
  assert.deepEqual(win.calls, ['restore', 'show', 'top:true', 'focus', 'moveTop', 'page-focus']);
  assert.deepEqual(timers.map((t) => t.ms), [300, 150]);
  win.focused = true;
  for (const t of timers) t.fn();
  assert.deepEqual(win.calls.slice(6), ['top:false']);
});

test('前に出す: Mac では最前面にしない。少し後にまだ焦点が来ていなければ、もう一度だけ出し直す', () => {
  const { bringToFront } = require('../src/main/target');
  const timers = [];
  const win = fakeFrontWindow();
  bringToFront(win, { platform: 'darwin', later: (fn, ms) => timers.push({ fn, ms }) });
  assert.deepEqual(win.calls, ['show', 'focus', 'page-focus']);
  assert.deepEqual(timers.map((t) => t.ms), [150]);
  timers[0].fn();
  assert.deepEqual(win.calls.slice(3), ['show', 'focus', 'page-focus']);
});
