'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { resolveUrl, buildScript } = require('../src/main/target');
const { validateConfig } = require('../src/main/config');

test('fixture: の url は test/fixtures/ のファイルになる', () => {
  const expected = pathToFileURL(path.join(__dirname, 'fixtures', 'practice.html')).href;
  assert.equal(resolveUrl('fixture:practice.html'), expected);
  assert.equal(resolveUrl('https://example.com/'), 'https://example.com/');
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
