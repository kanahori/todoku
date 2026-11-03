'use strict';
// 設定ファイル（ウェブアプリごとの操作の方法）を読み、形を確かめる所。
//
// 設定ファイルの形（JSON）:
// {
//   "id": "sample",                 // 英数字とハイフン
//   "name": "練習用のアプリ",        // 読み上げで使う名前
//   "description": "出典：…",       // 任意。アプリの説明。アプリのはじめのカードの最後の項目として読まれる
//                                   // URL は読み上げで一文字ずつ近い形で読まれるので、ここには書かず sourceUrl に置く
//   "sourceUrl": "https://example.com/about/",
//                                   // 任意。出典のページ。アプリのはじめのカードに「出典のページを開く」ボタンが出る（http:// か https:// だけ）
//   "url": "https://example.com/",  // 開くページ。"fixture:practice.html" なら test/fixtures/ の練習のページ
//   "login": { "selector": "body.notloggedin", "path": "/login/index.php" },
//                                   // 任意。selector が当たったらログインが要ると見なし、path（任意）のログインの画面を開く
//   "cards": [
//     {
//       "id": "inbox",
//       "title": "受信箱",
//       "action": "read" | "click" | "list",   // list は当たる項目を全部、番号を付けて読む
//       "selector": "main ul.messages",  // どこを読む・何を押すか
//       "path": "/my/",                  // 任意。url から見た、開くページ（/ で始まる）
//       "container": "main ul.messages", // 任意・list のカードだけ。項目を入れる入れ物。
//                                        // 入れ物に当たって項目が無ければ「0件」、入れ物にも当たらなければ「読めません」。
//                                        // 無いカードは、項目が無ければ「読めません」（0件と画面の変わりを分けられない）
//       "dateSelector": "td.date",       // 任意・list のカードだけ。項目の中の日付の要素。その要素の datetime か id に
//                                        // 書かれた年・月・日（2026-11-06・2026_11_6 の形）から「11月6日」と読む（日だけの表のため）
//       "until": "h1, h2",               // 任意・read のカードだけ。当たった要素から、後に続く兄弟の要素を、until に当たる要素の
//                                        // 手前まで読む（見出しから次の見出しの手前までの節）
//       "saveAs": "作り物_{date}.csv",    // 任意・click のカードだけ。押してダウンロードが始まったら、この名前で保存する。
//                                        // {date} は保存した日（yyyy-mm-dd）、{n} は使われていない番号（1 から）。
//                                        // 拡張子が無ければ、元の名前の拡張子を足す。同じ名前があり {n} が無ければ「名前 (1)」にする
//       "description": "任意の補足"
//     }
//   ]
// }

const fs = require('node:fs');
const path = require('node:path');

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const ACTIONS = new Set(['read', 'click', 'list']);
const FIXTURE_PATTERN = /^fixture:[a-z0-9][a-z0-9-]*\.html$/;
// 保存の名前の型で使える差し込み。
const SAVE_AS_PLACEHOLDERS = new Set(['{date}', '{n}']);

// 保存の名前の型（saveAs）を確かめ、誤りの理由を返す（正しければ null）。
function saveAsProblem(saveAs) {
  if (typeof saveAs !== 'string' || saveAs.trim() === '') return '空でない文字列が要ります';
  const unknown = (saveAs.match(/\{[^}]*\}/g) || []).filter((p) => !SAVE_AS_PLACEHOLDERS.has(p));
  if (unknown.length > 0) return `${unknown[0]} は使えません（使えるのは {date} と {n}）`;
  const rest = saveAs.replace(/\{date\}|\{n\}/g, '');
  if (/[\\/:*?"<>|{}\u0000-\u001f]/.test(rest)) return 'ファイル名に使えない文字（\\ / : * ? " < > | と { }）が入っています';
  if (/^[\s.]|[\s.]$/.test(saveAs)) return '空白や「.」で始まる・終わる名前は使えません';
  return null;
}

// 形を確かめ、当たらない所を「どの行か（パス）と理由」の一覧で返す。ページの中身は扱わない。
function validateConfig(config) {
  const errors = [];
  const add = (where, message) => errors.push({ where, message });

  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    add('(全体)', 'オブジェクトではありません');
    return errors;
  }
  if (typeof config.id !== 'string' || !ID_PATTERN.test(config.id)) {
    add('id', '英小文字・数字・ハイフンの文字列が要ります');
  }
  if (typeof config.name !== 'string' || config.name.trim() === '') {
    add('name', '空でない文字列が要ります');
  }
  if (typeof config.url !== 'string' || !(/^https?:\/\//.test(config.url) || FIXTURE_PATTERN.test(config.url))) {
    add('url', 'http:// か https:// で始まる文字列か、fixture:名前.html が要ります');
  }
  if (config.description !== undefined && typeof config.description !== 'string') {
    add('description', '文字列が要ります');
  }
  if (config.sourceUrl !== undefined && !externalUrl(config.sourceUrl)) {
    add('sourceUrl', 'http:// か https:// で始まる、空白の無い文字列が要ります');
  }
  if (config.login !== undefined) {
    if (config.login === null || typeof config.login !== 'object' || typeof config.login.selector !== 'string' || config.login.selector.trim() === '') {
      add('login.selector', '空でない文字列が要ります');
    } else if (config.login.path !== undefined && (typeof config.login.path !== 'string' || !/^\/(?!\/)/.test(config.login.path))) {
      add('login.path', '/ で始まる文字列が要ります（// で始まるものは不可）');
    }
  }
  if (!Array.isArray(config.cards) || config.cards.length === 0) {
    add('cards', '1枚以上のカードの配列が要ります');
    return errors;
  }

  const seen = new Set();
  config.cards.forEach((card, i) => {
    const at = `cards[${i}]`;
    if (card === null || typeof card !== 'object' || Array.isArray(card)) {
      add(at, 'オブジェクトではありません');
      return;
    }
    if (typeof card.id !== 'string' || !ID_PATTERN.test(card.id)) {
      add(`${at}.id`, '英小文字・数字・ハイフンの文字列が要ります');
    } else if (seen.has(card.id)) {
      add(`${at}.id`, `「${card.id}」が重なっています`);
    } else {
      seen.add(card.id);
    }
    if (typeof card.title !== 'string' || card.title.trim() === '') {
      add(`${at}.title`, '空でない文字列が要ります');
    }
    if (!ACTIONS.has(card.action)) {
      add(`${at}.action`, '"read"・"click"・"list" のどれかが要ります');
    }
    if (typeof card.selector !== 'string' || card.selector.trim() === '') {
      add(`${at}.selector`, '空でない文字列が要ります');
    }
    if (card.path !== undefined && (typeof card.path !== 'string' || !/^\/(?!\/)/.test(card.path))) {
      add(`${at}.path`, '/ で始まる文字列が要ります（// で始まるものは不可）');
    }
    if (card.container !== undefined) {
      if (typeof card.container !== 'string' || card.container.trim() === '') {
        add(`${at}.container`, '空でない文字列が要ります');
      } else if (card.action !== 'list') {
        add(`${at}.container`, 'action が "list" のカードにだけ使えます');
      }
    }
    if (card.dateSelector !== undefined) {
      if (typeof card.dateSelector !== 'string' || card.dateSelector.trim() === '') {
        add(`${at}.dateSelector`, '空でない文字列が要ります');
      } else if (card.action !== 'list') {
        add(`${at}.dateSelector`, 'action が "list" のカードにだけ使えます');
      }
    }
    if (card.until !== undefined) {
      if (typeof card.until !== 'string' || card.until.trim() === '') {
        add(`${at}.until`, '空でない文字列が要ります');
      } else if (card.action !== 'read') {
        add(`${at}.until`, 'action が "read" のカードにだけ使えます');
      }
    }
    if (card.saveAs !== undefined) {
      const problem = saveAsProblem(card.saveAs);
      if (problem) add(`${at}.saveAs`, problem);
      else if (card.action !== 'click') add(`${at}.saveAs`, 'action が "click" のカードにだけ使えます');
    }
    if (card.description !== undefined && typeof card.description !== 'string') {
      add(`${at}.description`, '文字列が要ります');
    }
  });
  return errors;
}

// 出典のページを開いてよい URL か。http:// と https:// だけを、正しい URL の形で返す（そうでなければ null）。
function externalUrl(value) {
  if (typeof value !== 'string' || /\s/.test(value)) return null;
  let url;
  try {
    url = new URL(value);
  } catch (e) {
    return null;
  }
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
}

// 一つのファイルを読む。結果は { file, config } か { file, errors }。
function loadConfigFile(file) {
  let config;
  try {
    // Windows のメモ帳や PowerShell で保存すると、頭に BOM が付くことがあるので取り除く。
    config = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    return { file, errors: [{ where: '(全体)', message: `JSON として読めません: ${e.message}` }] };
  }
  const errors = validateConfig(config);
  return errors.length > 0 ? { file, errors } : { file, config };
}

// フォルダの中の *.json を名前の順に全部読む。
function loadConfigDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => loadConfigFile(path.join(dir, name)));
}

// いくつかの置き場（[{ dir, label }]）を順に読む。id が前の置き場と重なったものは読まない。
// 結果は [{ file: 'label/名前.json', config | null, errors }]。
function loadConfigSources(sources) {
  const ids = new Set();
  const results = [];
  for (const { dir, label } of sources) {
    for (const r of loadConfigDir(dir)) {
      const file = `${label}/${path.basename(r.file)}`;
      if (r.config && ids.has(r.config.id)) {
        results.push({ file, config: null, errors: [{ where: 'id', message: `「${r.config.id}」は別の設定ファイルと重なっています` }] });
        continue;
      }
      if (r.config) ids.add(r.config.id);
      results.push({ file, path: r.file, config: r.config ?? null, errors: r.errors ?? [] });
    }
  }
  return results;
}

module.exports = { validateConfig, loadConfigFile, loadConfigDir, loadConfigSources, externalUrl };
