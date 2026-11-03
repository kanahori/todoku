'use strict';
// 直しの案の欄（採る／採らない）を、鍵が無くても画面に出して確かめるための起こし方。
// 動かし方: npm run ui:repair（Electron で動かす）。本物の Claude で確かめるときは UI_REPAIR_REAL=1 を足す。node --test から呼ばれたときは飛ばす。
// 作品のコードは変えない。Claude を呼ぶ所だけを、決まった案を返す偽物に差し替える。
// 手元の置き場には、画面が変わった後の練習のページを指す設定ファイルを、一時のフォルダに置く。

// 2026-11-03: 画面を基のカード型ページの形に作り直している途中で、点検と直しの案の欄は、まだ新しい画面にない。
// 直しの案を利用者の画面と保守の画面に作り直したら（作る順の (5)）、この起こし方も作り直す。
if (process.versions.electron) {
  console.log('直しの案の欄は、新しい画面で作り直している途中です。npm run ui:repair は、作り直すまで使えません。');
  require('electron').app.exit(0);
  return;
}

if (!process.versions.electron) {
  require('node:test')('直しの案の欄を画面に出す起こし方（Electron の上でだけ動く）', { skip: 'npm run ui:repair で動かす' }, () => {});
  return;
}

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const local = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-repair-'));
const course = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'cards', 'practice-course.json'), 'utf8'));
fs.writeFileSync(
  path.join(local, 'practice-course-after.json'),
  JSON.stringify({ ...course, id: 'practice-course-after', name: '練習の講座（画面が変わった後・作り物）', url: 'fixture:course-after.html' }, null, 2),
);
process.env.CARDS_LOCAL_DIR = local;

// main.js が読み込む前に、Claude を呼ぶ所を差し替える。
// UI_REPAIR_REAL=1 のときは差し替えず、本物の Claude を呼ぶ（鍵 CARDS_ANTHROPIC_API_KEY が要る）。
const repair = require('../src/main/repair');
if (process.env.UI_REPAIR_REAL !== '1') {
  repair.hasApiKey = () => true;
  repair.createClaudeCaller = () => async () => {
    await new Promise((r) => setTimeout(r, 1500)); // 本物らしく少し待つ
    return {
      proposals: [
        { where: 'cards[0].selector', selector: '[data-region="deadline-list"]', reason: '締め切りの一覧の作りが、class から data-region に変わったためです。' },
        { where: 'cards[1].selector', selector: '[data-region="announcement"]', reason: 'お知らせの作りが、class から data-region に変わったためです。' },
      ],
    };
  };
}

process.on('exit', () => fs.rmSync(local, { recursive: true, force: true }));
require('../src/main/main');

// UI_REPAIR_AUTO=1 のときは、画面の中でボタンを押し、読み上げへの知らせを書き出して終わる。
if (process.env.UI_REPAIR_AUTO === '1') {
  const { app, BrowserWindow } = require('electron');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  app.whenReady().then(async () => {
    await wait(3000);
    const win = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Todoku');
    const js = (code) => win.webContents.executeJavaScript(code);
    const status = () => js(`document.getElementById('status').textContent`);
    const section = `[...document.querySelectorAll('section.maint')].find((s) => s.querySelector('h3').textContent.startsWith('練習の講座（画面が変わった後'))`;
    await js(`${section}.querySelector('button').click()`);
    await wait(3000);
    console.log('点検の後: ' + (await status()));
    await js(`[...${section}.querySelectorAll('button')].find((b) => b.textContent === '直しの案を作る').click()`);
    await wait(500);
    // 本物の Claude は数十秒かかるので、知らせが「案を作っています」から変わるまで待つ（最長 180 秒）。
    // 知らせは、いったん空にしてから入れる作りなので、空のあいだも待つ。
    for (let i = 0; i < 180 && /^$|作っています/.test(await status()); i++) await wait(1000);
    await wait(1000);
    console.log('案の後: ' + (await status()));
    console.log('案の欄: ' + (await js(`[...${section}.querySelectorAll('fieldset')].map((f) => f.querySelector('legend').textContent + ' / ' + [...f.querySelectorAll('p')].map((p) => p.textContent).join(' / ')).join('\\n')`)));
    console.log('フォーカス: ' + (await js(`document.activeElement.id + ' ' + document.activeElement.type`)));
    await js(`${section}.querySelectorAll('input[value="yes"]').forEach((i) => { i.checked = true; })`);
    await js(`${section}.querySelector('form').requestSubmit()`);
    await wait(4000);
    console.log('書いた後: ' + (await status()));
    app.exit(0);
  }).catch((e) => { console.log('止まりました: ' + e.stack); app.exit(2); });
}
