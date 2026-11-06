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
  assert.deepEqual(tidyLinks(raw, PAGE).map(({ url, text }) => ({ url, text })), [
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

const link = (text, kind, label = '', extra = {}) => ({ url: `https://example.com/${encodeURIComponent(text)}`, text, area: { key: `${kind}-${label}`, kind, label }, ...extra });

test('場所ごとに分ける: 本文を先に、ページの上とフッターは後に、言語の切り替えなどの小さな操作は「そのほか」へ。全部のリンクがちょうど一度ずつ入る', () => {
  const { groupLinks } = require('../src/main/links');
  const links = [
    link('English', 'header', '', { lang: true }),
    link('スマートフォン版を表示', 'header'),
    link('サイトマップ', 'header'),
    link('くらしの案内', 'nav', 'グローバルナビゲーション'),
    link('お知らせ一', 'main'),
    link('観光の案内', 'heading', '関連するページ'),
    link('個人情報の取り扱い', 'footer'),
    link('どこにも無い所', 'none'),
    link('防災', 'nav'),
    link('ごみ', 'nav'),
  ];
  const groups = groupLinks(links);
  assert.deepEqual(groups.map((g) => [g.label, g.indexes]), [
    ['本文', [4]],
    ['関連するページ', [5]],
    ['グローバルナビゲーション', [3]],
    ['メニュー', [8, 9]],
    ['ページの上', [2]],
    ['フッター', [6]],
    ['そのほか', [0, 1, 7]],
  ]);
  const all = groups.flatMap((g) => g.indexes).sort((a, b) => a - b);
  assert.deepEqual(all, links.map((_, i) => i));
});

test('場所ごとに分ける: 一覧そろえ（tidyLinks）は、場所の印と言語の印を残す', () => {
  const r = tidyLinks([{ href: 'https://example.com/a', text: 'Aのページ', area: { key: 'l0', kind: 'nav', label: ' 町の\nメニュー ' }, lang: true }], PAGE);
  assert.deepEqual(r, [{ url: 'https://example.com/a', text: 'Aのページ', area: { key: 'l0', kind: 'nav', label: '町の メニュー' }, lang: true }]);
});

test('数字だけ・1〜2字だけのリンク: aria-label か title があればそれを使い、無ければ場所の名前を前に付ける', () => {
  const { isWeakLinkText } = require('../src/main/links');
  const r = tidyLinks([
    { href: 'https://example.com/cal/6', text: '6', area: { key: 'm1', kind: 'main', label: 'イベント情報' } },
    { href: 'https://example.com/cal/7', text: '7', alt: '11月7日の催し', area: { key: 'm1', kind: 'main', label: 'イベント情報' } },
    { href: 'https://example.com/en', text: 'EN', area: { key: 'l0', kind: 'header', label: '' } },
    { href: 'https://example.com/x', text: '?', area: { key: 'none', kind: 'none', label: '' } },
    { href: 'https://example.com/bousai', text: '防災情報', area: { key: 'l1', kind: 'nav', label: '' } },
  ], PAGE);
  assert.deepEqual(r.map((l) => l.text), ['イベント情報：6', '11月7日の催し', 'ページの上：EN', 'そのほか：?', '防災情報']);
  for (const t of ['6', '１２', 'EN', '防災']) assert.equal(isWeakLinkText(t), true, t);
  for (const t of ['防災情報', 'English', '2026年']) assert.equal(isWeakLinkText(t), false, t);
});

test('読まない項目の決まり（skipItemsMatching）: 一覧のカードの決まりを一つにまとめ、その語を含むリンクの題を外す。決まりが無ければ外さない', () => {
  const { skipPatternOf, dropSkippedLinks } = require('../src/main/links');
  const config = { cards: [
    { id: 'a', action: 'list', skipItemsMatching: '入試|募集要項' },
    { id: 'b', action: 'list', skipItemsMatching: 'オープンキャンパス' },
    { id: 'c', action: 'list', skipItemsMatching: '入試|募集要項' },
    { id: 'd', action: 'read' },
  ] };
  const links = [{ text: '入試情報' }, { text: 'お知らせ一覧' }, { text: '保健科学部オープンキャンパス' }, { text: '学生募集要項' }, { text: '図書館' }];
  assert.deepEqual(dropSkippedLinks(links, skipPatternOf(config)).map((l) => l.text), ['お知らせ一覧', '図書館']);
  assert.equal(skipPatternOf({ cards: [{ action: 'list' }] }), null);
  assert.equal(dropSkippedLinks(links, null), links);
});
