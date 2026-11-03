'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { validateConfig, loadConfigDir, loadConfigSources } = require('../src/main/config');

const good = () => ({
  id: 'demo',
  name: '試しのアプリ',
  url: 'https://example.com/',
  cards: [{ id: 'a', title: 'カード A', action: 'read', selector: 'main' }],
});

test('正しい形なら当たらない所は無い', () => {
  assert.deepEqual(validateConfig(good()), []);
});

test('当たらない行の場所を返す', () => {
  const c = good();
  c.cards.push({ id: 'a', title: '', action: 'drag', selector: '' });
  const where = validateConfig(c).map((e) => e.where);
  assert.deepEqual(where, ['cards[1].id', 'cards[1].title', 'cards[1].action', 'cards[1].selector']);
});

test('cards が無ければ知らせる', () => {
  const c = good();
  delete c.cards;
  assert.deepEqual(validateConfig(c).map((e) => e.where), ['cards']);
});

test('手元の置き場も読み、id が重なったものは読まない', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const local = fs.mkdtempSync(path.join(os.tmpdir(), 'cards-local-'));
  try {
    const mine = { ...good(), id: 'local-app' };
    fs.writeFileSync(path.join(local, 'a.json'), JSON.stringify(mine));
    fs.writeFileSync(path.join(local, 'b.json'), JSON.stringify({ ...good(), id: 'moodle-demo' }));
    const results = loadConfigSources([
      { dir: path.join(__dirname, '..', 'cards'), label: 'cards' },
      { dir: local, label: '手元' },
    ]);
    const a = results.find((r) => r.file === '手元/a.json');
    const b = results.find((r) => r.file === '手元/b.json');
    assert.equal(a.config.id, 'local-app');
    assert.equal(b.config, null);
    assert.equal(b.errors[0].where, 'id');
  } finally {
    fs.rmSync(local, { recursive: true, force: true });
  }
});

test('公開する cards/ には、手元だけで使う相手の語が入っていない', () => {
  // 大学の業務システムと大学の Moodle の設定ファイルは、手元の置き場（CARDS_LOCAL_DIR）にだけ置く。
  const fs = require('node:fs');
  const dir = path.join(__dirname, '..', 'cards');
  // つくば市の公式サイト（公開のページ）の設定ファイルは、その名前と URL だけを除いて見る（大学の語は、いままでどおり止める）。
  const banned = [/aims/i, /tsukuba-tech/i, /tsukuba/i, /portal\.k\./i];
  const publicCity = /www\.city\.tsukuba\.lg\.jp|tsukuba-city/g;
  for (const name of fs.readdirSync(dir)) {
    const text = (name + '\n' + fs.readFileSync(path.join(dir, name), 'utf8')).replace(publicCity, '');
    for (const re of banned) assert.ok(!re.test(text), `cards/${name} に ${re} が入っています`);
  }
});

test('同梱の cards/ の設定ファイルは全部読める', () => {
  const results = loadConfigDir(path.join(__dirname, '..', 'cards'));
  assert.ok(results.length > 0);
  for (const r of results) assert.deepEqual(r.errors ?? [], [], r.file);
});

test('頭に BOM の付いた設定ファイルも読める（Windows のメモ帳などで保存したもの）', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const { loadConfigFile } = require('../src/main/config');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bom-'));
  const file = path.join(dir, 'bom.json');
  fs.writeFileSync(file, '﻿' + JSON.stringify(good()), 'utf8');
  const r = loadConfigFile(file);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(r.errors, undefined);
  assert.equal(r.config.id, 'demo');
});

test('container は list のカードにだけ、空でない文字列で書ける', () => {
  const c = good();
  c.cards = [
    { id: 'a', title: 'A', action: 'list', selector: 'ul.items li', container: 'ul.items' },
    { id: 'b', title: 'B', action: 'read', selector: 'main', container: 'main' },
    { id: 'c', title: 'C', action: 'list', selector: 'ol li', container: '' },
  ];
  const errors = validateConfig(c);
  assert.deepEqual(errors.map((e) => e.where), ['cards[1].container', 'cards[2].container']);
  assert.match(errors[0].message, /list/);
});

test('dateSelector は list のカードにだけ、空でない文字列で書ける', () => {
  const c = good();
  c.cards = [
    { id: 'a', title: 'A', action: 'list', selector: 'tr.row', dateSelector: 'td.date' },
    { id: 'b', title: 'B', action: 'read', selector: 'main', dateSelector: 'td.date' },
    { id: 'c', title: 'C', action: 'list', selector: 'ol li', dateSelector: ' ' },
  ];
  const errors = validateConfig(c);
  assert.deepEqual(errors.map((e) => e.where), ['cards[1].dateSelector', 'cards[2].dateSelector']);
  assert.match(errors[0].message, /list/);
});

test('頭の description は、あれば文字列であること', () => {
  assert.deepEqual(validateConfig({ ...good(), description: '出典：作り物のサイト（https://example.com/）を加工して作成' }), []);
  assert.deepEqual(validateConfig({ ...good(), description: 3 }).map((e) => e.where), ['description']);
});

test('気象庁の三つの設定ファイルは、頭の description に出典の文を持ち、URL は sourceUrl にだけ置く', () => {
  const { loadConfigFile } = require('../src/main/config');
  for (const name of ['jma-daily.json', 'jma-forecast.json', 'jma-obsdl.json']) {
    const r = loadConfigFile(path.join(__dirname, '..', 'cards', name));
    assert.ok(r.config, `${name}: ${JSON.stringify(r.errors)}`);
    assert.equal(r.config.description, '出典：気象庁ホームページを加工して作成。');
    assert.match(r.config.sourceUrl, /^https:\/\/www\.(data\.)?jma\.go\.jp\//);
    // 読み上げで URL を一文字ずつ聞かせないように、説明の文には URL を入れない。
    for (const c of r.config.cards) assert.doesNotMatch(c.description || '', /https?:/, `${name} の ${c.id}`);
  }
});

test('sourceUrl は、あれば http:// か https:// の URL であること', () => {
  const { externalUrl } = require('../src/main/config');
  assert.deepEqual(validateConfig({ ...good(), sourceUrl: 'https://example.com/about/' }), []);
  for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'example.com', 'https://example.com/a b', 3]) {
    assert.deepEqual(validateConfig({ ...good(), sourceUrl: bad }).map((e) => e.where), ['sourceUrl'], String(bad));
    assert.equal(externalUrl(bad), null, String(bad));
  }
  assert.equal(externalUrl('https://example.com/about/'), 'https://example.com/about/');
});

test('saveAs は click のカードにだけ、{date} と {n} と、ファイル名に使える文字で書ける', () => {
  const c = good();
  c.cards = [
    { id: 'a', title: 'A', action: 'click', selector: '#a', saveAs: '作り物_{date}_{n}.csv' },
    { id: 'b', title: 'B', action: 'read', selector: 'main', saveAs: '作り物.csv' },
    { id: 'c', title: 'C', action: 'click', selector: '#c', saveAs: '作り物_{time}.csv' },
    { id: 'd', title: 'D', action: 'click', selector: '#d', saveAs: '../作り物.csv' },
    { id: 'e', title: 'E', action: 'click', selector: '#e', saveAs: '' },
    { id: 'f', title: 'F', action: 'click', selector: '#f', saveAs: '作り物.csv.' },
  ];
  const errors = validateConfig(c);
  assert.deepEqual(errors.map((e) => e.where), ['cards[1].saveAs', 'cards[2].saveAs', 'cards[3].saveAs', 'cards[4].saveAs', 'cards[5].saveAs']);
  assert.match(errors[0].message, /click/);
  assert.match(errors[1].message, /\{time\}/);
});

test('気象庁のダウンロードは、表の後に「メニューへ戻る」を持ち、CSV を日付の入った名前で保存する', () => {
  const { loadConfigFile } = require('../src/main/config');
  const { config } = loadConfigFile(path.join(__dirname, '..', 'cards', 'jma-obsdl.json'));
  const ids = config.cards.map((c) => c.id);
  const back = config.cards.find((c) => c.id === 'menu-top');
  assert.equal(back.action, 'click');
  assert.equal(back.selector, '#loadTop');
  assert.ok(ids.indexOf('menu-top') > ids.indexOf('load-table'));
  assert.equal(config.cards.find((c) => c.id === 'csv-download').saveAs, '気象庁_過去の気象データ_{date}.csv');
});

test('つくば市の設定ファイルは、頭の description に出典の文を持ち、URL は sourceUrl にだけ置く', () => {
  const { loadConfigFile } = require('../src/main/config');
  const r = loadConfigFile(path.join(__dirname, '..', 'cards', 'tsukuba-city.json'));
  assert.ok(r.config, JSON.stringify(r.errors));
  assert.match(r.config.description, /^出典：つくば市公式ウェブサイト。/);
  assert.match(r.config.cards[0].description, /^出典：つくば市公式ウェブサイト。/);
  assert.equal(r.config.sourceUrl, 'https://www.city.tsukuba.lg.jp/');
  for (const c of r.config.cards) assert.doesNotMatch(c.description || '', /https?:/, c.id);
});

test('試しのための古い行の写しは、つくば市の設定ファイルと新着情報のカードの行だけが違う', () => {
  const { loadConfigFile } = require('../src/main/config');
  const city = loadConfigFile(path.join(__dirname, '..', 'cards', 'tsukuba-city.json')).config;
  const old = loadConfigFile(path.join(__dirname, 'tsukuba-city-old-line-for-test.json')).config;
  assert.ok(old);
  assert.notEqual(old.id, city.id);
  assert.equal(old.cards.length, city.cards.length);
  const differ = city.cards.filter((c, i) => JSON.stringify(c) !== JSON.stringify(old.cards[i])).map((c) => c.id);
  assert.deepEqual(differ, ['news']);
  const news = old.cards.find((c) => c.id === 'news');
  assert.notEqual(news.selector, city.cards.find((c) => c.id === 'news').selector);
  assert.equal(news.container, undefined);
});
