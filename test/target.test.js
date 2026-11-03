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
    destroy() {}
    on() {}
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
