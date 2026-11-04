'use strict';
// 支援者向けの点検と直しの案を、本物の主の処理（main.js）で、窓を出さずに端から端まで通す。
// 動かし方: npm run ui:repair（Electron で動かす）。node --test から呼ばれたときは飛ばす。
// 作品のコードは変えない。Claude を呼ぶ所だけを、決まった案を返す偽物に差し替える（UI_REPAIR_REAL=1 のときは本物。鍵が要る）。
// 一時のフォルダに、画面が変わった後の練習のページ（fixture:course-after.html）を指す設定ファイルを置き、userData も一時のフォルダにする
// （本物の Todoku の置き場の設定ファイルと控えには触らない）。
// 確かめること: はじめのカードのボタンから点検の束へ進み、一件目の案を受けると設定ファイルのその行だけが書き換わり、前の版が
// config-backups に一つでき、二件目の案を断ると書き換わらないこと。読み上げへの知らせも書き出す。
// 窓を画面に出さず、前のアプリから焦点を奪わない（--show-windows を付けたときだけ窓を出す）。

if (!process.versions.electron) {
  require('node:test')('直しの案を本物の主の処理で通す起こし方（Electron の上でだけ動く）', { skip: 'npm run ui:repair で動かす' }, () => {});
  return;
}

require('./headless');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-repair-'));
const local = path.join(work, 'local');
const userData = path.join(work, 'userData');
fs.mkdirSync(local);
fs.mkdirSync(userData);
const course = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'cards', 'practice-course.json'), 'utf8'));
const configFile = path.join(local, 'practice-course-after.json');
const NAME = '練習の講座（画面が変わった後・作り物）';
fs.writeFileSync(configFile, JSON.stringify({ ...course, id: 'practice-course-after', name: NAME, url: 'fixture:course-after.html' }, null, 2));
process.env.CARDS_LOCAL_DIR = local;
app.setPath('userData', userData);

// main.js が読み込む前に、Claude を呼ぶ所を差し替える。
const repair = require('../src/main/repair');
if (process.env.UI_REPAIR_REAL !== '1') {
  repair.hasApiKey = () => true;
  repair.createClaudeCaller = () => async () => {
    await new Promise((r) => setTimeout(r, 300));
    return {
      proposals: [
        { where: 'cards[0].selector', selector: '[data-region="deadline-list"]', reason: '締め切りの一覧の作りが、class から data-region に変わったためです。' },
        { where: 'cards[1].selector', selector: '[data-region="announcement"]', reason: 'お知らせの作りが、class から data-region に変わったためです。' },
      ],
    };
  };
}

process.on('exit', () => fs.rmSync(work, { recursive: true, force: true }));
require('../src/main/main');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? '通った' : '落ちた'}: ${name}${ok ? '' : ` — ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
};

app.whenReady().then(async () => {
  let win = null;
  for (let i = 0; i < 100 && !win; i++) {
    win = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Todoku');
    if (!win) await wait(100);
  }
  const js = (code) => win.webContents.executeJavaScript(code);
  for (let i = 0; i < 100 && (await js("document.querySelectorAll('#deck > article.card').length")) < 3; i++) await wait(100);
  await js(`(() => {
    window.__said = [];
    for (const id of ['status', 'alert']) {
      const el = document.getElementById(id);
      new MutationObserver(() => { if (el.textContent) window.__said.push(el.textContent); }).observe(el, { childList: true, characterData: true, subtree: true });
    }
    return true;
  })()`);
  const press = (text) => js(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true; })()`);
  const said = () => js('window.__said.slice()');
  const focus = () => js('document.activeElement ? document.activeElement.textContent : null');
  const until = async (test, ms) => {
    for (let i = 0; i < ms / 200; i++) {
      if (await test()) return true;
      await wait(200);
    }
    return false;
  };

  // はじめの束から、画面が変わった後の練習の講座の束へ進む（アプリの名前のカードを押す）。
  await js(`[...document.querySelectorAll('#deck > article.card')].find((a) => a.querySelector('h2').textContent === ${JSON.stringify(NAME)}).click()`);
  await wait(300);
  check('はじめのカードに「設定ファイルを点検する（支援者向け）」のボタンがあり、押せる', await press('設定ファイルを点検する（支援者向け）'), null);
  // 点検と案（本物の Claude なら数十秒）が終わり、一件目の案に焦点が来るまで待つ（最長 180 秒）。
  await until(async () => /^1件目/.test((await focus()) || '') || (await said()).some((t) => /案を作れません|点検できません/.test(t)), 180 * 1000);
  // 知らせは焦点を移した少し後に入る作りなので、案の数の一文が入るまで待つ。
  await until(async () => (await said()).some((t) => /^当たらない行/.test(t)), 5 * 1000);
  const afterCheck = await said();
  console.log(`点検の後の知らせ: ${JSON.stringify(afterCheck)}`);
  console.log(`焦点: ${await focus()}`);
  const items = await js("[...document.querySelectorAll('#deck > article.card')[0].querySelectorAll('[data-item]')].map((x) => x.textContent)");
  console.log(`カードの項目:\n  ${items.join('\n  ')}`);
  if (process.env.UI_REPAIR_REAL === '1') {
    console.log('本物の Claude の案を書き出しました。受ける・断るは押さずに終わります。');
    app.exit(0);
    return;
  }
  check('点検の後、当たらない行と案の数を一文で知らせる', /^当たらない行が\d+件あり、直しの案が2件あります。$/.test(afterCheck[afterCheck.length - 1] || ''), afterCheck);

  const title0 = course.cards[0].title;
  const title1 = course.cards[1].title;
  await wait(300);
  await js('window.__said.length = 0');
  check('一件目の案を受けるボタンを押せる', await press(`「${title0}」の案を受ける（設定ファイルに書く）`), null);
  await until(async () => (await said()).some((t) => t.includes('案を受け')), 10 * 1000);
  const acceptSaid = await said();
  const written = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  const backups = fs.existsSync(path.join(userData, 'config-backups')) ? fs.readdirSync(path.join(userData, 'config-backups')) : [];
  check('受けると、設定ファイルのその行だけを書き換え、ほかの行は変えない',
    written.cards[0].selector === '[data-region="deadline-list"]' && written.cards[1].selector === course.cards[1].selector
      && written.cards.slice(2).every((c, k) => c.selector === course.cards[k + 2].selector), written.cards.map((c) => c.selector));
  check('受けると、前の版を config-backups に一つ残す', backups.length === 1 && /^practice-course-after\..+\.json$/.test(backups[0]), backups);
  check('受けたことを一文で知らせる', JSON.stringify(acceptSaid) === JSON.stringify([`「${title0}」の案を受け、設定ファイルに書きました。前の版は控えに残しました。`]), acceptSaid);

  await wait(300);
  await js('window.__said.length = 0');
  check('二件目の案を断るボタンを押せる', await press(`「${title1}」の案を断る`), null);
  await until(async () => (await said()).some((t) => t.includes('案を断り')), 10 * 1000);
  const rejectSaid = await said();
  const after = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  const backupsAfter = fs.readdirSync(path.join(userData, 'config-backups'));
  check('断ると、設定ファイルは変えず、控えも増やさない', after.cards[1].selector === course.cards[1].selector && backupsAfter.length === 1, { selector: after.cards[1].selector, backupsAfter });
  check('断ったことを一文で知らせる', /^「.+」の案を断りました。/.test(rejectSaid[0] || '') && rejectSaid[0].startsWith(`「${title1}」`), rejectSaid);

  console.log(failed === 0 ? '全部通りました。' : `${failed}件が落ちました。`);
  app.exit(failed === 0 ? 0 : 1);
}).catch((e) => {
  console.log(`止まりました: ${e.stack}`);
  app.exit(2);
});
