'use strict';
// 本物のつくば市の公式サイトで、cards/tsukuba-city.json のカードが当たるかと、自動で直す一巡が通るかを確かめる起こし方。
// 動かし方: npm run real:tsukuba（Electron で動かす・外のページに届くネットワークが要る）。node --test から呼ばれたときは飛ばす。
// npm run smoke には入れない（smoke は外へ出ない）。本物への負荷を小さくするため、手で一度ずつ動かす。
// 開くのは、トップ（2回: 設定ファイルの窓と、試しのための古い行を含む写しの窓）とイベントカレンダー（1回）の3回だけ。間は数秒あける。
// 書き出すのは、カードごとの当たった件数と文字数だけ。ページの文字は書き出さない。
// 自動で直す所は、Claude を呼ばずに偽の返事を使う（Mac には鍵が無い）。偽の返事は、送られた構造に一覧の作りがあるときだけ案を返す。

if (!process.versions.electron) {
  require('node:test')('本物のつくば市のページで確かめる起こし方（Electron の上でだけ動く）', { skip: 'npm run real:tsukuba で動かす' }, () => {});
  return;
}

// 窓を画面に出さず、前のアプリから焦点を奪わない（--show-windows を付けたときだけ窓を出す）。
require('./headless');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { loadConfigFile } = require('../src/main/config');
const { runCard } = require('../src/main/target');
const { createOverrideStore, runCardWithAutoRepair } = require('../src/main/autofix');
const { looksTextFree } = require('../src/main/structure');
const { proxySwitches } = require('../src/main/proxy');

for (const [name, value] of proxySwitches()) app.commandLine.appendSwitch(name, value);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? '通った' : '落ちた'}: ${name}${ok || detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
}

// ページを読み込んだ回数（# から後だけの移り変わりは数えない）。
let loads = 0;
app.on('browser-window-created', (_e, win) => {
  win.webContents.on('did-navigate', () => { loads += 1; });
});
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  const config = loadConfigFile(path.join(__dirname, '..', 'cards', 'tsukuba-city.json')).config;
  check('cards/tsukuba-city.json が読める', config);

  // 1. 全部のカードを本物で一度ずつ当てる。トップのカードを先に、別のページ（path のある）カードを後に。
  const ordered = [...config.cards.filter((c) => !c.path), ...config.cards.filter((c) => c.path)];
  for (const card of ordered) {
    const r = await runCard(BrowserWindow, config, card.id);
    const n = r.items ? r.items.length : null;
    const empty = r.items ? r.items.filter((t) => t.trim() === '').length : null;
    console.log(`  ${card.id}: ${r.ok ? `${n}件・文字数 ${r.text.length}・空の項目 ${empty}` : `当たらない（${r.where}）`}`);
    check(`${card.id}: 当たり、空でない項目を読める`, r.ok && n > 0 && empty === 0, r.ok ? undefined : r.message);
    // 日付の要素のあるカード（イベント情報）は、どの項目も「11月6日」の形の月日で始まる（文字は書き出さず、数だけ）。
    if (card.dateSelector && r.ok) {
      const dated = r.items.filter((t) => /^\d{1,2}月\d{1,2}日[ 、]/.test(t)).length;
      // 頭の12字の形だけを書き出す（数字・月・日・読点・空白のほかは「字」にする）。
      const head = r.items[0] ? r.items[0].slice(0, 12).replace(/[^\d月日、 ]/g, '字') : '';
      console.log(`  ${card.id}: 月日で始まる項目 ${dated}件／${n}件・1件目の頭の形「${head}」`);
      if (card.tagSelector) {
        const tagged = r.items.filter((t) => /（[^（）]+）$/.test(t)).length;
        console.log(`  ${card.id}: 分類を後ろの括弧で読む項目 ${tagged}件／${n}件`);
      }
      check(`${card.id}: どの項目も月日（「11月6日」の形）で始まる`, dated === n);
    }
  }

  // 2. 試しのための古い行を一つ含む写しで、自動で直す一巡。
  await wait(3000);
  const old = loadConfigFile(path.join(__dirname, 'tsukuba-city-old-line-for-test.json')).config;
  const oldCard = old.cards.find((c) => c.id === 'news');
  const right = config.cards.find((c) => c.id === 'news').selector;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'real-tsukuba-'));
  try {
    const store = createOverrideStore(path.join(userData, 'repairs'));
    let calls = 0;
    let structureOk = null;
    let structureChars = 0;
    const fakeModel = async ({ user }) => {
      calls += 1;
      const m = /<structure>\n([\s\S]*)\n<\/structure>/.exec(user);
      const structure = m ? m[1] : '';
      structureChars = structure.length;
      structureOk = looksTextFree(structure);
      // 送られた構造に、いまの一覧の作り（二段の入れ物の中の ul.news-list と li.pageEntity）があるときだけ案を返す。
      const seen = structure.includes('div.news-box') && structure.includes('ul.news-list.pageListBlock') && structure.includes('li.pageEntity');
      return { proposals: seen ? [{ where: 'cards[1].selector', selector: right, reason: '一覧が入れ物の中に一段深く入ったため、子の結び付きを外しました。' }] : [] };
    };
    const r = await runCardWithAutoRepair({ BrowserWindow, config: old, cardId: 'news', callModel: fakeModel, store });
    const n = r.items ? r.items.length : null;
    console.log(`  自動で直す: 前 ${oldCard.selector} → 後 ${r.repaired ? r.repaired.after : '(直らず)'}・当たった数 ${r.repaired ? r.repaired.matches : '-'}・読み直し ${n}件・送った構造 ${structureChars}文字`);
    check('自動で直す: 古い行は当たらず、Claude（偽）を1回だけ呼んだ', calls === 1, { calls, reason: r.autoRepairReason });
    check('自動で直す: 送った構造に、ページの文字が入っていない', structureOk === true);
    check('自動で直す: 案を本物のページで試して採り、読み直して1件以上読めた', r.ok && r.repaired && r.repaired.after === right && n > 0, { ok: r.ok, reason: r.autoRepairReason });
    const saved = store.load(old.id);
    check('自動で直す: 手元の上書きのファイルに、前と後のセレクタを残した', saved.length === 1 && saved[0].before === oldCard.selector && saved[0].after === right);
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }

  const failed = checks.filter((c) => !c.ok).length;
  console.log(`ページを読み込んだ回数: ${loads}`);
  console.log(`確かめた数: ${checks.length}・通った: ${checks.length - failed}・落ちた: ${failed}`);
  app.exit(failed === 0 ? 0 : 1);
}).catch((e) => { console.log('止まりました: ' + e.stack); app.exit(2); });
