'use strict';
// 使う人の側で、読めない・押せないカードを、その場で自動で直す所。
// 一巡: カードが当たらない → いま開いているページ（読み込み直さない）の構造を集める → Claude にそのカードの行だけ案を頼む
//       → 案をいまのページで試す → 確からしいときだけ採る → 手元の上書きのファイルに残す → 読むカードは読み直す。
// 直しは手元にだけ効かせる。リポジトリの cards/*.json は書き換えない（配るのは支援者が保守のカードから行う）。
// Claude に送るのは、当たらない行（場所・カードの題・操作・前のセレクタ）とページの構造だけ。ページの文字は送らない。

const fs = require('node:fs');
const path = require('node:path');
const { SYSTEM_PROMPT, buildRepairRequest } = require('./repair-prompt');
const { buildSkeletonScript, looksTextFree } = require('./structure');
const { resolveUrl, openTarget, runCard } = require('./target');

// Claude を待つ長さの上限（45秒）。カードが当たらないと分かるまでの待ち（8秒）の後に、この長さまで待つ。
const AUTO_REPAIR_TIMEOUT_MS = 45000;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

// ---- 上書きのファイル（アプリごとに一つ）----
// 置き場は app.getPath('userData') の下の repairs/。形は
// { "appId": "practice-city", "repairs": [{ cardId, field, before, after, reason, at, action, title }] }。
// before は上書きの元の値（設定ファイルの selector）、after は自動で採った値。
function createOverrideStore(dir) {
  const fileOf = (appId) => {
    if (!ID_PATTERN.test(String(appId))) throw new Error(`アプリの id が正しくありません: ${appId}`);
    return path.join(dir, `${appId}.json`);
  };
  const load = (appId) => {
    const file = fileOf(appId);
    let data;
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      return [];
    }
    return Array.isArray(data && data.repairs) ? data.repairs.filter((r) => r && typeof r.cardId === 'string' && typeof r.after === 'string') : [];
  };
  const save = (appId, repairs) => {
    const file = fileOf(appId);
    if (repairs.length === 0) {
      fs.rmSync(file, { force: true });
      return;
    }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ appId, repairs }, null, 2) + '\n', 'utf8');
  };
  return {
    dir,
    load,
    // 同じカードの直しは一つだけ持つ（新しいもので置き換える）。
    // 直しをさらに直したとき（前の直しの後の値から直したとき）は、元の値に最初の直しの前の値（設定ファイルの値）を残す。
    add(appId, repair) {
      const list = load(appId);
      const old = list.find((r) => r.cardId === repair.cardId);
      const next = list.filter((r) => r.cardId !== repair.cardId);
      next.push(old && old.after === repair.before ? { ...repair, before: old.before } : repair);
      save(appId, next);
      return next;
    },
    remove(appId, cardId) {
      const list = load(appId);
      const removed = list.find((r) => r.cardId === cardId) || null;
      if (removed) save(appId, list.filter((r) => r.cardId !== cardId));
      return removed;
    },
  };
}

// 設定ファイルの中身に、手元の直しを当てる。元の中身は変えない。
// 当てるのは、設定ファイルの selector が直しの元の値（before）のままのカードだけ。
// 配られた設定ファイルで selector が変わっていたら、その直しは古いので当てない（stale）。
function applyOverrides(config, repairs) {
  const next = JSON.parse(JSON.stringify(config));
  const active = [];
  const stale = [];
  for (const r of repairs || []) {
    const card = next.cards.find((c) => c.id === r.cardId);
    if (card && r.field === 'selector' && card.selector === r.before) {
      card.selector = r.after;
      active.push(r);
    } else {
      stale.push(r);
    }
  }
  return { config: next, active, stale };
}

// ---- 確からしいか ----
// read は当たる数が1以上で中身の文字が空でない、list は1件以上、click は当たる数がちょうど1。
function isConfident(action, probe) {
  if (!probe || typeof probe.count !== 'number') return false;
  if (action === 'read') return probe.count >= 1 && probe.hasText === true;
  if (action === 'list') return probe.count >= 1;
  if (action === 'click') return probe.count === 1;
  return false;
}

// ページの中で動く関数。案のセレクタが当たる数と、最初の要素に文字（か画像の説明）があるかだけを返す。文字そのものは返さない。
function pageTry(selector) {
  let els;
  try {
    els = document.querySelectorAll(selector);
  } catch (e) {
    return { count: -1, hasText: false };
  }
  const first = els[0];
  const hasText = Boolean(first && ((first.innerText || first.textContent || '').trim() !== ''
    || first.querySelector('img[alt]:not([alt=""]), [role="img"][aria-label], [aria-label]:not([aria-label=""])')));
  return { count: els.length, hasText };
}

// 時間切れを付けて待つ。時間が来たら controller を止める。
function withTimeout(promise, ms, controller) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      if (controller) controller.abort();
      reject(new Error('時間切れ'));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// 一枚のカードの直しの案を作り、いまのページで試す。結果は { ok: true, repair } か { ok: false, reason }。
// callModel は createClaudeCaller と同じ形の関数（async ({ system, user, signal }) => { proposals }）。試しでは偽物を渡す。
async function proposeAutoRepair({ BrowserWindow, config, index, callModel, timeoutMs = AUTO_REPAIR_TIMEOUT_MS, now = () => new Date() }) {
  const card = config.cards[index];
  const where = `cards[${index}].selector`;
  // いま開いているページを使う（同じページなら openTarget は読み込み直さない）。
  const win = await openTarget(BrowserWindow, config, resolveUrl(config.url, card.path));
  const { skeleton } = await win.webContents.executeJavaScript(buildSkeletonScript());
  if (!looksTextFree(skeleton)) return { ok: false, reason: 'text-in-structure' };
  const item = { where, index, title: card.title, action: card.action, oldSelector: card.selector };
  const controller = new AbortController();
  let answer;
  try {
    answer = await withTimeout(
      Promise.resolve().then(() => callModel({ system: SYSTEM_PROMPT, user: buildRepairRequest([item], skeleton), signal: controller.signal })),
      timeoutMs,
      controller,
    );
  } catch (e) {
    return { ok: false, reason: e.message === '時間切れ' ? 'timeout' : 'model-error', message: e.message };
  }
  const proposal = ((answer && answer.proposals) || []).find((p) => p.where === where);
  const selector = proposal && typeof proposal.selector === 'string' ? proposal.selector.trim() : '';
  if (!selector) return { ok: false, reason: 'no-proposal' };
  if (selector === card.selector) return { ok: false, reason: 'same-selector' };
  const probe = await win.webContents.executeJavaScript(`(${pageTry.toString()})(${JSON.stringify(selector)})`);
  if (!isConfident(card.action, probe)) return { ok: false, reason: 'not-confident', probe };
  return {
    ok: true,
    repair: {
      cardId: card.id,
      field: 'selector',
      before: card.selector,
      after: selector,
      reason: String(proposal.reason || ''),
      at: now().toISOString(),
      action: card.action,
      title: card.title,
      matches: probe.count,
    },
  };
}

// カードを一枚動かし、当たらなければその場で自動で直す。
// 結果は runCard の結果に、次を足したもの:
//   repaired: { cardId, before, after, reason, at, ... }  … 自動で直したとき（read・list は読み直した結果、click は押し直していない）
//   autoRepairFailed: true                                 … 当たらず、自動で直せなかったとき（鍵が無いときも）
//   config                                                 … 直したときの、直しを当てた後の設定ファイルの中身（主の処理が持ち直す）
// callModel が null なら（鍵が無いとき）、Claude を呼ばずに autoRepairFailed を付けて返す。
// onRepairing は、直し始めるときに一度呼ばれる（画面に「直しています」を知らせるため）。
async function runCardWithAutoRepair({ BrowserWindow, config, cardId, callModel, store, options = {}, onRepairing, timeoutMs, now }) {
  const first = await runCard(BrowserWindow, config, cardId, options);
  const index = config.cards.findIndex((c) => c.id === cardId);
  // 自動で直すのは「ページの中に当たる所がありません」のときだけ（ログイン・書き方の誤り・ページを開けないときは直さない）。
  if (first.ok || first.needLogin || index < 0 || first.where !== `cards[${index}].selector` || first.message !== 'ページの中に当たる所がありません') return first;
  if (typeof callModel !== 'function') return { ...first, autoRepairFailed: true, autoRepairReason: 'no-key' };
  if (onRepairing) onRepairing();
  let proposed;
  try {
    proposed = await proposeAutoRepair({ BrowserWindow, config, index, callModel, timeoutMs, now });
  } catch (e) {
    proposed = { ok: false, reason: 'error', message: e.message };
  }
  if (!proposed.ok) return { ...first, autoRepairFailed: true, autoRepairReason: proposed.reason };
  const repair = proposed.repair;
  const next = JSON.parse(JSON.stringify(config));
  next.cards[index].selector = repair.after;
  if (config.cards[index].action === 'click') {
    // 押すカードは押し直さない。直したことを知らせて、もう一度押すかを使う人に任せる。
    store.add(config.id, repair);
    return { ok: false, action: 'click', repaired: repair, config: next };
  }
  const again = await runCard(BrowserWindow, next, cardId, options);
  if (!again.ok) {
    // 試しでは当たったのに読めなかったときは、採らない（手元にも残さない）。
    return { ...first, autoRepairFailed: true, autoRepairReason: 'reread-failed' };
  }
  store.add(config.id, repair);
  return { ...again, repaired: repair, config: next };
}

module.exports = {
  AUTO_REPAIR_TIMEOUT_MS,
  createOverrideStore,
  applyOverrides,
  isConfident,
  pageTry,
  withTimeout,
  proposeAutoRepair,
  runCardWithAutoRepair,
};
