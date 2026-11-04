'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { looksTextFree } = require('../src/main/structure');
const { SYSTEM_PROMPT, buildRepairRequest } = require('../src/main/repair-prompt');
const { RepairSchema, hasApiKey, applyRepairs, DEFAULT_MODEL } = require('../src/main/repair');

test('構造に日本語の文字が混ざっていたら見つける', () => {
  assert.equal(looksTextFree('div#main.box (has text)\n  ul[data-region=list]'), true);
  assert.equal(looksTextFree('div#main.box 締め切り'), false);
});

test('頼みの文には、当たらない行と構造が入る', () => {
  const text = buildRepairRequest(
    [{ where: 'cards[0].selector', title: '次の締め切りを読む', action: 'read', oldSelector: '.old' }],
    'body\n  div.new',
  );
  assert.ok(text.includes('cards[0].selector'));
  assert.ok(text.includes('.old'));
  assert.ok(text.includes('<structure>\nbody\n  div.new\n</structure>'));
  assert.ok(SYSTEM_PROMPT.includes('文字は全部落としてあります'));
});

test('鍵が無いときは hasApiKey が false', () => {
  assert.equal(hasApiKey({}), false);
  assert.equal(hasApiKey({ CARDS_ANTHROPIC_API_KEY: '  ' }), false);
  assert.equal(hasApiKey({ CARDS_ANTHROPIC_API_KEY: 'x' }), true);
  // Claude Code 自身が拾う名前の鍵は、作品では使わない。
  assert.equal(hasApiKey({ ANTHROPIC_API_KEY: 'x' }), false);
});

test('既定のモデルは claude-opus-5-5', () => {
  assert.equal(DEFAULT_MODEL, 'claude-opus-5-5');
});

test('返事の形を確かめる', () => {
  assert.ok(RepairSchema.safeParse({ proposals: [{ where: 'cards[0].selector', selector: 'a', reason: 'b' }] }).success);
  assert.ok(!RepairSchema.safeParse({ proposals: [{ where: 'cards[0].selector' }] }).success);
});

test('採った案だけを設定ファイルの中身に当て、元の中身は変えない', () => {
  const config = { cards: [{ selector: '.a' }, { selector: '.b' }] };
  const next = applyRepairs(config, [{ index: 1, newSelector: '.b2' }]);
  assert.equal(next.cards[0].selector, '.a');
  assert.equal(next.cards[1].selector, '.b2');
  assert.equal(config.cards[1].selector, '.b');
});

test('直しの指示: 理由はふつうの日本語で、CSS の専門の言葉を使わず、言葉で言い換える例を添える', () => {
  assert.match(SYSTEM_PROMPT, /理由は、ふつうの日本語で、1〜2文で書くこと。/);
  for (const w of ['子結合', '子孫結合', '擬似クラス']) assert.ok(SYSTEM_PROMPT.includes(w), w);
  assert.match(SYSTEM_PROMPT, /CSS の専門の言葉（[^）]+）を使わないこと。/);
  assert.match(SYSTEM_PROMPT, /「子結合をやめて」ではなく「すぐ下の要素だけを指す書き方をやめて」/);
});
