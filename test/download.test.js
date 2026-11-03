'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { uniquePath, safeFileName, downloadMessage } = require('../src/main/download');

test('同じ名前のファイルがあれば、番号を付けた名前にする', () => {
  const dir = path.join('/作り物', 'ダウンロード');
  const taken = new Set([path.join(dir, 'data.csv'), path.join(dir, 'data (1).csv')]);
  const exists = (p) => taken.has(p);
  assert.equal(uniquePath(dir, 'report.csv', exists), path.join(dir, 'report.csv'));
  assert.equal(uniquePath(dir, 'data.csv', exists), path.join(dir, 'data (2).csv'));
  taken.add(path.join(dir, 'README'));
  assert.equal(uniquePath(dir, 'README', exists), path.join(dir, 'README (1)'));
});

test('ファイル名に使えない文字とフォルダの指定は取り除く', () => {
  assert.equal(safeFileName('../../etc/passwd'), 'passwd');
  assert.equal(safeFileName('a:b*c?.csv'), 'a_b_c_.csv');
  assert.equal(safeFileName(''), 'ダウンロード');
  assert.equal(safeFileName('..'), 'ダウンロード');
});

test('知らせの文は、名前を「」で囲み、何をしたかを一文で言う', () => {
  assert.equal(downloadMessage({ name: 'data.csv', ok: true }), '「data.csv」をダウンロードのフォルダに保存しました。');
  assert.equal(downloadMessage({ name: 'data.csv', ok: false }), '「data.csv」を保存できませんでした。');
});
