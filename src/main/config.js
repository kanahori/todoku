'use strict';
// 設定ファイル（ウェブアプリごとの操作の方法）を読み、形を確かめる所。
// 作品の形は 2026-11-02 の夜に決まる予定なので、ここでは最小の形だけを確かめる。
//
// 設定ファイルの形（JSON）:
// {
//   "id": "sample",                 // 英数字とハイフン
//   "name": "練習用のアプリ",        // 読み上げで使う名前
//   "url": "https://example.com/",  // 開くページ。"fixture:practice.html" なら test/fixtures/ の練習のページ
//   "cards": [
//     {
//       "id": "inbox",
//       "title": "受信箱",
//       "action": "read" | "click",
//       "selector": "main ul.messages",  // どこを読む・何を押すか
//       "description": "任意の補足"
//     }
//   ]
// }

const fs = require('node:fs');
const path = require('node:path');

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const ACTIONS = new Set(['read', 'click']);
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
      add(`${at}.action`, '"read" か "click" が要ります');
    }
    if (typeof card.selector !== 'string' || card.selector.trim() === '') {
      add(`${at}.selector`, '空でない文字列が要ります');
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

module.exports = { validateConfig, loadConfigFile, loadConfigDir };
