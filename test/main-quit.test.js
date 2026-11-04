'use strict';
// 主の処理（main.js）の文を文字として読み、窓を閉じたときに終えるかを確かめる。main.js は Electron の中で動くので、ここでは動かさない。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');

test('窓を全部閉じたら、Mac でも終える（OS で分けない）', () => {
  const body = source.slice(source.indexOf("app.on('window-all-closed'"));
  // 改行は \r?\n で見る（Windows の Git の既定 core.autocrlf=true で取り出すと、main.js が CRLF になる）。
  assert.match(body, /^app\.on\('window-all-closed', \(\) => \{\r?\n {2}app\.quit\(\);\r?\n\}\);/);
  assert.doesNotMatch(body.slice(0, 80), /darwin/);
});
