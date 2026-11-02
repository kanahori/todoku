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
  const banned = [/aims/i, /tsukuba-tech/i, /tsukuba/i, /portal\.k\./i];
  for (const name of fs.readdirSync(dir)) {
    const text = name + '\n' + fs.readFileSync(path.join(dir, name), 'utf8');
    for (const re of banned) assert.ok(!re.test(text), `cards/${name} に ${re} が入っています`);
  }
});

test('同梱の cards/ の設定ファイルは全部読める', () => {
  const results = loadConfigDir(path.join(__dirname, '..', 'cards'));
  assert.ok(results.length > 0);
  for (const r of results) assert.deepEqual(r.errors ?? [], [], r.file);
});
