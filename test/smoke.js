'use strict';
// Electron の上で、test/fixtures/sample.json のカードを練習のページに当てる試し（sample.json は試しのためだけのもので、作品の画面には出さない）。
// 動かし方: npm run smoke（Electron で動かす）。node --test から呼ばれたときは飛ばす。

if (!process.versions.electron) {
  require('node:test')('練習のページに当てる試し（Electron の上でだけ動く）', { skip: 'npm run smoke で動かす' }, () => {});
  return;
}

const path = require('node:path');
const { app, BrowserWindow } = require('electron');
// 落ちたときに、エラーのダイアログを出して止まらないようにする（試しは画面の前に人がいない前提で動くため）。
// エラーは書き出し、終わりの番号 3 で終わる。
const { dialog: errorDialog } = require('electron');
errorDialog.showErrorBox = (title, content) => { console.log(`エラー: ${title} ${content}`); app.exit(3); };
process.on('uncaughtException', (e) => { console.log(`エラー: ${e.stack}`); app.exit(3); });
const { loadConfigFile } = require('../src/main/config');
const { runCard, checkCards } = require('../src/main/target');

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok });
  console.log(`${ok ? '通った' : '落ちた'}: ${name}${ok ? '' : ` — ${JSON.stringify(detail)}`}`);
}

// ダウンロードの保存先は、試しでは一時のフォルダにする。
const os = require('node:os');
const fs = require('node:fs');
const { attachDownloads } = require('../src/main/download');
const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'download-smoke-'));
const lateDownloads = [];

async function main() {
  attachDownloads(require('electron').session.defaultSession, { getDir: () => downloadDir, onDone: (r) => lateDownloads.push(r) });
  const { config, errors } = loadConfigFile(path.join(__dirname, 'fixtures', 'sample.json'));
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

  // ページの中の動きで # から後だけが変わっても、次のカードで読み込み直さない（読み込み直すと、出した表が消える）。
  const withHash = { ...config, cards: [...config.cards, { id: 'show-table', title: '表を表示', action: 'click', selector: '#show-table' }] };
  const shown = await runCard(BrowserWindow, withHash, 'show-table', { downloadStartMs: 300 });
  const hashUrl = BrowserWindow.getAllWindows()[0].webContents.getURL();
  check('表を表示を押すと、URL の # から後だけが変わる', shown.ok && hashUrl.endsWith('practice.html#shown'), { shown, hashUrl });
  const afterHash = await runCard(BrowserWindow, withHash, 'inbox');
  const tableStill = await BrowserWindow.getAllWindows()[0].webContents.executeJavaScript("Boolean(document.getElementById('shown-table'))");
  check('# が付いた後に別のカードを読んでも、読み込み直さない（出した表が残る）', afterHash.ok && tableStill === true, { afterHash, tableStill });

  // 押した結果のダウンロードは、ダイアログを出さずに保存先のフォルダへ、元の名前で保存する（同じ名前があれば番号を付ける）。
  {
    const withDownload = { ...config, cards: [...config.cards, { id: 'download', title: '作り物の値をダウンロード', action: 'click', selector: '#download-sample' }] };
    fs.writeFileSync(path.join(downloadDir, 'practice-data.csv'), 'いまあるファイル');
    const got = await runCard(BrowserWindow, withDownload, 'download');
    check('押した結果のダウンロードを「「practice-data (1).csv」をダウンロードのフォルダに保存しました。」と返す',
      got.ok && got.action === 'click' && got.download && got.download.ok === true
        && got.download.message === '「practice-data (1).csv」をダウンロードのフォルダに保存しました。', got);
    const saved = path.join(downloadDir, 'practice-data (1).csv');
    check('保存したファイルの中身が、ダウンロードさせた中身と同じ',
      fs.existsSync(saved) && fs.readFileSync(saved, 'utf8') === 'date,value\n2026-11-01,12.3\n', fs.readdirSync(downloadDir));
    check('前からあったファイルは書き換えない', fs.readFileSync(path.join(downloadDir, 'practice-data.csv'), 'utf8') === 'いまあるファイル');
    check('押すカードが受け取ったダウンロードは、別の知らせ（onDone）を出さない', lateDownloads.length === 0, lateDownloads);

    // 保存の名前の型（saveAs）があれば、その名前で保存する。{date} は保存した日、{n} は使われていない番号。
    const { formatDate } = require('../src/main/download');
    const today = formatDate(new Date());
    const named = { ...config, cards: [...config.cards, { id: 'download', title: '作り物の値をダウンロード', action: 'click', selector: '#download-sample', saveAs: '作り物の値_{date}.csv' }] };
    const gotNamed = await runCard(BrowserWindow, named, 'download');
    const namedFile = `作り物の値_${today}.csv`;
    check(`saveAs があれば「${namedFile}」の名前で保存し、その名前で知らせる`,
      gotNamed.ok && gotNamed.download && gotNamed.download.ok === true
        && gotNamed.download.message === `「${namedFile}」をダウンロードのフォルダに保存しました。`
        && fs.readFileSync(path.join(downloadDir, namedFile), 'utf8') === 'date,value\n2026-11-01,12.3\n', { gotNamed, files: fs.readdirSync(downloadDir) });
    const numbered = { ...config, cards: [...config.cards, { id: 'download', title: '作り物の値をダウンロード', action: 'click', selector: '#download-sample', saveAs: '作り物の値_{n}' }] };
    const n1 = await runCard(BrowserWindow, numbered, 'download');
    const n2 = await runCard(BrowserWindow, numbered, 'download');
    check('saveAs の {n} は 1 から使われていない番号になり、拡張子が無ければ元の名前の拡張子（.csv）を足す',
      n1.download && n1.download.name === '作り物の値_1.csv' && n2.download && n2.download.name === '作り物の値_2.csv', { n1, n2 });
    const plain = await runCard(BrowserWindow, withDownload, 'download');
    check('saveAs の無い押すカードは、今までどおり元の名前で保存する（前の saveAs が残らない）',
      plain.download && plain.download.name === 'practice-data (2).csv', plain);
  }

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

  // 0件と「読めません」を分ける: 入れ物（container）に当たって項目が無ければ 0件、入れ物にも当たらなければ当たらない。
  const emptyCard = { id: 'empty', title: '空の一覧', action: 'list', selector: '#compose-area li', container: '#compose-area' };
  const empty = await runCard(BrowserWindow, { ...config, cards: [emptyCard] }, 'empty', { waitMs: 3000 });
  check('入れ物に当たって項目が無ければ、0件として読める（items が空）',
    empty.ok && empty.action === 'list' && Array.isArray(empty.items) && empty.items.length === 0, empty);
  const noBox = { ...emptyCard, container: undefined };
  const noBoxResult = await runCard(BrowserWindow, { ...config, cards: [noBox] }, 'empty', { waitMs: 500 });
  check('container の無いカードは、今までどおり 0件を cards[0].selector の当たらない行として返す',
    !noBoxResult.ok && noBoxResult.where === 'cards[0].selector', noBoxResult);
  const goneBox = { ...emptyCard, container: '#no-such-box' };
  const goneResult = await runCard(BrowserWindow, { ...config, cards: [goneBox] }, 'empty', { waitMs: 500 });
  check('入れ物にも当たらなければ、cards[0].selector の当たらない行として返す',
    !goneResult.ok && goneResult.where === 'cards[0].selector', goneResult);
  const badBox = { ...emptyCard, container: 'ul[' };
  const badBoxResult = await runCard(BrowserWindow, { ...config, cards: [badBox] }, 'empty', { waitMs: 500 });
  check('書き方の正しくない container は cards[0].container と返す',
    !badBoxResult.ok && badBoxResult.where === 'cards[0].container', badBoxResult);
  // 入れ物が先に見え、1秒後に項目が出てくるページでも、0件と早まらずに項目を待って読む。
  await wc.loadURL(wc.getURL());
  const lateBox = { id: 'late-list', title: '次の締め切り', action: 'list', selector: '#deadline-list li', container: '#deadline-list' };
  const lateBoxResult = await runCard(BrowserWindow, { ...config, cards: [lateBox] }, 'late-list');
  check('入れ物が先に見えても、1秒後に出てくる項目を待って 1件読める',
    lateBoxResult.ok && lateBoxResult.items.length === 1 && lateBoxResult.text.includes('23時59分'), lateBoxResult);
  const emptyCheck = await checkCards(BrowserWindow, { ...config, cards: [emptyCard, noBox, goneBox] }, { settleMs: 100 });
  check('点検では、入れ物に当たる 0件のカードは当たらない行に入れない',
    JSON.stringify(emptyCheck.map((p) => p.where)) === JSON.stringify(['cards[1].selector', 'cards[2].selector']), emptyCheck);

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

  // みどり市の「画面が変わった後」: カルーセルの部品が作りを組み替えると、カルーセルのカードだけが当たらなくなる（本物の自治体で見た形）。
  const city2 = loadConfigFile(path.join(__dirname, '..', 'cards', 'practice-city.json')).config;
  const cityAfter = await checkCards(BrowserWindow, { ...city2, id: 'practice-city-after', url: 'fixture:city-top-after.html' }, { settleMs: 100 });
  check('みどり市の後の版では、カルーセルのカード（cards[0].selector）だけが当たらない',
    JSON.stringify(cityAfter.map((p) => p.where)) === JSON.stringify(['cards[0].selector']), cityAfter);
  const cityFixed = { ...city2, id: 'practice-city-fixed', url: 'fixture:city-top-after.html',
    cards: city2.cards.map((c, n) => (n === 0 ? { ...c, selector: '.hero .vis-item:not(.is-clone)' } : c)) };
  const carousel2 = await runCard(BrowserWindow, cityFixed, 'carousel');
  check('組み替えた後の作りに合わせた selector なら、4件とも読める（複製は読まない・aria-hidden を越える）',
    carousel2.ok && carousel2.text.startsWith('4件あります。') && carousel2.text.includes('2件目: マイナンバーカードの休日窓口'), carousel2);

  // 直しの一巡（Claude を呼ぶ所は偽の返事）: 当たらない → 構造を集める → 案 → 採る → 設定ファイルが直る → 当たる。
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

  // 気象庁の「選んだ地点」のカード: 地点の名前だけを1件ずつ読み、観測している項目の画像の説明（気温・降水量…）は読まない。
  // 本物の気象庁ではなく、同じ作りの作り物のページ（test/fixtures/selected-stations.html）に当てる。
  {
    const obsdl = loadConfigFile(path.join(__dirname, '..', 'cards', 'jma-obsdl.json')).config;
    const onFixture = { ...obsdl, id: 'jma-obsdl-fixture', url: 'fixture:selected-stations.html' };
    const stations = await runCard(BrowserWindow, onFixture, 'selected-station');
    check('「選んだ地点」は地点の名前だけを1件ずつ読む（みどり・あおばの2件。気温などの分類の名前は入らない）',
      stations.ok && stations.action === 'list' && JSON.stringify(stations.items) === JSON.stringify(['みどり', 'あおば']), stations);
    const card = obsdl.cards.find((c) => c.id === 'selected-station');
    const emptyConfig = { ...onFixture, cards: [{ ...card, selector: '#emptyStationList .selectedStText', container: '#emptyStationList' }] };
    const none = await runCard(BrowserWindow, emptyConfig, 'selected-station', { waitMs: 3000 });
    check('地点を一つも選んでいないとき（入れ物だけある）は、0件として読める',
      none.ok && Array.isArray(none.items) && none.items.length === 0, none);
  }

  await rendererFocusChecks();
}

// カードの画面（src/renderer）の焦点の試し。cardsApi は偽物（test/renderer-preload.js）。
// 2026-11-03 の Windows の確かめで、すぐ結果が返るカードでは「読んでいます。」の項目に焦点を移した直後にその項目が消え、
// NVDA が焦点を見失った。すぐ返るときは読み込み中の項目を出さずに結果の最初へ、時間がかかるときは読み込み中の項目から結果の最初へ、
// 焦点のある要素を DOM から外さずに移ることを確かめる。
async function rendererFocusChecks() {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { preload: path.join(__dirname, 'renderer-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  try {
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    const js = (code) => win.webContents.executeJavaScript(code);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let k = 0; k < 50 && (await js("document.querySelectorAll('#deck > article.card').length")) < 4; k++) await wait(50);
    // 見張り: 読み込み中の項目が DOM に入った回数と、焦点のある要素（か、それを含む要素）を DOM から外した回数を数える。
    await js(`(() => {
      const t = { loadingAdded: 0, removedWithFocus: 0 };
      window.__watch = t;
      new MutationObserver((ms) => {
        for (const m of ms) for (const n of m.addedNodes) {
          if (n.nodeType === 1 && (n.matches('[data-loading]') || n.querySelector('[data-loading]'))) t.loadingAdded++;
        }
      }).observe(document.getElementById('deck'), { subtree: true, childList: true });
      const holdsFocus = (node) => node !== document.body && node.contains(document.activeElement);
      for (const name of ['remove', 'replaceWith']) {
        const orig = Element.prototype[name];
        Element.prototype[name] = function (...a) { if (holdsFocus(this)) t.removedWithFocus++; return orig.apply(this, a); };
      }
      const origReplaceChildren = Element.prototype.replaceChildren;
      Element.prototype.replaceChildren = function (...a) {
        if ([...this.children].some(holdsFocus)) t.removedWithFocus++;
        return origReplaceChildren.apply(this, a);
      };
      const origRemoveChild = Node.prototype.removeChild;
      Node.prototype.removeChild = function (c) { if (c.nodeType === 1 && holdsFocus(c)) t.removedWithFocus++; return origRemoveChild.call(this, c); };
      return true;
    })()`);
    const key = (k) => js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true }))`);
    const focusState = () => js(`(() => {
      const a = document.activeElement;
      const card = a && a.closest ? a.closest('article.card') : null;
      return {
        tag: a ? a.tagName : null,
        text: a ? a.textContent : null,
        connected: a ? a.isConnected : false,
        isResult: Boolean(a && a.hasAttribute && a.hasAttribute('data-result')),
        isLoading: Boolean(a && a.hasAttribute && a.hasAttribute('data-loading')),
        firstResult: Boolean(card && card.querySelector('[data-result]') === a),
        heading: card ? card.querySelector('h2').textContent : null,
        busy: card ? card.getAttribute('aria-busy') : null,
        loadingInDoc: document.querySelectorAll('[data-loading]').length,
        watch: window.__watch,
      };
    })()`);

    // 1. すぐ返る読む所（はじめのカードの次）。
    await key('ArrowDown');
    await key('Enter');
    await wait(900); // 読み込み中を出すまでの 0.5秒を越えて待つ
    const fast = await focusState();
    check('すぐ返る読む所: 焦点が結果の最初の項目にある',
      fast.connected && fast.isResult && fast.firstResult && fast.text === 'すぐ返った一つ目' && fast.heading === 'すぐ返る読む所', fast);
    check('すぐ返る読む所: 読み込み中の項目を出さず、焦点も残っていない', fast.watch.loadingAdded === 0 && !fast.isLoading && fast.loadingInDoc === 0, fast);

    // 2. すぐ返る一覧（二枚目。もう一度 Enter で読み直す場合も）。
    await key('Escape');
    await key('ArrowDown');
    await key('Enter');
    await wait(900);
    const list = await focusState();
    check('すぐ返る一覧: 焦点が一覧の最初の項目（li）にある',
      list.connected && list.tag === 'LI' && list.firstResult && list.text === '一覧の一件目' && list.heading === 'すぐ返る一覧（2件）', list);
    await key('Escape');
    await key('Enter');
    await wait(900);
    const again = await focusState();
    check('読み直しでも、焦点が一覧の最初の項目にあり、読み込み中の項目は出ない',
      again.connected && again.tag === 'LI' && again.firstResult && again.watch.loadingAdded === 0 && again.loadingInDoc === 0, again);

    // 3. 時間のかかる読む所: 0.5秒後に読み込み中の項目へ焦点が移り、結果が来たら結果の最初へ移る。
    await key('Escape');
    await key('ArrowDown');
    await key('Enter');
    await wait(800);
    const loading = await focusState();
    check('時間のかかる読む所: 0.5秒後は「読んでいます。」の項目に焦点があり、見出しに（読んでいます）・aria-busy が付く',
      loading.isLoading && loading.heading === '時間のかかる読む所（読んでいます）' && loading.busy === 'true', loading);
    await wait(1000);
    const slow = await focusState();
    check('時間のかかる読む所: 結果が来たら、焦点が結果の最初の項目に移り、読み込み中の項目は残っていない',
      slow.connected && slow.firstResult && slow.text === '遅れて返った一つ目' && !slow.isLoading && slow.loadingInDoc === 0 && slow.busy === null, slow);
    check('焦点のある要素を、一度も DOM から外していない', slow.watch.removedWithFocus === 0, slow.watch);

    // 4. はじめのカード: 出典の文は URL を含まず、最後の項目の「出典のページを開く」ボタンで、そのアプリの出典のページを開く。
    await key('Escape');
    await key('Home');
    await key('Enter');
    const firstTexts = await js("[...document.querySelectorAll('#deck > article.card')[0].querySelectorAll('[data-item]')].map((n) => n.textContent)");
    check('はじめのカードの項目に、出典の文があり、URL は無い',
      firstTexts.includes('出典：作り物のサイトを加工して作成。') && !firstTexts.some((t) => /https?:/.test(t)), firstTexts);
    await key('End');
    const sourceButton = await focusState();
    check('はじめのカードの最後の項目は「出典のページを開く」ボタン', sourceButton.tag === 'BUTTON' && sourceButton.text === '出典のページを開く', sourceButton);
    await js('document.activeElement.click()');
    await wait(300);
    const opened = await js('window.fakeLog.opened()');
    const said = await js("document.getElementById('status').textContent");
    check('ボタンを押すと、そのアプリの出典のページを開くよう頼み、開いたことを知らせる',
      JSON.stringify(opened) === JSON.stringify(['fake-app']) && said === '出典のページを、既定のブラウザで開きました。', { opened, said });
  } finally {
    win.destroy();
  }
}

app.whenReady()
  .then(main)
  .then(() => {
    fs.rmSync(downloadDir, { recursive: true, force: true });
    const failed = checks.filter((c) => !c.ok).length;
    console.log(`${checks.length}件のうち、${checks.length - failed}件が通りました。`);
    app.exit(failed === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error(`試しが止まりました: ${e.stack}`);
    app.exit(2);
  });
