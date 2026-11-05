'use strict';
// 「このページのリンク」の一覧のそろえ方・行き先の束の探し方・既定のブラウザで開く URL の決め方（src/main/links.js）。
const test = require('node:test');
const assert = require('node:assert/strict');
const { tidyLinks, browserUrl, findDeckFor, MAX_LINKS } = require('../src/main/links');

const PAGE = 'https://example.com/aoba/';

test('リンクの一覧: http と https だけ・ページの中の飛び先といまのページへのリンクは除き・同じ行き先は最初の一つ・名前の無いものは除く', () => {
  const raw = [
    { href: 'https://example.com/aoba/#main', text: '本文へ移動' },
    { href: 'https://example.com/aoba', text: 'トップ' },
    { href: 'https://example.com/aoba/kurashi/', text: ' くらしの\n 案内 ' },
    { href: 'https://example.com/aoba/kurashi/#gomi', text: 'ごみ' },
    { href: 'http://example.org/', text: '外のページ' },
    { href: 'mailto:', text: 'メール' },
    { href: 'javascript:void(0)', text: '文字を大きく' },
    { href: 'file:///etc/hosts', text: '手元のファイル' },
    { href: 'https://example.com/aoba/nameless/', text: '   ' },
    null,
  ];
  assert.deepEqual(tidyLinks(raw, PAGE), [
    { url: 'https://example.com/aoba/kurashi/', text: 'くらしの 案内' },
    { url: 'http://example.org/', text: '外のページ' },
  ]);
});

test('リンクの一覧: 上限の数で切る', () => {
  const raw = Array.from({ length: MAX_LINKS + 5 }, (_, i) => ({ href: `https://example.com/p${i}`, text: `ページ${i}` }));
  assert.equal(tidyLinks(raw, PAGE).length, MAX_LINKS);
  assert.equal(tidyLinks(raw, PAGE, 3).length, 3);
});

test('既定のブラウザで開く URL: ウェブアプリの窓のいまのページを先に、無ければ設定ファイルの url。練習のページは開かない', () => {
  assert.equal(browserUrl('https://example.com/now#x', 'https://example.com/'), 'https://example.com/now#x');
  assert.equal(browserUrl('', 'https://example.com/'), 'https://example.com/');
  assert.equal(browserUrl('file:///x/practice.html', 'https://example.com/'), 'https://example.com/');
  assert.equal(browserUrl('file:///x/practice.html', 'fixture:practice.html'), null);
});

test('行き先の束: 束の url と合えばその束、カードの path のページと合えばその束とカード、無ければ null（# から後と終わりの / は見ない）', () => {
  const configs = [
    { id: 'yt', kind: 'youtube', cards: [] },
    { id: 'practice', url: 'fixture:city-top.html', cards: [] },
    { id: 'city', url: 'https://example.com/aoba/', cards: [{ id: 'events', path: '/aoba/events/' }, { id: 'top', title: 'x' }] },
    { id: 'weather', url: 'https://example.com/weather/#area=1', cards: [] },
  ];
  assert.deepEqual(findDeckFor('https://example.com/aoba', configs), { config: configs[2], cardId: null });
  assert.deepEqual(findDeckFor('https://example.com/aoba/events/#today', configs), { config: configs[2], cardId: 'events' });
  assert.deepEqual(findDeckFor('https://example.com/weather/', configs), { config: configs[3], cardId: null });
  assert.equal(findDeckFor('https://example.com/other/', configs), null);
  assert.equal(findDeckFor('', configs), null);
});
