'use strict';
// Electron の上で、cards/sample.json のカードを練習のページに当てる試し。
// 動かし方: npm run smoke（Electron で動かす）。node --test から呼ばれたときは飛ばす。

if (!process.versions.electron) {
  require('node:test')('練習のページに当てる試し（Electron の上でだけ動く）', { skip: 'npm run smoke で動かす' }, () => {});
  return;
}

const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { loadConfigFile } = require('../src/main/config');
const { runCard, checkCards } = require('../src/main/target');

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok });
  console.log(`${ok ? '通った' : '落ちた'}: ${name}${ok ? '' : ` — ${JSON.stringify(detail)}`}`);
}

async function main() {
  const { config, errors } = loadConfigFile(path.join(__dirname, '..', 'cards', 'sample.json'));
  if (!config) throw new Error(`sample.json を読めません: ${JSON.stringify(errors)}`);

  const inbox = await runCard(BrowserWindow, config, 'inbox');
  check('inbox を読むと受信箱の2件が読める', inbox.ok && inbox.text.includes('打ち合わせ') && inbox.text.includes('資料'), inbox);

  const assignments = await runCard(BrowserWindow, config, 'assignments');
  check('課題の一覧を読める', assignments.ok && assignments.text.includes('11月9日'), assignments);

  const compose = await runCard(BrowserWindow, config, 'new-message');
  check('新しい知らせのボタンを押せる', compose.ok && compose.action === 'click', compose);

  // 押した結果がページに出たか（練習のページが body に印を付ける）。
  const win = BrowserWindow.getAllWindows()[0];
  const composed = await win.webContents.executeJavaScript('document.body.dataset.composed');
  check('押したあと、ページの中で書く欄が開いた', composed === 'yes', composed);

  // 後から出てくる所は、出てくるまで待って読む。
  const late = { ...config, cards: [{ id: 'late', title: '次の締め切り', action: 'read', selector: '#deadline-list' }] };
  const wc = BrowserWindow.getAllWindows()[0].webContents;
  await wc.loadURL(wc.getURL()); // 読み込み直した直後は、締め切りはまだ出ていない
  const lateResult = await runCard(BrowserWindow, late, 'late');
  check('1秒後に出てくる締め切りを待って読める', lateResult.ok && lateResult.text.includes('23時59分'), lateResult);

  // 当たらない行は、設定ファイルの場所だけを返す。
  const broken = { ...config, cards: [...config.cards, { id: 'grades', title: '成績', action: 'read', selector: '#grades' }] };
  const miss = await runCard(BrowserWindow, broken, 'grades', { waitMs: 500 });
  check('当たらない行は cards[3].selector と返す', !miss.ok && miss.where === 'cards[3].selector' && miss.text === undefined, miss);

  const bad = { ...config, cards: [{ id: 'bad', title: '壊れた行', action: 'read', selector: 'ul[' }] };
  const invalid = await runCard(BrowserWindow, bad, 'bad', { waitMs: 500 });
  check('書き方の正しくない selector も cards[0].selector と返す', !invalid.ok && invalid.where === 'cards[0].selector', invalid);

  // ログインの画面に当たったら、「当たらない」ではなく「ログインが要る」と返す。
  const loginConfig = {
    ...config,
    login: { selector: 'body.notloggedin', path: '/practice-login.html' },
    cards: [{ id: 'dash', title: 'ダッシュボード', action: 'read', selector: '#dashboard', path: '/practice-guest.html' }],
  };
  const login = await runCard(BrowserWindow, loginConfig, 'dash', { waitMs: 3000 });
  check('ログインしていないときは needLogin を返す', !login.ok && login.needLogin === true && login.where === undefined, login);
  const loginUrl = BrowserWindow.getAllWindows()[0].webContents.getURL();
  check('ログインが要るときは login.path の画面を開く', loginUrl.endsWith('/practice-login.html'), loginUrl);

  // 画面が変わる前と後: 同じ設定ファイルで点検し、当たらない行だけが返るか。
  const course = loadConfigFile(path.join(__dirname, '..', 'cards', 'practice-course.json')).config;
  const before = await checkCards(BrowserWindow, course, { settleMs: 100 });
  check('前の版では当たらない行が無い', before.length === 0, before);
  const after = await checkCards(BrowserWindow, { ...course, id: 'practice-course-after', url: 'fixture:course-after.html' }, { settleMs: 100 });
  const whereAfter = after.map((p) => p.where);
  check('後の版では cards[0] と cards[1] の selector だけが当たらない',
    JSON.stringify(whereAfter) === JSON.stringify(['cards[0].selector', 'cards[1].selector']), after);
  check('点検の結果にページの中身が入っていない', !JSON.stringify(after).includes('第3回'), after);
}

app.whenReady()
  .then(main)
  .then(() => {
    const failed = checks.filter((c) => !c.ok).length;
    console.log(`${checks.length}件のうち、${checks.length - failed}件が通りました。`);
    app.exit(failed === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error(`試しが止まりました: ${e.stack}`);
    app.exit(2);
  });
