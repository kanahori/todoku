'use strict';
// 最初のページのフォルダ・表示名・メモの保存（src/main/bookmarks.js）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeBookmarks, createBookmarksStore } = require('../src/main/bookmarks');

test('形をそろえる: 崩れたフォルダ（id の形・空の名前・重なり）を捨て、無いフォルダを指すページは、フォルダだけ外す', () => {
  const r = normalizeBookmarks({
    folders: [
      { id: 'f-a1', name: ' 天気 ' },
      { id: 'f-a1', name: '重なった id' },
      { id: 'f-b2', name: '天気' },
      { id: 'bad id', name: '形の違う id' },
      { id: 'f-c3', name: '   ' },
      { id: 'f-d4', name: '町の\nお知らせ' },
      null,
    ],
    pages: {
      'jma-forecast': { folder: 'f-a1', name: '  東京の天気 ', memo: '毎朝' },
      'tsukuba-city': { folder: 'f-zz', name: '' },
      'Bad Id': { name: '形の違う id' },
      'moodle-demo': 'x',
      'practice-city': { memo: 'あ'.repeat(400) },
    },
  });
  assert.deepEqual(r.folders, [{ id: 'f-a1', name: '天気' }, { id: 'f-d4', name: '町の お知らせ' }]);
  assert.deepEqual(r.pages['jma-forecast'], { folder: 'f-a1', name: '東京の天気', memo: '毎朝' });
  assert.equal(r.pages['tsukuba-city'], undefined);
  assert.equal(r.pages['Bad Id'], undefined);
  assert.equal(r.pages['moodle-demo'], undefined);
  assert.equal(r.pages['practice-city'].memo.length, 300);
});

test('形をそろえる: 中身が無い・配列・文字のときは、空のブックマーク', () => {
  for (const raw of [null, undefined, [], 'x', 3, { folders: 'x', pages: [] }]) {
    assert.deepEqual(normalizeBookmarks(raw), { folders: [], pages: {} }, String(raw));
  }
});

test('保存: 書いて読み直すと同じ。ファイルが無い・壊れている・頭に BOM があっても読める', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmarks-'));
  try {
    const file = path.join(dir, 'sub', 'bookmarks.json');
    const store = createBookmarksStore(file);
    assert.deepEqual(store.load(), { folders: [], pages: {} });
    const data = { folders: [{ id: 'f-a1', name: '天気' }], pages: { 'jma-forecast': { folder: 'f-a1', memo: '毎朝' } } };
    assert.deepEqual(store.save(data), { ok: true, bookmarks: data });
    assert.deepEqual(store.load(), data);
    fs.writeFileSync(file, 'こわれた{');
    assert.deepEqual(store.load(), { folders: [], pages: {} });
    fs.writeFileSync(file, '﻿' + JSON.stringify(data));
    assert.deepEqual(store.load(), data);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('保存: 書けない場所でも落ちず、ok: false を返す', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmarks-'));
  try {
    const blocker = path.join(dir, 'file');
    fs.writeFileSync(blocker, 'x');
    const store = createBookmarksStore(path.join(blocker, 'bookmarks.json'));
    assert.equal(store.save({ folders: [] }).ok, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
