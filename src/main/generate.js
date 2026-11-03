'use strict';
// 設定ファイルの無いページから、Claude がその場でカードの束を作る所。
// 一巡: 使う人が URL を入れる → そのページを開く → 文字を落とした構造を集める（structure.js・looksTextFree の守りを通す）
//       → Claude にカードの束の案を頼む → 案をそのページで試し、当たらない・空のカードを落とす
//       → 題と束の名前をアプリの手元で作る → userData の下に新しい束として残す。
// Claude に送るのは、ページの構造だけ。ページの文字・URL・題は送らない。
// カードの題は、Claude が返す「題の元になる要素のセレクタ」（titleSelector）の文字を手元で読んで作る。
// 作れないときは役目の種類から「一覧 1」のような題にする。束の名前は、ページの title を手元で使う。

const fs = require('node:fs');
const path = require('node:path');
const { z } = require('zod');
const { ROLE_LABELS, SYSTEM_PROMPT, buildGenerateRequest } = require('./generate-prompt');
const { buildSkeletonScript, looksTextFree } = require('./structure');
const { resolveUrl, openTarget, closeTarget } = require('./target');
const { externalUrl, validateConfig } = require('./config');
const { isConfident, pageTry, withTimeout } = require('./autofix');

// 待つのは長くても 90秒（ページを開く・構造を集める・Claude の案・試すまで全部を含めて）。
const GENERATE_TIMEOUT_MS = 90000;
// Claude に送る構造の上限（文字数）。越えたら行の切れ目で切り、切ったことを伝える。
// 大きさは、まず structure.js の要素の数の上限（2500）で抑えられる。気象庁の警報のページ（https://www.jma.go.jp/bosai/warning/）は、
// 要素 2855 のうち 2500 で切れて 98984 文字だった（2026-11-03 に Electron で一度だけ開いて測った）。それが切れずに収まる上限にする。
const MAX_STRUCTURE_CHARS = 120 * 1000;
// 作るカードの数の上限と、Claude の案を試す数の上限。
const MAX_CARDS = 8;
const MAX_CANDIDATES = 16;
// 題と束の名前の長さの上限（文字数）。
const TITLE_MAX = 30;
const NAME_MAX = 40;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const ROLES = Object.keys(ROLE_LABELS);

// 作った束の頭の説明（アプリのはじめのカードの最後の項目として読まれる）。
const GENERATED_DESCRIPTION = 'このカードの束は、Claude がページの作りから作ったものです。この機械の中だけにあります。';

// Claude に返させる形。題の文字は返させない（題の元になる要素のセレクタと、役目の種類だけ）。
// 使わない欄は空の文字列にさせる（構造化出力では文字の長さの決まりを使えないため、空かどうかは手元で見る）。
const GenerateSchema = z.object({
  cards: z.array(
    z.object({
      role: z.enum(ROLES),
      action: z.enum(['read', 'list', 'click']),
      selector: z.string(),
      container: z.string(),
      titleSelector: z.string(),
      reason: z.string(),
    }),
  ),
});

// 作れなかったときの理由（一文）。画面はこの文をそのまま知らせる。
const FAILURE_MESSAGES = {
  'bad-url': 'URL が http:// か https:// で始まっていないので、カードを作れませんでした。',
  'no-key': '鍵が設定されていないので、カードを作れませんでした。',
  'open-failed': 'ページを開けなかったので、カードを作れませんでした。',
  'text-in-structure': 'ページの作りに文字が混ざったので、Claude に送らず、カードを作りませんでした。',
  timeout: '90秒たっても終わらなかったので、カードを作るのをやめました。',
  'model-error': 'Claude が案を作れなかったので、カードを作れませんでした。',
  'no-cards': 'このページで読める所・押せる所が見つからなかったので、カードを作れませんでした。',
  'save-failed': '作ったカードを保存できなかったので、カードを作れませんでした。',
  busy: 'いまは別のカードの束を作っているので、終わってからもう一度押してください。',
  error: 'うまく動かなかったので、カードを作れませんでした。',
};

function failureMessage(reason) {
  return FAILURE_MESSAGES[reason] || FAILURE_MESSAGES.error;
}

function fail(reason, detail) {
  return detail ? { ok: false, reason, detail } : { ok: false, reason };
}

// 終わりの知らせ（一度だけ）。
function doneMessage(config) {
  return `「${config.name}」のカードを${config.cards.length}枚作りました。`;
}

// ---- 作った束の置き場 ----
// 置き場は app.getPath('userData') の下の generated/。一つの束を一つの設定ファイル（<id>.json）にする。
// 形は cards/*.json と同じなので、読むのは config.js の loadConfigDir で読める。
function createGeneratedStore(dir) {
  const fileOf = (id) => {
    if (!ID_PATTERN.test(String(id))) throw new Error(`束の id が正しくありません: ${id}`);
    return path.join(dir, `${id}.json`);
  };
  return {
    dir,
    fileOf,
    save(config) {
      const file = fileOf(config.id);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n', 'utf8');
      return file;
    },
    remove(id) {
      const file = fileOf(id);
      if (!fs.existsSync(file)) return false;
      fs.rmSync(file, { force: true });
      return true;
    },
  };
}

// 新しい束の id。時刻から作る（例: page-mhj3k2a1）。
function newDeckId(now = () => new Date()) {
  return `page-${now().getTime().toString(36)}`;
}

// 使う人が入れた URL を確かめる。http:// と https:// だけ。試しのときだけ練習のページ（fixture:名前.html）も通す。
function acceptUrl(value, { allowFixtures = false } = {}) {
  const text = String(value || '').trim();
  if (allowFixtures && /^fixture:[a-z0-9][a-z0-9-]*\.html$/.test(text)) return text;
  return externalUrl(text);
}

// 構造を送る量の上限に収める。越えたら行の切れ目で切る。
function limitStructure(skeleton, max = MAX_STRUCTURE_CHARS) {
  if (skeleton.length <= max) return { text: skeleton, cut: false };
  const k = skeleton.lastIndexOf('\n', max);
  return { text: skeleton.slice(0, k > 0 ? k : max), cut: true };
}

// ページが落ち着くまで待つ（後から出てくる作りのページのため）。要素の数が2回続けて変わらなくなったら終わる。
async function waitForSettle(win, { stepMs = 500, minMs = 1000, maxMs = 8000 } = {}) {
  const started = Date.now();
  let last = -1;
  let same = 0;
  for (;;) {
    await new Promise((r) => setTimeout(r, stepMs));
    const n = await win.webContents.executeJavaScript("document.getElementsByTagName('*').length");
    same = n === last ? same + 1 : 0;
    last = n;
    const t = Date.now() - started;
    if ((same >= 2 && t >= minMs) || t >= maxMs) return n;
  }
}

// Claude の案を、試せる形にそろえる。空のセレクタは落とし、list でないカードの container は外す。
function normalizeCandidates(answer) {
  const list = answer && Array.isArray(answer.cards) ? answer.cards : [];
  const out = [];
  for (const c of list) {
    if (!c || typeof c !== 'object') continue;
    const action = ['read', 'list', 'click'].includes(c.action) ? c.action : null;
    const selector = typeof c.selector === 'string' ? c.selector.trim() : '';
    if (!action || !selector || selector.length > 500) continue;
    const container = action === 'list' && typeof c.container === 'string' ? c.container.trim() : '';
    const titleSelector = typeof c.titleSelector === 'string' ? c.titleSelector.trim() : '';
    out.push({ role: ROLES.includes(c.role) ? c.role : 'other', action, selector, container, titleSelector });
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

// ページの中で動く関数。案ごとに、当たる数・文字があるか（pageTry と同じ見方）・入れ物に当たるか・題の元の文字を返す。
// 題の元の文字は、titleSelector の要素の aria-label・画像の alt・見出しなどの文字。押すカードで titleSelector が無いときは、押す所そのものの名前。
// この文字はアプリの手元で題にするだけで、外へは送らない。
function pageInspect(tryOne, cards) {
  const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  const one = (s) => {
    if (!s) return null;
    try {
      return document.querySelector(s);
    } catch (e) {
      return null;
    }
  };
  const nameOf = (el) => {
    if (!el) return '';
    const label = clean(el.getAttribute('aria-label'));
    if (label) return label;
    if (el.tagName === 'IMG') return clean(el.getAttribute('alt'));
    const text = clean(el.innerText || el.textContent);
    if (text) return text;
    const img = el.querySelector('img[alt]:not([alt=""])');
    return img ? clean(img.getAttribute('alt')) : '';
  };
  return cards.map((c) => {
    const probe = tryOne(c.selector);
    const containerOk = Boolean(c.container && one(c.container));
    let title = nameOf(one(c.titleSelector));
    if (!title && c.action === 'click' && probe.count === 1) title = nameOf(one(c.selector));
    return { count: probe.count, hasText: probe.hasText, containerOk, title: title.slice(0, 200) };
  });
}

function buildInspectScript(candidates) {
  return `(${pageInspect.toString()})(${pageTry.toString()}, ${JSON.stringify(candidates)})`;
}

function cleanTitle(text, max = TITLE_MAX) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

// 試した結果から、残すカードを選び、題と id を付ける。
// 落とすもの: 当たらない・中身が空（read は文字あり・list は1件以上・click は当たる数ちょうど1 でないもの）・同じ所の重なり。
function pickCards(candidates, probes) {
  const cards = [];
  const seen = new Set();
  const titles = new Set();
  const perRole = {};
  candidates.forEach((c, k) => {
    if (cards.length >= MAX_CARDS) return;
    const probe = probes[k];
    if (!isConfident(c.action, probe)) return;
    const key = `${c.action} ${c.selector}`;
    if (seen.has(key)) return;
    seen.add(key);
    let title = cleanTitle(probe.title);
    if (!title) {
      perRole[c.role] = (perRole[c.role] || 0) + 1;
      title = `${ROLE_LABELS[c.role]} ${perRole[c.role]}`;
    }
    let unique = title;
    for (let n = 2; titles.has(unique); n++) unique = `${title} ${n}`;
    titles.add(unique);
    const card = { id: `${c.role}-${cards.length + 1}`, title: unique, action: c.action, selector: c.selector };
    if (c.action === 'list' && c.container && probe.containerOk) card.container = c.container;
    cards.push(card);
  });
  return cards;
}

// 束の名前: ページの title。無ければ URL のホスト名、それも無ければ「新しいページ」。
function deckName(title, url) {
  const name = cleanTitle(title, NAME_MAX);
  if (name) return name;
  try {
    const host = new URL(url).hostname;
    if (host) return host;
  } catch (e) {
    // 練習のページ（fixture:）など
  }
  return '新しいページ';
}

// 中の一巡。signal が止められたら（時間切れ）、それ以上進めず、残さない。
async function buildDeck({ BrowserWindow, id, url, callModel, store, signal, settle, now }) {
  const temp = { id, name: '新しいページ', url, cards: [] };
  let win;
  try {
    win = await openTarget(BrowserWindow, temp, resolveUrl(url));
  } catch (e) {
    return fail(signal.aborted ? 'timeout' : 'open-failed', e.message);
  }
  if (signal.aborted) return fail('timeout');
  await waitForSettle(win, settle);
  const { skeleton, nodes, truncated } = await win.webContents.executeJavaScript(buildSkeletonScript());
  if (!looksTextFree(skeleton)) return fail('text-in-structure');
  const limited = limitStructure(skeleton);
  if (signal.aborted) return fail('timeout');
  let answer;
  try {
    answer = await callModel({ system: SYSTEM_PROMPT, user: buildGenerateRequest(limited.text, { truncated: truncated || limited.cut }), signal });
  } catch (e) {
    return fail(signal.aborted ? 'timeout' : 'model-error', e.message);
  }
  if (signal.aborted) return fail('timeout');
  const candidates = normalizeCandidates(answer);
  if (candidates.length === 0) return fail('no-cards');
  const probes = await win.webContents.executeJavaScript(buildInspectScript(candidates));
  const cards = pickCards(candidates, probes);
  if (cards.length === 0) return fail('no-cards');
  // 行き先が変わった（転送された）ときは、行き着いたページの URL を残す（http:// と https:// のときだけ）。
  const landed = externalUrl(win.webContents.getURL());
  const config = {
    id,
    name: deckName(win.webContents.getTitle(), landed || url),
    url: landed || url,
    description: GENERATED_DESCRIPTION,
    cards,
  };
  if (validateConfig(config).length > 0) return fail('save-failed');
  if (signal.aborted) return fail('timeout');
  let file;
  try {
    file = store.save(config);
  } catch (e) {
    return fail('save-failed', e.message);
  }
  return {
    ok: true,
    config,
    file,
    tried: candidates.length,
    dropped: candidates.length - cards.length,
    structure: { nodes, chars: limited.text.length, cut: truncated || limited.cut },
    at: now().toISOString(),
  };
}

// ページの URL から、カードの束を作る。結果は { ok: true, config, file, ... } か { ok: false, reason, detail? }。
// callModel は createClaudeCaller({ schema: GenerateSchema }) と同じ形の関数。null なら（鍵が無いとき）作らない。試しでは偽物を渡す。
async function generateDeck({
  BrowserWindow, url, callModel, store, timeoutMs = GENERATE_TIMEOUT_MS, now = () => new Date(), settle, allowFixtures = false,
}) {
  const target = acceptUrl(url, { allowFixtures });
  if (!target) return fail('bad-url');
  if (typeof callModel !== 'function') return fail('no-key');
  const id = newDeckId(now);
  const controller = new AbortController();
  let result;
  try {
    result = await withTimeout(
      buildDeck({ BrowserWindow, id, url: target, callModel, store, signal: controller.signal, settle, now }),
      timeoutMs,
      controller,
    );
  } catch (e) {
    result = e.message === '時間切れ' ? fail('timeout') : fail('error', e.message);
  }
  // 作れなかったときは、開いた窓を閉じる（作れたときは、カードを読むときにそのまま使う）。
  if (!result.ok) closeTarget(id);
  return result;
}

// 作った束を、支援者が確かめて配れるように、設定ファイルとして書き出す（置き場は dir。同じ名前があれば「名前 (1)」）。
function exportDeck(config, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const base = `todoku-${config.id}`;
  let name = `${base}.json`;
  for (let n = 1; fs.existsSync(path.join(dir, name)); n++) name = `${base} (${n}).json`;
  fs.writeFileSync(path.join(dir, name), JSON.stringify(config, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  return name;
}

function exportedMessage(name) {
  return `ダウンロードのフォルダに「${name}」として書き出しました。支援者が確かめてから、設定ファイルとして配ってください。`;
}

module.exports = {
  GENERATE_TIMEOUT_MS,
  MAX_STRUCTURE_CHARS,
  MAX_CARDS,
  GENERATED_DESCRIPTION,
  GenerateSchema,
  failureMessage,
  doneMessage,
  createGeneratedStore,
  newDeckId,
  acceptUrl,
  limitStructure,
  waitForSettle,
  normalizeCandidates,
  pageInspect,
  buildInspectScript,
  pickCards,
  deckName,
  generateDeck,
  exportDeck,
  exportedMessage,
};
