'use strict';
// 収録の前に、はじめの状態に戻す台本（scripts/demo-reset.js）の試し。一時のフォルダを userData に見立てる。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { userDataCandidates, resetUserData, restoreUserData, stampOf } = require('../scripts/demo-reset');

function fakeUserData() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-reset-'));
  fs.mkdirSync(path.join(dir, 'generated'));
  fs.writeFileSync(path.join(dir, 'generated', 'page-a.json'), '{"id":"page-a"}');
  fs.mkdirSync(path.join(dir, 'repairs'));
  fs.writeFileSync(path.join(dir, 'repairs', 'tsukuba-city.json'), '[]');
  fs.writeFileSync(path.join(dir, 'settings.json'), '{"scheme":"black"}');
  fs.writeFileSync(path.join(dir, 'log.txt'), '残す記録');
  return dir;
}

test('userData の置き場は、前の版の hackathon2026 と、いまの Todoku（npm start も包んだアプリも）の二つ（OS ごとの appData の下）', () => {
  assert.deepEqual(userDataCandidates({ platform: 'win32', env: { APPDATA: 'C:\\\\Users\\\\x\\\\AppData\\\\Roaming' }, home: '/h' }),
    [path.join('C:\\\\Users\\\\x\\\\AppData\\\\Roaming', 'hackathon2026'), path.join('C:\\\\Users\\\\x\\\\AppData\\\\Roaming', 'Todoku')]);
  assert.deepEqual(userDataCandidates({ platform: 'darwin', env: {}, home: '/h' }),
    [path.join('/h', 'Library', 'Application Support', 'hackathon2026'), path.join('/h', 'Library', 'Application Support', 'Todoku')]);
});

test('はじめの状態に戻す: 作った束・直し・表示設定を reset-backup/<日時>/ へ移し（消さない）、ほかのファイルは残す。戻すと元の所に戻る', () => {
  const dir = fakeUserData();
  try {
    const now = new Date(2026, 10, 7, 9, 5, 3);
    const r = resetUserData(dir, { now });
    // 控えの名前は「年月日-時分秒」（8字と6字の数字）。
    assert.equal(r.backup, path.join(dir, 'reset-backup', stampOf(now)));
    assert.match(path.basename(r.backup), /^\d{8}-\d{6}$/);
    assert.equal(stampOf(now), ['2026', '11', '07'].join('') + '-' + ['09', '05', '03'].join(''));
    assert.deepEqual(r.moved.map((m) => path.basename(m.from)), ['generated', 'repairs', 'settings.json']);
    for (const t of ['generated', 'repairs', 'settings.json']) assert.equal(fs.existsSync(path.join(dir, t)), false, t);
    assert.equal(fs.readFileSync(path.join(r.backup, 'settings.json'), 'utf8'), '{"scheme":"black"}');
    assert.equal(fs.readFileSync(path.join(r.backup, 'generated', 'page-a.json'), 'utf8'), '{"id":"page-a"}');
    assert.equal(fs.readFileSync(path.join(dir, 'log.txt'), 'utf8'), '残す記録');
    // もう一度動かしても、移すものが無いので控えは増えない。
    assert.deepEqual(resetUserData(dir, { now }), { moved: [], backup: null });
    // 戻す（いちばん新しい控え）。
    const back = restoreUserData(dir);
    assert.deepEqual(back.restored.map((m) => path.basename(m.to)), ['generated', 'repairs', 'settings.json']);
    assert.deepEqual(back.kept, []);
    assert.equal(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'), '{"scheme":"black"}');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('戻すとき、元の所に今のものがあれば上書きせず、控えに残す。同じ日時の控えがあれば番号を付ける。無い控えは戻さない', () => {
  const dir = fakeUserData();
  try {
    const now = new Date(2026, 10, 7, 9, 5, 3);
    const first = resetUserData(dir, { now });
    fs.writeFileSync(path.join(dir, 'settings.json'), '{"scheme":"white"}');
    const second = resetUserData(dir, { now });
    assert.equal(second.backup, path.join(dir, 'reset-backup', `${stampOf(now)}-2`));
    fs.writeFileSync(path.join(dir, 'settings.json'), '{"scheme":"standard"}');
    const back = restoreUserData(dir, path.basename(first.backup));
    assert.deepEqual(back.restored.map((m) => path.basename(m.to)), ['generated', 'repairs']);
    assert.deepEqual(back.kept.map((m) => path.basename(m.to)), ['settings.json']);
    assert.equal(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'), '{"scheme":"standard"}');
    assert.equal(fs.existsSync(path.join(first.backup, 'settings.json')), true);
    assert.deepEqual(restoreUserData(dir, 'no-such-backup'), { restored: [], kept: [], backup: null });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
