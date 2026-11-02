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

  // 自治体風のページ: 自動で切り替わるカルーセルの、隠れているスライドも全部読める。
  const city = loadConfigFile(path.join(__dirname, '..', 'cards', 'practice-city.json')).config;
  const carousel = await runCard(BrowserWindow, city, 'carousel');
  check('カルーセルの 4件を番号付きで全部読める',
    carousel.ok && carousel.text.startsWith('4件あります。') && carousel.text.includes('4件目: 市の図書館'), carousel);
  check('画像だけのスライドも、画像の説明（alt）で読める',
    carousel.ok && carousel.text.includes('2件目: マイナンバーカードの休日窓口'), carousel);
  check('aria-hidden の付いた見えないスライドも読める',
    carousel.ok && carousel.text.includes('3件目: 冬の道路の通行止め'), carousel);
  const garbage = await runCard(BrowserWindow, city, 'garbage');
  check('ごみの日の表を 3行読める', garbage.ok && garbage.text.startsWith('3件あります。'), garbage);

  // 画面が変わる前と後: 同じ設定ファイルで点検し、当たらない行だけが返るか。
  const course = loadConfigFile(path.join(__dirname, '..', 'cards', 'practice-course.json')).config;
  const before = await checkCards(BrowserWindow, course, { settleMs: 100 });
  check('前の版では当たらない行が無い', before.length === 0, before);
  const after = await checkCards(BrowserWindow, { ...course, id: 'practice-course-after', url: 'fixture:course-after.html' }, { settleMs: 100 });
  const whereAfter = after.map((p) => p.where);
  check('後の版では cards[0] と cards[1] の selector だけが当たらない',
    JSON.stringify(whereAfter) === JSON.stringify(['cards[0].selector', 'cards[1].selector']), after);
  check('点検の結果にページの中身が入っていない', !JSON.stringify(after).includes('第3回'), after);

  // 直しの一巡（Claude を呼ぶ所は偽の返事）: 当たらない → 構造を集める → 案 → 採る → 設定ファイルが直る → 当たる。
  const os = require('node:os');
  const fs = require('node:fs');
  const { proposeRepairs, applyRepairs, saveConfigFile } = require('../src/main/repair');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-smoke-'));
  try {
    const file = path.join(tmp, 'practice-course.json');
    const afterConfig = { ...course, id: 'practice-course-repair', url: 'fixture:course-after.html' };
    fs.writeFileSync(file, JSON.stringify(afterConfig, null, 2));
    const loaded = loadConfigFile(file).config;
    const problems = await checkCards(BrowserWindow, loaded, { settleMs: 100 });
    let sentUser = '';
    const fakeModel = async ({ system, user }) => {
      sentUser = user;
      return {
        proposals: [
          { where: 'cards[0].selector', selector: '[data-region="deadline-list"]', reason: '締め切りの一覧が data-region に変わったため。' },
          { where: 'cards[1].selector', selector: '[data-region="announcement"]', reason: 'お知らせが data-region に変わったため。' },
        ],
      };
    };
    const { proposals, errors } = await proposeRepairs({ BrowserWindow, config: loaded, problems, callModel: fakeModel });
    check('Claude に送る文に、ページの文字が入っていない',
      sentUser.includes('data-region=deadline-list') && !sentUser.includes('第3回') && !sentUser.includes('担当教員') && !sentUser.includes('授業の資料'), sentUser.slice(0, 300));
    check('案が 2件でき、どちらも今のページで 1か所に当たる',
      errors.length === 0 && proposals.length === 2 && proposals.every((p) => p.matches === 1), { proposals, errors });
    saveConfigFile(file, applyRepairs(loaded, proposals), path.join(tmp, 'backups'));
    const fixed = loadConfigFile(file).config;
    const recheck = await checkCards(BrowserWindow, fixed, { settleMs: 100 });
    check('採った案を書いた後は、全部のカードが当たる', recheck.length === 0, recheck);
    const read = await runCard(BrowserWindow, fixed, 'deadlines');
    check('直したカードで締め切りを読める', read.ok && read.text.includes('第3回'), read);
    check('書く前の設定ファイルを控えに残した', fs.readdirSync(path.join(tmp, 'backups')).length === 1, fs.readdirSync(path.join(tmp, 'backups')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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
