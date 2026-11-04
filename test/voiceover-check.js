'use strict';
// Mac の VoiceOver で、Todoku の読み上げを確かめる台本。動かし方: npm run voiceover:check（Mac だけ）。
// VoiceOver を AppleScript で起こし、Todoku（userData は一時のフォルダ）を開いて、キーでカードを移り、VoiceOver の
// 「最後に読んだ文」（last phrase）を取って記録する。確かめる三つ:
//   1. はじめの束でカードを下矢印で移ると、カードの題が読まれる。
//   2. 作り物の市のページ（みどり市・test/fixtures の練習ページ）の一覧のカードで、件数と項目が読まれる。
//   3. 結果の知らせ（role=status。「「新着情報を読む」から〇件読みました。」）が読まれる。
// 本物のサイトのカードは読まない（はじめの束で題を読むだけ）。窓が出て、VoiceOver が声を出すので、Mac を使っている人がいないときだけ動かす。
// 前提: VoiceOver ユーティリティの「VoiceOver を AppleScript で制御することを許可」が入っていること。
//   入っていなければ、最後の文を取る命令が返らないので、そう書き出して止める。
// クイックナビがオンだと、矢印キーが Todoku に届かない。そのときは焦点が動かないことを書き出して止める。
// 終わったら（落ちても・時間切れでも・Ctrl+C でも）VoiceOver を必ず止める。始める前から VoiceOver が動いていたときは、止めずに残す。
// node --test から読まれたときは飛ばす（--run を付けたときだけ動く）。

if (!process.argv.includes('--run')) {
  require('node:test')('VoiceOver で読み上げを確かめる台本（Mac で npm run voiceover:check から動かす）', { skip: 'npm run voiceover:check で動かす' }, () => {});
  return;
}

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile, execFileSync, spawn } = require('node:child_process');

if (process.platform !== 'darwin') {
  console.log('VoiceOver の確かめは Mac だけで動きます。');
  process.exit(0);
}

const TOTAL_LIMIT_MS = 5 * 60 * 1000;
const PROCESS = 'Electron';
const CITY = 'みどり市のホームページ（作り物）';
const LIST_CARD = '新着情報を読む';
const repo = path.join(__dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceover-check-'));
const userData = path.join(work, 'userData');
fs.mkdirSync(userData);
const outFile = path.join(work, 'voiceover-record.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const osa = (lines, { js = false, timeoutMs = 8000 } = {}) => new Promise((resolve) => {
  const args = js ? ['-l', 'JavaScript', '-e', lines] : lines.flatMap((l) => ['-e', l]);
  execFile('osascript', args, { timeout: timeoutMs }, (err, out, errOut) => {
    resolve({ ok: !err, out: String(out || '').trim(), err: err ? String(errOut || err.message).trim() : '' });
  });
});
const voRunning = async () => (await osa(['tell application "System Events" to (name of processes) contains "VoiceOver"'])).out === 'true';
const lastPhrase = async () => {
  const r = await osa(['tell application "VoiceOver" to get content of last phrase'], { timeoutMs: 5000 });
  return r.ok ? r.out : null;
};
const toFront = () => osa([`tell application "System Events" to set frontmost of process "${PROCESS}" to true`]);
const keyCode = async (code) => {
  await toFront();
  await sleep(200);
  await osa([`tell application "System Events" to key code ${code}`]);
};
const KEYS = { down: 125, up: 126, enter: 36, esc: 53 };
const focusName = async () => {
  const r = await osa(`(() => {
    const p = Application('System Events').processes.byName('${PROCESS}');
    try {
      const f = p.attributes.byName('AXFocusedUIElement').value();
      const a = (n) => { try { const v = f.attributes.byName(n).value(); return v == null ? '' : String(v); } catch (e) { return ''; } };
      return a('AXTitle') || a('AXDescription') || a('AXValue');
    } catch (e) { return ''; }
  })()`, { js: true });
  return r.out;
};
// キーを押した後、VoiceOver の最後の文を少しずつ取り、変わった文を順に集める（一つのキーで幾つも読むことがあるため）。
const collect = async (ms) => {
  const seen = [];
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const p = await lastPhrase();
    if (p && seen[seen.length - 1] !== p) seen.push(p);
    await sleep(250);
  }
  return seen;
};

let app = null;
let startedVO = false;
let cleaned = false;
// 止め忘れの守り: 終わり方がどうでも、同期の命令で VoiceOver を止め、Todoku を閉じる。
const cleanupSync = () => {
  if (cleaned) return;
  cleaned = true;
  if (startedVO) {
    try {
      execFileSync('osascript', ['-e', 'tell application "VoiceOver" to quit'], { timeout: 5000 });
    } catch (e) {
      // 止める命令が返らなければ、VoiceOver の切り替えのキー（Command+F5）で止める。
      try {
        execFileSync('osascript', ['-e', 'tell application "System Events" to key code 96 using command down'], { timeout: 5000 });
      } catch (e2) {
        console.log('VoiceOver を止められませんでした。Command キーと F5 キーで止めてください。');
      }
    }
  }
  if (app && app.exitCode === null) {
    try {
      app.kill();
    } catch (e) {
      // 閉じていれば何もしない。
    }
  }
};
process.on('exit', cleanupSync);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { cleanupSync(); process.exit(130); });
const watchdog = setTimeout(() => {
  console.log(`時間切れ（${TOTAL_LIMIT_MS / 60000}分）で止めます。`);
  cleanupSync();
  process.exit(3);
}, TOTAL_LIMIT_MS);

const record = { started: new Date().toString(), steps: [], checks: [], notes: [] };
const step = async (label, key, waitMs) => {
  if (key) await keyCode(KEYS[key]);
  const phrases = await collect(waitMs);
  const focus = await focusName();
  const s = { label, key, focus, phrases };
  record.steps.push(s);
  console.log(`${label}: 焦点「${focus}」 読んだ文 ${JSON.stringify(phrases)}`);
  return s;
};
const check = (name, ok, detail) => {
  record.checks.push({ name, ok, detail });
  console.log(`${ok ? '通った' : '落ちた'}: ${name}${ok ? '' : ` — ${JSON.stringify(detail)}`}`);
};

(async () => {
  const wasRunning = await voRunning();
  if (wasRunning) record.notes.push('始める前から VoiceOver が動いていたので、終わっても止めません。');

  // Todoku を起こす（窓が出る）。
  const electron = path.join(repo, 'node_modules', '.bin', 'electron');
  app = spawn(electron, [path.join(__dirname, 'voiceover-app.js'), userData], { cwd: repo, stdio: 'ignore' });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await sleep(500);
    up = (await osa([`tell application "System Events" to (name of windows of process "${PROCESS}") contains "Todoku"`])).out === 'true';
  }
  if (!up) throw new Error('Todoku の窓が出ませんでした');
  await toFront();
  await sleep(1000);

  // VoiceOver を起こし、最後の文が取れるかで、AppleScript の許可を確かめる。
  if (!wasRunning) {
    startedVO = true;
    await osa(['tell application "VoiceOver" to activate'], { timeoutMs: 15000 });
  }
  let allowed = false;
  for (let i = 0; i < 8 && !allowed; i++) {
    await sleep(1500);
    allowed = (await lastPhrase()) !== null;
  }
  if (!allowed) {
    check('VoiceOver を AppleScript で操れる（最後の文が取れる）', false, '最後の文を取る命令が返りません。VoiceOver ユーティリティの許可を確かめてください。');
    return;
  }
  check('VoiceOver を AppleScript で操れる（最後の文が取れる）', true);
  await toFront();
  await sleep(1500);

  // 1. はじめの束: 下矢印でカードを移り、題が読まれるか。作り物の市のカードまで進む。
  const first = await step('はじめの束の最初', null, 2500);
  const moves = [];
  for (let i = 0; i < 15; i++) {
    const s = await step(`はじめの束で下 ${i + 1}`, 'down', 2000);
    moves.push(s);
    if (s.focus === CITY) break;
    if (i === 0 && s.focus === first.focus) {
      check('下矢印で Todoku のカードが移る（クイックナビがオフ）', false, '焦点が動きません。VoiceOver のクイックナビをオフにしてください（左右の矢印キーを同時に押す）。');
      return;
    }
  }
  const titled = moves.filter((s) => s.focus);
  check('はじめの束で、下矢印で移ったカードの題が読まれる',
    titled.length > 0 && titled.every((s) => s.phrases.some((p) => p.includes(s.focus))),
    titled.map((s) => ({ focus: s.focus, phrases: s.phrases })));
  if (moves[moves.length - 1].focus !== CITY) {
    check(`「${CITY}」のカードまで進める`, false, moves.map((s) => s.focus));
    return;
  }

  // 2・3. 作り物の市の束へ進み、一覧のカードを読む。
  await step('作り物の市の束へ進む', 'enter', 2500);
  let at = null;
  for (let i = 0; i < 6 && !at; i++) {
    const s = await step(`作り物の市の束で下 ${i + 1}`, 'down', 2000);
    if (s.focus === LIST_CARD) at = s;
  }
  if (!at) {
    check(`「${LIST_CARD}」のカードまで進める`, false, record.steps.slice(-6).map((s) => s.focus));
    return;
  }
  const read = await step(`「${LIST_CARD}」を読む`, 'enter', 6000);
  const item1 = read.focus;
  const item2 = await step('一覧の次の項目', 'down', 2500);
  const all = [...read.phrases, ...item2.phrases];
  check('一覧のカードで、件数が読まれる', all.some((p) => /\d+件/.test(p)), all);
  check('一覧のカードで、項目が読まれる（一件目と二件目）',
    Boolean(item1) && Boolean(item2.focus) && read.phrases.some((p) => p.includes(item1.slice(0, 10))) && item2.phrases.some((p) => p.includes(item2.focus.slice(0, 10))),
    { item1, item2: item2.focus, phrases: all });
  check('結果の知らせ（role=status）が読まれる', all.some((p) => p.includes(`「${LIST_CARD}」から`) && p.includes('件読みました')), all);
  await step('戻る', 'esc', 1000);
  await step('戻る', 'esc', 1000);
})().catch((e) => {
  check('台本が最後まで動く', false, e.message);
}).finally(async () => {
  clearTimeout(watchdog);
  record.finished = new Date().toString();
  fs.writeFileSync(outFile, JSON.stringify(record, null, 2));
  cleanupSync();
  await sleep(1500);
  const stillVO = startedVO && (await voRunning());
  if (stillVO) console.log('VoiceOver がまだ動いています。Command キーと F5 キーで止めてください。');
  const failed = record.checks.filter((c) => !c.ok).length;
  console.log(`記録: ${outFile}`);
  console.log(failed === 0 && record.checks.length > 0 ? '全部通りました。' : `${failed}件が落ちました。`);
  process.exitCode = failed === 0 && !stillVO ? 0 : 1;
});
