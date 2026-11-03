'use strict';
// 画面が変わって当たらなくなった行について、直しの案を作る所。
// 鍵は CARDS_ANTHROPIC_API_KEY、モデルは既定 claude-opus-5-5（CARDS_REPAIR_MODEL で変えられる）。
// 一巡: 当たらない行（checkCards）→ ページの構造を集める（structure.js）→ Claude に案を頼む
//       → 案をページで試す → 人が「採る／採らない」を選ぶ → 設定ファイルを書き直す。
// Claude に送るのは、当たらない行（場所・カードの題・操作・前のセレクタ）とページの構造だけ。ページの文字は送らない。

const fs = require('node:fs');
const path = require('node:path');
const { z } = require('zod');
const { SYSTEM_PROMPT, buildRepairRequest, repairRequestTextFree } = require('./repair-prompt');
const { buildSkeletonScript, looksTextFree } = require('./structure');
const { resolveUrl, openTarget } = require('./target');

const DEFAULT_MODEL = 'claude-opus-5-5';

const RepairSchema = z.object({
  proposals: z.array(
    z.object({
      where: z.string(),
      selector: z.string(),
      reason: z.string(),
    }),
  ),
});

// 作品が読む鍵の名前。Claude Code 自身が拾う ANTHROPIC_API_KEY とは分けておく。
const API_KEY_ENV = 'CARDS_ANTHROPIC_API_KEY';

function hasApiKey(env = process.env) {
  return typeof env[API_KEY_ENV] === 'string' && env[API_KEY_ENV].trim() !== '';
}

// 本物の Claude を呼ぶ関数を作る。試しでは、同じ形の偽の関数を渡す。
// 返すのは async ({ system, user, signal }) => { proposals } 。signal（任意）で途中で止められる（自動で直すときの時間切れ）。
// schema（任意）で返す形を変えられる（カードの束をその場で作るときは generate.js の GenerateSchema）。
function createClaudeCaller({ model = process.env.CARDS_REPAIR_MODEL || DEFAULT_MODEL, fetch, schema = RepairSchema } = {}) {
  // 鍵は環境変数 CARDS_ANTHROPIC_API_KEY から読み、明示して渡す。
  const Anthropic = require('@anthropic-ai/sdk');
  const { betaZodOutputFormat } = require('@anthropic-ai/sdk/helpers/beta/zod');
  const client = new Anthropic({ apiKey: process.env[API_KEY_ENV], ...(fetch ? { fetch } : {}) });
  return async ({ system, user, signal }) => {
    const response = await client.beta.messages.parse({
      model,
      max_tokens: 16000,
      // temperature は付けない。claude-opus-5-5 は temperature・top_p・top_k を受け付けず 400 になる（作るたびに束が変わる件は、手元の守りで抑える）。
      // 安全の判定で断られたときは、サーバーの側で別のモデルに回す。
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'high', format: betaZodOutputFormat(schema) },
      system,
      messages: [{ role: 'user', content: user }],
    }, signal ? { signal } : undefined);
    if (response.stop_reason === 'refusal') {
      throw new Error('Claude が案を作るのを断りました');
    }
    if (!response.parsed_output) {
      throw new Error(`案を読み取れませんでした（stop_reason: ${response.stop_reason}）`);
    }
    return response.parsed_output;
  };
}

// ページの中で動く関数。セレクタごとに、当たる要素の数だけを返す。
function pageCount(selectors) {
  return selectors.map((s) => {
    try {
      return document.querySelectorAll(s).length;
    } catch (e) {
      return -1;
    }
  });
}

// 当たらない行の一覧（checkCards の結果）から、直しの案を作る。
// 結果は { proposals: [{ where, index, title, action, oldSelector, newSelector, reason, matches }], errors: [{ where, message }] }。
async function proposeRepairs({ BrowserWindow, config, problems, callModel }) {
  const proposals = [];
  const errors = [];
  // selector の行だけを扱う。カードの位置ごとにまとめ、開くページごとに分ける。
  const byUrl = new Map();
  for (const p of problems) {
    const m = /^cards\[(\d+)\]\.selector$/.exec(p.where);
    if (!m) {
      errors.push({ where: p.where, message: 'この行は案の対象にしていません' });
      continue;
    }
    const index = Number(m[1]);
    const card = config.cards[index];
    const url = resolveUrl(config.url, card.path);
    if (!byUrl.has(url)) byUrl.set(url, []);
    byUrl.get(url).push({ where: p.where, index, title: card.title, cardId: card.id, action: card.action, oldSelector: card.selector });
  }

  for (const [url, items] of byUrl) {
    const win = await openTarget(BrowserWindow, config, url);
    const { skeleton, nodes, truncated } = await win.webContents.executeJavaScript(buildSkeletonScript());
    if (!looksTextFree(skeleton)) {
      for (const it of items) errors.push({ where: it.where, message: '構造に文字が混ざったので、送りませんでした' });
      continue;
    }
    // 送る文の全体に日本語の文字があれば送らない（題は文に入れない。前のセレクタの文字は伏せる。それでも残れば止める）。
    const user = buildRepairRequest(items, skeleton);
    if (!repairRequestTextFree(user)) {
      for (const it of items) errors.push({ where: it.where, message: '送る文にページの文字が混ざったので、送りませんでした' });
      continue;
    }
    let answer;
    try {
      answer = await callModel({ system: SYSTEM_PROMPT, user, meta: { nodes, truncated } });
    } catch (e) {
      for (const it of items) errors.push({ where: it.where, message: `案を作れませんでした: ${e.message}` });
      continue;
    }
    const byWhere = new Map((answer.proposals || []).map((p) => [p.where, p]));
    const candidates = items.map((it) => ({ ...it, newSelector: (byWhere.get(it.where)?.selector || '').trim(), reason: byWhere.get(it.where)?.reason || '案がありませんでした' }));
    // 案をページで試し、当たる数を添える（人が採るかを決める手がかり）。
    const counts = await win.webContents.executeJavaScript(`(${pageCount.toString()})(${JSON.stringify(candidates.map((c) => c.newSelector || ':not(*)'))})`);
    candidates.forEach((c, k) => proposals.push({ ...c, matches: c.newSelector ? counts[k] : 0 }));
  }
  return { proposals, errors };
}

// 採った案を設定ファイルの中身に当てる。元の中身は変えずに、新しい中身を返す。
function applyRepairs(config, accepted) {
  const next = JSON.parse(JSON.stringify(config));
  for (const a of accepted) {
    if (!next.cards[a.index]) continue;
    next.cards[a.index].selector = a.newSelector;
  }
  return next;
}

// 設定ファイルを書き直す。書く前の中身を backupDir にコピーしておく。
function saveConfigFile(file, config, backupDir) {
  if (backupDir) {
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(file, path.join(backupDir, `${path.basename(file, '.json')}.${stamp}.json`));
  }
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

module.exports = { API_KEY_ENV, RepairSchema, hasApiKey, createClaudeCaller, proposeRepairs, applyRepairs, saveConfigFile, DEFAULT_MODEL };
