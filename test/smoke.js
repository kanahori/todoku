'use strict';
// Electron の上で、test/fixtures/sample.json のカードを練習のページに当てる試し（sample.json は試しのためだけのもので、作品の画面には出さない）。
// 動かし方: npm run smoke（Electron で動かす）。node --test から呼ばれたときは飛ばす。

if (!process.versions.electron) {
  require('node:test')('練習のページに当てる試し（Electron の上でだけ動く）', { skip: 'npm run smoke で動かす' }, () => {});
  return;
}

// 窓を画面に出さず、前のアプリから焦点を奪わない（--show-windows を付けたときだけ窓を出す）。
const { headless } = require('./headless');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
// 落ちたときに、エラーのダイアログを出して止まらないようにする（試しは画面の前に人がいない前提で動くため）。
// エラーは書き出し、終わりの番号 3 で終わる。
const { dialog: errorDialog } = require('electron');
errorDialog.showErrorBox = (title, content) => { console.log(`エラー: ${title} ${content}`); app.exit(3); };
process.on('uncaughtException', (e) => { console.log(`エラー: ${e.stack}`); app.exit(3); });
const { loadConfigFile } = require('../src/main/config');
const {
  runCard, checkCards, setHomeWindow, showTarget, closeTarget, readItemTarget, readLinks, revealTarget, isRevealed, currentPageUrl,
} = require('../src/main/target');

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

  // 大学のトップの作り（作り物の「みどり技術大学」）: 本学の三つのサイトの設定ファイル（手元の置き場）と同じ selector の形で読めること。
  // 切り替えのための同じニュースの写しは読まない。トピックスは写真の説明を読まず、日付・分類・題を読む。入試の案内へのリンクは、カードにしない。
  const univ = loadConfigFile(path.join(__dirname, 'practice-univ-for-test.json')).config;
  const univPickup = await runCard(BrowserWindow, univ, 'pickup');
  check('大学のトップ: ピックアップニュースを、写しを除いて4件読む',
    univPickup.ok && JSON.stringify(univPickup.items) === JSON.stringify([
      'みどり学部 学部紹介、みどり学部の概要の動画です。', '【保健の学科】来年に新しいコースができます、新しいコースの案内です。', '見学の日の案内', '町の会社と組む授業']), univPickup.items);
  const univAnn = await runCard(BrowserWindow, univ, 'announcements');
  check('大学のトップ: お知らせを、日付・分類・題の一件ずつで読む',
    univAnn.ok && univAnn.items.length === 3 && univAnn.items[0] === '2026年11月02日、イベント、11月7日 体を動かす教室のご案内', univAnn.items);
  check('作り物の大学: 読まない決まり（skipItemsMatching）に当たる入試案内の一件は読まず、件数にも入れない',
    univAnn.ok && univAnn.text.startsWith('3件あります。') && !univAnn.items.some((t) => t.includes('入試')) && !univAnn.text.includes('入試'), univAnn);
  const univTopics = await runCard(BrowserWindow, univ, 'topics');
  check('大学のトップ: トピックスを、写真の説明を読まずに、日付・分類・題で読む。日付の無い固定の記事は、頭の「＼」「／」を読まず、「固定の記事、」を付ける（undatedLabel）',
    univTopics.ok && JSON.stringify(univTopics.items) === JSON.stringify([
      '固定の記事、Hot!、学生・卒業生の活躍、卒業生が大会で金メダルを取りました', '2026年11月04日、学生・卒業生の活躍、情報の学科の学生が大会で優勝しました'])
      && univTopics.text.split('\n')[1] === '1件目: 固定の記事、Hot!、学生・卒業生の活躍、卒業生が大会で金メダルを取りました', univTopics);
  const univIntro = await runCard(BrowserWindow, univ, 'intro');
  check('学部の紹介: 見出しの中の改行（br）では段落を分けず、「みんなで学ぶ、あしたの町へ」の一つの段落として読む',
    univIntro.ok && univIntro.text === 'みんなで学ぶ、あしたの町へ\n作り物の学部の紹介の一つ目の文です。\n作り物の学部の紹介の二つ目の文です。', univIntro.text);
  check('大学のトップ: 入試の案内へのリンクを読むカードは無い（ピックアップのリンクはカードにしない）',
    !univ.cards.some((c) => /入試|pickuplink|admission/.test(`${c.title} ${c.selector} ${c.container || ''}`)), univ.cards.map((c) => c.selector));

  // 自治体風のページ: 自動で切り替わるカルーセルの、隠れているスライドも全部読める。
  const city = loadConfigFile(path.join(__dirname, '..', 'cards', 'practice-city.json')).config;
  const carousel = await runCard(BrowserWindow, city, 'carousel');
  check('カルーセルの 4件を番号付きで全部読める',
    carousel.ok && carousel.text.startsWith('4件あります。') && carousel.text.includes('4件目: 市の図書館'), carousel);
  check('画像だけのスライドも、画像の説明（alt）で読める',
    carousel.ok && carousel.text.includes('2件目: マイナンバーカードの休日窓口'), carousel);
  check('aria-hidden の付いた見えないスライドも読める',
    carousel.ok && carousel.text.includes('3件目: 冬の道路の通行止め'), carousel);
  // 画像の説明（alt）と文字の重なり: 同じか、片方が他方を含むときは一度だけ読む。違う中身は両方読む。
  const altConfig = { id: 'alt-text', name: 'あおば町のリンク集（作り物）', url: 'fixture:alt-text.html',
    cards: [{ id: 'links', title: 'リンク集', action: 'list', selector: '#links li' }, { id: 'all', title: 'リンク集', action: 'read', selector: '#links' }] };
  const altExpected = ['あおば町の地図のサイト「あおばマップ」', 'こども学習を支援サイト「まなび」', '図書館の開館日', 'あおば町の路線バスの時刻表',
    '探究学習の支援サイト「steam まなび」', 'あおば町在宅医療・介護連携の事業', 'AOBA OPEN DATA', '町民プール 夏の行事'];
  const altList = await runCard(BrowserWindow, altConfig, 'links');
  check('画像の説明: 一覧の項目の中で、画像の説明と文字が同じか片方が他方を含むときは一度だけ読み、違う中身は両方読む',
    altList.ok && JSON.stringify(altList.items) === JSON.stringify(altExpected), altList.items);
  const altRead = await runCard(BrowserWindow, altConfig, 'all');
  // 読むカードは行ごとに読む。「・」で終わる行は次の行につなぐが、英字の二行（AOBA と OPEN DATA）は別の行のまま。
  const altReadExpected = [...altExpected.slice(0, 6), 'AOBA', 'OPEN DATA', altExpected[7]];
  check('画像の説明: 読むカードでも、行の中の重なりを一度だけ読む', altRead.ok && altRead.text === altReadExpected.join('\n'), altRead.text);
  closeTarget('alt-text');

  // 作り物のチャットの画面（cards/practice-chat.json）: 返事が描かれている最中（aria-busy="true"）に読んだら、書き終わるのを待って読む。
  // 待つ長さの内に書き終わらなければ、そこまでを読み、途中だと返す（partial）。
  {
    const chat = loadConfigFile(path.join(__dirname, '..', 'cards', 'practice-chat.json')).config;
    const startedAt = Date.now();
    const last = await runCard(BrowserWindow, chat, 'last-reply');
    check('チャット: 返事を書いている最中に「最後の返事を読む」を押すと、書き終わるのを待ってから全部読む（途中の印は付かない）',
      last.ok && last.partial === undefined && last.text.startsWith('持ち物を確かめる手順') && last.text.endsWith('楽しい旅になりますように。')
        && Date.now() - startedAt >= 2000, { last, ms: Date.now() - startedAt });
    const code = await runCard(BrowserWindow, chat, 'last-code');
    check('チャット: 最後の返事のコードの塊だけを読む（1件）', code.ok && code.items.length === 1 && code.items[0].includes('切符: 済'), code.items);
    const questions = await runCard(BrowserWindow, chat, 'questions');
    check('チャット: 自分の質問を12件、古い順に読む', questions.ok && questions.items.length === 12 && questions.items[0].startsWith('週末に一泊で山の宿へ行きます。'), questions.items);
    const turns = await runCard(BrowserWindow, chat, 'all-turns');
    check('チャット: やり取りを24件、質問と返事を交互に読む（一件ずつ移れる）',
      turns.ok && turns.items.length === 24 && turns.items[0].startsWith('あなた') && turns.items[1].startsWith('ことのは'), turns.items.slice(0, 2));
    // 一覧の一件に結び付いた所（itemTarget）: 質問の一件を選ぶと、その質問への返事を読む。
    const reply1 = await readItemTarget(BrowserWindow, chat, 'questions', 0);
    check('チャット: 自分の質問の1件目を選ぶと、その返事（見出し・箇条書き・段落）を読む',
      reply1.ok && reply1.action === 'read' && reply1.text.startsWith('持ち物の案\n雨具（山は天気が変わりやすいため）') && !reply1.text.includes('あなた'), reply1);
    const reply12 = await readItemTarget(BrowserWindow, chat, 'questions', 11);
    check('チャット: 12件目（最後の質問）を選ぶと、少しずつ描かれた最後の返事を読む',
      reply12.ok && reply12.text.startsWith('持ち物を確かめる手順') && reply12.text.endsWith('楽しい旅になりますように。'), reply12);
    check('チャット: 番号の付いた手順（ol）は、頭に番号を付けて読む', reply12.ok && reply12.text.includes('\n1 前の日の夜に、一覧と見比べる\n2 雨合羽と上着を'), reply12.text);
    const reply7 = await readItemTarget(BrowserWindow, chat, 'questions', 6);
    check('チャット: ol の start と li の value に従って番号を付ける（3・7・8）',
      reply7.ok && reply7.text.includes('\n3 費用を入れる\n7 列を選ぶ\n8 式を入れる\n'), reply7.text);
    const none = await readItemTarget(BrowserWindow, chat, 'questions', 99);
    check('チャット: 無い一件を選んだときは、見つからない（notFound）と返す', !none.ok && none.notFound === true && none.where === 'cards[1].itemTarget', none);

    // 一覧を読んだ後にページで発言が増えても、選んだ一件の手がかり（短いハッシュ）で、今のページの同じ項目を探して読む。
    check('チャット: 一覧を読むと、一件ごとの手がかりが12件返り、文字そのものは入っていない',
      Array.isArray(questions.keys) && questions.keys.length === 12 && questions.keys.every((k) => /^[0-9a-f]{8}-\d+$/.test(k)), questions.keys);
    const chatWin = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/chat.html'));
    // 前の発言が上に読み込まれた形（一往復を先頭に足す）。番号は一つずつ後ろへずれる。
    await chatWin.webContents.executeJavaScript(`(() => {
      const log = document.querySelector('.log');
      log.insertAdjacentHTML('afterbegin', '<li class="turn user"><p class="who">あなた</p><div class="body"><p>前に聞いた質問です。</p></div></li>'
        + '<li class="turn ai"><p class="who">ことのは</p><div class="body"><p>前の返事です。</p></div></li>');
      return true;
    })()`);
    const byKey = await readItemTarget(BrowserWindow, chat, 'questions', 1, {}, questions.keys[1]);
    const byIndex = await readItemTarget(BrowserWindow, chat, 'questions', 1);
    check('チャット: 一覧を読んだ後に発言が先頭に増えても、手がかりで選ぶと、選んだ2件目の質問への返事（雨合羽の返事）を読む（番号だけだとずれる）',
      byKey.ok && byKey.text.startsWith('山道を歩くなら') && byIndex.ok && byIndex.text.startsWith('持ち物の案'), { byKey, byIndex });
    // 選んだ一件そのものが書き換わったときは、画面が変わったと返す。
    await chatWin.webContents.executeJavaScript(`(() => {
      document.querySelectorAll('.log > li.user .body')[3].textContent = '書き換えた質問です。';
      return true;
    })()`);
    const changed = await readItemTarget(BrowserWindow, chat, 'questions', 2, {}, questions.keys[2]);
    check('チャット: 選んだ一件がページに無くなっていたら、一覧を読んだ後に画面が変わった（changed）と返す',
      !changed.ok && changed.changed === true && changed.message === '一覧を読んだ後に、ページが変わりました', changed);
    const history = await runCard(BrowserWindow, chat, 'history');
    check('チャット: 過去のチャットの一覧を5件読む', history.ok && history.items.length === 5 && history.items[0] === '旅の持ち物の相談', history.items);
    // 読み込み直して、書き終わる前に待つ長さが切れたとき。
    closeTarget('practice-chat');
    const early = await runCard(BrowserWindow, chat, 'last-reply', { waitMs: 700 });
    check('チャット: 待つ長さの内に書き終わらなければ、そこまでを読み、途中だと返す（partial）',
      early.ok && early.partial === true && early.text.length > 0 && !early.text.includes('楽しい旅'), early);
    closeTarget('practice-chat');
  }

  // 日だけの表: 日付の要素の id か datetime に書かれた年・月・日から「11月6日」と読む。読めない行は書いてあるまま。
  const calConfig = { id: 'calendar', name: 'あおば町のイベントカレンダー（作り物）', url: 'fixture:calendar.html',
    cards: [{ id: 'events', title: 'イベント', action: 'list', selector: '#events tr.row', dateSelector: 'td.date' }] };
  const cal = await runCard(BrowserWindow, calConfig, 'events');
  check('日付: 日の欄の id や datetime から月を足して「11月6日 金曜」と読み、月の分からない行は書いてあるまま読む',
    cal.ok && JSON.stringify(cal.items) === JSON.stringify(['11月6日 金曜 町民まつり', '11月7日 土曜 図書館のおはなし会', '8 日曜 月の書いていない行']), cal.items);
  const multiConfig = { ...calConfig, cards: [{ id: 'multi', title: 'イベント', action: 'list', selector: '#multi tr.row .ev', dateSelector: 'td.date', tagSelector: '.tag' }] };
  const multi = await runCard(BrowserWindow, multiConfig, 'multi');
  check('日付: 一日に催しが二つある行も一件ずつ、行の日付と曜日を頭に付けて読み、分類の言葉は題の後ろに括弧で読む',
    multi.ok && JSON.stringify(multi.items) === JSON.stringify(['11月9日 月曜 町民まつりの準備会（催し）', '11月9日 月曜 からだの相談会（健康、福祉）']), multi.items);
  const laterConfig = { ...calConfig, cards: [{ id: 'later', title: 'イベント', action: 'list', selector: '#later tr.row', dateSelector: 'td.date' }] };
  closeTarget('calendar');
  const later = await runCard(BrowserWindow, laterConfig, 'later');
  check('日付: 読み込んだ直後の日付の無い仮の行は読まず、日付つきの行に描き直されるまで待って読む',
    later.ok && JSON.stringify(later.items) === JSON.stringify(['12月5日 土曜 冬の音楽会', '12月12日 土曜 もちつき大会']), later.items);
  closeTarget('calendar');
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

  // 構造の守り（見直しの8）: role の値の文と、学籍番号の形・長い英数字・GUID の値は、構造に入れない（名前だけ残す）。
  {
    const { buildSkeletonScript } = require('../src/main/structure');
    const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
    try {
      // 試しの値に、6桁以上の数字の並びを書かない（名前の点検に当たるため）。5桁の数字で「5桁以上の数字を含む」に当てる。
      const html = '<!doctype html><body><div role="Dialog for user alice" id="u24123" class="box s24123 3f2b1c9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f"'
        + ' data-user="s24123" data-token="abc123def456ghi789" data-kind="list" aria-describedby="x1"><p>t</p></div></body>';
      await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const { skeleton } = await w.webContents.executeJavaScript(buildSkeletonScript());
      check('構造の守り: role の文・学籍番号の形・長い英数字・GUID の値を入れず（属性の名前だけ）、ふつうの名前（box・data-kind=list）は残す',
        !/alice|Dialog|24123|abc123|3f2b1c9e/.test(skeleton) && skeleton.includes('div.box') && skeleton.includes('[role]') && skeleton.includes('[data-user]')
          && skeleton.includes('[data-kind=list]'), skeleton);
    } finally {
      w.destroy();
    }
  }

  // 時間の上限（見直しの3）: 応えない口のページは、時間切れで読み込みを止め、「ページを開けませんでした」と返す（手元の作り物の http の口・外へは出ない）。
  {
    const http = require('node:http');
    const server = http.createServer(() => {}); // 何も応えない
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const hangUrl = `http://127.0.0.1:${server.address().port}/`;
    const started = Date.now();
    const hung = await runCard(BrowserWindow, { id: 'hang', name: '応えないページ（作り物）', url: hangUrl, cards: [{ id: 'c', title: 'c', action: 'read', selector: '#x' }] }, 'c', { loadTimeoutMs: 1500 });
    const ms = Date.now() - started;
    closeTarget('hang');
    server.close();
    check('時間の上限: 応えない口のページは、時間切れで「ページを開けませんでした: 時間内に終わりませんでした」と返す（待ち続けない）',
      !hung.ok && hung.message === 'ページを開けませんでした: 時間内に終わりませんでした' && ms < 5000, { hung, ms });
  }

  await autoRepairChecks();
  await focusAndSeparatorChecks();
  await linksAndRevealChecks();
  await generateChecks();
  // カードの画面の試しは、表示設定の口を本物（settings.js）にして、一時のフォルダの settings.json につなぐ。
  const { createSettingsStore, registerSettingsHandlers } = require('../src/main/settings');
  const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-smoke-'));
  const settingsFile = path.join(settingsDir, 'settings.json');
  const settingsStore = createSettingsStore(settingsFile);
  registerSettingsHandlers(require('electron').ipcMain, settingsStore);
  // フォルダ・表示名・メモも、本物の口（bookmarks.js）を一時のフォルダの bookmarks.json につなぐ。
  const { createBookmarksStore, registerBookmarksHandlers } = require('../src/main/bookmarks');
  const bookmarksFile = path.join(settingsDir, 'bookmarks.json');
  registerBookmarksHandlers(require('electron').ipcMain, createBookmarksStore(bookmarksFile));
  try {
    await rendererItemTargetChecks(settingsStore);
    await rendererBusyChecks();
    await rendererErrorTextChecks();
    await rendererDeckFocusChecks();
    await rendererFocusChecks();
    await rendererClickAnnounceChecks();
    await rendererReviewChecks();
    await rendererYouTubeChecks();
    await rendererGenerateChecks();
    await rendererSettingsChecks(settingsStore, settingsFile);
    await rendererSearchChecks(settingsStore);
    await rendererLinksChecks();
    await rendererBookmarksChecks(bookmarksFile);
  } finally {
    fs.rmSync(settingsDir, { recursive: true, force: true });
  }
}

// ウェブアプリの窓が焦点を奪わないか、と、読む文の区切り。作り物のページ（test/fixtures/focus-grab.html）は、
// 読み込んだら自分で window.focus() を呼び、ページの中の欄に焦点を当てる（本物のつくば市のトップで見た動きをまねる）。
// 2026-11-03 の Windows の確かめでは、つくば市のトップのカードを読んだ直後に NVDA がつくば市の窓へ移り、使う人が取り残された。
// ふだん（窓を出さない試し）は、隠れた窓のまま、ウェブアプリの窓が焦点を取れない窓であること・焦点の知らせが一度も来ないこと・
// ページの中で焦点を取ろうとしてもページが焦点を持たないことを確かめる。
// 窓が OS の上で前に出ないことまで確かめるのは npm run smoke:windows（窓が前に出るので、Mac を使っている人がいないときだけ）。
async function focusAndSeparatorChecks() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // Todoku の窓の代わりに、窓を一つ開く。窓を出す試しのときだけ、見せて前に出す。
  const home = new BrowserWindow({ width: 480, height: 320, title: 'Todoku（試し）', show: !headless });
  try {
    await home.loadURL('data:text/html;charset=utf-8,<title>Todoku</title><p>試し</p>');
    setHomeWindow(home);
    if (!headless) {
      if (app.focus) app.focus({ steal: true });
      home.focus();
    }
    await wait(300);
    const before = headless || BrowserWindow.getFocusedWindow() === home;
    // 焦点を得た窓を順に控える（この機械でほかのアプリが前に出て、Todoku のどの窓にも焦点が無くなることがあるため、
    // 「いま焦点のある窓」だけでなく、ウェブアプリの窓に一度でも焦点が来たかで見る）。
    const focusLog = [];
    const onFocus = (_e, w) => focusLog.push(w.getTitle());
    app.on('browser-window-focus', onFocus);
    const grab = { id: 'grab', name: '焦点を取るページ（作り物）', url: 'fixture:focus-grab.html', login: { selector: '#no-such-login' },
      cards: [
        { id: 'news', title: 'お知らせ', action: 'list', selector: '#news li' },
        { id: 'office', title: '役場の窓口', action: 'read', selector: '#office' },
      ] };
    const news = await runCard(BrowserWindow, grab, 'news');
    await wait(800); // ページが 300ミリ秒後にもう一度焦点を取るのを待つ
    const target = BrowserWindow.getAllWindows().find((w) => w !== home && w.getTitle() === '焦点を取るページ（作り物）');
    const focused = BrowserWindow.getFocusedWindow();
    app.removeListener('browser-window-focus', onFocus);
    // 窓を出さない試しでは、ウェブアプリの窓は隠れたままで、ページも焦点を持たない。窓を出す試しでは、前に出さずに見せる。
    const pageHasFocus = target ? await target.webContents.executeJavaScript('document.hasFocus()') : null;
    const shownAsExpected = target && (headless ? !target.isVisible() && pageHasFocus === false && !target.webContents.isFocused() : target.isVisible());
    check('焦点: 自分で焦点を取るページのカードを読んだ後も、ウェブアプリの窓に一度も焦点が来ず、Todoku の窓から焦点が移らない（ウェブアプリの窓は焦点を取れない窓）',
      before && shownAsExpected && target.isFocusable() === false && !focusLog.includes(target.getTitle()) && focused !== target
        && (focused === home || focused === null),
      { headless, before, focused: focused ? focused.getTitle() : null, focusLog, focusable: target ? target.isFocusable() : null,
        visible: target ? target.isVisible() : null, pageHasFocus });

    // 守りの二つ目: それでもウェブアプリの窓に焦点が来たら、Todoku の窓へ返す。
    let homeFocusCalls = 0;
    const homeFocus = home.focus.bind(home);
    // 窓を出さない試しでは、数えるだけで、本当には焦点を動かさない。
    home.focus = () => { homeFocusCalls += 1; if (!headless) homeFocus(); };
    target.emit('focus');
    home.focus = homeFocus;
    check('焦点: ウェブアプリの窓に焦点が来たと知らされたら、Todoku の窓へ返す', homeFocusCalls === 1, { homeFocusCalls });

    // ログインのために前に出すときだけ焦点を取れる窓にし、次にカードを動かすと戻す。
    const shown = showTarget('grab');
    const duringLogin = target.isFocusable();
    await runCard(BrowserWindow, grab, 'office');
    check('焦点: 「ログインの窓を前に出す」の間だけ焦点を取れる窓にし、次にカードを読むと焦点を取れない窓に戻す',
      shown === true && duringLogin === true && target.isFocusable() === false, { shown, duringLogin, after: target.isFocusable() });

    // ログインの後、Todoku の窓に戻ったら、カードを動かす前でも焦点の守りを戻す（見直しの7）。
    // ログインの窓のページが後から自分で焦点を取っても、Todoku の窓へ返す。
    showTarget('grab');
    home.emit('focus');
    let backCalls = 0;
    const homeFocus2 = home.focus.bind(home);
    home.focus = () => { backCalls += 1; if (!headless) homeFocus2(); };
    target.emit('focus');
    home.focus = homeFocus2;
    check('焦点: ログインの後に Todoku の窓へ戻ったら、焦点を取れない窓に戻し、ウェブアプリの窓に焦点が来ても Todoku の窓へ返す',
      target.isFocusable() === false && backCalls === 1, { focusable: target.isFocusable(), backCalls });

    // 区切り: 一件の中の別々の要素の文字の間に区切りを入れる。字の飾り（strong）は区切らない。aria-hidden の中は読まない。
    check('区切り: 一覧の一件の中で、日付と題の間に空白か読点が入る（字の飾りの所は区切らず、aria-hidden の中は読まない）',
      news.ok && JSON.stringify(news.items) === JSON.stringify(['2026年11月3日 Open Day のご案内', '2026年11月1日 重要：図書館の休館日', '2026年10月30日、ごみの出し方が変わります']),
      news.items);
    if (!headless) {
      home.focus();
      await wait(200);
    }
    const office = await runCard(BrowserWindow, grab, 'office');
    check('区切り: 読むカードは、見出し・画像の説明・段落の中の改行ごとに別の行になる（見えない所は読まない）',
      office.ok && office.text === '役場の窓口\n役場の写真 あおば町役場\n電話 （作り物の番号）\n窓口 8時30分から17時15分', office.text);
  } finally {
    closeTarget('grab');
    setHomeWindow(null);
    home.destroy();
  }
}

// 「このページのリンク」と「元のページを表示する」（主の処理の側）。作り物のあおば町のページ（test/fixtures/links.html）で確かめる。
async function linksAndRevealChecks() {
  const home = new BrowserWindow({ width: 480, height: 320, title: 'Todoku（検証）', show: false });
  const page = { id: 'links-test', name: 'あおば町のリンク（作り物）', url: 'fixture:links.html', cards: [{ id: 'main', title: '本文', action: 'read', selector: 'main' }] };
  const other = { id: 'reveal-test', name: 'あおば町の練習（作り物）', url: 'fixture:practice.html', cards: [{ id: 'inbox', title: '受信箱', action: 'read', selector: 'body' }] };
  try {
    await home.loadURL('data:text/html;charset=utf-8,<title>Todoku</title><p>検証</p>');
    setHomeWindow(home);
    // リンク: http と https だけ・同じ行き先は一つ・ページの中の飛び先と名前の無いものは除く・名前は文字か aria-label か画像の alt・後から出てくるものも読む。
    const r = await readLinks(BrowserWindow, page);
    const got = r.ok ? r.links.map((l) => `${l.text} ${l.url}`) : r;
    check('リンク: ページのリンクを、名前と行き先で、ページの順に一件ずつ読む（重なり・ページの中の飛び先・mailto・javascript・名前の無いものは除く）',
      r.ok && r.truncated === false && JSON.stringify(got) === JSON.stringify([
        'くらしの案内 https://example.com/aoba/kurashi/',
        '防災の お知らせ https://example.com/aoba/bousai/',
        '町の地図 https://example.com/aoba/map/',
        '催しの予定 https://example.com/aoba/events/',
      ]), got);
    check('リンク: 読んだ後のウェブアプリの窓は、設定ファイルの url のページにいる', currentPageUrl('links-test').endsWith('/test/fixtures/links.html'), currentPageUrl('links-test'));

    // 元のページを表示する: 窓がまだ無いアプリでも開いてから出し、焦点を取れる窓にする。Esc キーで Todoku の窓へ戻り、焦点を取れない窓に戻る。
    await revealTarget(BrowserWindow, other);
    const win = BrowserWindow.getAllWindows().find((w) => w !== home && w.getTitle() === '練習のページ（作り物）');
    const opened = Boolean(win) && win.webContents.getURL().endsWith('/test/fixtures/practice.html');
    const focusable = Boolean(win) && win.isFocusable();
    const hiddenOther = BrowserWindow.getAllWindows().filter((w) => w !== home && w !== win).every((w) => !w.isVisible());
    let prevented = 0;
    const press = (key) => win.webContents.emit('before-input-event', { preventDefault: () => { prevented += 1; } }, { type: 'keyDown', key });
    press('a');
    const afterA = isRevealed('reveal-test');
    press('Escape');
    const afterEsc = isRevealed('reveal-test');
    home.emit('focus');
    check('元のページ: 窓が無いアプリでも開いてから前に出し、焦点を取れる窓にする。ほかのアプリの窓は隠す',
      opened && focusable && hiddenOther && afterA === true, { opened, focusable, hiddenOther, afterA });
    check('元のページ: 出した窓で Esc キーを押すと、ページには渡さずに Todoku の窓へ戻り、窓は焦点を取れない窓に戻る',
      afterEsc === false && prevented === 1 && win.isFocusable() === false, { afterEsc, prevented, focusable: win.isFocusable() });
    // 出していない窓の Esc はページに渡す（ページの中のダイアログを閉じる Esc などを横取りしない）。
    press('Escape');
    check('元のページ: 出していないときの Esc キーは横取りしない', prevented === 1, { prevented });
  } finally {
    closeTarget('links-test');
    closeTarget('reveal-test');
    setHomeWindow(null);
    home.destroy();
  }
}

// 設定ファイルの無いページから、Claude がその場でカードの束を作る一巡（Claude は偽の返事。Mac には鍵が無いので本物は呼ばない）。
// みどり市の練習のページ（test/fixtures/city-top.html）を開く → 文字を落とした構造を偽の Claude に渡す → 案をページで試し、
// 当たらない・空・押す所が一つでないカードを落とす → 題を手元で作り、新しい束として保存する → 読める → 消す。
async function generateChecks() {
  const { generateDeck, createGeneratedStore, doneMessage } = require('../src/main/generate');
  const { loadConfigDir } = require('../src/main/config');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'generate-smoke-'));
  try {
    const store = createGeneratedStore(path.join(userData, 'generated'));
    let sentUser = '';
    const fakeModel = async ({ user }) => {
      sentUser = user;
      return {
        cards: [
          { role: 'notice', action: 'list', selector: '.hero .slide', container: '.hero', titleSelector: '', reason: '自動で切り替わるお知らせ。' },
          { role: 'list', action: 'list', selector: '.news-list li', container: '.news-list', titleSelector: '.wrap h4:nth-of-type(1)', reason: '新着の一覧。' },
          { role: 'table', action: 'list', selector: 'table.garbage tr', container: '', titleSelector: '.wrap h4:nth-of-type(2)', reason: '表。' },
          { role: 'main', action: 'read', selector: '.counter-info', container: '', titleSelector: '.wrap h4:nth-of-type(3)', reason: '本文。' },
          { role: 'menu', action: 'click', selector: '.global-nav a:first-child', container: '', titleSelector: '', reason: '最初のメニュー。' },
          { role: 'link', action: 'click', selector: '.news-list a', container: '', titleSelector: '', reason: '当たる数が3つ。' },
          { role: 'other', action: 'read', selector: '.no-such-place', container: '', titleSelector: '', reason: '当たらない。' },
          { role: 'other', action: 'read', selector: '.hero img', container: '', titleSelector: '', reason: '文字が無い。' },
          { role: 'other', action: 'read', selector: '[[', container: '', titleSelector: '', reason: '書き方の誤り。' },
        ],
      };
    };
    const r = await generateDeck({ BrowserWindow, url: 'fixture:city-top.html', callModel: fakeModel, store, allowFixtures: true });
    check('カードを作る: 練習のページから、当たる4枚の束を作る（当たらない・空・押す所が3つ・書き方の誤り・題を作れないの5枚を落とす）',
      r.ok && r.config.cards.length === 4 && r.dropped === 5, r);
    check('カードを作る: Claude に送る文に、ページの文字も URL も入っていない',
      sentUser.includes('news-list') && !sentUser.includes('市民まつり') && !sentUser.includes('新着情報')
        && !sentUser.includes('みどり市') && !sentUser.includes('city-top') && !sentUser.includes('file:'), sentUser.slice(0, 300));
    check('カードを作る: 題は手元で、見出しの文字・押す所の文字から作り、ページの上からの順に並べる（題を作れないお知らせのカードは作らない）',
      r.ok && JSON.stringify(r.config.cards.map((c) => c.title)) === JSON.stringify(['くらし', '新着情報', 'ごみの日', '窓口の案内']), r.ok && r.config.cards);
    check('カードを作る: 束の名前はページの title（手元で使う）で、知らせは「「名前」のカードを4枚作りました。」',
      r.ok && r.config.name === 'みどり市 公式ホームページ（作り物）' && doneMessage(r.config) === '「みどり市 公式ホームページ（作り物）」のカードを4枚作りました。', r.ok && r.config.name);
    // 次の起動: 置き場を設定ファイルの読み方で読み直すと、同じ束が出る。
    const reloaded = loadConfigDir(store.dir);
    check('カードを作る: 次の起動でも、置き場から同じ束が読める', reloaded.length === 1 && reloaded[0].config && reloaded[0].config.id === r.config.id, reloaded);
    const deck = reloaded[0].config;
    const news = await runCard(BrowserWindow, deck, deck.cards[1].id, { waitMs: 500 });
    check('カードを作る: 作った束の新着情報のカードで、項目を読める', news.ok && news.action === 'list' && news.items.length > 0, news);
    const counter = await runCard(BrowserWindow, deck, deck.cards[3].id, { waitMs: 500 });
    check('カードを作る: 作った束の本文のカードで、窓口の案内を読める', counter.ok && counter.text.includes('8時30分'), counter);

    // 題の手がかり: Claude が題の元（titleSelector）を返さないときも、見出し・aria-labelledby・ランドマークの aria-label・
    // 最初の短い文字から、手元で題を作る（気象庁の警報のページで3枚とも「お知らせ 1」のような題になった）。
    const noTitle = (role, action, selector, container = '') => ({ role, action, selector, container, titleSelector: '', reason: '作り物。' });
    const titled = await generateDeck({
      BrowserWindow,
      url: 'fixture:titles.html',
      callModel: async () => ({
        cards: [
          noTitle('notice', 'read', '.banner'),
          noTitle('menu', 'list', 'nav .menu a'),
          noTitle('notice', 'read', '.pickup'),
          noTitle('main', 'read', '.weather'),
          noTitle('main', 'read', '.mayor'),
          noTitle('list', 'list', '.warn-list li', '.warn-list'),
          noTitle('main', 'read', '.topic'),
        ],
      }),
      store,
      allowFixtures: true,
    });
    check('カードを作る: 題の元が無いときは、ランドマークの aria-label・最初の短い文字・aria-labelledby・直前の見出し・中の見出しから手元で題を作り、何も無いカードは作らない',
      titled.ok && JSON.stringify(titled.config.cards.map((c) => c.title))
        === JSON.stringify(['ごみの出し方', 'あすの天気', '町長の部屋', 'いま出ている注意報', '図書館の本の返し方', '町のメニュー']),
      titled.ok ? titled.config.cards.map((c) => c.title) : titled);
    if (titled.ok) store.remove(titled.config.id);

    // 地名の一語と検索: 気象庁の警報のページで「全国」（中身も「全国」だけ）・「茨城県」・「検索 1」のカードができた（2026-11-03 の Windows の確かめ）。
    // 中身が題と同じ一語だけのカードは作らず、題が地名の一語になるときは中の短い文か操作の種類を、手がかりの無い検索は「検索する」を題にする。
    const area = await generateDeck({
      BrowserWindow,
      url: 'fixture:area-warnings.html',
      callModel: async () => ({
        cards: [
          noTitle('heading', 'read', '.crumb'),
          noTitle('list', 'list', '.towns li', '.towns'),
          noTitle('main', 'read', '.today'),
          noTitle('search', 'click', '.find .go'),
        ],
      }),
      store,
      allowFixtures: true,
    });
    check('カードを作る: 中身が題と同じ一語だけのカード（全国）は作らず、地名の一語の題は「地域を選ぶ」や中の短い文に、名前の無い検索のボタンは作らない',
      area.ok && area.dropped === 2
        && JSON.stringify(area.config.cards.map((c) => c.title)) === JSON.stringify(['地域を選ぶ', '大雨注意報が出ています。']),
      area.ok ? { dropped: area.dropped, titles: area.config.cards.map((c) => c.title) } : area);
    if (area.ok) store.remove(area.config.id);

    // 案内のページ: パンくず・「現在のページ」は作らず、目次は「目次を読む」の一枚にまとめ、Claude の題の元が場所に合わなければ使わず、
    // 重なった題は番号でなく中の見出しにし、束の名前はサイトの名前を外して語の切れ目で切る（2026-11-04 の Windows の確かめ）。
    const withTitle = (role, action, selector, titleSelector) => ({ ...noTitle(role, action, selector), titleSelector });
    const guide = await generateDeck({
      BrowserWindow,
      url: 'fixture:bus-guide.html',
      callModel: async () => ({
        cards: [
          noTitle('list', 'list', '.crumb li'),
          noTitle('other', 'read', '.now'),
          withTitle('list', 'list', '.toc li', 'h1'),
          withTitle('list', 'list', '.docs li', 'h2.toc-title'),
          noTitle('main', 'read', 'section.bus'),
          noTitle('main', 'read', 'section.taxi'),
          noTitle('search', 'click', '.find button'),
        ],
      }),
      store,
      allowFixtures: true,
    });
    check('カードを作る: パンくずと「現在のページ」を作らず、目次は「目次を読む」に、合わない題の元は使わず、重なった題は中の見出しにし、押すカードは「サイト内を検索する」にして束の後ろに置く',
      guide.ok && guide.dropped === 2 && guide.config.name === '路線バスのご案内（予約電話番号、利用方法）'
        && JSON.stringify(guide.config.cards.map((c) => c.title)) === JSON.stringify(['目次を読む', '利用方法', '予約のしかた', '資料のダウンロード', 'サイト内を検索する']),
      guide.ok ? { name: guide.config.name, dropped: guide.dropped, titles: guide.config.cards.map((c) => c.title) } : guide);
    if (guide.ok) store.remove(guide.config.id);

    // 同じページから二回作る: Claude の案の数・順・中身が違っても、手元の守り（題を作れないカード・見出しだけのカード・
    // 名前の無い押す所を作らない・主な表を必ず一枚作る・ページの上からの順に並べる）で、同じ束になる。
    const runOnce = (answer) => generateDeck({ BrowserWindow, url: 'fixture:warnings-table.html', callModel: async () => ({ cards: answer }), store, allowFixtures: true });
    const first = await runOnce([
      noTitle('notice', 'read', '.banner'),
      noTitle('heading', 'read', '.lead'),
      noTitle('button', 'click', '.tool'),
      noTitle('button', 'click', '.print'),
      noTitle('main', 'read', '.note'),
      noTitle('menu', 'click', '.tabs button:nth-of-type(1)'),
    ]);
    const second = await runOnce([
      noTitle('main', 'read', '.note'),
      noTitle('menu', 'click', '.tabs button:nth-of-type(1)'),
      noTitle('button', 'click', '.tool'),
      noTitle('button', 'click', '.print'),
    ]);
    const shape = (r) => (r.ok ? { name: r.config.name, cards: r.config.cards } : r);
    check('カードを作る: Claude の案が違っても同じ束になり、本文の最初の表（発表状況・8行）と行の一番多い表（市町村ごと・12行）の二つを必ず作り、題の無いカード・見出しだけのカード・名前の無いボタンは作らない。表を切り替えるタブは「表を替える（…）」の題にする',
      first.ok && second.ok && JSON.stringify(shape(first)) === JSON.stringify(shape(second))
        && first.config.name === 'あおば気象台｜警報・注意報（作り物）'
        && JSON.stringify(first.config.cards.map((c) => c.title)) === JSON.stringify(['発表状況', 'あおば県の警報・注意報（発表状況）', '表を替える（大雨・土砂災害・高潮）', '市町村ごとの詳しい状況', '印刷する']),
      { first: shape(first), second: shape(second) });
    if (first.ok) {
      const table = await runCard(BrowserWindow, first.config, first.config.cards[0].id, { waitMs: 500 });
      check('カードを作る: 主な表のカードで、8行を読める', table.ok && table.items.length === 8 && table.items[0] === 'あおば市 大雨注意報', table.items);
      const towns = await runCard(BrowserWindow, first.config, first.config.cards[3].id, { waitMs: 500 });
      check('表の行: 見出しの列のほかの升目が全部空なら「さくら町 なし」と読み、一部だけ空の行（みどり市）には付けない',
        towns.ok && towns.items.length === 12 && towns.items[0] === 'あおば市 大雨注意報 雷注意報' && towns.items[1] === 'みどり市 雷注意報'
          && towns.items[2] === 'さくら町 なし' && towns.items.filter((t) => t.endsWith(' なし')).length === 5, towns.items);
      store.remove(first.config.id);
    }
    if (second.ok) store.remove(second.config.id);

    // 同じ中身の表を二つ描くページ（早期注意情報）: 二つをつながず一つだけ読み、「-」の升目で終わる行を次の行とつながない。
    const dup = await generateDeck({ BrowserWindow, url: 'fixture:warnings-dup.html', callModel: async () => ({ cards: [] }), store, allowFixtures: true });
    check('カードを作る: 同じ中身の写しの二つの表は、つながずに一つの表のカードにする', dup.ok && dup.config.cards.length === 1 && !dup.config.cards[0].joinWith, dup.ok ? dup.config.cards : dup);
    if (dup.ok) {
      const dupRows = await runCard(BrowserWindow, dup.config, dup.config.cards[0].id, { waitMs: 500 });
      check('表の行: 「-」の升目は空白で区切り、行ごとに一件で読む（二重に読まない）',
        dupRows.ok && JSON.stringify(dupRows.items) === JSON.stringify(['あおば市 - - 大雨', 'みどり市 - 雷 -', 'さくら町 - - -', 'やまなみ町 大雨 - -', 'かわべ村 - - -']), dupRows.items);
      const dupRead = await runCard(BrowserWindow, { ...dup.config, cards: [{ id: 'r', title: '表', action: 'read', selector: '#prob .wide-scroll table' }] }, 'r', { waitMs: 500 });
      check('表の行: 読むカードでも、「-」で終わる行を次の行とつながず、一行ずつ読む',
        dupRead.ok && dupRead.text.split('\n').length === 6 && dupRead.text.split('\n')[1] === 'あおば市 - - 大雨', dupRead.text);
      const explain = await runCard(BrowserWindow, { ...dup.config, cards: [{ id: 'e', title: '説明', action: 'list', selector: 'ul.asterisk > li' }] }, 'e', { waitMs: 500 });
      check('表の行: 一覧の一件の中に表があれば、表の前の文・見出しの行（一度だけ）・行ごとに分けて読む（表まるごと一件にしない）',
        explain.ok && JSON.stringify(explain.items) === JSON.stringify(['警戒レベルとの関係（作り物）', '警報・注意報 警戒レベル', '大雨警報 レベル3相当', '大雨注意報 レベル2相当', 'この表は作り物です。']),
        explain.items);
      store.remove(dup.config.id);
    }

    // 本文の大半が最初の h2 より前の h3 の節にあり、本文を同じ class の div で書くページ（市の案内のページの作り）。
    // 節は h2 と h3 の両方で区切る。Claude の読むカードが幾つもの要素に当たっても、重なりは読む最初の一つで見る。丸ごとのカードも節に分ける。
    // サイトのメニュー（header の中の nav）は束の後ろへ。目次の項目が指す見出し（a の name で指す、文字の少ない「利用料」）も節にし、
    // 3項目の一覧を含む「利用の流れ」は、一覧だけのカードでなく節にする。
    const expectedSections = ['目次を読む', 'あおチャリとは', '料金', '利用料（税込）', '利用の流れ', '借りられる場所', 'お知らせ', 'お問い合わせ', 'サイトのメニュー'];
    const multi = await generateDeck({
      BrowserWindow, url: 'fixture:cycle-guide2.html', callModel: async () => ({ cards: [noTitle('menu', 'list', '.site-menu li'), noTitle('main', 'read', '.wysiwyg')] }), store, allowFixtures: true,
    });
    check('カードを作る: h3 の節も節のカードにし（h2 の前にあるもの）、幾つもの要素に当たる読むカードは最初の一つ（頭の目次）だけと重なりを見る。お問い合わせとサイトのメニューは束の後ろ（この順）。目次の項目の見出しは短くても節にし、一覧を含む節は節のまま',
      multi.ok && JSON.stringify(multi.config.cards.map((c) => c.title)) === JSON.stringify(expectedSections), multi.ok ? multi.config.cards.map((c) => c.title) : multi);
    const { looksTextFree } = require('../src/main/structure');
    check('カードを作る: 節のカードの selector に、日本語の id（ページの文字）を使わない',
      multi.ok && multi.config.cards.every((c) => looksTextFree(c.selector) && looksTextFree(c.until || '')), multi.ok ? multi.config.cards.map((c) => c.selector) : multi);
    if (multi.ok) store.remove(multi.config.id);
    const whole2 = await generateDeck({
      BrowserWindow, url: 'fixture:cycle-guide2.html', callModel: async () => ({ cards: [noTitle('main', 'read', '#contents')] }), store, allowFixtures: true,
    });
    check('カードを作る: 本文を丸ごと読むカード（h1 の題になるもの）は、h2・h3 の節のカードに分け、頭の目次は読まない',
      whole2.ok && whole2.split === 1 && JSON.stringify(whole2.config.cards.map((c) => c.title)) === JSON.stringify(expectedSections.filter((t) => t !== '目次を読む' && t !== 'サイトのメニュー')),
      whole2.ok ? whole2.config.cards.map((c) => c.title) : whole2);
    if (whole2.ok) {
      const about3 = await runCard(BrowserWindow, whole2.config, whole2.config.cards[0].id, { waitMs: 500 });
      check('カードを作る: h3 の節は、次の h3 の手前までを読み、「目次に戻る」を読まない',
        about3.ok && about3.text === 'あおチャリとは\nあおチャリは、町の中のどの貸し場所でも借りて返せる自転車です。電動の自転車なので、坂の多い道も楽に走れます。', about3.text);
      store.remove(whole2.config.id);
    }

    // 頼み16 の後戻りの組み合わせ（Claude の案で、節や必ず作る表が消えたもの）。
    // 本文の子を全部項目にした一覧・目次の一覧の selector が節の中の一覧にも当たるもの・ページ全体を包む読むカード。
    const sectionTitles = ['あおチャリとは', '料金', '利用料（税込）', '利用の流れ', '借りられる場所', 'お知らせ', 'お問い合わせ'];
    for (const [label, cardsOf, expect] of [
      ['本文の子を全部項目にした一覧', [noTitle('list', 'list', '.free-layout-area > div > *')], sectionTitles],
      ['目次の一覧（節の中の一覧にも当たる selector）', [noTitle('list', 'list', '.wysiwyg ul li')], ['目次を読む', ...sectionTitles]],
    ]) {
      const d = await generateDeck({ BrowserWindow, url: 'fixture:cycle-guide2.html', callModel: async () => ({ cards: cardsOf }), store, allowFixtures: true });
      check(`カードを作る（後戻りの組み合わせ）: ${label}があっても、節のカードを全部作る`,
        d.ok && JSON.stringify(d.config.cards.map((c) => c.title)) === JSON.stringify(expect), d.ok ? d.config.cards.map((c) => c.title) : d);
      if (d.ok) store.remove(d.config.id);
    }
    // 本物の Claude の案の形: Claude のカードが、最初の表と行の一番多い表を、もう読んでいる。必ず作る枠は、まだ読まれていない三つ目の表（市町村別）に使う。
    const claimed = await generateDeck({
      BrowserWindow, url: 'fixture:warnings-wide.html', store, allowFixtures: true,
      callModel: async () => ({ cards: [noTitle('table', 'read', '#summary .wide-fix table'), noTitle('table', 'read', '#timeline .wide-fix table')] }),
    });
    check('カードを作る（本物の Claude の案の形）: 最初の表と行の一番多い表を Claude のカードが読んでいれば、必ず作る枠は三つ目の表（市町村別）に使う',
      claimed.ok && claimed.config.cards.some((c) => c.title === '市町村別の警報・注意報' && c.joinWith), claimed.ok ? claimed.config.cards.map((c) => c.title) : claimed);
    if (claimed.ok) store.remove(claimed.config.id);
    // 別々の要素の「利用料」「（税込）」の見出しを、題と同じく空白無しで読む。
    const rateDeck = await generateDeck({ BrowserWindow, url: 'fixture:cycle-guide2.html', callModel: async () => ({ cards: [] }), store, allowFixtures: true });
    if (rateDeck.ok) {
      const rateCard = rateDeck.config.cards.find((c) => c.title === '利用料（税込）');
      const rate = rateCard ? await runCard(BrowserWindow, rateDeck.config, rateCard.id, { waitMs: 500 }) : null;
      check('読む: 別々の要素の「利用料」と「（税込）」を、題と同じく空白無しで読む', Boolean(rate && rate.ok && rate.text.startsWith('利用料（税込）\n')), rate && rate.text);
      store.remove(rateDeck.config.id);
    } else {
      check('読む: 別々の要素の「利用料」と「（税込）」を、題と同じく空白無しで読む', false, rateDeck);
    }

    // Claude の案にリンクだけの一覧（メニュー）が入る回: 題を「〇〇のメニュー」にして、束の後ろへ回す。
    const menuDeck = await generateDeck({
      BrowserWindow, url: 'fixture:warnings-wide.html', store, allowFixtures: true, callModel: async () => ({ cards: [noTitle('menu', 'list', '.bosai-menu li')] }),
    });
    check('カードを作る: リンクだけの一覧（メニュー）の Claude のカードは、題を「〇〇のメニュー」にして束の後ろに置く',
      menuDeck.ok && menuDeck.config.cards[menuDeck.config.cards.length - 1].title === '警報・注意報のメニュー', menuDeck.ok ? menuDeck.config.cards.map((c) => c.title) : menuDeck);
    if (menuDeck.ok) store.remove(menuDeck.config.id);
    // Claude の読むカードが、題の行のある表が二つある区画を丸ごと指す回: 表ごとの一覧のカードに分け、題は表の題の行から取る。
    const splitDeck = await generateDeck({
      BrowserWindow, url: 'fixture:warnings-split.html', store, allowFixtures: true, callModel: async () => ({ cards: [noTitle('table', 'read', '#sum')] }),
    });
    check('カードを作る: 表を読むための Claude の読むカードは、表ごとの一覧のカードに分け、題は表の題の行から取る（同じ題に番号を付けない）',
      splitDeck.ok && JSON.stringify(splitDeck.config.cards.map((c) => [c.title, c.action])) === JSON.stringify([
        ['あおば県の警戒レベル相当情報（発表状況）', 'list'], ['あおば県の警報・注意報（発表状況）', 'list']]),
      splitDeck.ok ? splitDeck.config.cards : splitDeck);
    if (splitDeck.ok) {
      const warnRows = await runCard(BrowserWindow, splitDeck.config, splitDeck.config.cards[1].id, { waitMs: 500 });
      check('カードを作る: 分けた表のカードで、その表の行だけを読み、地域の名前の見出しの行を下の行の頭に、更新の時刻を一件目の頭に付ける',
        warnRows.ok && JSON.stringify(warnRows.items) === JSON.stringify(['4日8時00分 更新 北部 大雨注意報', '南部 発表されていません']), warnRows.items);
      const levelRows = await runCard(BrowserWindow, splitDeck.config, splitDeck.config.cards[0].id, { waitMs: 500 });
      check('カードを作る: 見出しの行が一つだけの表（列の名前）は、行の頭に何も付けない',
        levelRows.ok && JSON.stringify(levelRows.items) === JSON.stringify(['北部 発表されていません', '南部 発表されていません', '西部 発表されていません']), levelRows.items);
      store.remove(splitDeck.config.id);
    }
    // Claude の案が、警戒レベル相当情報の表の固定の列（隠れた写し）だけを指した回（本物の Claude の五回目の案の形）:
    // 行の少ない発表状況の表も、題の行があれば必ず作る表にし、分けて描いた表の頭の更新の時刻を一件目に読む。
    const headDeck = await generateDeck({
      BrowserWindow, url: 'fixture:warnings-head.html', store, allowFixtures: true,
      callModel: async () => ({ cards: [{ ...noTitle('table', 'read', '#summary .wide-fix'), titleSelector: '#summary tr.title th' }] }),
    });
    check('カードを作る: 案が警戒レベルの表の写しだけを指しても、行の少ない発表状況の表（題の行つき）のカードを作る',
      headDeck.ok && JSON.stringify(headDeck.config.cards.map((c) => c.title)) === JSON.stringify(['あおば県の警戒レベル相当情報（発表状況）', 'あおば県の警報・注意報（発表状況）']),
      headDeck.ok ? headDeck.config.cards.map((c) => c.title) : headDeck);
    if (headDeck.ok) {
      const levelItems = await runCard(BrowserWindow, headDeck.config, headDeck.config.cards[0].id, { waitMs: 500 });
      check('カードを作る: 分けて描いた表の頭の更新の時刻を一件目の頭に付けて読む（地域名は行の頭）',
        levelItems.ok && levelItems.items.length === 2 && levelItems.items[0].startsWith('4日6時00分更新 北部') && levelItems.items[1].startsWith('南部'), levelItems.items);
      store.remove(headDeck.config.id);
    }
    // 不変条件（頼み27）: 注意報が出ているときの作り物の気象台のページに、本物の Claude の案に出てきた形（区画を丸ごと読む・
    // 表の写しだけを指す・発表状況の表の行を全部並べる・表そのものを一件にする・案が一枚も無い）を当てても、
    // 束は6〜8枚で、芯（警戒レベル・発表状況・市町村別・表を替える）が一枚ずつ、番号付きの題が無く、
    // 発表状況は地域ごとに一件（地域名と特別警報・警報・注意報）で、一件目の頭に更新の時刻が付く（題だけ・時刻だけ・細かく割った件を出さない）。
    const nightShapes = [
      ['区画を丸ごと読む', [noTitle('table', 'read', '#summary'), noTitle('table', 'read', '#timeline'), noTitle('menu', 'list', '.bosai-menu li')]],
      ['写しだけを指す', [{ ...noTitle('table', 'read', '#summary .wide-fix'), titleSelector: '#summary tr.title th' }, noTitle('button', 'click', '#tool .radio-button:nth-of-type(1)')]],
      ['表の行を全部並べる', [noTitle('table', 'list', '#summary .block:nth-of-type(2) table tr')]],
      ['表そのものを一件にする', [noTitle('table', 'list', '#summary .block:nth-of-type(2) table')]],
      ['案が一枚も無い', []],
      // 本物の案の7〜9の形: 分けて描いた表の頭だけを読む・表の升目の一覧（一つの表と二つの表）・一つの表の行の一覧（題の元が別の表の題）。
      ['表の頭だけを読む', [{ ...noTitle('table', 'read', '#prob .wide > table.head'), titleSelector: '#prob tr.title th' }, noTitle('table', 'read', '#timeline table')]],
      ['表の升目の一覧', [{ ...noTitle('list', 'list', '#summary td.sentence'), titleSelector: '#summary tr.header th' }, noTitle('menu', 'list', '.bosai-menu li')]],
      ['二つの表の升目', [{ ...noTitle('list', 'list', '#summary td'), titleSelector: '#summary tr.header th' }, noTitle('menu', 'list', '.bosai-menu li')]],
      ['題の元が別の表', [{ ...noTitle('notice', 'list', '#summary tr:has(td.sentence)', '#summary'), titleSelector: '#summary tr.title th' }]],
      // 本物の案の10・11の形: 開くまで畳まれている説明を読む（見出しと表の頭の行だけを読むカードになった）。
      ['畳まれた説明を読む', [noTitle('other', 'read', '#explain .contents-explain'), noTitle('list', 'list', '#explain ul.asterisk > li'), noTitle('menu', 'list', '.bosai-menu li')]],
    ];
    const nightCore = ['あおば県の警戒レベル相当情報（発表状況）', 'あおば県の警報・注意報（発表状況）', 'あおば県の警報・注意報（市町村別）', '表を替える（大雨・土砂災害・高潮）'];
    // ページの上からの芯の表の並び（作り物のページの並び）。どの案の形でも、この順に並ぶ。
    const nightOrder = ['あおば県の警戒レベル相当情報（発表状況）', 'あおば県の警報・注意報（発表状況）', '表を替える（大雨・土砂災害・高潮）', 'あおば県の時系列情報（明日までの見通し）', 'あおば県の早期注意情報（警報級の可能性）', 'あおば県の警報・注意報（市町村別）'];
    // 案を試した後、節や必ず作る表を探す前に、ページの上の方に要素が増える窓（気象庁の警報のページは、読み込んだ後も上の方を書き換える）。
    // 並びの番号を別々の時点で数えると、芯の表の並びが入れ替わった（頼み34）。
    class ShiftingWindow extends BrowserWindow {
      constructor(opts) {
        super(opts);
        const wc = this.webContents;
        const orig = wc.executeJavaScript.bind(wc);
        wc.executeJavaScript = async (code, ...rest) => {
          const r = await orig(code, ...rest);
          if (String(code).includes('menuNames')) {
            await orig('(() => { for (let i = 0; i < 300; i++) { const d = document.createElement("div"); d.hidden = true; document.body.prepend(d); } return true; })()');
          }
          return r;
        };
      }
    }
    for (const [label, cardsOf, Win] of [...nightShapes, ['表の行を全部並べる・途中で上に要素が増える', [noTitle('table', 'list', '#summary .block:nth-of-type(2) table tr')], ShiftingWindow]]) {
      const d = await generateDeck({ BrowserWindow: Win || BrowserWindow, url: 'fixture:warnings-night.html', store, allowFixtures: true, callModel: async () => ({ cards: cardsOf }) });
      const titles = d.ok ? d.config.cards.map((c) => c.title) : [];
      const summaryCard = d.ok ? d.config.cards.find((c) => c.title === 'あおば県の警報・注意報（発表状況）') : null;
      const read = summaryCard ? await runCard(BrowserWindow, d.config, summaryCard.id, { waitMs: 500 }) : null;
      const items = read && read.ok ? read.items : [];
      check(`カードを作る（不変条件・${label}）: 6〜8枚で芯が一枚ずつ、番号付きの題・時刻だけの題・同じ題・表の升目だけのカード・畳まれた説明のカードが無く、表はページの上からの順で、発表状況は地域ごとに一件で一件目にその表の更新の時刻`,
        d.ok && titles.length >= 6 && titles.length <= 8 && nightCore.every((t) => titles.filter((x) => x === t).length === 1)
          && !titles.some((t) => / \d+$/.test(t) || /更新$|発表$/.test(t)) && new Set(titles).size === titles.length
          && d.config.cards.every((c) => !/^td\b/.test(String(c.selector).trim().split(/\s+/).pop()))
          && !titles.some((t) => /警戒レベルとの関係|とるべき行動|説明を表示する/.test(t) || /^[▲▼△▽■□●○◆◇►▶※＊*・]/.test(t))
          && JSON.stringify(titles.filter((t) => nightOrder.includes(t))) === JSON.stringify(nightOrder.filter((t) => titles.includes(t)))
          && JSON.stringify(items) === JSON.stringify([
            '4日19時55分更新 北部 特別警報 なし、警報 なし、注意報 強風注意報、雷注意報',
            '南部 特別警報 なし、警報 なし、注意報 波浪注意報',
          ]),
        { titles, items });
      if (d.ok) store.remove(d.config.id);
    }
    // メニューの題は Claude の題の元を使わず、aria-label・見出し・最初の項目から取る。項目がほとんど地域の名前なら「地域のメニュー」。
    const menuNamed = await generateDeck({
      BrowserWindow, url: 'fixture:warnings-split.html', store, allowFixtures: true,
      callModel: async () => ({ cards: [{ ...noTitle('menu', 'list', '.bosai li'), titleSelector: '.areas .label' }, { ...noTitle('menu', 'list', '.area-menu li'), titleSelector: '.areas .label' }] }),
    });
    const menuTitles = menuNamed.ok ? menuNamed.config.cards.filter((c) => /メニュー$/.test(c.title)).map((c) => c.title) : [];
    check('カードを作る: メニューの題は、aria-label か最初の項目から「〇〇のメニュー」にし、項目が地域の名前なら「地域のメニュー」にする（「全域のメニュー」にしない）',
      JSON.stringify(menuTitles) === JSON.stringify(['防災情報のメニュー', '地域のメニュー']), menuNamed.ok ? menuNamed.config.cards.map((c) => c.title) : menuNamed);
    if (menuNamed.ok) store.remove(menuNamed.config.id);
    // 束の後ろの並び: 部品だけの所（更新日・ページ番号など）→ お問い合わせ → メニュー・サイトの名前 → 検索（ページの上の見出しのメニューが、お問い合わせより前に来ない）。
    // 横のメニューの題は、包む dt から取る。ページの題（h1）を借りた更新日の所の題は、中の最初の短い文にする。目次はメニューの形でも後ろに回さない。
    const orderDeck = await generateDeck({
      BrowserWindow, url: 'fixture:cycle-order.html', store, allowFixtures: true,
      callModel: async () => ({ cards: [
        noTitle('search', 'click', '.search-button'), noTitle('menu', 'list', '.head-nav li'), noTitle('notice', 'read', '#update'), noTitle('menu', 'list', '.toc li'),
        { ...noTitle('other', 'read', '.toiawase'), titleSelector: '.toiawase h2' }, noTitle('menu', 'list', '.side-list li'),
        { ...noTitle('other', 'read', 'address.foot'), titleSelector: 'address.foot .name' },
      ] }),
    });
    const orderTitles = orderDeck.ok ? orderDeck.config.cards.map((c) => c.title) : [];
    check('カードを作る: 後ろのカードは 部品だけの所（更新日とページ番号）→ お問い合わせ → メニュー・サイトの名前 → 検索 の順。横のメニューの題は dt から、更新日の所の題は中の最初の文から。リンクだけが5件の目次は後ろに回さない',
      orderDeck.ok && JSON.stringify(orderTitles.slice(-6)) === JSON.stringify(['更新日：4月1日', 'この記事に関するお問い合わせ先', 'くらし・手続きのメニュー', '自転車のまちのメニュー', 'あおば町役場', orderTitles[orderTitles.length - 1]])
        && /検索/.test(orderTitles[orderTitles.length - 1]) && orderTitles[0] === '目次を読む',
      orderDeck.ok ? orderTitles : orderDeck);
    if (orderDeck.ok) store.remove(orderDeck.config.id);
    // 芯が同じになること: 本物の Claude の二つの回の案の形（一回目: 表そのものを読むカード・表を替えるカード / 二回目: 区画を丸ごと読むカード・
    // 表を替えるカード無し・メニュー）のどちらでも、発表状況・市町村ごと・市町村別の表と「表を替える」が一枚ずつあり、番号付きの重なりが無く、
    // メニューは「〇〇のメニュー」で後ろ。
    const coreOf = (deck) => ['あおば県の警報・注意報（発表状況）', '市町村ごとの状況', '市町村別の警報・注意報', '表を替える（大雨・土砂災害・高潮）']
      .map((t) => deck.config.cards.filter((c) => c.title === t).length);
    for (const [label, cardsOf] of [
      ['一回目の形', [noTitle('table', 'read', '#summary .wide-fix table'), noTitle('table', 'read', '#timeline .wide-fix table'),
        noTitle('button', 'click', '#tool .radio-button:nth-of-type(1)'), noTitle('menu', 'list', '.bosai-menu li')]],
      ['二回目の形', [noTitle('table', 'read', '#summary'), noTitle('table', 'read', '#timeline'), noTitle('menu', 'list', '.bosai-menu li')]],
    ]) {
      const d = await generateDeck({ BrowserWindow, url: 'fixture:warnings-wide.html', store, allowFixtures: true, callModel: async () => ({ cards: cardsOf }) });
      check(`カードを作る（芯が同じ・${label}）: 発表状況・市町村ごと・市町村別の表と「表を替える」が一枚ずつ、番号付きの重なりが無く、メニューは後ろ`,
        d.ok && JSON.stringify(coreOf(d)) === JSON.stringify([1, 1, 1, 1]) && !d.config.cards.some((c) => / \d+$/.test(c.title))
          && d.config.cards[d.config.cards.length - 1].title === '警報・注意報のメニュー',
        d.ok ? d.config.cards.map((c) => c.title) : d);
      if (d.ok) store.remove(d.config.id);
    }
    const wrapped = await generateDeck({ BrowserWindow, url: 'fixture:warnings-wide.html', callModel: async () => ({ cards: [noTitle('main', 'read', '.container')] }), store, allowFixtures: true });
    check('カードを作る（後戻りの組み合わせ）: ページ全体を包む読むカードがあっても、必ず作る二つの表を作る',
      wrapped.ok && wrapped.config.cards.filter((c) => c.joinWith).length === 2, wrapped.ok ? wrapped.config.cards.map((c) => c.title) : wrapped);
    if (wrapped.ok) store.remove(wrapped.config.id);

    // main も見出しも無く、表を名前の列と値の列の二つに分けて描くページ（気象台の警報のページの作り）。
    // body を本文の区画とみて、最初の表と行の一番多い表を、二つの表の行をつないで読むカード（joinWith）にし、role の無い div の並びも表の切り替えとみる。
    const wide = await generateDeck({
      BrowserWindow, url: 'fixture:warnings-wide.html', callModel: async () => ({ cards: [noTitle('menu', 'click', '#tool .radio-button:nth-of-type(1)')] }), store, allowFixtures: true,
    });
    check('カードを作る: 見出しの無いページでも、分けて描いた二つの表を一つの表のカードにし（題は表の前の短い文）、div の並びを「表を替える（…）」にする。表より行の多いリンクだけの一覧（市町村選択）は必ず作る一覧にしない',
      wide.ok && JSON.stringify(wide.config.cards.map((c) => c.title)) === JSON.stringify(['あおば県の警報・注意報（発表状況）', '表を替える（大雨・土砂災害・高潮）', '市町村ごとの状況'])
        && wide.config.cards[0].joinWith && wide.config.cards[2].joinWith,
      wide.ok ? wide.config.cards : wide);
    if (wide.ok) {
      const summaryRows = await runCard(BrowserWindow, wide.config, wide.config.cards[0].id, { waitMs: 500 });
      check('カードを作る: 二つに分けた表の行を、名前と値をつないで読む（値の無い行は「なし」ではなく名前だけ）',
        summaryRows.ok && JSON.stringify(summaryRows.items) === JSON.stringify(['あおば市 大雨注意報 雷注意報', 'みどり市 雷注意報', 'さくら町']), summaryRows.items);
      const townRows = await runCard(BrowserWindow, wide.config, wide.config.cards[2].id, { waitMs: 500 });
      check('カードを作る: 行の一番多い二つに分けた表（12行）も、名前と値をつないで読む',
        townRows.ok && townRows.items.length === 12 && townRows.items[0] === 'あおば市 大雨注意報' && townRows.items[1] === 'みどり市 雷注意報', townRows.items);
      store.remove(wide.config.id);
    }

    // 本文の節: 見出しごとの節を読むカードを足す（Claude の選んだカードの中にある節と、文字の少ない節は作らない）。
    const cycle = await generateDeck({
      BrowserWindow,
      url: 'fixture:cycle-guide.html',
      callModel: async () => ({ cards: [noTitle('menu', 'list', '.menu li'), noTitle('main', 'read', 'section.places')] }),
      store,
      allowFixtures: true,
    });
    check('カードを作る: 本文の見出しごとの節を読むカードを足す（見出しの後に続く節・見出しを包んだ節。Claude のカードの中の節と、文字の少ない節は作らない）',
      cycle.ok && cycle.sections === 3
        && JSON.stringify(cycle.config.cards.map((c) => c.title)) === JSON.stringify(['貸し自転車とは', '料金', '借りられる場所', '乗り方', 'メニュー']),
      cycle.ok ? { sections: cycle.sections, cards: cycle.config.cards } : cycle);
    if (cycle.ok) {
      const about = await runCard(BrowserWindow, cycle.config, cycle.config.cards[0].id, { waitMs: 500 });
      check('カードを作る: 節のカードは、見出しから次の見出しの手前までを読む',
        about.ok && about.text === '貸し自転車とは\n貸し自転車は、町の中を自転車で回りたい方のための仕組みです。一日に何度でも、空いている自転車を借りられます。\n返すときは、どの貸し場所に返しても構いません。',
        about.text);
      const ride = await runCard(BrowserWindow, cycle.config, cycle.config.cards[3].id, { waitMs: 500 });
      check('カードを作る: 見出しを包んだ節も、次の見出しの手前までを読む',
        ride.ok && ride.text === '乗り方\n貸し場所の機械にカードをかざすと、鍵が外れます。返すときは、自転車を台に戻して鍵をかけてください。', ride.text);
      store.remove(cycle.config.id);
    }
    // 本文を丸ごと読むカード（Claude の案）があっても、節のカードに分ける（丸ごとのカードは作らない）。頭の目次と「目次に戻る」は読まない。
    const wholeDeck = await generateDeck({
      BrowserWindow, url: 'fixture:cycle-guide.html', callModel: async () => ({ cards: [noTitle('main', 'read', 'main')] }), store, allowFixtures: true,
    });
    check('カードを作る: 本文を丸ごと読むカードは、見出しごとの節のカードに分ける（目次の一覧は主な一覧にしない）',
      wholeDeck.ok && wholeDeck.split === 1
        && JSON.stringify(wholeDeck.config.cards.map((c) => c.title)) === JSON.stringify(['貸し自転車とは', '料金', '借りられる場所', '乗り方']),
      wholeDeck.ok ? { split: wholeDeck.split, cards: wholeDeck.config.cards } : wholeDeck);
    if (wholeDeck.ok) {
      const about2 = await runCard(BrowserWindow, wholeDeck.config, wholeDeck.config.cards[0].id, { waitMs: 500 });
      check('カードを作る: 節のカードは「目次に戻る」を読まない', about2.ok && !about2.text.includes('目次に戻る') && about2.text.endsWith('返すときは、どの貸し場所に返しても構いません。'), about2.text);
      store.remove(wholeDeck.config.id);
    }

    // 待ち方: 主な区画（main）が空のうちと、ページが変わり続けているうちは、構造を集めない（表を後から描くページ）。
    let lateStructure = '';
    const started = Date.now();
    const late = await generateDeck({
      BrowserWindow,
      url: 'fixture:late-content.html',
      callModel: async ({ user }) => {
        lateStructure = user;
        return { cards: user.includes('table.warn-table') ? [noTitle('table', 'list', '.warn-table tr')] : [] };
      },
      store,
      allowFixtures: true,
    });
    const lateMs = Date.now() - started;
    check('カードを作る: 4秒後に表を描くページでも、表が出るまで待ってから構造を集め、表のカードを作る（題は直前の見出し）',
      late.ok && lateStructure.includes('table.warn-table') && late.config.cards.length === 1 && late.config.cards[0].title === '警報と注意報（作り物）',
      { ok: late.ok, reason: late.reason, lateMs, sawTable: lateStructure.includes('table.warn-table'), cards: late.ok ? late.config.cards : null });
    if (late.ok) {
      const rows = await runCard(BrowserWindow, late.config, late.config.cards[0].id, { waitMs: 500 });
      check('カードを作る: 後から描いた表のカードで、3行を区切り付きで読める',
        rows.ok && JSON.stringify(rows.items) === JSON.stringify(['あおば町 大雨注意報', 'みどり町 雷注意報', 'さくら町 発表なし']), rows.items);
      store.remove(late.config.id);
    }
    check('カードを作る: 消すと、置き場から消え、次の起動で出ない', store.remove(deck.id) === true && loadConfigDir(store.dir).length === 0);
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

// 使う人の側で、その場で自動で直す一巡（Claude を呼ぶ所は偽の返事。Mac には鍵が無いので本物は呼ばない）。
// みどり市の「画面が変わった後」のページで、カルーセルのカードの selector が当たらない
// → いま開いているページの構造から案を作る → 試して確からしいので採る → 読み直して 4件読める → 手元に残す
// → 次の起動でも効く → 元に戻すと、また当たらない。リポジトリの cards/*.json は書き換えない。
async function autoRepairChecks() {
  const { createOverrideStore, applyOverrides, runCardWithAutoRepair } = require('../src/main/autofix');
  const cityFile = path.join(__dirname, '..', 'cards', 'practice-city.json');
  const cityBefore = fs.readFileSync(cityFile, 'utf8');
  const base = { ...loadConfigFile(cityFile).config, id: 'practice-city-auto', url: 'fixture:city-top-after.html' };
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'autofix-smoke-'));
  try {
    const store = createOverrideStore(path.join(userData, 'repairs'));
    let sentUser = '';
    let calls = 0;
    const fakeModel = async ({ user }) => {
      calls += 1;
      sentUser = user;
      return { proposals: [{ where: 'cards[0].selector', selector: '.hero .vis-item:not(.is-clone)', reason: 'カルーセルの部品が作りを組み替え、.slide が .vis-item に変わったため。' }] };
    };
    let repairingSaid = 0;
    const first = await runCardWithAutoRepair({
      BrowserWindow, config: applyOverrides(base, store.load(base.id)).config, cardId: 'carousel', callModel: fakeModel, store,
      options: { waitMs: 500 }, onRepairing: () => { repairingSaid += 1; },
    });
    check('自動で直す: 当たらないカルーセルのカードを直し、読み直して 4件読める',
      first.ok && first.repaired && first.repaired.after === '.hero .vis-item:not(.is-clone)'
        && first.text.startsWith('4件あります。') && first.text.includes('2件目: マイナンバーカードの休日窓口'), first);
    check('自動で直す: Claude を1回だけ呼び、直し始めた知らせを1回出した', calls === 1 && repairingSaid === 1, { calls, repairingSaid });
    check('自動で直す: Claude に送る文に、ページの文字が入っていない',
      sentUser.includes('vis-item') && !sentUser.includes('市民まつり') && !sentUser.includes('マイナンバー') && !sentUser.includes('図書館'), sentUser.slice(0, 300));
    const saved = store.load(base.id);
    check('自動で直す: 手元の上書きのファイルに、カード・前と後のセレクタ・理由・日時を残した',
      saved.length === 1 && saved[0].cardId === 'carousel' && saved[0].before === '.hero .slide'
        && saved[0].after === '.hero .vis-item:not(.is-clone)' && saved[0].reason !== '' && !Number.isNaN(Date.parse(saved[0].at)), saved);
    check('自動で直す: リポジトリの cards/practice-city.json は書き換えていない', fs.readFileSync(cityFile, 'utf8') === cityBefore);

    // 次の起動: 上書きのファイルを読み直して当てると、Claude を呼ばずに読める。
    const reopened = createOverrideStore(path.join(userData, 'repairs'));
    const effective = applyOverrides(base, reopened.load(base.id));
    const second = await runCardWithAutoRepair({ BrowserWindow, config: effective.config, cardId: 'carousel', callModel: fakeModel, store: reopened, options: { waitMs: 500 } });
    check('自動で直す: 次の起動でも直しが効き、Claude を呼ばずに 4件読める',
      effective.active.length === 1 && second.ok && !second.repaired && second.text.startsWith('4件あります。') && calls === 1, { second, calls });

    // 元に戻す: 上書きを外すと、設定ファイルのままの selector に戻り、また当たらない。
    reopened.remove(base.id, 'carousel');
    const undone = applyOverrides(base, reopened.load(base.id));
    const third = await runCardWithAutoRepair({ BrowserWindow, config: undone.config, cardId: 'carousel', callModel: null, store: reopened, options: { waitMs: 500 } });
    check('自動で直す: 元に戻すと、設定ファイルのままの selector になり、読めない（鍵が無いので「自動で直せなかった」の印と「Claude の API キーがありません」）',
      undone.config.cards[0].selector === '.hero .slide' && !third.ok && third.autoRepairFailed === true && third.where === 'cards[0].selector'
        && third.autoRepairReasonText === 'Claude の API キーがありません', third);

    // 確からしくない案（当たる数 0）は採らない。
    const weak = await runCardWithAutoRepair({
      BrowserWindow, config: undone.config, cardId: 'carousel', store: reopened, options: { waitMs: 500 },
      callModel: async () => ({ proposals: [{ where: 'cards[0].selector', selector: '.hero .no-such-item', reason: '試し' }] }),
    });
    check('自動で直す: 当たらない案は採らず、手元にも残さない',
      !weak.ok && weak.autoRepairFailed === true && weak.autoRepairReason === 'not-confident'
        && weak.autoRepairReasonText === '確かな直しの候補がありませんでした' && reopened.load(base.id).length === 0, weak);
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

// カードの画面の試しの待ちは、カードの画面の窓の中の時計で待つ（窓の中で setTimeout を置き、それが動くまで待つ）。
// 画面は知らせを 50ミリ秒遅らせて知らせの欄に入れる（announce）。窓を出さない試しでは、Mac で隠れた窓の中の 50ミリ秒のタイマーが
// 実際には 100〜200ミリ秒で動く（2026-11-04 に測った。主の処理のタイマーは 50〜52ミリ秒。backgroundThrottling: false・
// Chromium の間引きを止める切り替え・powerSaveBlocker のどれでも変わらなかった）。主の処理の時計で 150ミリ秒待ってから読むと、
// 知らせがまだ入っておらず、書き出し・消す・探す欄の知らせの試しが落ちた。窓の中の時計で待てば、先に置かれた知らせのタイマーが必ず先に動く。
function pageWait(win) {
  return (ms) => win.webContents.executeJavaScript(`new Promise((r) => setTimeout(r, ${Number(ms)}))`);
}

// 一覧の一件を選んで、その一件に結び付いた所を読む（itemTarget）を、読み上げの操作（キー）だけで使う試し。
// 偽の cardsApi（test/renderer-preload.js）を ?fake=chat で、作り物のチャットのアプリだけにして開く。
async function rendererItemTargetChecks() {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { preload: path.join(__dirname, 'renderer-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  try {
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), { query: { fake: 'chat' } });
    const js = (code) => win.webContents.executeJavaScript(code);
    const wait = pageWait(win);
    for (let k = 0; k < 50 && (await js("document.querySelectorAll('#deck > article.card').length")) < 3; k++) await wait(50);
    const key = (k) => js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true }))`);
    const active = () => js(`(() => { const a = document.activeElement; const c = a.closest ? a.closest('article.card') : null;
      return { tag: a.tagName, text: a.textContent, heading: c ? c.querySelector('h2').textContent : null }; })()`);
    const status = () => js("document.getElementById('status').textContent");
    // はじめの束の四枚目（作り物のチャット）へ進み、三枚目（はじめのカード・最後の返事の次）の「自分の質問を全部読む」を読む。
    for (let k = 0; k < 3; k++) await key('ArrowDown');
    await key('Enter');
    await wait(100);
    await key('ArrowDown');
    await key('ArrowDown');
    await key('Enter');
    await wait(300);
    const first = await active();
    const hint = await js("[...document.activeElement.closest('article.card').querySelectorAll('p[data-item]')].map((n) => n.textContent)");
    check('一件を選んで読む: 一覧を読むと、焦点は1件目にあり、一覧の後に「一件を選んで Enter キーを押すと、その返事を読みます。」がある',
      first.tag === 'LI' && first.text === '一つ目の質問' && first.heading === '自分の質問を全部読む（4件）' && hint.includes('一件を選んで Enter キーを押すと、その返事を読みます。'), { first, hint });
    // 項目の端: 最初で上矢印なら「ここが一番上です。」、最後で下矢印なら「ここが最後です。」と知らせ、焦点は動かない。
    await key('ArrowUp');
    await wait(150);
    const topSaid = await status();
    const atTop = await active();
    await key('End');
    await key('ArrowDown');
    await wait(150);
    const endSaid = await status();
    const atEnd = await active();
    check('項目の端: 最初の項目で上矢印なら「ここが一番上です。」、最後の項目で下矢印なら「ここが最後です。」と知らせ、焦点は動かない',
      topSaid === 'ここが一番上です。' && atTop.text === '一つ目の質問' && endSaid === 'ここが最後です。' && atEnd.text === '一件を選んで Enter キーを押すと、その返事を読みます。',
      { topSaid, atTop, endSaid, atEnd });
    await key('Home');
    await key('ArrowDown');
    await key('Enter');
    await wait(300);
    const opened = await active();
    const said = await status();
    const asked = await js('window.fakeLog.itemTargets()');
    // 偽の一覧は、一件ごとの手がかり k1・k2・k3 を返す。選んだ一件の手がかりを渡すか。
    check('一件を選んで読む: 2件目の上で Enter を押すと、その返事のカード「2件目の返事」が開き、焦点は返事の最初の項目にあり、「「自分の質問を全部読む」の2件目の返事を読みました。」と知らせる',
      opened.tag === 'P' && opened.text === '二つ目の返事の一行目' && opened.heading === '2件目の返事'
        && said === '「自分の質問を全部読む」の2件目の返事を読みました。' && JSON.stringify(asked) === JSON.stringify(['fake-chat/questions/1/k2']),
      { opened, said, asked });
    await key('Escape');
    await key('Escape');
    await wait(100);
    const back = await active();
    check('一件を選んで読む: Esc を二度押すと、一覧のさっきの一件（2件目）に戻る', back.tag === 'LI' && back.text === '二つ目の質問' && back.heading === '自分の質問を全部読む（4件）', back);
    await key('ArrowDown');
    await key('Enter');
    await wait(300);
    const missing = await js("document.getElementById('alert').textContent");
    const stay = await active();
    check('一件を選んで読む: 一覧を読んだ後に画面が変わっていたら「「自分の質問を全部読む」を読んだ後に、ページが変わりました。もう一度「自分の質問を全部読む」を読んでください。」と知らせ、その一件に留まる',
      missing === '「自分の質問を全部読む」を読んだ後に、ページが変わりました。もう一度「自分の質問を全部読む」を読んでください。'
        && stay.tag === 'LI' && stay.text === '三つ目の質問（画面が変わった後）', { missing, stay });
    // 返事の無い一件（手がかりは合うが、結び付いた所が無い）。偽の一覧の4件目。
    await key('ArrowDown');
    await key('Enter');
    await wait(300);
    const noReply = await js("document.getElementById('alert').textContent");
    check('一件を選んで読む: 返事の無い一件では「「自分の質問を全部読む」の4件目の返事が見つかりませんでした。」と知らせる',
      noReply === '「自分の質問を全部読む」の4件目の返事が見つかりませんでした。', noReply);
  } finally {
    win.destroy();
  }
}

// 束を移る（Enter で先へ・Esc で戻る）とき、焦点のある要素を先に DOM から外さない（見直しの5）。
// カードの中の項目では、同じ並び（外してから焦点を移す）で NVDA が焦点を見失った測りがある（renderer.js の refreshCard の註）。
async function rendererDeckFocusChecks() {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { preload: path.join(__dirname, 'renderer-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  try {
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    const js = (code) => win.webContents.executeJavaScript(code);
    const wait = pageWait(win);
    for (let k = 0; k < 50 && (await js("document.querySelectorAll('#deck > article.card').length")) < 3; k++) await wait(50);
    const key = (k) => js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true }))`);
    // はじめの一枚目のアプリの数は「〇個」で読む（「14つ」と読まれた。2026-11-05 の Windows の確かめ）。
    const intro = await js("document.querySelector('#deck > article.card [data-item]').textContent");
    check('はじめの一枚目: アプリの数を「アプリは〇個あります。」と読む（10を越えても「〇つ」にしない）',
      /^ウェブアプリの画面を、カードで読めます。アプリは\d+個あります。$/.test(intro), intro);
    // 見張り: 焦点のある要素（か、それを含む要素）を DOM から外した回数と、焦点が body に落ちた回数。
    await js(`(() => {
      const t = { removedWithFocus: 0, bodyFocus: 0 };
      window.__deckWatch = t;
      const holdsFocus = (node) => node !== document.body && node.contains(document.activeElement);
      for (const name of ['remove', 'replaceWith']) {
        const orig = Element.prototype[name];
        Element.prototype[name] = function (...a) { if (holdsFocus(this)) t.removedWithFocus++; return orig.apply(this, a); };
      }
      const origReplaceChildren = Element.prototype.replaceChildren;
      Element.prototype.replaceChildren = function (...a) { if ([...this.children].some(holdsFocus)) t.removedWithFocus++; return origReplaceChildren.apply(this, a); };
      document.addEventListener('focusout', () => setTimeout(() => { if (document.activeElement === document.body) t.bodyFocus++; }, 0), true);
      return true;
    })()`);
    for (let k = 0; k < 3; k++) await key('ArrowDown');
    await key('Enter');
    await wait(100);
    const inApp = await js("(() => { const a = document.activeElement; return a.tagName + ':' + (a.querySelector('h2') ? a.querySelector('h2').textContent : ''); })()");
    await key('Escape');
    await wait(100);
    const back = await js("(() => { const a = document.activeElement; return a.tagName + ':' + (a.querySelector('h2') ? a.querySelector('h2').textContent : ''); })()");
    const watch = await js('window.__deckWatch');
    check('束を移る: Enter で先へ進むときも Esc で戻るときも、焦点のある要素を先に DOM から外さず、焦点は新しいカードにある',
      watch.removedWithFocus === 0 && watch.bodyFocus === 0 && inApp === 'ARTICLE:試しのアプリ（作り物）' && back === 'ARTICLE:試しのアプリ（作り物）',
      { watch, inApp, back });
  } finally {
    win.destroy();
  }
}

// 主の処理の誤り（where が「(なし)」・「動かせませんでした」）は、「画面が変わったため」ではなく、もう一度押す文で読む（見直しの6）。
async function rendererErrorTextChecks() {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { preload: path.join(__dirname, 'renderer-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  try {
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), { query: { fake: 'chat' } });
    const js = (code) => win.webContents.executeJavaScript(code);
    const wait = pageWait(win);
    for (let k = 0; k < 50 && (await js("document.querySelectorAll('#deck > article.card').length")) < 3; k++) await wait(50);
    const key = (k) => js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true }))`);
    for (let k = 0; k < 3; k++) await key('ArrowDown');
    await key('Enter');
    await wait(100);
    await key('ArrowDown');
    await key('Enter');
    await wait(300);
    const texts = await js("[...document.querySelectorAll('#deck > article.card')[1].querySelectorAll('[data-item]')].map((n) => n.textContent)");
    check('主の処理の誤り: 「動かせませんでした」は「うまく動きませんでした。」「もう一度押してください。」と読み、「画面が変わったため」とは言わない',
      JSON.stringify(texts) === JSON.stringify(['うまく動きませんでした。\nもう一度 Enter キーを押してください。']), texts);
  } finally {
    win.destroy();
  }
}

// 読んでいる最中に、別のカードをクリック（読み上げソフトの閲覧モードの Enter・VO+Space も click として届く）しても、
// 二枚を同時に読まず、「読み込み中です。少しお待ちください。」と知らせる（見直しの4）。
async function rendererBusyChecks() {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { preload: path.join(__dirname, 'renderer-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  try {
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    const js = (code) => win.webContents.executeJavaScript(code);
    const wait = pageWait(win);
    for (let k = 0; k < 50 && (await js("document.querySelectorAll('#deck > article.card').length")) < 3; k++) await wait(50);
    const key = (k) => js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true }))`);
    for (let k = 0; k < 3; k++) await key('ArrowDown');
    await key('Enter');
    await wait(100);
    const headings = () => js("[...document.querySelectorAll('#deck > article.card h2')].map((h) => h.textContent)");
    // 時間のかかる読む所（四枚目）をクリックし、すぐにすぐ返る読む所（二枚目）をクリックする。
    await js("document.querySelectorAll('#deck > article.card')[3].click()");
    await wait(50);
    await js("document.querySelectorAll('#deck > article.card')[1].click()");
    await wait(150);
    const said = await js("document.getElementById('status').textContent");
    const during = await headings();
    await wait(1500);
    const after = await headings();
    check('読んでいる最中: 別のカードをクリックしても読み始めず、「読み込み中です。少しお待ちください。」と知らせ、先のカードだけを読み終える',
      said === '読み込み中です。少しお待ちください。' && during[1] === 'すぐ返る読む所' && after[1] === 'すぐ返る読む所' && after[3] === '時間のかかる読む所',
      { said, during, after });
  } finally {
    win.destroy();
  }
}

// 押すカードの知らせ: 「押しています。」は 0.5秒たっても終わらないときだけ出す（すぐ終われば「押しました。」だけ）。
// 押す9枚の束で、一枚ごとに4つの知らせが読まれて長かった（2026-11-04 の Windows の通し稽古）。cardsApi は偽物（?fake=click）。
async function rendererClickAnnounceChecks() {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { preload: path.join(__dirname, 'renderer-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  try {
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), { query: { fake: 'click' } });
    const js = (code) => win.webContents.executeJavaScript(code);
    const wait = pageWait(win);
    for (let k = 0; k < 50 && (await js("document.querySelectorAll('#deck > article.card').length")) < 3; k++) await wait(50);
    const key = (k) => js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true }))`);
    for (let k = 0; k < 3; k++) await key('ArrowDown');
    await key('Enter');
    await wait(100);
    // 知らせの欄（status・alert）に出た文を、出た順に控える。
    await js(`(() => {
      window.__said = [];
      for (const id of ['status', 'alert']) {
        const el = document.getElementById(id);
        new MutationObserver(() => { if (el.textContent) window.__said.push(el.textContent); }).observe(el, { childList: true, characterData: true, subtree: true });
      }
      return true;
    })()`);
    const press = async () => {
      await key('ArrowDown');
      await key('Enter');
      await wait(100);
      await key('ArrowDown');
      const button = await js('document.activeElement.textContent');
      await js('window.__said.length = 0; document.activeElement.click()');
      return button;
    };
    const fastButton = await press();
    await wait(900);
    const fastSaid = await js('window.__said.slice()');
    check('すぐ終わる押す所: 「クリックしています。」を出さず、「クリックしました。」だけを知らせる',
      fastButton === '「すぐ終わる押す所」をクリックする' && JSON.stringify(fastSaid) === JSON.stringify(['「すぐ終わる押す所」をクリックしました。']), { fastButton, fastSaid });
    await key('Escape');
    const slowButton = await press();
    await wait(800);
    const slowDuring = await js('window.__said.slice()');
    const buttonDuring = await js('document.activeElement.textContent');
    await wait(1000);
    const slowSaid = await js('window.__said.slice()');
    const buttonAfter = await js('document.activeElement.textContent');
    check('時間のかかる押す所: 0.5秒たっても終わらなければ「クリックしています。」を出し（ボタンも「（クリックしています）」）、終わったら「クリックしました。」',
      slowButton === '「時間のかかる押す所」をクリックする' && JSON.stringify(slowDuring) === JSON.stringify(['「時間のかかる押す所」をクリックしています。'])
        && buttonDuring === '「時間のかかる押す所」をクリックする（クリックしています）'
        && JSON.stringify(slowSaid) === JSON.stringify(['「時間のかかる押す所」をクリックしています。', '「時間のかかる押す所」をクリックしました。'])
        && buttonAfter === '「時間のかかる押す所」をクリックする',
      { slowButton, slowDuring, buttonDuring, slowSaid, buttonAfter });
  } finally {
    win.destroy();
  }
}

// YouTube のカード（"kind": "youtube"）: 探す欄で探し、結果を番号つきで読み、Enter で再生のカードへ移って再生する。
// プレーヤーは作り物（test/fixtures/yt-fake-player.html。埋め込みプレーヤーの postMessage の決まりの一部をまねる）。API の答えも作り物（?fake=youtube）。
// 確かめること: 一枚目に「検索の言葉は YouTube（Google）に送られます。…」と規約・プライバシーポリシーのボタン。再生のカードでは焦点がプレーヤーの外のボタンにあり、
// ボタンはプレーヤーの下（重ならない）。プレーヤーが読み込めたら再生の命令を送る。10秒戻る・音量を上げる（何％かを一文で知らせる）・一時停止。
async function rendererYouTubeChecks() {
  const open = async (query) => {
    const win = new BrowserWindow({
      show: false,
      width: 1000,
      height: 900,
      webPreferences: { preload: path.join(__dirname, 'renderer-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), { query });
    const js = (code) => win.webContents.executeJavaScript(code);
    const wait = pageWait(win);
    for (let k = 0; k < 50 && (await js("document.querySelectorAll('#deck > article.card').length")) < 3; k++) await wait(50);
    const key = (k) => js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true }))`);
    for (let k = 0; k < 3; k++) await key('ArrowDown');
    await key('Enter');
    await wait(150);
    await js(`(() => {
      window.__said = [];
      window.__ytMsgs = [];
      window.addEventListener('message', (e) => { try { const d = JSON.parse(e.data); if (d.info && d.info.lastCommand) window.__ytMsgs.push(d.info.lastCommand); } catch (err) {} });
      for (const id of ['status', 'alert']) {
        const el = document.getElementById(id);
        new MutationObserver(() => { if (el.textContent) window.__said.push(el.textContent); }).observe(el, { childList: true, characterData: true, subtree: true });
      }
      return true;
    })()`);
    return { win, js, wait, key };
  };
  const t = await open({ fake: 'youtube' });
  try {
    const first = await t.js("[...document.querySelectorAll('#deck > article.card')[0].querySelectorAll('[data-item]')].map((x) => x.textContent)");
    check('YouTube: 一枚目に、検索の言葉が YouTube（Google）に送られ Todoku は保存しないことと、利用規約・プライバシーポリシーを開くボタンがある',
      first.includes('検索の言葉は YouTube（Google）に送られます。Todoku は保存しません。') && first.includes('YouTube の利用規約を開く')
        && first.includes('Google のプライバシーポリシーを開く') && !first.some((x) => x.includes('設定ファイルを確認する')), first);
    check('YouTube: 一枚目のキーの説明は、ほかのアプリと同じく Home・End の一文と Esc の一文を含む',
      first.includes('Homeキーで最初のカード、Endキーで最後のカードへ移動します。') && first.includes('Escキーで、カードの中からカードへ戻ります。'), first);
    const emptyPlayer = await t.js("(() => { const p = document.querySelector('#deck > article.card-yt-player'); const items = [...p.querySelectorAll('[data-item]')]; return items.length === 1 ? items[0].textContent : items.map((x) => x.textContent); })()");
    check('YouTube: 動画を選ぶ前の再生のカードは「まだ動画を選んでいません。…」の一文だけ（ボタンの説明は出さない）',
      emptyPlayer === 'まだ動画を選んでいません。「動画を探す」か、新しい動画の一覧で一件を選んで Enter キーを押すと、ここで再生します。', emptyPlayer);
    // 探す欄で探す。
    await t.key('ArrowDown');
    await t.key('Enter');
    await t.js(`(() => { const i = document.activeElement; i.value = '授業'; i.dispatchEvent(new Event('input', { bubbles: true })); return i.tagName; })()`);
    await t.js("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))");
    await t.wait(400);
    const found = await t.js(`(() => ({ focus: document.activeElement.tagName + ' ' + document.activeElement.textContent, said: window.__said.slice(), queries: window.fakeLog.ytQueries() }))()`);
    check('YouTube: 探すと、結果を番号つきの一覧で出して最初の一件に焦点を置き、何件見つかったかを知らせる（探す言葉とカードを API の口に渡す）',
      found.focus === 'LI 作り物の授業 第1回、長さ 12分34秒、公開日 2026年11月3日、作り物の大学' && found.said.includes('2件見つかりました。')
        && JSON.stringify(found.queries) === JSON.stringify(['search:授業']), found);
    // Enter で再生のカードへ（欄の Enter のすぐ後の Enter は捨てる守りがあるので、少し間を置く）。
    await t.wait(300);
    await t.key('Enter');
    await t.wait(1200);
    const play = await t.js(`(() => {
      const a = document.activeElement;
      const card = a.closest('article.card');
      const f = card ? card.querySelector('iframe') : null;
      const fr = f ? f.getBoundingClientRect() : null;
      const buttons = card ? [...card.querySelectorAll('button')] : [];
      return { focus: a.tagName + ' ' + a.textContent, heading: card ? card.querySelector('h2').textContent : null, iframe: Boolean(f), iframeTab: f ? f.getAttribute('tabindex') : null,
        size: fr ? [Math.round(fr.width), Math.round(fr.height)] : null, below: fr ? buttons.every((b) => b.getBoundingClientRect().top >= fr.bottom - 0.5) : false,
        msgs: window.__ytMsgs.slice(), said: window.__said.slice() };
    })()`);
    check('YouTube: 一件で Enter を押すと、再生のカードに移り、焦点はプレーヤーの外の「再生」のボタン。プレーヤーは 200×200 以上で、ボタンはプレーヤーの下（重ならない）',
      play.focus === 'BUTTON 再生' && play.heading === '再生中の動画を操作する（作り物の授業 第1回）' && play.iframe && play.iframeTab === '-1'
        && play.size[0] >= 200 && play.size[1] >= 200 && play.below, play);
    check('YouTube: プレーヤーが読み込めて見えたら、再生の命令を送る', play.msgs.includes('playVideo:[]'), play);
    await t.js('window.__said.length = 0; window.__ytMsgs.length = 0');
    for (const label of ['10秒戻る', '音量を上げる', '一時停止']) {
      await t.js(`[...document.querySelectorAll('button')].find((b) => b.textContent === ${JSON.stringify(label)}).click()`);
      await t.wait(250);
    }
    const ctrl = await t.js('({ msgs: window.__ytMsgs.slice(), said: window.__said.slice() })');
    check('YouTube: 10秒戻る・音量を上げる・一時停止をプレーヤーに送り、音量は何％にしたかを一文で知らせる',
      JSON.stringify(ctrl.msgs) === JSON.stringify(['seekTo:[20,true]', 'setVolume:[60]', 'pauseVideo:[]'])
        && JSON.stringify(ctrl.said) === JSON.stringify(['10秒戻しました。', '音量を60%にしました。', '一時停止しました。']), ctrl);
    // 決まったチャンネルの新しい動画（二枚目）。
    await t.key('Escape');
    await t.key('ArrowUp');
    await t.key('Enter');
    await t.wait(400);
    const latest = await t.js(`(() => ({ focus: document.activeElement.textContent, queries: window.fakeLog.ytQueries(), said: window.__said.slice() }))()`);
    check('YouTube: 決まったチャンネルの新しい動画を、番号つきの一覧で読む',
      latest.focus.startsWith('作り物の授業 第1回') && latest.queries.includes('latest:') && latest.said.includes('「授業の動画の新しいものを読む」から2件読みました。'), latest);
  } finally {
    t.win.destroy();
  }
  const n = await open({ fake: 'youtube', ytnokey: '1' });
  try {
    await n.key('ArrowDown');
    await n.key('Enter');
    await n.js(`(() => { const i = document.activeElement; i.value = '授業'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await n.js("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))");
    await n.wait(400);
    const nk = await n.js(`(() => ({ focus: document.activeElement.textContent, said: window.__said.slice() }))()`);
    check('YouTube（API キーが無いとき）: 「YouTube の API キーが設定されていません。」の文に焦点を置き、知らせの欄には何も入れない（すぐ返ったので「探しています。」も言わない）',
      nk.focus === 'YouTube の API キーが設定されていません。' && !nk.said.includes('YouTube の API キーが設定されていません。') && !nk.said.includes('探しています。'), nk);
  } finally {
    n.win.destroy();
  }
}

// 支援者向けの点検と直しの案: はじめのカードのボタンから点検の束へ進み、当たらない行の案を一件ずつ受ける・断る。
// 鍵が無いときは、当たらない行の一覧だけを読む。cardsApi は偽物（?fake=review。偽の Claude の案が二件）。
async function rendererReviewChecks() {
  const open = async (query) => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: { preload: path.join(__dirname, 'renderer-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), { query });
    const js = (code) => win.webContents.executeJavaScript(code);
    const wait = pageWait(win);
    for (let k = 0; k < 50 && (await js("document.querySelectorAll('#deck > article.card').length")) < 3; k++) await wait(50);
    const key = (k) => js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true }))`);
    for (let k = 0; k < 3; k++) await key('ArrowDown');
    await key('Enter');
    await wait(100);
    await js(`(() => {
      window.__said = [];
      for (const id of ['status', 'alert']) {
        const el = document.getElementById(id);
        new MutationObserver(() => { if (el.textContent) window.__said.push(el.textContent); }).observe(el, { childList: true, characterData: true, subtree: true });
      }
      return true;
    })()`);
    const press = (text) => js(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true; })()`);
    const state = () => js(`(() => {
      const a = document.activeElement;
      const card = a && a.closest ? a.closest('article.card') : null;
      return { focus: a ? a.textContent : null, heading: card ? card.querySelector('h2').textContent : null, title: document.title,
        buttons: card ? [...card.querySelectorAll('button')].map((b) => b.textContent) : [], said: window.__said.slice(), applied: window.fakeLog.applied() };
    })()`);
    return { win, js, wait, key, press, state };
  };

  const t = await open({ fake: 'review' });
  try {
    const pressed = await t.press('設定ファイルを確認する（支援者向け）');
    await t.wait(500);
    const first = await t.state();
    check('確認: アプリの案内のカードのボタンから確認の画面へ進み、読めなくなった場所と直しの候補の数を一文で知らせ、焦点は一つ目の候補の見出し',
      pressed && first.title === 'Todoku - 「作り物の講座（画面が変わった後）」の設定ファイルの確認（支援者向け）'
        && first.heading === '設定ファイルを確認して直す（支援者向け）（直しの候補2個）'
        && first.focus === '直しの候補1（全部で2個）: 「締め切りを読む」の読む場所'
        && first.said[first.said.length - 1] === '読めなくなった場所が2か所あり、直しの候補が2個あります。'
        && first.buttons.includes('「締め切りを読む」の直しを使う（設定ファイルに書く）') && first.buttons.includes('「お知らせを読む」の直しを使わない'), first);
    // 見出しと値は一つの段落（dl にしない。NVDA が項目ごとに役割の名前を付けて、一件で6回読んだ）。断っても使う人の画面では直す、の一文がある。
    const reviewItems = await t.js("[...document.querySelectorAll('#deck > article.card')[0].querySelectorAll('[data-item]')].map((x) => x.tagName + ' ' + x.textContent)");
    check('確認: 候補の見出しと値は「いまのセレクタ: …」の一つの段落で、dl を使わず、使わなくても使う人の画面では直す一文がある',
      reviewItems.includes('P いまのセレクタ: .deadline-list li') && reviewItems.includes('P 直しの候補のセレクタ: [data-region="deadline-list"] li（ページの中で3か所が見つかります）')
        && reviewItems.includes('P 理由: 一覧の作りが data-region に変わったためです。') && reviewItems.includes('P この直しを使わなくても、使う人の画面では、その場で直して読みます。Claude の API キーがあるときです。')
        && !reviewItems.some((x) => /^D[TD] /.test(x)), reviewItems);
    await t.js('window.__said.length = 0');
    await t.press('「締め切りを読む」の直しを使う（設定ファイルに書く）');
    await t.wait(1300);
    const accepted = await t.state();
    await t.key('ArrowDown');
    const nextHead = await t.state();
    check('確認: 直しを使うと、その一件だけを書くように頼み、書くのに 0.5秒を越えたら「書いています。」と一言知らせ、焦点はその候補の結果の文。下矢印で次の候補の見出し',
      JSON.stringify(accepted.applied) === JSON.stringify(['cards[0].selector']) && JSON.stringify(accepted.said) === JSON.stringify(['書いています。'])
        && accepted.focus === '直しの候補1（全部で2個）: 「締め切りを読む」の読む場所: この直しを使いました。設定ファイルに書き、前の版はバックアップとして残しました。'
        && nextHead.focus === '直しの候補2（全部で2個）: 「お知らせを読む」の読む場所' && !accepted.buttons.some((b) => b.startsWith('「締め切りを読む」')), { accepted, nextHead });
    await t.js('window.__said.length = 0');
    await t.press('「お知らせを読む」の直しを使わない');
    await t.wait(300);
    const rejected = await t.state();
    await t.key('ArrowDown');
    const summary = await t.state();
    check('確認: 直しを使わないと書かず、焦点はその候補の結果の文。全部見たら、下矢印で使った数と使わなかった数の一文',
      JSON.stringify(rejected.applied) === JSON.stringify(['cards[0].selector']) && rejected.said.length === 0
        && rejected.focus === '直しの候補2（全部で2個）: 「お知らせを読む」の読む場所: この直しは使いませんでした。設定ファイルは変えていません。'
        && summary.focus === 'すべての直しの候補を確認しました。使った直しは1個、使わなかった直しは1個です。' && rejected.buttons.length === 0, { rejected, summary });
    await t.key('Escape');
    await t.key('Escape');
    const back = await t.state();
    check('確認: Esc でアプリのカードに戻る（窓の題も戻る）', back.title === 'Todoku - 作り物の講座（画面が変わった後）' && back.heading === '作り物の講座（画面が変わった後）', back);
  } finally {
    t.win.destroy();
  }

  // 確認に時間がかかる間: キーを押しても「読み込み中です。」を出さず、5秒ごとに「確認を始めて、〇秒たちました。」と知らせる。
  const w = await open({ fake: 'review', slowcheck: '1' });
  try {
    await w.press('設定ファイルを確認する（支援者向け）');
    await w.wait(1500);
    for (let k = 0; k < 3; k++) {
      await w.key('ArrowDown');
      await w.wait(400);
    }
    await w.wait(5000);
    const s = await w.state();
    const said = s.said.filter((t) => !/枚中/.test(t));
    check('確認の間: キーを押しても「読み込み中です。」を出さず、5秒ごとに「確認を始めて、〇秒たちました。」と知らせ、終わったら数の一文',
      !s.said.some((t) => t.includes('読み込み中')) && said[0] === '確認しています。' && said.includes('確認を始めて、5秒たちました。')
        && said[said.length - 1] === '読めなくなった場所が2か所あり、直しの候補が2個あります。', s.said);
  } finally {
    w.win.destroy();
  }

  const n = await open({ fake: 'review', nokey: '1' });
  try {
    await n.press('設定ファイルを確認する（支援者向け）');
    await n.wait(500);
    const items = await n.js("[...document.querySelectorAll('#deck > article.card')[0].querySelectorAll('[data-item]')].map((x) => x.textContent)");
    const s = await n.state();
    check('確認（API キーが無いとき）: 読めなくなった場所の一覧だけを読み、使う・使わないのボタンは出さない',
      JSON.stringify(items) === JSON.stringify([
        '読めなくなった場所が2か所あります。Claude の API キーが設定されていないので、直しの候補を作れません（環境変数 CARDS_ANTHROPIC_API_KEY が空です）。',
        '「締め切りを読む」（読む場所、ボタンやリンクの場所）: ページの中に読む場所が見つかりません。',
        '「お知らせを読む」（読む場所、ボタンやリンクの場所）: ページの中に読む場所が見つかりません。',
      ]) && s.buttons.length === 0 && s.applied.length === 0
        && s.said[s.said.length - 1] === '読めなくなった場所が2か所あります。Claude の API キーが設定されていないので、直しの候補を作れません（環境変数 CARDS_ANTHROPIC_API_KEY が空です）。', { items, s });
  } finally {
    n.win.destroy();
  }
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
    const wait = pageWait(win);
    const cardCount = () => js("document.querySelectorAll('#deck > article.card').length");
    for (let k = 0; k < 50 && (await cardCount()) < 3; k++) await wait(50);
    const key = (k) => js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true }))`);
    // 0. はじめの束（Todoku）から、試しのアプリの束へ進む（はじめの束は、アプリが一つでも出す）。
    // 束を移るときは束を丸ごと描き直すので、見張りはアプリの束へ進んでから付ける（読むカードの焦点を見る試しのため）。
    // 表示設定（二枚目）と探す欄（三枚目）の後の、四枚目がアプリの名前のカード。
    for (let k = 0; k < 3; k++) await key('ArrowDown');
    await key('Enter');
    for (let k = 0; k < 50 && (await cardCount()) < 4; k++) await wait(50);
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
    check('はじめのカードの項目に、表示設定の在処と、Escキーではじめの画面へ戻れることを言う一文がある',
      firstTexts.includes('表示設定は、はじめの画面の「表示設定」のカードにあります。'), firstTexts);
    await key('End');
    const sourceButton = await focusState();
    check('はじめのカードの最後の項目は「出典のページを開く」ボタン', sourceButton.tag === 'BUTTON' && sourceButton.text === '出典のページを開く', sourceButton);
    await js('document.activeElement.click()');
    await wait(300);
    const opened = await js('window.fakeLog.opened()');
    const said = await js("document.getElementById('status').textContent");
    check('ボタンを押すと、そのアプリの出典のページを開くよう頼み、開いたことを知らせる',
      JSON.stringify(opened) === JSON.stringify(['fake-app']) && said === '出典のページを、既定のブラウザで開きました。', { opened, said });

    // 5. 自動で直した読む所: 読んだ結果に焦点が移り、直したことを一度だけ知らせ、カードの中に「直す前に戻す」ボタンがある。
    const status = () => js("document.getElementById('status').textContent");
    await key('Escape');
    await key('Home');
    for (let k = 0; k < 4; k++) await key('ArrowDown');
    await key('Enter');
    await wait(900);
    const fixed = await focusState();
    const fixedSaid = await status();
    check('自動で直した読む所: 焦点が結果の最初の項目にあり、「ページが変わったので、読む場所を直しました。」と知らせる',
      fixed.connected && fixed.firstResult && fixed.text === '直した所の文'
        && fixedSaid === 'ページが変わったので、読む場所を直しました。「画面が変わった読む所」を読みました。', { fixed, fixedSaid });
    const fixedItems = await js("[...document.activeElement.closest('article.card').querySelectorAll('[data-item]')].map((n) => n.tagName + ':' + n.textContent)");
    check('自動で直した読む所: カードの中に、直したことの一文と「直す前に戻す」ボタンがある',
      fixedItems.includes('P:このカードの読む場所は、ページが変わったときに自動で直したものです。') && fixedItems[fixedItems.length - 1] === 'BUTTON:直す前に戻す', fixedItems);
    const headings = await js("[...document.querySelectorAll('#deck > article.card h2')].map((h) => h.textContent)");
    check('自動で直したら、束の最後に「自動で直した場所（支援者向け）」のカードが足される',
      headings[headings.length - 1] === '自動で直した場所（支援者向け）', headings);
    // 二度目に読んだときは、直したことを言わない。
    await key('Escape');
    await key('Enter');
    await wait(900);
    const againSaid = await status();
    check('自動で直した読む所: 二度目に読んだときは、直したことを言わない', againSaid === '「画面が変わった読む所」を読みました。', againSaid);

    // 支援者向けのカード: どのカード・前と後のセレクタ・理由・日時を読める。
    await key('Escape');
    await key('End');
    await key('Enter');
    await wait(300);
    const maintTexts = await js("[...document.activeElement.closest('article.card').querySelectorAll('[data-item]')].map((n) => n.textContent)");
    check('支援者向けのカードで、カード・直す前と後のセレクタ・理由・日時と、配るボタン・戻すボタンを読める',
      maintTexts[0] === '自動で直した場所が1か所あります。この直しは、このパソコンの中だけで使っています。' && maintTexts.includes('画面が変わった読む所')
        && maintTexts.includes('#d') && maintTexts.includes('#d2') && maintTexts.includes('id が変わったため。')
        && maintTexts.some((t) => /^2026年11月3日 \d+時05分$/.test(t))
        && maintTexts.includes('「画面が変わった読む所」の直しを設定ファイルに書く（ほかの人にも配れるようにする）') && maintTexts.includes('「画面が変わった読む所」を直す前に戻す'), maintTexts);

    // 直す前に戻す（読む所のカードの中のボタン）。支援者向けのカードから5枚上（名前・メモ・フォルダ・このページのリンク・直せない押す所・直せない読む所の上）。
    await key('Escape');
    for (let k = 0; k < 5; k++) await key('ArrowUp');
    await key('Enter');
    await wait(900);
    await key('End');
    const undoButton = await focusState();
    await js('document.activeElement.click()');
    await wait(300);
    const undoSaid = await status();
    const afterUndo = await focusState();
    const undoneLog = await js('window.fakeLog.undone()');
    const leftItems = await js("[...document.querySelectorAll('#deck > article.card')[4].querySelectorAll('[data-item]')].map((n) => n.textContent)");
    const firstItemFocused = await js("(() => { const a = document.activeElement; const c = a.closest('article.card'); return Boolean(c) && c.querySelector('[data-item]') === a; })()");
    check('「直す前に戻す」を押すと、戻すよう頼み、「…読む所を、直す前に戻しました。」と知らせ、ボタンが消えて焦点はカードの中の最初の項目に移る',
      undoButton.text === '直す前に戻す' && JSON.stringify(undoneLog) === JSON.stringify(['fake-app/fixed-read'])
        && undoSaid === '「画面が変わった読む所」の読む場所を、直す前に戻しました。'
        && !leftItems.includes('直す前に戻す') && afterUndo.connected && afterUndo.tag === 'P' && firstItemFocused
        && afterUndo.text === '直した所の文' && afterUndo.heading === '画面が変わった読む所', { undoButton, undoneLog, undoSaid, afterUndo, leftItems, firstItemFocused });
    // 戻した後に Esc を一度押すと、カードの上に戻るだけで、束からは出ない。
    const deckBefore = await js("[...document.querySelectorAll('#deck > article.card h2')].map((h) => h.textContent)");
    await key('Escape');
    const afterEsc = await focusState();
    const deckAfter = await js("[...document.querySelectorAll('#deck > article.card h2')].map((h) => h.textContent)");
    check('戻した後に Esc を押すと、そのカードの上に戻り、束は変わらない',
      afterEsc.tag === 'ARTICLE' && afterEsc.heading === '画面が変わった読む所' && JSON.stringify(deckBefore) === JSON.stringify(deckAfter), { afterEsc, deckBefore, deckAfter });

    // 直せなかった読む所: 見つからない → 自動で直すこともできなかった（理由）、の順。
    await key('ArrowDown');
    await key('Enter');
    await wait(900);
    const unfixed = await focusState();
    check('直せなかった読む所: 「読めません」の中に、理由つきの「自動で直すこともできませんでした（…）。」が最後に来る',
      unfixed.heading === '直せない読む所（読めません）'
        && unfixed.text === 'ページが変わったため、読む場所が見つかりませんでした。\n自動で直すこともできませんでした（時間内に終わりませんでした）。', unfixed);

    // 直せなかった押す所: 押せなかった知らせに、理由つきの一文を足す。
    await key('Escape');
    await key('ArrowDown');
    await key('Enter');
    await wait(100);
    await key('ArrowDown');
    const pressButton = await focusState();
    await js('document.activeElement.click()');
    await wait(300);
    const clickSaid = await js("document.getElementById('alert').textContent");
    check('直せなかった押す所: 「クリックできませんでした。…。自動で直すこともできませんでした（Claude の API キーがありません）。」と知らせる',
      pressButton.text === '「直せない押す所」をクリックする'
        && clickSaid === '「直せない押す所」をクリックできませんでした。ページの中に読む場所が見つかりません。自動で直すこともできませんでした（Claude の API キーがありません）。',
      { pressButton, clickSaid });

    // 支援者向けのカードの「直す前に戻す」: 焦点は支援者向けのカードの中の最初の項目（「いまはありません」）に移る。
    // まず画面が変わった読む所をもう一度読んで、また自動で直させる（偽物は、直しが外れていればまた直す）。
    await key('Escape');
    await key('Home');
    for (let k = 0; k < 4; k++) await key('ArrowDown');
    await key('Enter');
    await wait(900);
    await key('Escape');
    await key('End');
    await key('Enter');
    await wait(300);
    const maintUndo = await js("[...document.activeElement.closest('article.card').querySelectorAll('button')].findIndex((b) => b.textContent === '「画面が変わった読む所」を直す前に戻す')");
    await js(`document.activeElement.closest('article.card').querySelectorAll('button')[${maintUndo}].focus()`);
    await js('document.activeElement.click()');
    await wait(300);
    const afterMaintUndo = await focusState();
    const maintFirst = await js("(() => { const a = document.activeElement; const c = a.closest('article.card'); return Boolean(c) && c.querySelector('[data-item]') === a; })()");
    const fixedCardItems = await js("[...document.querySelectorAll('#deck > article.card')[4].querySelectorAll('[data-item]')].map((n) => n.textContent)");
    check('支援者向けのカードで直す前に戻すと、焦点はそのカードの中の最初の項目に移り、読む所のカードから戻すボタンが消える',
      maintUndo >= 0 && afterMaintUndo.connected && maintFirst && afterMaintUndo.text === '自動で直した場所は、いまはありません。'
        && afterMaintUndo.heading === '自動で直した場所（支援者向け）（0か所）' && !fixedCardItems.includes('直す前に戻す'),
      { maintUndo, afterMaintUndo, maintFirst, fixedCardItems });
    await key('Escape');
    const afterMaintEsc = await focusState();
    check('支援者向けのカードで戻した後に Esc を押すと、そのカードの上に戻る（束からは出ない）',
      afterMaintEsc.tag === 'ARTICLE' && afterMaintEsc.heading === '自動で直した場所（支援者向け）（0か所）', afterMaintEsc);
  } finally {
    win.destroy();
  }
}

// カードの画面で「新しいページからカードを作る」を、読み上げの操作（キー）だけで使う試し。cardsApi は偽物（test/renderer-preload.js）。
async function rendererGenerateChecks() {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { preload: path.join(__dirname, 'renderer-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  try {
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    const js = (code) => win.webContents.executeJavaScript(code);
    const wait = pageWait(win);
    for (let k = 0; k < 50 && (await js("document.querySelectorAll('#deck > article.card').length")) < 3; k++) await wait(50);
    const key = (k) => js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true }))`);
    const headings = () => js("[...document.querySelectorAll('#deck > article.card h2')].map((h) => h.textContent)");
    const status = () => js("document.getElementById('status').textContent");
    const alertSaid = () => js("document.getElementById('alert').textContent");
    const typeUrl = (v) => js(`(() => { const a = document.activeElement; a.value = ${JSON.stringify(v)}; a.dispatchEvent(new Event('input', { bubbles: true })); return a.tagName; })()`);
    const active = () => js(`(() => {
      const a = document.activeElement;
      const card = a && a.closest ? a.closest('article.card') : null;
      return { tag: a.tagName, text: a.textContent, value: a.value === undefined ? null : a.value,
        label: a.labels && a.labels[0] ? a.labels[0].textContent : null, connected: a.isConnected,
        heading: card ? card.querySelector('h2').textContent : null };
    })()`);

    const top = await headings();
    check('はじめの束に「新しいページからカードを作る」のカードがある（アプリが一つでも、はじめの束を出す）',
      JSON.stringify(top) === JSON.stringify(['Todoku', '表示設定', 'カードを探す', '試しのアプリ（作り物）', 'フォルダを作る', '新しいページからカードを作る']), top);

    await key('End');
    await key('Enter');
    const input = await active();
    check('作るカードの上で Enter を押すと、ラベル付きの URL の入力欄へ移る',
      input.tag === 'INPUT' && input.label === 'ページのURL（http か https で始まるもの）', input);

    await typeUrl('example.com');
    await key('Enter');
    await wait(150);
    const badSaid = await alertSaid();
    check('http か https で始まらない URL では作らず、「http:// か https:// で始まるページのURLを入れてください。」と知らせる',
      badSaid === 'http:// か https:// で始まるページのURLを入れてください。' && JSON.stringify(await js('window.fakeLog.generated()')) === '[]', badSaid);

    await typeUrl('https://example.com/fail');
    await key('Enter');
    await wait(400);
    const failSaid = await alertSaid();
    const afterFail = await active();
    const failItems = await js("[...document.querySelectorAll('#deck > article.card')[5].querySelectorAll('[data-item]')].map((n) => n.tagName + ':' + (n.value || n.textContent))");
    check('作れなかったときは、理由を一文で知らせ、理由の項目に焦点を移し、入れた URL を残した入力欄をもう一度出す',
      failSaid === 'ページを開けなかったので、カードを作れませんでした。' && afterFail.text === failSaid
        && failItems.includes('INPUT:https://example.com/fail'), { failSaid, afterFail, failItems });

    // Enter でなく、作り始めるボタンでも作れる。
    await key('End');
    const button = await active();
    await js("(() => { const i = document.activeElement.closest('article.card').querySelector('[data-input]'); i.value = 'https://example.com/town'; i.dispatchEvent(new Event('input', { bubbles: true })); })()");
    await js('document.activeElement.click()');
    await wait(150);
    const making = await active();
    check('作り始めるボタンを押すと、「カードを作っています。…」の項目に焦点が移り、見出しに（作っています）が付く',
      button.text === '作り始める' && making.connected && making.text.startsWith('カードを作っています。') && making.heading === '新しいページからカードを作る（作っています）', { button, making });
    await wait(700);
    const done = await active();
    const doneSaid = await status();
    const deckHeadings = await headings();
    check('作り終えたら、その束を開き、「「作り物の町のページ」のカードを2枚作りました。」と一度だけ知らせる',
      doneSaid === '「作り物の町のページ」のカードを2枚作りました。' && done.tag === 'ARTICLE' && done.heading === '作り物の町のページ'
        && JSON.stringify(deckHeadings) === JSON.stringify(['作り物の町のページ', '新着', '本文 1', 'このページのリンク', '名前・メモ・フォルダ']), { doneSaid, done, deckHeadings });

    await key('Enter');
    await key('End');
    const delButton = await active();
    await key('ArrowUp');
    const expButton = await active();
    await js('document.activeElement.click()');
    await wait(150);
    const expSaid = await status();
    check('作った束のはじめのカードに、書き出す（支援者向け）ボタンと消すボタンがあり、書き出すと知らせる',
      delButton.text === 'このアプリのカードを消す' && expButton.text === '設定ファイルとして書き出す（支援者向け）'
        && expSaid === 'ダウンロードのフォルダに「todoku-page-test.json」として書き出しました。支援者が確認してから、設定ファイルとして配ってください。'
        && JSON.stringify(await js('window.fakeLog.exported()')) === '["page-test"]', { delButton, expButton, expSaid });

    await key('Escape');
    await key('Escape');
    const back = await active();
    const topAfter = await headings();
    check('Esc ではじめの束へ戻ると、作った束の行き先のカードが足されていて、そこに焦点がある',
      back.heading === '作り物の町のページ' && JSON.stringify(topAfter) === JSON.stringify(['Todoku', '表示設定', 'カードを探す', '試しのアプリ（作り物）', '作り物の町のページ', 'フォルダを作る', '新しいページからカードを作る']), { back, topAfter });

    await key('Enter');
    await key('Enter');
    await key('End');
    await js('document.activeElement.click()');
    await wait(150);
    const delSaid = await status();
    const afterDel = await active();
    const topAfterDel = await headings();
    check('消すボタンで、束を消し、はじめの束の作るカードへ戻り、「「作り物の町のページ」のカードを消しました。」と知らせる',
      delSaid === '「作り物の町のページ」のカードを消しました。' && afterDel.heading === '新しいページからカードを作る'
        && JSON.stringify(topAfterDel) === JSON.stringify(['Todoku', '表示設定', 'カードを探す', '試しのアプリ（作り物）', 'フォルダを作る', '新しいページからカードを作る'])
        && JSON.stringify(await js('window.fakeLog.deleted()')) === '["page-test"]', { delSaid, afterDel, topAfterDel });

    // 欄の Enter で作り始めた直後に、焦点を移した先へ Enter が続けて届いても（押したままの繰り返し・読み上げソフトが続けて渡すもの）、
    // 「読み込み中です。少しお待ちください。」を言わない（2026-11-03 の Windows の確かめで一度出た）。
    await js(`(() => {
      window.__saidAll = [];
      for (const id of ['status', 'alert']) {
        const n = document.getElementById(id);
        new MutationObserver(() => { if (n.textContent) window.__saidAll.push(n.textContent); }).observe(n, { childList: true, characterData: true, subtree: true });
      }
      return true;
    })()`);
    await key('Enter');
    await typeUrl('https://example.com/town');
    await key('Enter');
    const afterEnter = await active();
    await js("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))");
    await js("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true }))");
    await wait(800);
    const saidAfterEnter = await js('window.__saidAll.slice()');
    check('作る欄の Enter で作り始めた直後に Enter が続けて届いても、「読み込み中です。少しお待ちください。」を言わず、作り終えたことを一度だけ言う',
      afterEnter.text.startsWith('カードを作っています。') && !saidAfterEnter.some((t) => t.startsWith('読み込み中です'))
        && saidAfterEnter.filter((t) => t === '「作り物の町のページ」のカードを2枚作りました。').length === 1, { afterEnter, saidAfterEnter });
  } finally {
    win.destroy();
  }
}

// カードの画面を、偽物の cardsApi（test/renderer-preload.js）と本物の表示設定の口で開く。読み上げの操作（キー）で動かすための道具を返す。
async function openRendererWindow(settingsStore) {
  const { attachZoomKeys } = require('../src/main/settings');
  const win = new BrowserWindow({
    show: false,
    // 隠した窓でもタイマーを間引かせない（知らせの欄に入る順と時を測るため）。
    webPreferences: { preload: path.join(__dirname, 'renderer-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  if (settingsStore) {
    attachZoomKeys(win.webContents, settingsStore, (message) => { if (!win.isDestroyed()) win.webContents.send('settings:zoom', { message }); });
  }
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  // 隠した窓でも、中身に焦点を渡す（:focus の見た目を測るため）。
  win.webContents.focus();
  const js = (code) => win.webContents.executeJavaScript(code);
  const wait = pageWait(win);
  for (let k = 0; k < 50 && (await js("document.querySelectorAll('#deck > article.card').length")) < 3; k++) await wait(50);
  const t = {
    win,
    js,
    wait,
    key: (k) => js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true }))`),
    headings: () => js("[...document.querySelectorAll('#deck > article.card h2')].map((h) => h.textContent)"),
    status: () => js("document.getElementById('status').textContent"),
    active: () => js(`(() => {
      const a = document.activeElement;
      const card = a && a.closest ? a.closest('article.card') : null;
      return { tag: a.tagName, text: a.textContent, value: a.value === undefined ? null : a.value,
        label: a.labels && a.labels[0] ? a.labels[0].textContent : null, connected: a.isConnected,
        pressed: a.getAttribute('aria-pressed'), expanded: a.getAttribute('aria-expanded'),
        heading: card ? card.querySelector('h2').textContent : null };
    })()`),
    // 知らせの欄に入った空でない文を、順に控える（一度だけ知らせたかを数えるため）。
    // 前の知らせ（50ミリ秒遅れて入る）が済むのを待ってから数え始める。
    watchSaid: async () => { await wait(150); return js(`(() => {
      window.__said = [];
      const s = document.getElementById('status');
      if (!window.__saidObserver) {
        window.__saidObserver = new MutationObserver(() => { if (s.textContent) window.__said.push(s.textContent); });
        window.__saidObserver.observe(s, { childList: true, characterData: true, subtree: true });
      }
      return true;
    })()`); },
    said: () => js('window.__said.slice()'),
    dataset: () => js('({ ...document.documentElement.dataset })'),
    type: (v) => js(`(() => { const a = document.activeElement; a.value = ${JSON.stringify(v)}; a.dispatchEvent(new Event('input', { bubbles: true })); return a.tagName; })()`),
  };
  return t;
}

// 表示設定: 読み上げの操作だけで開き、変え、変えたら一度だけ知らせ、次に開いた窓（起動し直し）でも残る。
async function rendererSettingsChecks(settingsStore, settingsFile) {
  let t = await openRendererWindow(settingsStore);
  try {
    const visibleItems = () => t.js("[...document.activeElement.closest('article.card').querySelectorAll('[data-item]')].filter((n) => !n.closest('[hidden]')).length");
    await t.key('ArrowDown');
    const card = await t.active();
    await t.key('Enter');
    const toggle = await t.active();
    const shown = await visibleItems();
    await t.key('ArrowDown');
    const still = await t.active();
    check('表示設定: 二枚目のカードで、中はふだん「表示設定を開く」の1行だけ（畳んだ項目は下矢印キーでも選ばれない）',
      card.tag === 'ARTICLE' && card.heading === '表示設定' && toggle.tag === 'BUTTON' && toggle.text === '表示設定を開く'
        && toggle.expanded === 'false' && shown === 1 && still.text === '表示設定を開く', { card, toggle, shown, still });

    await t.js('document.activeElement.click()');
    const opened = await t.active();
    const labels = await t.js("[...document.activeElement.closest('article.card').querySelectorAll('[data-item]')].filter((n) => !n.closest('[hidden]')).map((n) => n.textContent)");
    check('表示設定: 開くと aria-expanded が true になり、読みやすさ・1列リフロー表示・配色・標準に戻すが並ぶ',
      opened.expanded === 'true' && opened.text === '表示設定を開く'
        && ['標準、選択中', 'ゆったり', '1列リフロー表示: 無効', '標準（配色変更なし）、選択中', '高コントラスト（白地）', '高コントラスト（黒地）', '表示設定を標準に戻す']
          .every((x) => labels.includes(x)), labels);

    // ゆったり
    await t.key('ArrowDown');
    await t.key('ArrowDown');
    const standard = await t.active();
    await t.key('ArrowDown');
    await t.watchSaid();
    await t.js('document.activeElement.click()');
    await t.wait(250);
    const yuttari = await t.active();
    const saidYuttari = await t.said();
    const dsYuttari = await t.dataset();
    const spacing = await t.js("getComputedStyle(document.body).letterSpacing");
    check('表示設定: 「ゆったり」を押すと、「読みやすさを「ゆったり」にしました。1列リフロー表示を有効にしました。」と一度だけ知らせ、ボタンは「ゆったり、選択中」で焦点はそのまま',
      standard.text === '標準、選択中' && standard.pressed === 'true'
        && JSON.stringify(saidYuttari) === JSON.stringify(['読みやすさを「ゆったり」にしました。1列リフロー表示を有効にしました。'])
        && yuttari.connected && yuttari.text === 'ゆったり、選択中' && yuttari.pressed === 'true'
        && dsYuttari.preset === 'yuttari' && dsYuttari.reflow === 'on' && spacing !== 'normal' && spacing !== '0px',
      { standard, saidYuttari, yuttari, dsYuttari, spacing });

    // 黒地
    for (let k = 0; k < 15; k++) {
      if ((await t.active()).text.startsWith('高コントラスト（黒地）')) break;
      await t.key('ArrowDown');
    }
    await t.watchSaid();
    await t.js('document.activeElement.click()');
    await t.wait(250);
    const black = await t.active();
    const saidBlack = await t.said();
    const blackColors = await t.js(`(() => {
      const a = document.activeElement;
      return { page: getComputedStyle(document.documentElement).backgroundColor, button: getComputedStyle(a).backgroundColor, buttonText: getComputedStyle(a).color };
    })()`);
    await t.key('ArrowDown');
    const note = await t.js("(() => { const a = document.activeElement; return { text: a.textContent, bg: getComputedStyle(a).backgroundColor, color: getComputedStyle(a).color }; })()");
    check('表示設定: 「高コントラスト（黒地）」を押すと「配色を「高コントラスト（黒地）」にしました。」と一度だけ知らせ、地は黒・選ばれているボタンは黄色に黒い文字',
      JSON.stringify(saidBlack) === JSON.stringify(['配色を「高コントラスト（黒地）」にしました。'])
        && black.text === '高コントラスト（黒地）、選択中' && black.pressed === 'true' && (await t.dataset()).scheme === 'black'
        && blackColors.page === 'rgb(0, 0, 0)' && blackColors.button === 'rgb(255, 255, 0)' && blackColors.buttonText === 'rgb(0, 0, 0)',
      { saidBlack, black, blackColors });
    check('表示設定: 黒地でフォーカス中の注釈は、黄色の背景に黒い文字（明るい灰色のまま載せない）',
      note.text.startsWith('OSで強制配色') && note.bg === 'rgb(255, 255, 0)' && note.color === 'rgb(0, 0, 0)', note);

    await t.wait(200);
    const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    check('表示設定: userData の settings.json に、読みやすさ・1列リフロー表示・配色を書いた',
      saved.preset === 'yuttari' && saved.reflow === true && saved.scheme === 'black', saved);

    // 文字の大きさ: Ctrl（macOS は Command）とプラスで拡大し、一度だけ知らせる。
    await t.watchSaid();
    t.win.webContents.sendInputEvent({ type: 'keyDown', keyCode: '=', modifiers: [process.platform === 'darwin' ? 'meta' : 'control'] });
    await t.wait(400);
    const zoomSaid = await t.said();
    check('文字の大きさ: Ctrl（macOS は Command）とプラスで 110% にし、「文字の大きさを110%にしました。」と一度だけ知らせる',
      t.win.webContents.getZoomFactor() === 1.1 && JSON.stringify(zoomSaid) === JSON.stringify(['文字の大きさを110%にしました。']),
      { zoom: t.win.webContents.getZoomFactor(), zoomSaid });

    // 起動し直し: 窓を閉じて、同じ置き場で開き直す。
    t.win.destroy();
    t = await openRendererWindow(settingsStore);
    const dsAgain = await t.dataset();
    await t.key('ArrowDown');
    await t.key('Enter');
    await t.js('document.activeElement.click()');
    const labelsAgain = await t.js("[...document.activeElement.closest('article.card').querySelectorAll('button')].map((b) => b.textContent + ':' + b.getAttribute('aria-pressed'))");
    await t.wait(100);
    check('表示設定: 起動し直しても、ゆったり・1列リフロー表示・黒地が残り、ボタンの文字と押された状態も合う',
      dsAgain.preset === 'yuttari' && dsAgain.reflow === 'on' && dsAgain.scheme === 'black'
        && labelsAgain.includes('ゆったり、選択中:true') && labelsAgain.includes('1列リフロー表示: 有効:true')
        && labelsAgain.includes('高コントラスト（黒地）、選択中:true') && labelsAgain.includes('標準（配色変更なし）:false'),
      { dsAgain, labelsAgain });
    check('文字の大きさ: 起動し直しても 110% が残る', t.win.webContents.getZoomFactor() === 1.1, t.win.webContents.getZoomFactor());

    // 標準に戻す（カードの中の最後の項目）。
    await t.key('End');
    const reset = await t.active();
    await t.watchSaid();
    await t.js('document.activeElement.click()');
    await t.wait(250);
    const saidReset = await t.said();
    const dsReset = await t.dataset();
    const savedReset = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    check('表示設定: 「表示設定を標準に戻す」で三つとも標準に戻し、「表示設定を標準に戻しました。続けて文字の大きさも、必要に応じて調整してください。」と一度だけ知らせる（文字の大きさは戻さない）',
      reset.text === '表示設定を標準に戻す'
        && JSON.stringify(saidReset) === JSON.stringify(['表示設定を標準に戻しました。続けて文字の大きさも、必要に応じて調整してください。'])
        && dsReset.preset === 'standard' && dsReset.reflow === 'off' && dsReset.scheme === 'standard'
        && savedReset.preset === 'standard' && savedReset.reflow === false && savedReset.scheme === 'standard' && savedReset.zoom === 1.1,
      { reset, saidReset, dsReset, savedReset });

    // 閉じる: Home で「表示設定を開く」へ戻り、押すと畳む。Esc でカードへ。
    await t.key('Home');
    await t.js('document.activeElement.click()');
    const closed = await t.active();
    const shownClosed = await visibleItems();
    await t.key('Escape');
    const back = await t.active();
    check('表示設定: もう一度押すと畳み（aria-expanded が false・中は1行）、Esc でカードへ戻る',
      closed.expanded === 'false' && shownClosed === 1 && back.tag === 'ARTICLE' && back.heading === '表示設定', { closed, shownClosed, back });
  } finally {
    t.win.destroy();
  }
}

// 探す欄: 題と説明から全部の束のカードを探し、当たった数を知らせ、見つかったカードへ移れる。0件も知らせる。キーだけで入り・出られる。
async function rendererSearchChecks(settingsStore) {
  const t = await openRendererWindow(settingsStore);
  try {
    await t.key('ArrowDown');
    await t.key('ArrowDown');
    const card = await t.active();
    const described = await t.js("(() => { const c = document.activeElement; const id = c.getAttribute('aria-describedby'); return id ? document.getElementById(id).textContent : null; })()");
    const searchTexts = await t.js("[...document.activeElement.querySelectorAll('p[data-item]')].map((n) => n.textContent)");
    await t.key('Enter');
    const input = await t.active();
    check('探す欄: 三枚目のカード「カードを探す」で、Enter でラベル「探す言葉」の欄へ移る（カードを選ぶと何を探すかも読む）',
      card.heading === 'カードを探す' && described === 'タイトルと説明から、全部のアプリのカードを探します。'
        && input.tag === 'INPUT' && input.label === '探す言葉', { card, described, input });
    check('探す欄: 説明の項目に、欄の中で Enter キーを押すと何が起きるかの一文がある',
      searchTexts.includes('欄の中でEnterキーを押すと、最初に見つかったカードへ移ります。'), searchTexts);

    // 打つたびに絞り込む。続けて打っても、数は打ち終えてから一度だけ知らせる。
    await t.watchSaid();
    await t.type('すぐ');
    await t.wait(100);
    await t.type('すぐ返る');
    await t.wait(700);
    const said = await t.said();
    const heads = await t.headings();
    const stay = await t.active();
    const countText = await t.js("document.querySelector('[data-search-count]').textContent");
    check('探す欄: 「すぐ返る」で「2件見つかりました。」と一度だけ知らせ、探す欄のすぐ後に、アプリの名前と件数の見出しのカードが出る',
      JSON.stringify(said) === JSON.stringify(['2件見つかりました。']) && countText === '2件見つかりました。'
        && JSON.stringify(heads) === JSON.stringify(['Todoku', '表示設定', 'カードを探す', '「試しのアプリ（作り物）」で見つかったカード（2件）', '試しのアプリ（作り物）', 'フォルダを作る', '新しいページからカードを作る']),
      { said, heads, countText });
    check('探す欄: 打っている間、焦点は欄から動かない', stay.tag === 'INPUT' && stay.connected && stay.value === 'すぐ返る', stay);

    // 出る: Esc で探す欄のカードへ戻り、下矢印キーで見つかったカードへ。
    await t.key('Escape');
    const out = await t.active();
    await t.key('ArrowDown');
    const result = await t.active();
    await t.wait(100);
    const pos = await t.status();
    check('探す欄: Esc で「カードを探す」のカードへ戻り、下矢印キーで見つかったカードへ移る（「7枚中4枚目」）',
      out.tag === 'ARTICLE' && out.heading === 'カードを探す' && result.tag === 'ARTICLE'
        && result.heading === '「試しのアプリ（作り物）」で見つかったカード（2件）' && pos === '7枚中4枚目', { out, result, pos });

    // 移る: 見つかったカードの中のボタンで、そのアプリの束のそのカードへ。
    await t.key('Enter');
    const first = await t.active();
    await t.key('ArrowDown');
    const second = await t.active();
    await t.js('document.activeElement.click()');
    await t.wait(150);
    const moved = await t.active();
    const movedPos = await t.status();
    check('探す欄: 見つかったカードの中は「「アプリの名前」の「〇〇」へ移る」のボタンで、押すとそのアプリの束のそのカードへ移り、位置を知らせる',
      first.text === '「試しのアプリ（作り物）」の「すぐ返る読む所」へ移る' && second.text === '「試しのアプリ（作り物）」の「すぐ返る一覧」へ移る'
        && moved.tag === 'ARTICLE' && moved.heading === 'すぐ返る一覧' && movedPos === '9枚中3枚目', { first, second, moved, movedPos });
    await t.key('Escape');
    await t.wait(100);
    const backTop = await t.active();
    check('探す欄: 移った先で Esc を押すと、はじめの束の見つかったカードへ戻る（探した結果は残る）',
      backTop.tag === 'ARTICLE' && backTop.heading === '「試しのアプリ（作り物）」で見つかったカード（2件）', backTop);

    // 0件
    await t.key('ArrowUp');
    await t.key('Enter');
    const again = await t.active();
    await t.watchSaid();
    await t.type('どこにも無い言葉');
    await t.wait(700);
    const saidNone = await t.said();
    const headsNone = await t.headings();
    const countNone = await t.js("document.querySelector('[data-search-count]').textContent");
    check('探す欄: 当たらないときは「見つかりませんでした。別の言い方でお試しください。」と知らせ、見つかったカードは出さない',
      again.tag === 'INPUT' && again.value === 'すぐ返る'
        && JSON.stringify(saidNone) === JSON.stringify(['見つかりませんでした。別の言い方でお試しください。'])
        && countNone === '見つかりませんでした。別の言い方でお試しください。'
        && JSON.stringify(headsNone) === JSON.stringify(['Todoku', '表示設定', 'カードを探す', '試しのアプリ（作り物）', 'フォルダを作る', '新しいページからカードを作る']),
      { again, saidNone, headsNone, countNone });

    // 日本語入力の変換を確定する Enter（isComposing が立つもの・keyCode 229 だけが来るもの）では移らない。
    await t.type('一覧');
    const imeEnter = (init) => t.js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', ${JSON.stringify({ key: 'Enter', bubbles: true, cancelable: true, ...init })}))`);
    await imeEnter({ isComposing: true });
    await imeEnter({ keyCode: 229 });
    await t.wait(150);
    const composing = await t.active();
    const keyCode229 = await t.js("new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229 }).keyCode");
    check('探す欄: 変換を確定する Enter（isComposing の付いたもの・keyCode 229 のもの）では、欄から移らない',
      composing.tag === 'INPUT' && composing.value === '一覧' && keyCode229 === 229, { composing, keyCode229 });

    // 欄の中の Enter で、最初の見つかったカードへ。
    // 「一覧」と打ってから 0.4秒で数を知らせる（打ち終えてからの知らせ）。それが済んでから数え始め、Enter の知らせだけを数える。
    await t.wait(600);
    await t.watchSaid();
    await t.key('Enter');
    await t.wait(150);
    const jumped = await t.active();
    const saidJump = await t.said();
    check('探す欄: 欄の中の Enter で、最初の見つかったカードへ移り、「1件見つかりました。7枚中4枚目」と知らせる',
      jumped.tag === 'ARTICLE' && jumped.heading === '「試しのアプリ（作り物）」で見つかったカード（1件）'
        && JSON.stringify(saidJump) === JSON.stringify(['1件見つかりました。7枚中4枚目']), { jumped, saidJump });

    // 消す: 欄を空にすると、見つかったカードは消え、数の文は始めの案内に戻る。
    await t.key('ArrowUp');
    await t.key('Enter');
    await t.type('');
    await t.wait(100);
    const headsEmpty = await t.headings();
    const countEmpty = await t.js("document.querySelector('[data-search-count]').textContent");
    await t.key('Escape');
    const outEmpty = await t.active();
    check('探す欄: 欄を空にすると見つかったカードが消え、Esc でカードへ戻れる',
      JSON.stringify(headsEmpty) === JSON.stringify(['Todoku', '表示設定', 'カードを探す', '試しのアプリ（作り物）', 'フォルダを作る', '新しいページからカードを作る'])
        && countEmpty === '探す言葉を入れると、ここに見つかった数が出ます。' && outEmpty.tag === 'ARTICLE' && outEmpty.heading === 'カードを探す',
      { headsEmpty, countEmpty, outEmpty });
  } finally {
    t.win.destroy();
  }
}

// 「このページのリンク」・リンクの行き先の確認（三つの選び方）・P キーと B キーと、はじめのカードのボタン（偽の cardsApi で。本物の Claude は呼ばない）。
async function rendererLinksChecks() {
  const t = await openRendererWindow(null);
  const pressLetter = (k) => t.js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, code: ${JSON.stringify(`Key${k.toUpperCase()}`)}, bubbles: true, cancelable: true }))`);
  const alertSaid = () => t.js("document.getElementById('alert').textContent");
  try {
    // はじめの束では、P キーと B キーは働かず、そう知らせる。
    await pressLetter('p');
    await t.wait(150);
    const topSaid = await t.status();
    check('P キー: はじめの束では「このキーは、アプリのカードを開いているときに使えます。」と知らせ、何も開かない',
      topSaid === 'このキーは、アプリのカードを開いているときに使えます。' && JSON.stringify(await t.js('window.fakeLog.revealed()')) === '[]', topSaid);

    for (let k = 0; k < 3; k++) await t.key('ArrowDown');
    await t.key('Enter');
    const info = await t.js(`(() => {
      const card = document.activeElement.closest('article.card');
      return { heading: card.querySelector('h2').textContent,
        texts: [...card.querySelectorAll('p[data-item]')].map((n) => n.textContent),
        buttons: [...card.querySelectorAll('button[data-item]')].map((b) => b.textContent + (b.getAttribute('aria-keyshortcuts') ? '/' + b.getAttribute('aria-keyshortcuts') : '')) };
    })()`);
    check('アプリのはじめのカード: P キーと B キーの説明があり、「元のページを表示する」（P）と「いまのページを既定のブラウザで開く」（B）のボタンがある',
      info.heading === '試しのアプリ（作り物）'
        && info.texts.includes('Pキーで、元のページを、そのままの見た目で表示します。元のページでEscキーを押すと、Todoku に戻ります。')
        && info.texts.includes('Bキーで、いまのページを既定のブラウザで開きます。')
        && JSON.stringify(info.buttons.slice(0, 2)) === JSON.stringify(['元のページを表示する/P', 'いまのページを既定のブラウザで開く/B'])
        && info.buttons[info.buttons.length - 1] === '出典のページを開く', info);

    await pressLetter('p');
    await t.wait(150);
    const revealSaid = await t.status();
    await pressLetter('B');
    await t.wait(150);
    const openSaid = await t.status();
    check('P キーで元のページを表示し、B キーでいまのページを既定のブラウザで開き、それぞれ知らせる',
      JSON.stringify(await t.js('window.fakeLog.revealed()')) === '["fake-app"]' && JSON.stringify(await t.js('window.fakeLog.pagesOpened()')) === '["fake-app"]'
        && revealSaid === '元のページを表示しました。元のページでEscキーを押すと、Todoku に戻ります。'
        && openSaid.startsWith('いまのページを、既定のブラウザで開きました。'), { revealSaid, openSaid });

    // 「このページのリンク」は束の最後から二枚目のカード（最後は「名前・メモ・フォルダ」）。中に入るとリンクを一件ずつ読む。
    await t.key('End');
    await t.key('ArrowUp');
    const linksCardHead = await t.active();
    await t.key('Enter');
    await t.wait(700);
    const firstLink = await t.active();
    const linkItems = await t.js("[...document.activeElement.closest('article.card').querySelectorAll('[data-item]')].map((n) => n.tagName + ':' + n.textContent)");
    check('「このページのリンク」: 束の最後のほうにあり、中に入ると、説明の一文の後にリンクを一件ずつ読み、最初の一件に焦点が移る',
      linksCardHead.heading === 'このページのリンク' && firstLink.tag === 'LI' && firstLink.text === '読めるページ（作り物）'
        && firstLink.heading === 'このページのリンク（3件）'
        && JSON.stringify(linkItems) === JSON.stringify(['P:一件を選んで Enter キーを押すと、そのページへ移ります。まだ読めないページは、開く前に確認します。',
          'LI:読めるページ（作り物）', 'LI:作り物の町のページ', 'LI:作れないページ（作り物）']), { linksCardHead, firstLink, linkItems });

    // 行き先に Todoku の束があれば、その束のそのカードへ移る。Esc でリンクのその一件に戻る。
    await t.key('Enter');
    await t.wait(150);
    const moved = await t.active();
    const movedSaid = await t.status();
    await t.key('Escape');
    const backToLink = await t.active();
    check('リンクの行き先に束があれば、その束のそのカードへ移って知らせ、Esc でリンクのその一件に戻る',
      moved.tag === 'ARTICLE' && moved.heading === 'すぐ返る一覧' && movedSaid === '「試しのアプリ（作り物）」のカードへ移りました。'
        && backToLink.tag === 'LI' && backToLink.text === '読めるページ（作り物）', { moved, movedSaid, backToLink });

    // 行き先に束が無ければ、確かめる（作って開く・既定のブラウザで開く・やめる）。
    await t.key('ArrowDown');
    await t.key('Enter');
    await t.wait(150);
    const ask = await t.active();
    const choices = await t.js("[...document.activeElement.closest('article.card').querySelectorAll('button[data-item]')].map((b) => b.textContent)");
    check('リンクの行き先に束が無ければ、「まだ Todoku で読めるようになっていません…90秒ほどかかります。」と告げ、三つから選ばせる',
      ask.tag === 'P' && ask.heading === '「作り物の町のページ」を開く'
        && ask.text === 'このページは、まだ Todoku で読めるようになっていません。これから Claude がカードを作ります。90秒ほどかかります。'
        && JSON.stringify(choices) === JSON.stringify(['カードを作って開く', '既定のブラウザで開く', 'やめる']), { ask, choices });

    await t.key('ArrowDown');
    await t.key('ArrowDown');
    await t.js('document.activeElement.click()');
    await t.wait(150);
    const extSaid = await t.status();
    check('確認の「既定のブラウザで開く」は、その一件を番号で頼んで開き、知らせる',
      JSON.stringify(await t.js('window.fakeLog.linksOpened()')) === '["fake-app/1"]' && extSaid === '「作り物の町のページ」のページを、既定のブラウザで開きました。', extSaid);

    await t.key('ArrowDown');
    await t.js('document.activeElement.click()');
    await t.wait(100);
    const cancelled = await t.active();
    check('確認の「やめる」で、リンクのその一件に戻る', cancelled.tag === 'LI' && cancelled.text === '作り物の町のページ', cancelled);

    // 「カードを作って開く」: 作る流れは「新しいページからカードを作る」と同じ。作れたら、確認の束の代わりに作った束を開く。
    await t.key('Enter');
    await t.wait(150);
    await t.key('ArrowDown');
    await t.js('document.activeElement.click()');
    await t.wait(150);
    const making = await t.active();
    await t.wait(800);
    const made = await t.active();
    const madeSaid = await t.status();
    check('確認の「カードを作って開く」で、そのリンクの URL から作り、「（作っています）」の後、作った束を開いて知らせる',
      making.text.startsWith('カードを作っています。') && making.heading === '「作り物の町のページ」を開く（作っています）'
        && made.tag === 'ARTICLE' && made.heading === '作り物の町のページ' && madeSaid === '「作り物の町のページ」のカードを2枚作りました。'
        && (await t.js('window.fakeLog.generated()')).includes('https://example.com/town'), { making, made, madeSaid });
    await t.key('Escape');
    const afterMade = await t.active();
    await t.key('Escape');
    await t.key('Escape');
    const top = await t.headings();
    check('作った束から Esc でリンクのその一件に戻り（確認の束は残らない）、はじめの束には作った束のカードが足される',
      afterMade.tag === 'LI' && afterMade.text === '作り物の町のページ'
        && JSON.stringify(top) === JSON.stringify(['Todoku', '表示設定', 'カードを探す', '試しのアプリ（作り物）', '作り物の町のページ', 'フォルダを作る', '新しいページからカードを作る']), { afterMade, top });
  } finally {
    t.win.destroy();
  }
}

// 最初のページのフォルダ・表示名・メモ（ブックマークのように使う）。操作は全部、カードの中の入力欄とボタンと、今までのキーだけ。
// 保存は本物の bookmarks.js の口（一時のフォルダの bookmarks.json）。開き直しても残ること・壊れたファイルでも開けることも確かめる。
async function rendererBookmarksChecks(bookmarksFile) {
  const fresh = ['Todoku', '表示設定', 'カードを探す', '試しのアプリ（作り物）', 'フォルダを作る', '新しいページからカードを作る'];
  let t = await openRendererWindow(null);
  const alertSaid = () => t.js("document.getElementById('alert').textContent");
  const said = async () => { await t.wait(150); return t.status(); };
  const items = () => t.js("[...document.activeElement.closest('article.card').querySelectorAll('[data-item]')].map((n) => n.tagName + ':' + (n.tagName === 'INPUT' ? n.labels[0].textContent + '=' + n.value : n.textContent))");
  try {
    check('フォルダ: はじめは、ページのカードの後に「フォルダを作る」のカードがある', JSON.stringify(await t.headings()) === JSON.stringify(fresh), await t.headings());

    // フォルダを作る: カードの上の Enter で名前の欄へ。名前を入れて Enter で作る。
    await t.key('End');
    await t.key('ArrowUp');
    await t.key('Enter');
    const field = await t.active();
    await t.type('天気');
    await t.key('Enter');
    const made = await said();
    const afterMade = await t.active();
    const headsMade = await t.headings();
    check('フォルダを作る: 名前の欄で Enter を押すと作り、「「天気」フォルダを作りました。」と知らせ、フォルダのカードを選ぶ',
      field.tag === 'INPUT' && field.label === '新しいフォルダの名前' && made === '「天気」フォルダを作りました。'
        && afterMade.tag === 'ARTICLE' && afterMade.heading === '天気（フォルダ）'
        && JSON.stringify(headsMade) === JSON.stringify(['Todoku', '表示設定', 'カードを探す', '天気（フォルダ）', '試しのアプリ（作り物）', 'フォルダを作る', '新しいページからカードを作る']),
      { field, made, afterMade, headsMade });

    // 同じ名前と空の名前は作らない。
    await t.key('ArrowDown');
    await t.key('ArrowDown');
    await t.key('Enter');
    await t.type('天気');
    await t.key('ArrowDown');
    await t.js('document.activeElement.click()');
    await t.wait(150);
    const dup = await alertSaid();
    await t.key('ArrowUp');
    await t.type('');
    await t.key('Enter');
    await t.wait(150);
    const empty = await alertSaid();
    check('フォルダを作る: 同じ名前は「「天気」フォルダは、もうあります。…」、空なら「フォルダの名前を入れてください。」と知らせ、作らない',
      dup === '「天気」フォルダは、もうあります。別の名前にしてください。' && empty === 'フォルダの名前を入れてください。'
        && (await t.headings()).filter((h) => h.endsWith('（フォルダ）')).length === 1, { dup, empty });

    // ページのカードの束の「名前・メモ・フォルダ」で、表示名とメモを付け、フォルダに入れる。
    await t.key('Escape');
    await t.key('ArrowUp');
    const page = await t.active();
    await t.key('Enter');
    await t.key('End');
    const organize = await t.active();
    await t.key('Enter');
    const organizeItems = await items();
    await t.key('ArrowDown');
    await t.type('よく見るアプリ');
    await t.key('ArrowDown');
    await t.type('毎朝見る');
    await t.key('ArrowDown');
    const saveButton = await t.active();
    await t.js('document.activeElement.click()');
    const noteSaid = await said();
    const afterSave = await t.active();
    check('名前とメモ: ページのカードの束の最後の「名前・メモ・フォルダ」で、表示名とメモを入れ、保存のボタンで「表示名を「…」にしました。メモを保存しました。」と知らせ、焦点はボタンのまま',
      page.heading === '試しのアプリ（作り物）' && organize.heading === '名前・メモ・フォルダ'
        && organizeItems[0] === 'P:最初のページでの、このページのカードの表示名とメモ、入れるフォルダを決めます。元の名前は「試しのアプリ（作り物）」です。'
        && organizeItems.includes('INPUT:表示名（空にすると元の名前に戻ります）=') && organizeItems.includes('INPUT:メモ=')
        && organizeItems.includes('P:いまは、どのフォルダにも入っていません。') && organizeItems.includes('BUTTON:「天気」フォルダに入れる')
        && saveButton.text === '表示名とメモを保存する' && noteSaid === '表示名を「よく見るアプリ」にしました。メモを保存しました。'
        && afterSave.tag === 'BUTTON' && afterSave.text === '表示名とメモを保存する', { page, organize, organizeItems, saveButton, noteSaid, afterSave });

    await t.key('ArrowDown');
    await t.key('ArrowDown');
    const intoButton = await t.active();
    await t.js('document.activeElement.click()');
    const intoSaid = await said();
    const afterInto = await t.active();
    const intoItems = await items();
    check('フォルダに入れる: 「「天気」フォルダに入れる」で、「「よく見るアプリ」を「天気」フォルダに入れました。」と知らせ、中の一文と出すボタンが変わる',
      intoButton.text === '「天気」フォルダに入れる' && intoSaid === '「よく見るアプリ」を「天気」フォルダに入れました。'
        && afterInto.text === '「天気」フォルダから出す' && intoItems.includes('P:いまは「天気」フォルダに入っています。'), { intoButton, intoSaid, afterInto, intoItems });

    // 最初のページへ戻ると、ページのカードはフォルダの中にあり、フォルダのカードを選んでいる。保存のファイルにも残る。
    await t.key('Escape');
    await t.key('Escape');
    const backTop = await t.active();
    const headsTop = await t.headings();
    const describe = await t.js("document.getElementById(document.activeElement.getAttribute('aria-describedby')).textContent");
    const onDisk = JSON.parse(fs.readFileSync(bookmarksFile, 'utf8'));
    check('最初のページ: フォルダに入れたページのカードは最初のページから消え、フォルダのカードに「ページのカードが1件入っています。」と出る。保存のファイルに残る',
      backTop.heading === '天気（フォルダ）'
        && JSON.stringify(headsTop) === JSON.stringify(['Todoku', '表示設定', 'カードを探す', '天気（フォルダ）', 'フォルダを作る', '新しいページからカードを作る'])
        && describe === 'ページのカードが1件入っています。スペースキーまたはEnterキーで、「天気」フォルダの中へ進みます。'
        && onDisk.folders.length === 1 && onDisk.folders[0].name === '天気'
        && JSON.stringify(onDisk.pages['fake-app']) === JSON.stringify({ folder: onDisk.folders[0].id, name: 'よく見るアプリ', memo: '毎朝見る' }),
      { backTop, headsTop, describe, onDisk });

    // フォルダの中へ。ページのカードは表示名で読み、説明の頭に元の名前、次にメモ。
    await t.key('Enter');
    const inFolder = await t.headings();
    await t.key('ArrowDown');
    const pageDescribe = await t.js("document.getElementById(document.activeElement.getAttribute('aria-describedby')).textContent");
    check('フォルダの中: 一枚目はフォルダのカード、その後にページのカード。ページのカードは表示名で読み、説明は元の名前・メモ・Enter キーの順',
      JSON.stringify(inFolder) === JSON.stringify(['「天気」フォルダ', 'よく見るアプリ'])
        && pageDescribe === '元の名前は「試しのアプリ（作り物）」です。メモ: 毎朝見る。スペースキーまたはEnterキーで、「よく見るアプリ」のカードへ進みます。',
      { inFolder, pageDescribe });

    // フォルダの名前を変える（フォルダの束の一枚目のカードで）。
    await t.key('ArrowUp');
    await t.key('Enter');
    await t.key('ArrowDown');
    const renameField = await t.active();
    await t.type('天気予報');
    await t.key('Enter');
    const renameSaid = await said();
    const renamed = await t.headings();
    check('フォルダの名前を変える: 「フォルダの名前」の欄で Enter を押すと、「フォルダの名前を「天気」から「天気予報」に変えました。」と知らせる',
      renameField.tag === 'INPUT' && renameField.label === 'フォルダの名前' && renameField.value === '天気'
        && renameSaid === 'フォルダの名前を「天気」から「天気予報」に変えました。' && renamed[0] === '「天気予報」フォルダ', { renameField, renameSaid, renamed });

    // 探す: 表示名とメモでも見つかる。
    await t.key('Escape');
    await t.key('Escape');
    await t.key('Home');
    await t.key('ArrowDown');
    await t.key('ArrowDown');
    await t.key('Enter');
    await t.type('毎朝');
    await t.wait(600);
    const found = await t.headings();
    await t.key('Enter');
    // 欄の Enter の直後の Enter は捨てる決まり（FIELD_ENTER_GUARD_MS）なので、少し待ってから見つかったカードの中へ。
    await t.wait(600);
    await t.key('Enter');
    const openButton = await t.active();
    t.win.destroy();

    // 開き直しても残る。
    t = await openRendererWindow(null);
    const reopened = await t.headings();
    check('探す: メモの言葉で、表示名の見出しの見つかったカードが出て、中に「「よく見るアプリ」のカードを開く」ボタンがある。開き直してもフォルダと表示名が残る',
      found.includes('「よく見るアプリ」で見つかったカード（1件）') && openButton.text === '「よく見るアプリ」のカードを開く'
        && JSON.stringify(reopened) === JSON.stringify(['Todoku', '表示設定', 'カードを探す', '天気予報（フォルダ）', 'フォルダを作る', '新しいページからカードを作る']),
      { found, openButton, reopened });

    // フォルダを消す: 中のページのカードは最初のページに戻る。
    for (let k = 0; k < 3; k++) await t.key('ArrowDown');
    await t.key('Enter');
    await t.key('Enter');
    await t.key('End');
    const delButton = await t.active();
    await t.js('document.activeElement.click()');
    const delSaid = await said();
    const afterDel = await t.active();
    const headsDel = await t.headings();
    check('フォルダを消す: 「「天気予報」フォルダを消しました。中のページのカード1件は、最初のページに戻しました。」と知らせ、戻したページのカードを選ぶ',
      delButton.text === 'このフォルダを消す（中のページのカードは最初のページに戻ります）'
        && delSaid === '「天気予報」フォルダを消しました。中のページのカード1件は、最初のページに戻しました。'
        && afterDel.heading === 'よく見るアプリ'
        && JSON.stringify(headsDel) === JSON.stringify(['Todoku', '表示設定', 'カードを探す', 'よく見るアプリ', 'フォルダを作る', '新しいページからカードを作る'])
        && JSON.parse(fs.readFileSync(bookmarksFile, 'utf8')).folders.length === 0, { delButton, delSaid, afterDel, headsDel });

    // 表示名とメモを空にして保存すると、元の名前に戻る。
    await t.key('Enter');
    await t.key('End');
    await t.key('Enter');
    await t.key('ArrowDown');
    await t.type('');
    await t.key('ArrowDown');
    await t.type('');
    await t.key('Enter');
    const clearSaid = await said();
    await t.key('Escape');
    await t.key('Escape');
    const cleared = await t.headings();
    check('名前とメモ: 空にして保存すると「表示名を外し、元の名前「…」に戻しました。メモを消しました。」と知らせ、元の名前に戻る',
      clearSaid === '表示名を外し、元の名前「試しのアプリ（作り物）」に戻しました。メモを消しました。' && JSON.stringify(cleared) === JSON.stringify(fresh),
      { clearSaid, cleared });
    t.win.destroy();

    // 保存のファイルが壊れていても開ける（フォルダも表示名も無いものとして）。
    fs.writeFileSync(bookmarksFile, 'こわれた{');
    t = await openRendererWindow(null);
    const broken = await t.headings();
    check('保存のファイルが壊れていても、最初のページを開ける（フォルダも表示名も無いものとして）', JSON.stringify(broken) === JSON.stringify(fresh), broken);
  } finally {
    t.win.destroy();
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
