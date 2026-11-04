'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { localStamp } = require('../src/main/logline');

test('記録の時刻は、その機械の時刻に UTC との差を付けて書く（末尾 Z にしない）', () => {
  const d = new Date(2026, 10, 4, 9, 5, 3, 7);
  const s = localStamp(d);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
  const mm = String(Math.abs(off) % 60).padStart(2, '0');
  assert.equal(s, `2026-11-04T09:05:03.007${sign}${hh}:${mm}`);
  assert.doesNotMatch(s, /Z$/);
  // 同じ時点を指す（読み戻すと元の時刻になる）。
  assert.equal(new Date(s).getTime(), d.getTime());
});
