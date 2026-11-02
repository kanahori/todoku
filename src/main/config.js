'use strict';
// 設定ファイル（ウェブアプリごとの操作の方法）を読み、形を確かめる所。
//
// 設定ファイルの形（JSON）:
// {
//   "id": "sample",                 // 英数字とハイフン
//   "name": "練習用のアプリ",        // 読み上げで使う名前
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
//       "description": "任意の補足"
//     }
//   ]
// }

const fs = require('node:fs');
const path = require('node:path');

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const ACTIONS = new Set(['read', 'click', 'list']);
const FIXTURE_PATTERN = /^fixture:[a-z0-9][a-z0-9-]*\.html$/;

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
    if (card.description !== undefined && typeof card.description !== 'string') {
      add(`${at}.description`, '文字列が要ります');
    }
  });
  return errors;
}

// 一つのファイルを読む。結果は { file, config } か { file, errors }。
function loadConfigFile(file) {
  let config;
  try {
    config = JSON.parse(fs.readFileSync(file, 'utf8'));
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

module.exports = { validateConfig, loadConfigFile, loadConfigDir, loadConfigSources };
