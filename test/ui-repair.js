'use strict';
// 直しの案の欄（採る／採らない）を、鍵が無くても画面に出して確かめるための起こし方。
// 動かし方: npm run ui:repair（Electron で動かす）。node --test から呼ばれたときは飛ばす。
// 作品のコードは変えない。Claude を呼ぶ所だけを、決まった案を返す偽物に差し替える。
// 手元の置き場には、画面が変わった後の練習のページを指す設定ファイルを、一時のフォルダに置く。

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
const repair = require('../src/main/repair');
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

process.on('exit', () => fs.rmSync(local, { recursive: true, force: true }));
require('../src/main/main');

// UI_REPAIR_AUTO=1 のときは、画面の中でボタンを押し、読み上げへの知らせを書き出して終わる。
if (process.env.UI_REPAIR_AUTO === '1') {
  const { app, BrowserWindow } = require('electron');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  app.whenReady().then(async () => {
    await wait(3000);
    const win = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'カードの画面');
    const js = (code) => win.webContents.executeJavaScript(code);
    const status = () => js(`document.getElementById('status').textContent`);
    const section = `[...document.querySelectorAll('section.maint')].find((s) => s.querySelector('h3').textContent.startsWith('練習の講座（画面が変わった後'))`;
    await js(`${section}.querySelector('button').click()`);
    await wait(3000);
    console.log('点検の後: ' + (await status()));
    await js(`[...${section}.querySelectorAll('button')].find((b) => b.textContent === '直しの案を作る').click()`);
    await wait(5000);
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
