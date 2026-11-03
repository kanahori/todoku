'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { uniquePath, safeFileName, nameFromPattern, formatDate, downloadMessage } = require('../src/main/download');

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

test('ファイル名は、Windows の形（ドライブ・\\ の区切り）でも、どの OS で動かしても同じ結果になる', () => {
  // Windows の path は「a:」をドライブの名前として扱うので、先に basename をかけると「a:」より前が消えていた（2026-11-03 の Windows の試し）。
  assert.equal(path.win32.basename('a:b*c?.csv'), 'b*c?.csv'); // この試しの前提（Windows の考えでは「a:」がドライブ）
  assert.equal(safeFileName('a:b.csv'), 'a_b.csv');
  assert.equal(safeFileName('C:\\作り物\\ダウンロード\\x:y.csv'), 'x_y.csv');
  assert.equal(safeFileName('..\\..\\作り物.csv'), '作り物.csv');
  assert.equal(safeFileName('a/b\\c.csv'), 'c.csv');
  for (const name of ['a:b*c?.csv', 'C:\\作り物\\x:y.csv', '../../etc/passwd', 'data.csv']) {
    const safe = safeFileName(name);
    // 結果は、Windows の考えでも posix の考えでも、フォルダの部分もドライブも持たない。
    assert.equal(path.win32.basename(safe), safe, name);
    assert.equal(path.posix.basename(safe), safe, name);
    assert.equal(path.win32.parse(safe).root, '', name);
  }
});

test('保存の名前の型: {date} を保存した日（yyyy-mm-dd）に替え、拡張子が無ければ元の名前の拡張子を足す', () => {
  const day = new Date(2026, 10, 3, 9, 5); // 2026-11-03（その機械の時刻）
  assert.equal(formatDate(day), '2026-11-03');
  assert.equal(nameFromPattern('作り物_{date}.csv', 'data.csv', day), '作り物_2026-11-03.csv');
  assert.equal(nameFromPattern('作り物_{date}', 'data.csv', day), '作り物_2026-11-03.csv');
  assert.equal(nameFromPattern('作り物_{date}_{n}', 'data.csv', day), '作り物_2026-11-03_{n}.csv');
  assert.equal(nameFromPattern('作り物:{date}.csv', 'data.csv', day), '作り物_2026-11-03.csv');
});

test('名前に {n} があれば、1 から順に、使われていない番号を入れる', () => {
  const dir = path.join('/作り物', 'ダウンロード');
  const taken = new Set([path.join(dir, '値_1.csv'), path.join(dir, '値_2.csv')]);
  const exists = (p) => taken.has(p);
  assert.equal(uniquePath(dir, '値_{n}.csv', exists), path.join(dir, '値_3.csv'));
  assert.equal(uniquePath(dir, '別_{n}.csv', exists), path.join(dir, '別_1.csv'));
});

test('知らせの文は、名前を「」で囲み、何をしたかを一文で言う', () => {
  assert.equal(downloadMessage({ name: 'data.csv', ok: true }), '「data.csv」をダウンロードのフォルダに保存しました。');
  assert.equal(downloadMessage({ name: 'data.csv', ok: false }), '「data.csv」を保存できませんでした。');
});
