'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { validateConfig, loadConfigDir } = require('../src/main/config');

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

test('同梱の cards/ の設定ファイルは全部読める', () => {
  const results = loadConfigDir(path.join(__dirname, '..', 'cards'));
  assert.ok(results.length > 0);
  for (const r of results) assert.deepEqual(r.errors ?? [], [], r.file);
});
