'use strict';
// 画面の文（renderer.js）を文字として読み、読み込み中の言い方を確かめる。
// renderer.js はブラウザの中で動くので、ここでは動かさずに中身の文を見る。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'renderer.js'), 'utf8');
const readCardBody = source.slice(source.indexOf('async function readCard('), source.indexOf('function unreadableText('));

test('読み込み中に同じことを3回言わない（「〇〇を読んでいます。」の知らせは出さない）', () => {
  assert.ok(readCardBody.length > 0);
  assert.doesNotMatch(readCardBody, /announce\(`「\$\{card\.title\}」を読んでいます。`\)/);
  // 状態を文字で持つ決まりの分（aria-busy・見出しの「（読んでいます）」・項目の「読んでいます。」）は残す。
  assert.match(readCardBody, /setAttribute\('aria-busy', 'true'\)/);
  assert.match(readCardBody, /（読んでいます）/);
  assert.match(readCardBody, /text: '読んでいます。/);
  // 5秒ごとの知らせと、読み終えた・読めなかったの知らせも残す。
  assert.match(readCardBody, /を読み始めて、\$\{sec\}秒たちました。/);
  assert.match(readCardBody, /を読みました。/);
  assert.match(readCardBody, /を読めませんでした。/);
});

test('書いている途中までを読んだとき（partial）は、カードの最後の一文と知らせの両方で、途中だと言う', () => {
  assert.match(readCardBody, /if \(result\.partial\) card\.items\.push\(\{ text: 'まだ書いている途中でした。ここまでを読みました。もう一度読むと、続きが読めます。' \}\)/);
  assert.match(readCardBody, /result\.partial \? 'まだ書いている途中です。' : ''/);
});

test('読めなかった理由: ログインの画面を開けなかったときと、主の処理の誤り（where が「(なし)」・「動かせませんでした」）を、画面が変わったときと分ける', () => {
  const body = source.slice(source.indexOf('function unreadableText('), source.indexOf('function unreadableText(') + 2000);
  assert.match(body, /startsWith\('ログインの画面を開けませんでした'\)\) return 'ログインの画面を開けませんでした。/);
  assert.match(body, /result\.where === '\(なし\)' \|\| message\.startsWith\('動かせませんでした'\)\) return 'うまく動きませんでした。\\nもう一度押してください。'/);
});

test('0件のときは、見出し「〇〇（0件）」と中の一文を出す', () => {
  assert.match(readCardBody, /\(count === 0\)/);
  assert.match(readCardBody, /（0件）/);
  assert.match(readCardBody, /このカードの中には、読む項目がありません。/);
});

test('list のカードで 0件のときは「「〇〇」は0件でした。」と知らせる', () => {
  assert.match(readCardBody, /count === 0 \? `「\$\{card\.title\}」は0件でした。`/);
  assert.doesNotMatch(readCardBody, /から0件読みました/);
  assert.match(readCardBody, /から\$\{count\}件読みました。/);
});

test('設定ファイルの頭の description は、アプリのはじめのカードの項目になる', () => {
  const appDeckBody = source.slice(source.indexOf('function appDeck('), source.indexOf('function topDeck('));
  assert.match(appDeckBody, /texts\.push\(endSentence\(config\.description\)\)/);
});

test('出典のページ（sourceUrl）があれば、はじめのカードに「出典のページを開く」ボタンを置き、URL は読ませない', () => {
  const appDeckBody = source.slice(source.indexOf('function appDeck('), source.indexOf('function topDeck('));
  assert.match(appDeckBody, /button: '出典のページを開く'/);
  assert.match(appDeckBody, /window\.cardsApi\.openSource\(config\.id\)/);
  assert.doesNotMatch(appDeckBody, /texts\.push\([^)]*sourceUrl/);
});

test('押した結果のダウンロードは、保存したか（できなかったか）を知らせる', () => {
  assert.match(source, /if \(r\.ok && r\.download\) announce\(r\.download\.message, !r\.download\.ok\)/);
  assert.match(source, /onDownloadDone\(\(r\) => announce\(r\.message, !r\.ok\)\)/);
});

test('押すカードを自動で直したときは押し直さず、もう一度押すかを使う人に任せる知らせを出す', () => {
  assert.match(source, /ページが変わったので、押す場所を直しました。もう一度押すときは、「\$\{card\.title\}」を押すボタンを押してください。/);
  assert.match(source, /ページが変わったので、押す場所を直しています。少しお待ちください。/);
  // 押せなかったときも、読めないときと同じ一文（理由つき）を足す。
  assert.match(source, /r\.autoRepairFailed \? `。\$\{notFixedSentence\(r\)\}` : ''/);
  assert.doesNotMatch(source, /自動で直せませんでした。/);
});

// renderer.js の unreadableText と notFixedSentence を取り出して動かす（DOM を使わない関数だけ）。
function loadTextFunctions() {
  const start = source.indexOf('function unreadableText(');
  const end = source.indexOf('// ---- 押すカード');
  // eslint-disable-next-line no-new-func
  return new Function(`${source.slice(start, end)}; return { unreadableText, notFixedSentence };`)();
}

test('読めないときの文: 見つからない → 0件のことも → 自動で直すこともできなかった（理由）、の順にする', () => {
  const { unreadableText } = loadTextFunctions();
  const failed = { ok: false, message: 'ページの中に読む場所が見つかりません', autoRepairFailed: true, autoRepairReasonText: 'Claude の API キーがありません' };
  assert.equal(unreadableText({ action: 'list' }, failed),
    'ページが変わったため、読む場所が見つかりませんでした。\n本当に0件の場合もあります。\n自動で直すこともできませんでした（Claude の API キーがありません）。');
  assert.equal(unreadableText({ action: 'read' }, { ...failed, autoRepairReasonText: '時間内に終わりませんでした' }),
    'ページが変わったため、読む場所が見つかりませんでした。\n自動で直すこともできませんでした（時間内に終わりませんでした）。');
  // 理由の言い方が無ければ、括弧を付けない。
  assert.equal(unreadableText({ action: 'read' }, { ...failed, autoRepairReasonText: '' }),
    'ページが変わったため、読む場所が見つかりませんでした。\n自動で直すこともできませんでした。');
  // 自動で直そうとしなかったときは、今までどおり。
  assert.equal(unreadableText({ action: 'list' }, { ok: false, message: 'ページの中に読む場所が見つかりません' }),
    'ページが変わったため、読む場所が見つかりませんでした。\n本当に0件の場合もあります。');
  assert.equal(unreadableText({ action: 'list', hasContainer: true }, failed),
    'ページが変わったため、読む場所が見つかりませんでした。\n自動で直すこともできませんでした（Claude の API キーがありません）。');
});

test('「直す前に戻す」の後は、焦点をカードの中の最初の項目に置く（カードの上に戻さない）', () => {
  const body = source.slice(source.indexOf('async function undoRepair('), source.indexOf('function pushDeck('));
  assert.match(body, /refreshCard\(card, \{ focusFirst: true \}\)/);
});

// ---- 探す欄（文字だけの関数）----
function loadSearchFunctions() {
  const start = source.indexOf('// ---- 探す（文字だけの関数）----');
  const end = source.indexOf('// ---- 探す欄 ----');
  assert.ok(start >= 0 && end > start);
  // eslint-disable-next-line no-new-func
  return new Function(`${source.slice(start, end)}; return { normalizeForSearch, searchCards, searchCountText };`)();
}

const searchConfigs = [
  { id: 'a', name: '作り物の学習サイト', cards: [
    { id: 'a1', title: '次の締め切り', description: '課題の締め切りを読みます' },
    { id: 'a2', title: 'お知らせ', description: '先生からのお知らせ' },
    { id: 'a3', title: 'ファイルをダウンロード' },
  ] },
  { id: 'b', name: '作り物の町', cards: [
    { id: 'b1', title: 'ごみの日', description: 'ゴミの収集日の表' },
    { id: 'b2', title: 'お知らせ 1' },
  ] },
  { id: 'c', name: '当たらないアプリ', cards: [{ id: 'c1', title: '天気' }] },
];

test('探す: 題と説明から探し、当たらないアプリは入れない', () => {
  const { searchCards } = loadSearchFunctions();
  const r = searchCards(searchConfigs, 'お知らせ');
  assert.deepEqual(r.map((g) => [g.config.id, g.matches.map((c) => c.id)]), [['a', ['a2']], ['b', ['b2']]]);
  // 説明だけに当たる言葉でも見つかる。
  assert.deepEqual(searchCards(searchConfigs, '課題').map((g) => g.matches.map((c) => c.id)), [['a1']]);
  assert.deepEqual(searchCards(searchConfigs, '見つからない言葉'), []);
  assert.deepEqual(searchCards(searchConfigs, '   '), []);
});

test('探す: 全角と半角、大文字と小文字、ひらがなとカタカナを区別せず、空白で区切ると全部を含むものだけ', () => {
  const { searchCards, normalizeForSearch } = loadSearchFunctions();
  assert.equal(normalizeForSearch('ＡＢＣ　ゴミ'), 'abc ごみ');
  // 「ごみ」で「ゴミ」（説明）と「ごみ」（題）の両方に当たる。カタカナの「ダウンロード」もひらがなで当たる。
  assert.deepEqual(searchCards(searchConfigs, 'ゴミ').map((g) => g.matches.map((c) => c.id)), [['b1']]);
  assert.deepEqual(searchCards(searchConfigs, 'だうんろーど').map((g) => g.matches.map((c) => c.id)), [['a3']]);
  assert.deepEqual(searchCards(searchConfigs, 'お知らせ　１').map((g) => g.matches.map((c) => c.id)), [['b2']]);
  assert.deepEqual(searchCards(searchConfigs, '締め切り 天気'), []);
});

test('探す: 見つかった数の文（0件も黙らない）', () => {
  const { searchCountText } = loadSearchFunctions();
  assert.equal(searchCountText('お知らせ', 3), '3件見つかりました。');
  assert.equal(searchCountText('お知らせ', 1), '1件見つかりました。');
  assert.equal(searchCountText('無い言葉', 0), '見つかりませんでした。別の言い方でお試しください。');
  assert.equal(searchCountText('  ', 0), '探す言葉を入れると、ここに見つかった数が出ます。');
});

// ---- 表示設定（DOM の代わりに data-* を受ける入れ物を渡す）----
function loadSettingFunctions() {
  const start = source.indexOf('const SETTINGS_HEADING');
  const end = source.indexOf('function settingsItems(');
  assert.ok(start >= 0 && end > start);
  const fakeDocument = { documentElement: { dataset: {} } };
  // eslint-disable-next-line no-new-func
  const f = new Function('document', `${source.slice(start, end)}; return { applySettings, settingButton, view: () => view };`)(fakeDocument);
  return { ...f, dataset: fakeDocument.documentElement.dataset };
}

test('表示設定: 知らない値は標準に戻し、html の data-* に当てる', () => {
  const { applySettings, view, dataset } = loadSettingFunctions();
  applySettings({ preset: 'yuttari', reflow: true, scheme: 'black' });
  assert.deepEqual(view(), { preset: 'yuttari', reflow: true, scheme: 'black' });
  assert.deepEqual({ ...dataset }, { preset: 'yuttari', reflow: 'on', scheme: 'black' });
  applySettings({ preset: 'big', reflow: 'yes', scheme: 'pink' });
  assert.deepEqual({ ...dataset }, { preset: 'standard', reflow: 'off', scheme: 'standard' });
});

test('表示設定: ボタンの文字にいまの状態を入れる（「、選択中」「: 有効」）', () => {
  const { applySettings, settingButton } = loadSettingFunctions();
  applySettings({ preset: 'standard', reflow: false, scheme: 'white' });
  assert.deepEqual(settingButton('preset:standard'), { text: '標準、選択中', pressed: true });
  assert.deepEqual(settingButton('preset:yuttari'), { text: 'ゆったり', pressed: false });
  assert.deepEqual(settingButton('reflow'), { text: '1列リフロー表示: 無効', pressed: false });
  assert.deepEqual(settingButton('scheme:standard'), { text: '標準（配色変更なし）', pressed: false });
  assert.deepEqual(settingButton('scheme:white'), { text: '高コントラスト（白地）、選択中', pressed: true });
  applySettings({ preset: 'yuttari', reflow: true, scheme: 'black' });
  assert.deepEqual(settingButton('reflow'), { text: '1列リフロー表示: 有効', pressed: true });
  assert.deepEqual(settingButton('scheme:black'), { text: '高コントラスト（黒地）、選択中', pressed: true });
});

test('表示設定: 変えたときの知らせは「何をしたか」を一文で（名前は「」で囲む）', () => {
  assert.match(source, /`読みやすさを「\$\{PRESET_LABELS\[preset\]\}」にしました。\$\{more\}`/);
  assert.match(source, /`1列リフロー表示を\$\{reflow \? '有効' : '無効'\}にしました。`/);
  assert.match(source, /`配色を「\$\{SCHEME_LABELS\[scheme\]\}」にしました。`/);
  assert.match(source, /'表示設定を標準に戻しました。続けて文字の大きさも、必要に応じて調整してください。'/);
});

test('はじめのカードの案内に、NVDA と並べて Mac の VoiceOver の使い方を一文で入れる（キーの名前は Apple の言い方）', () => {
  const readers = source.slice(source.indexOf('const READER_TEXTS = ['), source.indexOf('function sentences('));
  assert.match(readers, /'NVDAでは、/);
  assert.match(readers, /'MacのVoiceOverでは、左矢印キーと右矢印キーを同時に押してクイックナビをオフにすると、上下矢印キーでカードを選べます。'/);
  const topDeckBody = source.slice(source.indexOf('function topDeck('));
  assert.match(topDeckBody, /\.\.\.READER_TEXTS,/);
});

test('束に入ったら窓の題を「Todoku - 束の題」にし、一番上の束では「Todoku」に戻す（h1 は変えない）', () => {
  const body = source.slice(source.indexOf('function renderDeck('), source.indexOf('function cardNodes('));
  assert.match(body, /document\.title = stack\.length > 1 && deck\.name \? `\$\{APP_NAME\} - \$\{deck\.name\}` : APP_NAME;/);
  assert.doesNotMatch(body, /page-title/);
});

test('押すカード: 「押しています。」は 0.5秒（読み込み中と同じ待ち）たっても終わらないときだけ出し、終わったら出さない', () => {
  const body = source.slice(source.indexOf('function showClickConfirm('), source.indexOf("const MAINT_HEADING"));
  const timer = body.match(/const pressingTimer = setTimeout\(\(\) => \{([\s\S]*?)\}, LOADING_DELAY_MS\);/);
  assert.ok(timer, '押しているの知らせが、待ちの中に無い');
  assert.match(timer[1], /announce\(`「\$\{card\.title\}」を押しています。`\);/);
  assert.match(timer[1], /button\.textContent = `「\$\{card\.title\}」を押す（押しています）`;/);
  // 待ちの外では「押しています。」を出さない。
  assert.equal(body.split('を押しています。').length - 1, 1);
  assert.match(body, /\} finally \{\s+clearTimeout\(pressingTimer\);/);
  // 言い回しは変えない。
  assert.match(body, /`「\$\{card\.title\}」を押しました。`/);
  assert.match(body, /text: `「\$\{card\.title\}」を押します。`/);
});
