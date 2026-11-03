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
  assert.match(source, /画面が変わったので、押す所を直しました。もう一度押すときは、「\$\{card\.title\}」を押すボタンを押してください。/);
  assert.match(source, /画面が変わったので、押す所を直しています。少しお待ちください。/);
  assert.match(source, /r\.autoRepairFailed \? '。自動で直せませんでした。' : ''/);
});

test('読めないときの文に、自動で直せなかったときだけ「自動で直せませんでした。」を足す', () => {
  const body = source.slice(source.indexOf('function unreadableText('), source.indexOf('// ---- 押すカード'));
  assert.match(body, /result\.autoRepairFailed \? '\\n自動で直せませんでした。' : ''/);
});
