'use strict';
// 設定ファイルの無いページから、Claude がその場でカードの束を作る所。
// 一巡: 使う人が URL を入れる → そのページを開く → 文字を落とした構造を集める（structure.js・looksTextFree の守りを通す）
//       → Claude にカードの束の案を頼む → 案をそのページで試し、当たらない・空のカードを落とす
//       → 題と束の名前をアプリの手元で作る → userData の下に新しい束として残す。
// Claude に送るのは、ページの構造だけ。ページの文字・URL・題は送らない。
// カードの題は、Claude が返す「題の元になる要素のセレクタ」（titleSelector）の文字を手元で読んで作る。
// 無いときは、その場所の見出し・aria-labelledby・ランドマークの aria-label・最初の短い文字から手元で作る（pageInspect）。
// それでも作れないときは役目の種類から「一覧 1」のような題にする。束の名前は、ページの title を手元で使う。

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
// 本文の節を読むカードの数の上限と、節にする文字の数の下限。
const MAX_SECTIONS = 10;
const SECTION_MIN_CHARS = 40;
// Claude の案に無くても必ず作る、本文の表・一覧の数の上限。
const MAX_MUST_LISTS = 2;
const MAX_CANDIDATES = 16;
// 題と束の名前の長さの上限（文字数）。
const TITLE_MAX = 30;
const NAME_MAX = 40;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const ROLES = Object.keys(ROLE_LABELS);

// 作った束の頭の説明（アプリのはじめのカードの最後の項目として読まれる）。
const GENERATED_DESCRIPTION = 'このカードは、Claude がページの構造から作ったものです。このパソコンの中だけにあります。';

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
  'no-key': 'Claude の API キーが設定されていないので、カードを作れませんでした。',
  'open-failed': 'ページを開けなかったので、カードを作れませんでした。',
  'text-in-structure': 'ページの構造に文字が混ざっていたので、Claude に送らず、カードを作りませんでした。',
  timeout: '90秒たっても終わらなかったので、カードを作るのをやめました。',
  'model-error': 'Claude がカードの候補を作れなかったので、カードを作れませんでした。',
  'no-cards': 'このページでは、読める場所も、操作できるボタンやリンクも見つからなかったので、カードを作れませんでした。',
  'save-failed': '作ったカードを保存できなかったので、カードを作れませんでした。',
  busy: 'いまは別のページのカードを作っているので、作り終わってから、もう一度お試しください。',
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
    if (!ID_PATTERN.test(String(id))) throw new Error(`作ったカードの id が正しくありません: ${id}`);
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

// ページの中で動く関数（落ち着いたかを見る）。要素の数・文字の量・読み込んだ部品の数と、
// まだ中身を待っている印（読み込みが済んでいない・主な区画（main）が空・aria-busy="true" の所がある）を返す。
// 文字の中身は返さない（量だけ）。
function pageSettleProbe() {
  const main = document.querySelector('main, [role="main"]');
  const mainEmpty = Boolean(main) && main.textContent.trim() === '' && !main.querySelector('img, svg, canvas, table, iframe');
  return {
    nodes: document.getElementsByTagName('*').length,
    chars: document.body ? document.body.textContent.length : 0,
    resources: performance.getEntriesByType('resource').length,
    waiting: document.readyState !== 'complete' || mainEmpty || Boolean(document.querySelector('[aria-busy="true"]')),
  };
}

// ページが落ち着くまで待つ（後から出てくる作りのページのため）。
// 要素の数・文字の量・読み込んだ部品の数（ページが後から取りに行く値も入る）の三つが stableMs のあいだ変わらず、
// 中身を待っている印も無くなったら終わる。上限は maxMs（作る一巡の 90秒の中に収める）。
// 前は「要素の数が 1秒変わらなければ終わり」だった。気象庁の警報のページは地図と表を後から描くので、
// 作りを集めた時点で中身がまだ無く、警報の中身に届かなかった（2026-11-03 の Windows の確かめ）。
async function waitForSettle(win, { stepMs = 500, minMs = 2500, stableMs = 2000, maxMs = 15000 } = {}) {
  const started = Date.now();
  let last = null;
  let stableSince = started;
  let snap = null;
  for (;;) {
    await new Promise((r) => setTimeout(r, stepMs));
    snap = await win.webContents.executeJavaScript(`(${pageSettleProbe.toString()})()`);
    const key = `${snap.nodes}/${snap.chars}/${snap.resources}`;
    const now = Date.now();
    if (key !== last) {
      last = key;
      stableSince = now;
    }
    const t = now - started;
    if ((t >= minMs && now - stableSince >= stableMs && !snap.waiting) || t >= maxMs) return snap.nodes;
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
// 題の元の文字は、次の順に探す（この文字はアプリの手元で題にするだけで、外へは送らない）。
//   1. titleSelector の要素の aria-label・画像の alt・見出しなどの文字。押すカードで当たる所が一つなら、押す所そのものの名前。
//   2. その場所（読む・押す所の要素。一覧は入れ物か、最初の項目の親）の中の見出し（h1〜h6）。無ければ直前の見出し（4段上の要素の中まで）。
//   3. その場所か、その上の要素の aria-labelledby の先の文字。
//   4. その場所を囲むランドマーク（nav・section・aside など）の aria-label。
//   5. その場所の中の最初の短い文字（20字まで。日付や数字だけの文字は飛ばす）。
// どれも無ければ、手元で役目の種類から「お知らせ 1」のような題にする（pickCards）。
// 気象庁の警報のページから作った束で、3枚とも「お知らせ 1」「本文 1」「メニュー 1」になり、何のカードか分かりにくかった（2026-11-03 の Windows の確かめ）。
function pageInspect(tryOne, cards) {
  const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  const SHORT_MAX = 20;
  const HEADINGS = 'h1, h2, h3, h4, h5, h6, [role="heading"]';
  const LANDMARKS = 'nav, aside, main, section, form, header, footer, [role="navigation"], [role="region"], [role="complementary"], '
    + '[role="main"], [role="search"], [role="banner"], [role="contentinfo"], [role="form"]';
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
  const hidden = (el) => Boolean(el.closest('[aria-hidden="true"]'));
  // 読む・押す所の場所。一覧は入れ物か、最初の項目の親。
  const regionOf = (c) => {
    if (c.action === 'list') {
      const box = one(c.container);
      if (box) return box;
      const first = one(c.selector);
      return first ? first.parentElement : null;
    }
    return one(c.selector);
  };
  // メニューの題の手がかり: 包む要素の aria-label（3段上まで）・包む見出し（中か、すぐ前の見出し）・最初の項目と項目の名前（10件まで）。
  const menuNames = (c, region) => {
    let label = '';
    for (let n = region, d = 0; n && !label && d < 4; n = n.parentElement, d++) label = clean(n.getAttribute && n.getAttribute('aria-label'));
    // 包む見出しは、h1〜h6 のほか、すぐ前の dt と、class に title の付いた短い文（20字まで）も見る（つくば市の横のメニューは dt.title）。
    let heading = innerHeading(region);
    for (let n = region, d = 0; n && !heading && d < 3; n = n.parentElement, d++) {
      const p = n.previousElementSibling;
      if (!p || hidden(p)) continue;
      const t = nameOf(p);
      if (p.matches(HEADINGS) || ((p.matches('dt') || /title/i.test(p.className || '')) && t.length <= 20)) heading = t;
    }
    let items = [];
    try {
      items = [...document.querySelectorAll(c.selector)].slice(0, 10).map((e) => nameOf(e).slice(0, 40));
    } catch (e) {
      items = [];
    }
    return { label: label.slice(0, 40), heading: heading.slice(0, 40), items };
  };
  const innerHeading = (region) => {
    for (const h of region.querySelectorAll(HEADINGS)) {
      const t = hidden(h) ? '' : nameOf(h);
      if (t) return t;
    }
    return '';
  };
  const precedingHeadingEl = (region) => {
    let anc = region.parentElement;
    for (let depth = 0; anc && depth < 4; depth++, anc = anc.parentElement) {
      const before = [...anc.querySelectorAll(HEADINGS)]
        .filter((h) => !region.contains(h) && !hidden(h) && (h.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING));
      for (let k = before.length - 1; k >= 0; k--) {
        if (nameOf(before[k])) return before[k];
      }
    }
    return null;
  };
  const precedingHeading = (region) => {
    const h = precedingHeadingEl(region);
    return h ? nameOf(h) : '';
  };
  // Claude が返した題の元（titleSelector）が、その場所の題として合っているか。
  // 場所の中か、場所を囲む要素か、場所の直前の見出しか、場所（か3段上まで）のすぐ前の要素のときだけ使う。
  // 合わない題の元を使うと、題と中身がずれた（「…ご案内 2」が目次で、「目次 2」が資料の一覧。2026-11-04 の Windows の確かめ）。
  const titleFits = (el, region) => {
    if (!el || !region) return false;
    if (region.contains(el) || el.contains(region) || precedingHeadingEl(region) === el) return true;
    for (let n = region, d = 0; n && d < 3; n = n.parentElement, d++) {
      const p = n.previousElementSibling;
      if (p && (p === el || p.contains(el))) return true;
    }
    return false;
  };
  // 目次: 中のリンクの多く（8割以上・2つ以上）が、同じページの中の、本当にある所（id）を指す一覧。
  const isToc = (region) => {
    if (!region) return false;
    const links = [...region.querySelectorAll('a[href]')];
    const inPage = links.filter((a) => {
      const href = a.getAttribute('href');
      if (!/^#./.test(href)) return false;
      try {
        // 行き先は id か、昔の書き方の a[name]。
        const key = decodeURIComponent(href.slice(1));
        return Boolean(document.getElementById(key) || document.querySelector(`a[name="${CSS.escape(key)}"]`));
      } catch (e) {
        return false;
      }
    }).length;
    return links.length >= 2 && inPage / links.length >= 0.8;
  };
  // パンくず（いまのページの場所の道しるべ）。読んでも中身が分からないので、カードにしない。
  const CRUMB = '[class*="breadcrumb" i], [class*="topicpath" i], [class*="pankuzu" i], [id*="breadcrumb" i], [id*="topicpath" i], '
    + '[id*="pankuzu" i], [aria-label*="パンくず"]';
  const isCrumb = (region) => Boolean(region && (region.closest(CRUMB) || region.querySelector(CRUMB)));
  const labelledBy = (region) => {
    let n = region;
    for (let depth = 0; n && n !== document.body && depth < 5; depth++, n = n.parentElement) {
      const ids = clean(n.getAttribute('aria-labelledby'));
      if (!ids) continue;
      const t = clean(ids.split(' ').map((id) => {
        const e = document.getElementById(id);
        return e ? (e.innerText || e.textContent) : '';
      }).join(' '));
      if (t) return t;
    }
    return '';
  };
  const landmarkLabel = (region) => {
    const lm = region.closest(LANDMARKS);
    return lm ? clean(lm.getAttribute('aria-label')) : '';
  };
  // その場所の中の短い文字を、出てくる順に（6つまで）。題が地名の一語のときに、代わりの題を探すのに使う。
  const shortTexts = (region) => {
    const out = [];
    if (!region) return out;
    const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
    for (let k = 0; k < 200 && out.length < 6 && walker.nextNode(); k++) {
      const parent = walker.currentNode.parentElement;
      if (!parent || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(parent.tagName) || hidden(parent)) continue;
      const t = clean(walker.currentNode.nodeValue);
      if (t && t.length <= SHORT_MAX && /[A-Za-zぁ-んァ-ヶ一-龠]/.test(t.replace(/[年月日時分秒曜]/g, ''))) out.push(t);
    }
    return out;
  };
  // 読む・一覧のカードの中身の文字（題と同じ一語だけのカードを落とすのに使う）。押すカードは見ない。
  const bodyOf = (c) => {
    if (c.action === 'click') return '';
    let els = [];
    try {
      els = c.action === 'list' ? [...document.querySelectorAll(c.selector)] : [one(c.selector)].filter(Boolean);
    } catch (e) {
      return '';
    }
    return clean(els.map((e) => e.innerText || e.textContent).join(' ')).slice(0, 400);
  };
  const firstShortText = (region) => {
    const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
    for (let k = 0; k < 200 && walker.nextNode(); k++) {
      const node = walker.currentNode;
      const parent = node.parentElement;
      if (!parent || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(parent.tagName) || hidden(parent)) continue;
      const t = clean(node.nodeValue);
      // 日付や数字だけの文字（「11月3日」「2026.11.03」）は、題にしても何のカードか分からないので飛ばす。
      if (!t || !/[A-Za-zぁ-んァ-ヶ一-龠]/.test(t.replace(/[年月日時分秒曜]/g, ''))) continue;
      return t.length <= SHORT_MAX ? t : '';
    }
    return '';
  };
  const placeName = (region) => {
    if (!region) return '';
    return innerHeading(region) || precedingHeading(region) || labelledBy(region) || landmarkLabel(region) || firstShortText(region);
  };
  // 文書の中の順（束のカードを、Claude の返した順でなく、ページの上からの順に並べるため）。
  const order = new Map();
  [...document.querySelectorAll('*')].forEach((e, i) => order.set(e, i));
  // 中身が見出しだけか（見出しの文字を除くと、文字が残らない）。
  const squeeze = (t) => clean(t).replace(/[\s、。，．・：:（）()「」『』【】［］\[\]!！?？]/g, '');
  const headingOnly = (el) => {
    if (!el) return false;
    const all = squeeze(el.innerText || el.textContent);
    if (!all) return false;
    const heads = el.matches(HEADINGS) ? [el] : [...el.querySelectorAll(HEADINGS)];
    const headText = squeeze(heads.map((h) => h.innerText || h.textContent).join(''));
    return headText !== '' && all === headText;
  };
  // 押す所が、表示の切り替え（タブ・aria-controls・aria-pressed・aria-selected・三つ以上並んだボタンの一つ）か。
  // 切り替える先に表があれば 'table'、ほかは 'view'。切り替えでなければ ''。
  const toggleKind = (el) => {
    if (!el) return '';
    const isButton = el.matches('button, [role="button"], [role="tab"]');
    const isTab = el.getAttribute('role') === 'tab' || Boolean(el.closest('[role="tablist"]'));
    const controls = clean(el.getAttribute('aria-controls'));
    const state = el.hasAttribute('aria-pressed') || el.hasAttribute('aria-selected');
    const group = isButton && el.parentElement
      && [...el.parentElement.children].filter((x) => x.matches('button, [role="button"], [role="tab"]')).length >= 3;
    // ボタンの要素でなくても、名前（class）が切り替えの部品らしく（radio・tab・toggle・switch）、同じ名前の兄弟が三つ以上並ぶもの。
    // 気象庁の警報のページの「大雨・土砂災害・高潮」は、class が radio-button の div で、role も tabindex も無かった。
    const firstClass = (x) => (typeof x.className === 'string' ? x.className.trim().split(/\s+/)[0] : '');
    const lookalike = !el.matches('a') && /radio|tab|toggle|switch/i.test(firstClass(el)) && el.parentElement
      && [...el.parentElement.children].filter((x) => x.tagName === el.tagName && firstClass(x) === firstClass(el)).length >= 3;
    if (!(isTab || controls || state || group || lookalike)) return '';
    const hasTable = (t) => Boolean(t && (t.matches('table') || t.querySelector('table')));
    if (controls && controls.split(' ').some((id) => hasTable(document.getElementById(id)))) return 'table';
    // 切り替える先: 並びの後ろの兄弟（3つまで）。並びを包む要素を4段上までたどって、それぞれの後ろも見る。
    let box = el.closest('[role="tablist"]') || el.parentElement;
    for (let up = 0; box && box !== document.body && up < 4; up++, box = box.parentElement) {
      for (let n = box.nextElementSibling, d = 0; n && d < 3; n = n.nextElementSibling, d++) {
        if (hasTable(n)) return 'table';
      }
    }
    return 'view';
  };
  // サイトのメニューか（nav・header の中、または本文の区画の外にある、リンクやボタンだけの一覧）。束の後ろに回す。
  // つくば市の自転車のページで、一枚目にサイト全体のメニュー（6件）が来た（2026-11-04 の Windows の確かめ）。
  const mainEl = document.querySelector('main, [role="main"]');
  const linkOnlyItems = (items) => items.length > 0 && items.filter((it) => {
    const all = clean(it.textContent).replace(/\s/g, '');
    const linked = [...it.querySelectorAll('a, button, [role="button"], [role="link"]')].map((a) => clean(a.textContent)).join('').replace(/\s/g, '')
      + (it.matches('a, button, [role="button"], [role="link"]') ? clean(it.textContent).replace(/\s/g, '') : '');
    return all !== '' && linked.includes(all);
  }).length / items.length >= 0.8;
  const chromeOf = (c, el) => {
    if (!el) return false;
    if (el.closest('nav, header, [role="navigation"], [role="banner"]')) return true;
    if (mainEl && !mainEl.contains(el) && c.action === 'list') {
      let items = [];
      try {
        items = [...document.querySelectorAll(c.selector)];
      } catch (e) {
        return false;
      }
      return linkOnlyItems(items);
    }
    return false;
  };
  return cards.map((c) => {
    const probe = tryOne(c.selector);
    const containerOk = Boolean(c.container && one(c.container));
    const region = probe.count > 0 ? regionOf(c) : null;
    // 押すカードの題は、押す所そのものの名前だけ（分からなければ作らない）。
    const ownName = c.action === 'click' && probe.count === 1 ? nameOf(one(c.selector)) : '';
    const titleEl = one(c.titleSelector);
    let title = c.action === 'click' ? ownName : titleFits(titleEl, region) ? nameOf(titleEl) : '';
    if (!title && c.action !== 'click' && probe.count > 0) title = placeName(region);
    // 題が重なったときに、番号でなく別の題にするための候補（場所の中の見出し・直前の見出し・中の短い文字）。
    const alts = region ? [innerHeading(region), precedingHeading(region), ...shortTexts(region)].filter(Boolean) : [];
    return {
      count: probe.count, hasText: probe.hasText, containerOk, title: title.slice(0, 200), body: bodyOf(c), texts: shortTexts(region),
      alts: alts.map((t) => t.slice(0, 200)), toc: c.action !== 'click' && isToc(region), crumb: isCrumb(region),
      headingOnly: c.action === 'read' && headingOnly(one(c.selector)),
      toggle: c.action === 'click' && probe.count === 1 ? toggleKind(one(c.selector)) : '',
      chrome: probe.count > 0 ? chromeOf(c, region || one(c.selector)) : false,
      menu: c.action === 'list' && probe.count >= 5 && !isToc(region) ? (() => {
        try {
          return linkOnlyItems([...document.querySelectorAll(c.selector)]);
        } catch (e) {
          return false;
        }
      })() : false,
      menuNames: c.action === 'list' && probe.count >= 5 && region ? menuNames(c, region) : null,
      // 読む所・一覧の場所が、ページの上に描かれていない（畳まれた説明など、display:none の中）か。
      unrendered: c.action !== 'click' && Boolean(region) && region.getClientRects().length === 0,
      pageTitle: c.action !== 'click' && Boolean(region) && Boolean(title) && (() => {
        const h1 = document.querySelector('h1');
        return Boolean(h1 && !region.contains(h1) && !h1.contains(region) && nameOf(h1) === title);
      })(),
      pos: region && order.has(region) ? order.get(region) : (one(c.selector) && order.get(one(c.selector))) || 0,
    };
  });
}

// ページの中で動く関数。本文の区画の、見出しごとの節を探す（題はアプリの手元で使うだけで、外へは送らない）。
// 本文の区画は main か role="main"、無ければ文字の一番多い区画。見出しは h2（無ければ h3・h4）。
// 節は、見出しを含む区画（その見出しだけを含む section など）か、見出しから次の同じ段か上の段の見出しの手前まで。
// 文字が少ない節（minChars 字より少ない）と、Claude が選んだカード（taken の selector）の中にある節は作らない。
// 自転車のページの「〇〇とは」の長い段落など、本文の節を読むカードが無かった（2026-11-04 の Windows の確かめ）。
// あわせて、本文の区画の主な表・一覧を、二つまで返す（mainLists）。本文の最初の表（3行以上）と、行の一番多い table か ul・ol（3行以上）。
// 行の一番多い表だけでは、気象庁の警報のページで市町村別の表（49行）が選ばれ、一番大事な発表状況の表（8行）が作られなかった
// （2026-11-04 の Windows の確かめ）。発表状況の表は、本文の最初の表だった。
// Claude の案に無くても必ず一枚作るため（気象庁の警報のページで、一番大事な発表状況の表が、作るたびに入ったり入らなかったりした）。
function pageSections(taken, maxSections, minChars, maxMust, clicks = []) {
  const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  const textOf = (el) => clean(el.innerText || el.textContent);
  const hidden = (el) => Boolean(el.closest('[aria-hidden="true"], [hidden]')) || getComputedStyle(el).display === 'none';
  let main = document.querySelector('main, [role="main"]');
  if (!main) {
    let best = null;
    let most = 0;
    for (const el of document.querySelectorAll('article, section, div')) {
      if (el.closest('nav, header, footer, aside')) continue;
      const n = textOf(el).length;
      if (n > most && el.querySelector('h2, h3, h4')) {
        best = el;
        most = n;
      }
    }
    // 見出しが一つも無いページ（気象庁の警報のページは main も h1〜h6 も無かった。2026-11-04 に Mac で一度開いて測った）は、
    // body を本文の区画とみる（nav・header・footer・aside の中は、表・一覧のところで外す）。
    main = best || document.body;
  }
  if (!main) return { sections: [], mainLists: [], whole: [] };
  const order = new Map();
  [...document.querySelectorAll('*')].forEach((e, i) => order.set(e, i));
  // id は、英数字の名前（文字でないもの）で、ページに一つだけのときだけ使う。日本語などの id を selector に入れると、
  // その selector が直しのときに Claude へ送られる（見直しで見つけた経路）。
  const safeId = (n) => Boolean(n.id) && /^[A-Za-z0-9_:\-]{1,40}$/.test(n.id) && document.querySelectorAll(`#${CSS.escape(n.id)}`).length === 1;
  const selectorOf = (el) => {
    if (safeId(el)) return `#${CSS.escape(el.id)}`;
    const parts = [];
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      if (n !== el && safeId(n)) {
        parts.unshift(`#${CSS.escape(n.id)}`);
        break;
      }
      const tag = n.tagName.toLowerCase();
      if (tag === 'body') {
        parts.unshift('body');
        break;
      }
      const same = [...n.parentElement.children].filter((c) => c.tagName === n.tagName);
      parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(n) + 1})` : tag);
    }
    const sel = parts.join(' > ');
    return document.querySelector(sel) === el ? sel : null;
  };
  // 節の見出し: 本文の区画にある h2・h3・h4 のうち、上の二つの段（h2 と h3 など）。どちらの段の見出しも、そこで節を区切る。
  // 上の段（h2）だけで区切ると、つくば市の自転車のページのように、本文の大半が最初の h2 より前の h3 の節にあるページで、節にならなかった
  // （h2 は3つで、その節は40字と9字。2026-11-04 に Mac で一度開いて測った）。
  const usable = (h) => !hidden(h) && !h.closest('nav, aside') && textOf(h);
  const present = [2, 3, 4].filter((l) => [...main.querySelectorAll(`h${l}`)].some(usable));
  const levels = present.slice(0, 2);
  const level = levels.length > 0 ? levels[levels.length - 1] : 0;
  const headSel = levels.map((l) => `h${l}`).join(', ');
  const sectionHeads = level ? [...main.querySelectorAll(headSel)].filter(usable) : [];
  // 本文を丸ごと読むカード（Claude の案で、節の見出しを二つ以上含む読むカード）は、節のカードに分ける。
  // 自転車のページで、本文を丸ごと読むカードがあり、重なりの判断で節のカードが全部はじかれた（2026-11-04 の Windows の確かめ）。
  // 読むカードが読むのは、当たる要素の最初の一つだけなので、重なりの判断もその一つで見る（一覧のカードは全部）。
  const takenEls = [];
  const takenCards = [];
  const whole = [];
  for (const t of taken) {
    const s = Array.isArray(t) ? t[0] : t;
    const firstOnly = Array.isArray(t) && t[1] === 'read';
    let els = [];
    try {
      els = firstOnly ? [document.querySelector(s)].filter(Boolean) : [...document.querySelectorAll(s)];
    } catch (e) {
      // 書き方の誤りのある selector は、もう落としてある
    }
    // 本文を丸ごと読むカード: 読むカードは最初の一つが、一覧のカードは項目の全部が、節の見出しを二つ以上含むもの。
    // 一覧のカードで、本文の div を項目にしたもの（.wysiwyg など）が節を全部はじいた（頼み16 の後戻り。作り物のページで再現した）。
    const covered = firstOnly ? els.slice(0, 1) : els;
    if (els.length > 0 && sectionHeads.filter((h) => covered.some((e) => e.contains(h))).length >= 2) whole.push(s);
    else {
      takenEls.push(...els);
      if (els.length > 0) takenCards.push(els);
    }
  }
  // 本文の主な表・一覧。
  const outside = (el) => Boolean(el.closest('nav, header, footer, aside, [role="navigation"]')) || hidden(el);
  // 必ず作る表を作らないのは、Claude のカードがその表そのものか、表の行の半分以上を項目にしているときだけ。
  // 表を含む大きな包み（本文の全部を読むカードなど）や、表の中の升目だけのカードでは、表は作る
  // （包み全体を読むカードがあると、発表状況の表も市町村別の表も作られなかった。頼み16 の後戻り。作り物のページで再現した）。
  const overlapsTaken = (el) => {
    if (takenEls.includes(el)) return true;
    const rows = el.matches('table') ? [...el.rows] : [...el.querySelectorAll('[role="row"], :scope > li')];
    return rows.length > 0 && rows.filter((r) => takenEls.includes(r)).length / rows.length >= 0.5;
  };
  // 目次（同じページの中を指すリンクの一覧）は、主な一覧にしない。
  const tocLike = (l) => {
    const links = [...l.querySelectorAll('a[href]')];
    return links.length >= 2 && links.filter((a) => /^#./.test(a.getAttribute('href'))).length / links.length >= 0.8;
  };
  // リンクやボタンだけが並ぶ一覧（選ぶための一覧・メニュー）か。項目の8割以上で、項目の文字が全部リンクかボタンの文字のとき。
  // 気象庁の警報のページで、ページの上の「市町村選択」（リンクの一覧 53行）が必ず作る枠を取り、発表状況の表も市町村別の表も
  // 作られなかった（2026-11-04 の Windows の確かめ）。
  const linkOnly = (items) => {
    if (items.length === 0) return false;
    const n = items.filter((it) => {
      const all = clean(it.textContent).replace(/\s/g, '');
      const linked = [...it.querySelectorAll('a, button, [role="button"], [role="link"], [role="option"]')].map((a) => clean(a.textContent)).join('').replace(/\s/g, '');
      return all !== '' && linked === all;
    }).length;
    return n / items.length >= 0.8;
  };
  const lists = [];
  const dataRows = (t) => [...t.querySelectorAll('tr')].filter((r) => r.querySelector('td, th') && (r.querySelector('td') || r.parentElement.tagName !== 'THEAD')).length;
  // 画面に描かれていない表（説明を畳んだ中の表・幅で隠れる固定の列）は、そのままでは選ばない。組の片方が描かれていれば、その方を読む。
  // 気象庁の警報のページで、畳んだ説明の中の表（4行）が「本文の最初の表」に選ばれた（本物の Claude の案を本物のページに当てて確かめた）。
  const rendered = (el) => el.getClientRects().length > 0;
  const nav = (el) => Boolean(el.closest('nav, header, footer, aside, [role="navigation"]'));
  const tables = [...main.querySelectorAll('table')].filter((t) => !nav(t) && !t.parentElement.closest('table'));
  // 横に長い表を、左の固定の列（名前）と右の流れる列（値）の二つの表に分けて描くページがある（気象庁の警報のページ）。
  // 二つの表が、同じ親の隣り合う子の中にあり、行の数が同じなら、組にして一行ずつつないで読む（joinWith）。
  const paired = new Set();
  const pairOf = new Map();
  const partnerOf = new Map(); // 組にした二つ目の表（同じ中身の写しも含む）
  for (const t of tables) {
    if (paired.has(t)) continue;
    let a = t;
    while (a.parentElement && a.parentElement !== main && a.parentElement.children.length === 1) a = a.parentElement;
    const sib = a.nextElementSibling;
    const u = sib ? (sib.matches('table') ? sib : sib.querySelector('table')) : null;
    if (u && u !== t && tables.includes(u) && !paired.has(u) && dataRows(u) === dataRows(t) && dataRows(t) >= 3) {
      paired.add(u);
      partnerOf.set(t, u);
      partnerOf.set(u, t);
      // 二つが同じ中身の写し（固定の列と流れる列を、同じ表を二つ描いて見せるページ。気象庁の早期注意情報）なら、つながず一つだけ読む。
      if (clean(t.textContent) !== clean(u.textContent)) pairOf.set(t, u);
    }
  }
  // 表の一つずつ（組は一つにまとめる）。読む表: ふつうはこの表。描かれていなくて、同じ中身の写しの片方が描かれていれば、そちらを読む。
  // 中身の違う組（名前と値）は、隠れた方も含めてつないで読む（隠れた文字も読める）。どちらも描かれていなければ選ばない。
  const tableUnits = [];
  for (const t of tables) {
    if (paired.has(t)) continue;
    let el = t;
    if (!rendered(t)) {
      const u = partnerOf.get(t);
      if (pairOf.has(t) && rendered(u)) el = t;
      else if (u && rendered(u)) el = u;
      else continue;
    }
    if (hidden(el)) continue;
    const rowEls = [...el.querySelectorAll('tr')].filter((r) => r.querySelector('td'));
    const rows = pairOf.has(t) ? dataRows(t) : rowEls.length;
    if (rows === 0) continue;
    // 分けて描いた表の頭（td の行が一つまでで、すぐ後ろに表が続くもの）は、表の一つに数えない（題の手がかりにだけ使う）。
    // 気象庁の早期注意情報で、頭の表と本体の表が同じ題の二枚になった（本物の Claude の案を本物のページに当てて確かめた）。
    const nextEl = t.nextElementSibling;
    if (rowEls.length <= 1 && !pairOf.has(t) && nextEl && (nextEl.matches('table') || nextEl.querySelector('table'))) continue;
    tableUnits.push({ el, t, rows, rowEls, table: true, join: el === t ? pairOf.get(t) || null : null });
  }
  for (const x of tableUnits) if (x.rows >= 3 && !linkOnly(x.rowEls)) lists.push(x);
  // role の付いた表（role=table・grid）。行は role=row で、升目のある行。
  for (const t of main.querySelectorAll('[role="table"], [role="grid"]')) {
    if (t.matches('table') || outside(t) || t.parentElement.closest('[role="table"], [role="grid"], table')) continue;
    const rowEls = [...t.querySelectorAll('[role="row"]')].filter((r) => r.querySelector('[role="cell"], [role="gridcell"]'));
    if (rowEls.length >= 3 && !linkOnly(rowEls)) lists.push({ el: t, rows: rowEls.length, table: true, role: true, join: null });
  }
  for (const l of main.querySelectorAll('ul, ol')) {
    const items = [...l.children].filter((c) => c.tagName === 'LI');
    const rows = items.length;
    if (rows >= 3 && !outside(l) && l.getClientRects().length > 0 && !l.parentElement.closest('ul, ol') && !tocLike(l) && !linkOnly(items)) lists.push({ el: l, rows, table: false });
  }
  // 表・一覧の題の手がかり。
  // 表の頭の、升目が一つだけの見出しの行（th）を題にする。表そのものの一行目か、分けて描いた表の頭（見出しの行だけの表）の一行目。
  // 気象庁の警報の表は、題（「〇〇の警報・注意報（市町村別）」）が表の頭の見出しの行にあった。
  // headOnly は、分けて描いた表の頭（升目の td の行が一つまで）。そのときは一行目が升目一つの th なら題にする。
  // 表そのもののときは、名前の列だけの表（どの行も升目が一つ）の一行目と見分けるため、横に広がる升目か、次の行の升目が二つ以上のときだけ。
  const titleRow = (tb, headOnly = false) => {
    const r = tb && tb.rows ? tb.rows[0] : null;
    if (!r || r.cells.length !== 1 || r.cells[0].tagName !== 'TH') return '';
    const next = tb.rows[1];
    return headOnly || r.cells[0].colSpan > 1 || (next && next.cells.length > 1) ? textOf(r.cells[0]) : '';
  };
  const headTable = (p) => p.matches('table') && [...p.rows].filter((r) => r.querySelector('td')).length <= 1;
  // 行が3つより少なくても、表の題の行（表の頭の升目一つの見出しの行）か caption のある表は、主な表の候補にする。
  // 気象庁の発表状況の表（地域が二つで、td の行が2つ）が、Claude の案が警戒レベルの表だけを指した回に、束から抜けた（頼み20 の確かめ）。
  for (const x of tableUnits) if (x.rows < 3 && !linkOnly(x.rowEls) && (titleRow(x.t) || (x.t.caption && textOf(x.t.caption)))) lists.push(x);
  const titlesOf = (el, isTable) => {
    const cap = isTable && el.caption ? textOf(el.caption) : '';
    const label = clean(el.getAttribute('aria-label'));
    let heading = '';
    for (let n = el, d = 0; n && n !== main && !heading && d < 3; n = n.parentElement, d++) {
      for (let p = n.previousElementSibling; p && !heading; p = p.previousElementSibling) {
        const h = p.matches('h1, h2, h3, h4, h5, h6') ? p : null;
        if (h) heading = textOf(h);
        else if (p.querySelector('h1, h2, h3, h4, h5, h6')) break;
      }
    }
    let rowTitle = el.matches('table') ? titleRow(el) : '';
    for (let n = el, d = 0; n && n !== main && !rowTitle && d < 6; n = n.parentElement, d++) {
      for (let p = n.previousElementSibling; p && !rowTitle; p = p.previousElementSibling) {
        if (headTable(p)) rowTitle = titleRow(p, true);
        else if (p.matches('table') || p.querySelector('table')) break;
      }
    }
    // 見出しの無いページでは、表の前（6段上まで）にある短い文（40字まで）を題にする。見出しの行だけの表（分けて描いた表の頭）は飛ばす。
    let near = '';
    for (let n = el, d = 0; n && n !== main && !near && d < 6; n = n.parentElement, d++) {
      for (let p = n.previousElementSibling; p && !near; p = p.previousElementSibling) {
        if (p.matches('script, style')) continue;
        if (headTable(p)) continue;
        if (p.querySelector('table') || p.matches('table')) break;
        const t = textOf(p);
        if (t && t.length <= 40) near = t;
        else if (t) break;
      }
    }
    return { cap, label, heading, rowTitle, near };
  };
  const rowsSelector = (x) => (x.role ? `${selectorOf(x.el)} [role="row"]:has([role="cell"], [role="gridcell"])`
    : x.join ? `${selectorOf(x.el)} tr:has(td, th):not(thead tr)` : `${selectorOf(x.el)} tr:has(td)`);
  // Claude の読むカードが、表を読むためのもの（中の文字の6割以上が表）なら、表ごとの一覧のカードにする（splits）。
  // 表が二つ以上なら、表ごとに分ける。読むカードのままだと表をまるごと読み、二つの表が一枚の題にまとまった
  // （気象庁の警報のページで、「〇〇の警報・注意報（発表状況）」のカードが無くなった。本物の Claude の案を本物のページに当てて確かめた）。
  // 表のかけらを並べる一覧のカード（項目が表の升目か、二つ以上の表にまたがる行）は作らない。その表は、表ごとのカード（必ず作る表）で読む。
  // 気象庁の警報のページで、発表状況と警戒レベルの表の升目だけの一覧（題が古い更新の時刻）や、二つの表の行をまたぐ一覧
  // （「全国 〇〇の警報・注意報」の題で警戒レベルの表を読む）ができ、発表状況のカードが無くなった（頼み27 の7〜9）。
  const unitOf = (node) => tableUnits.find((x) => [x.el, x.t, partnerOf.get(x.t)].some((m) => m && m.contains(node)));
  const fragments = [];
  // 一つの表の行だけを並べる一覧のカードは、題をその表の題（caption・aria-label・表の頭の題の行）にする（題の元が別の表の題を指していた。頼み27 の9）。
  const retitles = {};
  for (const t of taken) {
    if (!Array.isArray(t) || t[1] !== 'list') continue;
    let els = [];
    try {
      els = [...document.querySelectorAll(t[0])];
    } catch (err) {
      els = [];
    }
    if (els.length === 0) continue;
    const units = els.map(unitOf);
    if (units.some((u) => !u)) continue;
    const cells = els.every((e) => e.matches('td, th') || Boolean(e.closest('td, th')));
    if (!cells && new Set(units).size < 2) {
      if (els.every((e) => e.matches('tr'))) {
        const tt = titlesOf(units[0].el, true);
        if (tt.cap || tt.label || tt.rowTitle) retitles[t[0]] = tt.cap || tt.label || tt.rowTitle;
      }
      continue;
    }
    fragments.push(t[0]);
    for (const e of els) {
      const k = takenEls.indexOf(e);
      if (k >= 0) takenEls.splice(k, 1);
    }
    const c = takenCards.findIndex((group) => group.length === els.length && group.every((e, i) => e === els[i]));
    if (c >= 0) takenCards.splice(c, 1);
  }
  const splits = {};
  const claimed = new Set();
  for (const t of taken) {
    if (!Array.isArray(t) || t[1] !== 'read') continue;
    let e = null;
    try {
      e = document.querySelector(t[0]);
    } catch (err) {
      e = null;
    }
    if (!e) continue;
    // 分けて描いた表の頭（題と時刻だけの表）を読むカードは、その頭が付く表を読むカードにする（同じ表のカードを二枚作らない）。
    // 気象庁の早期注意情報で、頭の表を読むカードと、必ず作る表のカードが同じ題になり、「 2」が付いた（頼み27 の7）。
    if (headTable(e) && !tableUnits.some((x) => x.el === e || x.t === e) && e.parentElement) {
      const body = tableUnits.filter((x) => e.parentElement.contains(x.el) && x.el !== e);
      if (body.length === 1) {
        const x = body[0];
        const tt = titlesOf(x.el, true);
        claimed.add(x.el);
        claimed.add(x.t);
        if (partnerOf.has(x.t)) claimed.add(partnerOf.get(x.t));
        splits[t[0]] = [{
          selector: rowsSelector(x), container: selectorOf(x.el), ...(x.join ? { joinWith: `${selectorOf(x.join)} tr:has(td, th):not(thead tr)` } : {}),
          title: tt.cap || tt.label || tt.rowTitle || '', near: tt.heading || tt.near || '', pos: order.get(x.el),
        }].filter((u) => u.container);
        continue;
      }
    }
    // 組の表は、読むカードがどちらか片方を含めば、その組を読むとみる（隠れた固定の列の表だけを指すカードもある）。
    const partner = (x) => partnerOf.get(x.t) || null;
    const inside = tableUnits.filter((x) => [x.el, x.t, partner(x)].some((m) => m && (e === m || e.contains(m))));
    if (inside.length === 0) continue;
    // 表の文字は、組の両方（同じ中身の写しも）を数える（区画の文字には、写しも入っているため）。
    const tableText = inside.reduce((n, x) => n + textOf(x.t).length + (partner(x) ? textOf(partner(x)).length : 0), 0);
    const all = textOf(e).length;
    if (all === 0 || tableText / all < 0.6) continue;
    splits[t[0]] = inside.map((x) => {
      const tt = titlesOf(x.el, true);
      claimed.add(x.el);
      claimed.add(x.t);
      if (partnerOf.has(x.t)) claimed.add(partnerOf.get(x.t));
      return {
        selector: rowsSelector(x), container: selectorOf(x.el), ...(x.join ? { joinWith: `${selectorOf(x.join)} tr:has(td, th):not(thead tr)` } : {}),
        title: tt.cap || tt.label || tt.rowTitle || '', near: tt.heading || tt.near || '', pos: order.get(x.el),
      };
    }).filter((u) => u.container);
  }
  // 表を先にする: 本文の最初の表と、行の一番多い表。表が一つも無いときだけ、行の一番多い一覧。
  const byOrder = (a, b) => order.get(a.el) - order.get(b.el);
  const bySize = (a, b) => b.rows - a.rows || byOrder(a, b);
  // Claude のカードがもう読んでいる表（組の片方を読んでいるものも）は除いてから、本文の最初の表と行の一番多い表を選ぶ。
  // 気象庁の警報のページで、Claude のカードが発表状況と時系列の表を読んでいたので、必ず作る二つの枠が両方そこに当たって外れ、
  // 三つ目の大きな表（市町村別・45行）が作られなかった（本物の Claude の案を本物のページに当てて確かめた）。
  const free = (x) => !claimed.has(x.el) && !overlapsTaken(x.el) && !(partnerOf.has(x.el) && overlapsTaken(partnerOf.get(x.el)));
  const tableItems = lists.filter((x) => x.table && free(x));
  const firstTable = tableItems.slice().sort(byOrder)[0];
  const largest = tableItems.length > 0 ? tableItems.slice().sort(bySize)[0] : lists.filter(free).sort(bySize)[0];
  const must = [];
  for (const x of [firstTable, largest]) {
    if (x && !must.includes(x) && must.length < maxMust) must.push(x);
  }
  // 表そのものに題のある表（caption か、表の頭の題の行）は、Claude の案に無くても、ページの上からの順に3枚まで足す。
  // 気象庁の警報のページで、Claude の案の形によって時系列・早期注意・市町村別の表があったり無かったりし、束の枚数が回ごとに揺れた（頼み27）。
  for (const x of tableItems.slice().sort(byOrder)) {
    if (must.length >= maxMust + 3) break;
    if (must.includes(x)) continue;
    const tt = titlesOf(x.el, true);
    if (tt.cap || tt.rowTitle) must.push(x);
  }
  const mainLists = [];
  for (const top of must) {
    if (overlapsTaken(top.el)) continue;
    const sel = selectorOf(top.el);
    if (!sel) continue;
    const { cap, label, heading, rowTitle, near } = titlesOf(top.el, top.table);
    mainLists.push({
      el: top.el, selector: top.table ? rowsSelector(top) : `${sel} > li`, container: sel, table: top.table,
      ...(top.join ? { joinWith: `${selectorOf(top.join)} tr:has(td, th):not(thead tr)` } : {}),
      title: cap || label || heading || rowTitle || near, alts: [cap, label, rowTitle, heading, near].filter(Boolean),
      text: textOf(top.el).slice(0, 400), pos: order.get(top.el),
    });
  }
  // 節の中に必ず作る一覧（ul・ol）があれば、節を残して一覧の方を作らない（節が一覧も読むため）。必ず作る表のときは、今までどおり節を作らない。
  // つくば市の自転車のページで、一覧を含む節が作られず、一覧だけのカードになって節の文が抜けた（2026-11-04 に Mac で本物を開いて確かめた）。
  const dropMust = new Set();
  const holdsMust = (nodes) => mainLists.some((m) => {
    if (!nodes.some((n) => n === m.el || n.contains(m.el))) return false;
    if (m.table) return true;
    dropMust.add(m);
    return false;
  });
  // 目次の項目が指す見出しは、短くても節の区切りにする（id か、昔の書き方の a[name] で指す）。
  // つくば市の自転車のページで、目次にある「利用料」などの節が、文字が少ないので作られなかった。
  const tocHeads = new Set();
  for (const l of main.querySelectorAll('ul, ol')) {
    if (!tocLike(l)) continue;
    for (const a of l.querySelectorAll('a[href^="#"]')) {
      let key = '';
      try {
        key = decodeURIComponent(a.getAttribute('href').slice(1));
      } catch (e) {
        continue;
      }
      const el = key ? document.getElementById(key) || document.querySelector(`a[name="${CSS.escape(key)}"]`) : null;
      const h = el ? (el.matches('h1, h2, h3, h4, h5, h6') ? el : el.closest('h1, h2, h3, h4, h5, h6')) : null;
      if (h) tocHeads.add(h);
    }
  }
  const plain = () => mainLists.filter((m) => !dropMust.has(m)).map(({ el, ...rest }) => rest);
  // 表を切り替える部品の並び（タブ・ラジオボタンのような、同じ名前の部品が三つ以上並ぶもの）で、すぐ後ろの区画に表があるもの。
  // Claude の案に無くても、並びごとに一枚「表を替える」のカードを作る（Claude の案の回によって、あったりなかったりした。頼み18 の確かめ）。
  // 押すのは、いま選ばれていない最初の部品。Claude の押すカードがその並びの中の部品を押すなら作らない。二つの並びまで。
  const toggles = [];
  {
    const clickEls = [];
    for (const c of clicks) {
      try {
        const e = document.querySelector(c);
        if (e) clickEls.push(e);
      } catch (err) {
        // 書き方の誤りのある selector は、もう落としてある
      }
    }
    const firstClass = (x) => (typeof x.className === 'string' ? x.className.trim().split(/\s+/)[0] : '');
    const seen = new Set();
    const cands = [...main.querySelectorAll('[role="tab"], [class*="radio" i], [class*="tab" i], [class*="toggle" i], [class*="switch" i]')];
    for (const el of cands) {
      if (toggles.length >= 2) break;
      if (el.matches('a, input, table, tr, td, th, tbody') || nav(el) || !rendered(el)) continue;
      const parent = el.parentElement;
      if (!parent || seen.has(parent)) continue;
      const kind = el.getAttribute('role') === 'tab' ? 'tab' : firstClass(el);
      if (!kind) continue;
      const group = [...parent.children].filter((x) => x.tagName === el.tagName && (kind === 'tab' ? x.getAttribute('role') === 'tab' : firstClass(x) === kind));
      if (group.length < 3) continue;
      seen.add(parent);
      if (group.some((g) => clickEls.some((c) => c === g || g.contains(c) || c.contains(g)))) continue;
      let hasTable = false;
      for (let box = parent, up = 0; box && box !== document.body && up < 4 && !hasTable; up++, box = box.parentElement) {
        for (let n = box.nextElementSibling, d = 0; n && d < 3; n = n.nextElementSibling, d++) {
          if (n.matches('table') || n.querySelector('table')) {
            hasTable = true;
            break;
          }
        }
      }
      if (!hasTable) continue;
      const on = (g) => g.getAttribute('aria-selected') === 'true' || g.getAttribute('aria-pressed') === 'true' || /(^|[-_\s])(on|active|selected|current)($|[-_\s])/i.test(g.className || '');
      const pick = group.find((g) => !on(g) && textOf(g)) || group.find((g) => textOf(g));
      const sel = pick ? selectorOf(pick) : null;
      const name = pick ? textOf(pick) : '';
      if (sel && name && name.length <= 30) toggles.push({ selector: sel, name, pos: order.get(pick) });
    }
  }
  if (!level) return { sections: [], mainLists: plain(), whole: [], splits, toggles, fragments, retitles };
  const stops = Array.from({ length: level }, (_, k) => `h${k + 1}`).join(', ');
  const until = `${stops}, :has(${stops})`;
  const out = [];
  for (const h of sectionHeads) {
    if (out.length >= maxSections) break;
    if (hidden(h) || h.closest('nav, aside')) continue;
    const title = textOf(h);
    if (!title || takenEls.some((t) => t.contains(h))) continue;
    const need = tocHeads.has(h) ? 1 : minChars;
    // 節の中に、Claude が選んだカードの場所があれば作らない（同じ所を二度読むカードになるため）。
    // 節を作らないのは、Claude のカードがその節を読むとき: カードの要素が節の範囲を全部含むか、カードの要素の半分以上が節の中にあって、
    // 節の文字の半分以上を読むとき。節の中の一部に、ほかの所にも当たるカードがかかるだけなら、節は作る
    // （目次のリンクの一覧の selector が節の中の一覧にも当たり、節がはじかれた。頼み16 の後戻り。作り物のページで再現した）。
    const textLen = (els) => els.reduce((n, e) => n + textOf(e).length, 0);
    const overlaps = (nodes) => takenCards.some((els) => {
      if (els.some((e) => nodes.every((n) => e === n || e.contains(n)))) return true;
      const inside = els.filter((e) => nodes.some((n) => n === e || n.contains(e)));
      if (inside.length === 0 || inside.length / els.length < 0.5) return false;
      const all = textLen(nodes);
      return all === 0 || textLen(inside) / all >= 0.5;
    });
    // 見出しを頭に持ち、ほかの中身もある区画（その見出しだけを含む section など）なら、その区画を読む。
    const box = h.parentElement;
    if (box && box !== main && main.contains(box) && box.children.length > 1 && box.querySelectorAll(stops).length === 1 && box.firstElementChild === h) {
      const sel = selectorOf(box);
      const chars = textOf(box).length - title.length;
      if (sel && chars >= need && !overlaps([box]) && !holdsMust([box])) {
        out.push({ selector: sel, until: null, title, chars, pos: order.get(box) });
      }
      continue;
    }
    // 見出しから、次の同じ段か上の段の見出しの手前まで。見出しが包みの中にあるときは、包みから数える。
    let anchor = h;
    while (!anchor.nextElementSibling && anchor.parentElement && anchor.parentElement !== main) anchor = anchor.parentElement;
    let chars = 0;
    const range = [anchor];
    for (let n = anchor.nextElementSibling; n && !n.matches(until); n = n.nextElementSibling) {
      chars += textOf(n).length;
      range.push(n);
    }
    const sel = selectorOf(anchor);
    if (sel && chars >= need && !overlaps(range) && !holdsMust(range)) {
      out.push({ selector: sel, until, title, chars, pos: order.get(anchor) });
    }
  }
  // 節のカードができたときだけ、丸ごとのカードを外す（節ができなければ、丸ごとのカードを残す）。
  return { sections: out, mainLists: plain(), whole: out.length > 0 ? whole : [], splits, toggles, fragments, retitles };
}

function buildSectionsScript(taken, clicks = []) {
  return `(${pageSections.toString()})(${JSON.stringify(taken)}, ${MAX_SECTIONS}, ${SECTION_MIN_CHARS}, ${MAX_MUST_LISTS}, ${JSON.stringify(clicks)})`;
}

// 節を読むカードを足す。題は見出しの文字（重なれば番号）。束は全部で MAX_CARDS + MAX_SECTIONS 枚まで。
function addSectionCards(cards, sections) {
  const out = [...cards];
  const titles = new Set(out.map((c) => c.title));
  for (const s of sections) {
    if (out.length >= MAX_CARDS + MAX_SECTIONS) break;
    const title = cleanTitle(s.title);
    if (!title) continue;
    let unique = title;
    for (let n = 2; titles.has(unique); n++) unique = `${title} ${n}`;
    titles.add(unique);
    const card = { id: `section-${out.length + 1}`, title: unique, action: 'read', selector: s.selector };
    if (s.until) card.until = s.until;
    Object.defineProperty(card, 'pos', { value: Number(s.pos) || 0, enumerable: false });
    // 「お問い合わせ」などの節も、束の後ろにまとめる。
    Object.defineProperty(card, 'back', { value: BACK_TITLE.test(unique), enumerable: false });
    out.push(card);
  }
  return out;
}

// 本文の主な表・一覧のカードを、Claude の案に無ければ足す。題は表の題（caption）・aria-label・直前の見出し、無ければ「表を読む」「一覧を読む」。
function addMainListCards(cards, mainLists) {
  let out = cards;
  for (const m of Array.isArray(mainLists) ? mainLists : []) out = addMainListCard(out, m);
  return out;
}

// 表を切り替える部品の並びの「表を替える（部品の名前）」のカード（pageSections の toggles）。
function addToggleCards(cards, toggles) {
  let out = cards;
  for (const t of Array.isArray(toggles) ? toggles : []) {
    const titles = new Set(out.map((c) => c.title));
    let title = `表を替える（${cleanTitle(t.name)}）`;
    for (let n = 2; titles.has(title); n++) title = `表を替える（${cleanTitle(t.name)}） ${n}`;
    const card = { id: `button-${out.length + 1}`, title, action: 'click', selector: t.selector };
    Object.defineProperty(card, 'pos', { value: Number(t.pos) || 0, enumerable: false });
    out = [...out, card];
  }
  return out;
}

// 表を読むための Claude の読むカードを、表ごとの一覧のカードにする（pageSections の splits）。
// 表が一つなら、Claude のカードの題のまま一覧のカードにする（行ごとに読み、二つに分けて描いた表の写しを二度読まない）。
// 表が二つ以上なら表ごとに分け、題は表の題（表の頭の見出しの行など）。題の無い表は、一つ目だけ Claude のカードの題を使い、ほかは作らない。
function applySplits(cards, splits) {
  if (!splits) return cards;
  const out = [];
  const titles = new Set(cards.filter((c) => !(c.action === 'read' && splits[c.selector])).map((c) => c.title));
  for (const c of cards) {
    const units = c.action === 'read' ? splits[c.selector] : null;
    if (!Array.isArray(units) || units.length === 0) {
      out.push(c);
      continue;
    }
    units.forEach((u, i) => {
      // 表の題（表の題・aria-label・表の頭の行）があれば、それを使う。無ければ Claude のカードの題。
      // Claude のカードの題が地名から作った仮の題（「〇〇の情報」）か、ほかのカードと重なるときは、表の前の見出しか短い文を使う。
      // 気象庁の警報のページで、表そのものを読む二枚の題が「〇〇の情報」「〇〇の情報 2」になり、発表状況の表が束に無かった（試しの作り物のページで再現）。
      const near = cleanTitle(u.near);
      const own = c.weak || titles.has(c.title) ? near : '';
      let title = cleanTitle(u.title) || (units.length === 1 || i === 0 ? own || c.title : near);
      if (!title) return;
      if (titles.has(title) && near && !titles.has(near)) title = near;
      // 二つ目からの表で題が重なるものは作らない（番号付きの重なりにしない）。
      if (i > 0 && titles.has(title)) return;
      for (let n = 2; titles.has(title); n++) title = `${cleanTitle(u.title) || c.title} ${n}`;
      titles.add(title);
      const card = { id: c.id, title, action: 'list', selector: u.selector, container: u.container };
      if (u.joinWith) card.joinWith = u.joinWith;
      Object.defineProperty(card, 'pos', { value: Number(u.pos) || c.pos || 0, enumerable: false });
      Object.defineProperty(card, 'back', { value: Boolean(c.back), enumerable: false });
      Object.defineProperty(card, 'body', { value: c.body, enumerable: false });
      out.push(card);
    });
  }
  return out;
}

// 一つの表の行だけを並べる一覧のカードの題を、その表の題にする（ほかのカードと重ならないときだけ）。
function retitleCards(cards, retitles) {
  if (!retitles) return cards;
  const titles = new Set(cards.map((c) => c.title));
  return cards.map((c) => {
    const t = c.action === 'list' ? cleanTitle(retitles[c.selector]) : '';
    if (!t || t === c.title || titles.has(t)) return c;
    titles.delete(c.title);
    titles.add(t);
    const card = { ...c, title: t };
    for (const k of ['pos', 'back', 'body', 'meta']) Object.defineProperty(card, k, { value: c[k], enumerable: false });
    return card;
  });
}

// 日時だけの文か（数字・年月日時分秒・区切りと、末尾の「更新」「発表」「現在」だけ）。
// 中身の分からない題: 更新日などの日付の行（「最終更新日：2026年6月27日」）と、「リンク」「詳細」「一覧」のような一語。
// 「イベント」のページから作った束に「最終更新日：…」「リンク」の題が出た（2026-11-06 の WinCC の確かめ）。
const META_TITLE = /^(最終)?(更新|公開|掲載|作成|登録)(日|日時|日付)?\s*[：:]/;
const GENERIC_TITLE = /^(リンク|リンク集|関連リンク|link|links|詳細|詳しく|詳しくはこちら|もっと見る|続きを読む|一覧|一覧を見る|一覧へ|こちら|ここ|more|read more|top|トップ|戻る|ページの先頭へ)$/i;
function isVagueTitle(text) {
  const t = String(text || '').trim();
  return isTimeOnly(t) || META_TITLE.test(t) || GENERIC_TITLE.test(t);
}

function isTimeOnly(text) {
  const t = String(text || '').trim();
  return /[0-9０-９]/.test(t) && /^[0-9０-９年月日時分秒\s:：\/.\-（）()]+(更新|発表|現在)?$/.test(t);
}

// 題がほかのカードと重なるときは、題の取り方が違う疑いとして扱う: 中身がそのカードの中身に含まれるなら作らない。
// 含まれなければ、ほかの取り方の題（表の題・aria-label・表の頭の行・見出し・前の短い文）から、重ならないものを使う（頼み18 の確かめ）。
function addMainListCard(cards, mainList) {
  if (!mainList || !mainList.selector) return cards;
  const titles = new Set(cards.map((c) => c.title));
  let title = cleanTitle(mainList.title) || (mainList.table ? '表を読む' : '一覧を読む');
  if (titles.has(title)) {
    const same = cards.find((c) => c.title === title);
    if (same && same.body && squeezeText(same.body).includes(squeezeText(mainList.text).slice(0, 200))) return cards;
    const alt = (Array.isArray(mainList.alts) ? mainList.alts : []).map((t) => cleanTitle(t)).find((t) => t && !titles.has(t));
    if (alt) title = alt;
  }
  let unique = title;
  for (let n = 2; titles.has(unique); n++) unique = `${title} ${n}`;
  const card = { id: `${mainList.table ? 'table' : 'list'}-${cards.length + 1}`, title: unique, action: 'list', selector: mainList.selector, container: mainList.container };
  if (mainList.joinWith) card.joinWith = mainList.joinWith;
  Object.defineProperty(card, 'pos', { value: Number(mainList.pos) || 0, enumerable: false });
  return [...cards, card];
}

function buildInspectScript(candidates) {
  return `(${pageInspect.toString()})(${pageTry.toString()}, ${JSON.stringify(candidates)})`;
}

// 題と束の名前は、長ければ語の切れ目（読点・空白・括弧・スラッシュの前か、閉じ括弧の後）で切る。
// 語の途中で切れた（「…／つくば市公」「…（予約電話番号、利用方」。2026-11-04 の Windows の確かめ）。
// 切れ目が前すぎる（上限の半分より前）ときだけ、上限の字数で切る。
const CUT_BEFORE = /[、。，．,\s／/｜|（(「『【［[〔・：:－—–〜~]/;
const CUT_AFTER = /[）)」』】］\]〕]/;
// 題の頭の飾りの記号（「▼ 説明を表示する」の ▼ など）。読み上げソフトがそのまま「下向き三角」などと読むので落とす。
const LEAD_MARKS = /^[▲▼△▽■□●○◆◇►▶▷▸▹◀◁◂◃★☆※＊*・]+\s*/;

function cleanTitle(text, max = TITLE_MAX) {
  const t = String(text || '').replace(/\s+/g, ' ').trim().replace(LEAD_MARKS, '');
  if (t.length <= max) return t;
  let cut = -1;
  for (let i = max; i > 0; i--) {
    if (CUT_BEFORE.test(t[i]) || CUT_AFTER.test(t[i - 1])) {
      cut = i;
      break;
    }
  }
  let head = cut >= Math.floor(max / 2) ? t.slice(0, cut) : t.slice(0, max);
  // 開いたまま閉じていない括弧が残るなら、その括弧の前で切る（「…（予約電話番号」としない）。
  const open = Math.max(...['（', '(', '「', '『', '【', '［', '['].map((b) => {
    const at = head.lastIndexOf(b);
    const close = { '（': '）', '(': ')', '「': '」', '『': '』', '【': '】', '［': '］', '[': ']' }[b];
    return at >= 0 && head.indexOf(close, at) < 0 ? at : -1;
  }));
  if (open >= Math.floor(max / 2)) head = head.slice(0, open);
  return head.replace(/[、。，．,\s・：:－—–〜~]+$/, '').trim();
}

// 地名の一語（「全国」「あおば県」「みどり市」など）。題がこれだけだと、何のカードか分からない。
const PLACE_WORD = /^(全国|日本|国内|[一-龠ぁ-んァ-ヶー]{1,6}(都|道|府|県|市|区|町|村|郡|地方))$/;
function isPlaceWord(text) {
  return PLACE_WORD.test(text);
}

// メニューの題。Claude の題の元は使わない（回ごとに違う題になり、「全域のメニュー」のような何のメニューか分からない題が来た。頼み19 の確かめ）。
// 包む要素の aria-label・包む見出し・最初の項目の順に、地名でない短い名前（20字まで）を探して「〇〇のメニュー」にする。
// 項目がほとんど地名なら「地域のメニュー」、何も無ければ「サイトのメニュー」。
function menuTitle(names) {
  const n = names || {};
  const items = (Array.isArray(n.items) ? n.items : []).map((t) => cleanTitle(t)).filter(Boolean);
  const place = (t) => isPlaceWord(t) || /(地方|地域|全域|[北南東西中]部)$/.test(t);
  if (items.length > 0 && items.filter(place).length * 2 > items.length) return '地域のメニュー';
  const name = [n.label, n.heading].map((t) => cleanTitle(t)).find((t) => t && t.length <= 20 && !place(t))
    || [items[0]].map((t) => cleanTitle(t)).find((t) => t && t.length <= 12 && !place(t));
  if (!name) return 'サイトのメニュー';
  return /メニュー$/.test(name) ? name : `${name}のメニュー`;
}

// 題が地名の一語になる読む・一覧のカードと、題の手がかりの無い検索のカードの題。
// 中の短い文字のうち、題と違い、地名の一語でもない最初のものを題にする。無ければ操作の種類から作る。
// 気象庁の警報のページで、「全国」「茨城県」「検索 1」という題のカードができた（2026-11-03 の Windows の確かめ）。
function betterTitle(c, title, probe) {
  const texts = Array.isArray(probe.texts) ? probe.texts : [];
  const alt = texts.map((t) => cleanTitle(t)).find((t) => t && t !== title && !isPlaceWord(t));
  if (alt) return alt;
  if (c.role === 'search') return 'サイト内を検索する';
  if (c.action === 'read') return `${title}の情報`;
  return '地域を選ぶ';
}

// 中身が一語だけ（空白・句読点が無く、12字まで）か。読んでも一語だけのカードは作らない。
// 気象庁の警報のページで、題を直した後も中身が「全国」の一語だけのカードが残った（2026-11-04 の Windows の確かめ）。
function isOneWord(text) {
  return text !== '' && text.length <= 12 && !/[\s、。，．,.!?！？：:]/.test(text);
}

// 押すカードの題が、地名や部品の名前の一語のときに、何をするカードかが分かる形にする。
// 「茨城県」→「地域を選ぶ（茨城県）」、「市町村選択」→「市町村を選ぶ」、「検索」→「サイト内を検索する」、「〇〇検索」→「〇〇を検索する」。
function clickTitle(title) {
  if (/\s/.test(title)) return title;
  if (isPlaceWord(title)) return `地域を選ぶ（${title}）`;
  if (title === '検索') return 'サイト内を検索する';
  let m = /^(.{1,12})選択$/.exec(title);
  if (m) return `${m[1]}を選ぶ`;
  m = /^(.{1,12})検索$/.exec(title);
  if (m) return `${m[1]}を検索する`;
  return title;
}

// 試した結果から、残すカードを選び、題と id を付ける。
// 落とすもの: 当たらない・中身が空（read は文字あり・list は1件以上・click は当たる数ちょうど1 でないもの）・同じ所の重なり・
// 中身が題と同じか、一語だけの読む・一覧のカード（読んでも題をくり返すか、一語だけのため）。
// rejects（任意の配列）を渡すと、作らなかった案と、その理由（短い英数字の印）を入れる（TODOKU_DUMP_DIR の書き出しのため）。
function pickCards(candidates, probes, rejects = null) {
  const cards = [];
  const seen = new Set();
  const titles = new Set();
  let tocTaken = false;
  candidates.forEach((c, k) => {
    const probe = probes[k];
    const drop = (reason) => { if (rejects) rejects.push({ index: k, action: c.action, selector: c.selector, reason, title: cleanTitle(probe && probe.title) }); };
    if (cards.length >= MAX_CARDS) return drop('max-cards');
    if (!isConfident(c.action, probe)) return drop('not-confident');
    const key = `${c.action} ${c.selector}`;
    if (seen.has(key)) return drop('duplicate');
    seen.add(key);
    let title = cleanTitle(probe.title);
    const body = cleanTitle(probe.body, 200);
    if (c.action !== 'click' && ((title && body === title) || isOneWord(body))) return drop('one-word-body');
    // ページの上に描かれていない所（「▼ 説明を表示する」で開くまで畳まれている説明など）を読むカードは作らない。
    // 気象庁の警報のページで、畳まれた説明を読むカードが、見出しと表の頭の行だけを読んだ（頼み27 の10・11）。
    // 一覧の入れ物が描かれていて、項目だけが隠れている所（切り替わる画像の帯など）と、開くまで畳まれているメニュー（リンクだけの一覧）は、今までどおり作る。
    if (probe.unrendered && !probe.menu) return drop('not-rendered');
    // 中身が見出し一行だけのカードと、題とほぼ同じ一行だけのカードは作らない（バスのページと気象庁の一枚目がこの形だった）。
    if (c.action !== 'click' && (probe.headingOnly || nearlySame(body, title))) return drop('heading-only');
    // 押すカードは、押す所の名前が分からなければ作らない。
    if (c.action === 'click' && !title) return drop('click-without-name');
    // パンくずと、題が「現在のページ」のカードは作らない。
    if (probe.crumb || /^現在(の)?(ページ|位置|地)$/.test(title)) return drop('breadcrumb');
    // 目次は「目次を読む」の一枚にまとめる（二つ目からは作らない）。
    if (probe.toc || /^目次/.test(title)) {
      if (tocTaken) return drop('second-toc');
      tocTaken = true;
      title = '目次を読む';
    }
    // 表示の切り替えの押す所は、押すと何が起きるかを題にする（「大雨・土砂災害・高潮」→「表を替える（大雨・土砂災害・高潮）」）。
    if (c.action === 'click' && title && probe.toggle) title = `${probe.toggle === 'table' ? '表を替える' : '表示を替える'}（${title}）`;
    else if (c.action === 'click' && title) title = clickTitle(title);
    // ページの題（h1）を借りた短い読むカードは、本文の節のカードがあるときに、中の最初の短い文を題にする（renamePageTitled）。
    const pageTitled = c.action === 'read' && Boolean(probe.pageTitle) && body.length < 120 && title === cleanTitle(probe.title)
      ? (Array.isArray(probe.texts) ? probe.texts : []).map((t) => cleanTitle(t)).find((t) => t && t !== title && !isPlaceWord(t)) || '' : '';
    const weak = (c.action !== 'click' && isPlaceWord(title)) || (!title && c.role === 'search');
    if (weak) title = betterTitle(c, title, probe);
    // リンクやボタンだけが5件以上並ぶ一覧（メニュー）は、本文と紛らわしい題にせず「〇〇のメニュー」にして、束の後ろへ回す。
    // 気象庁の警報のページで、防災情報のメニュー（リンク43件）が「警報・注意報」の題で来た（頼み18 の確かめ）。
    if (probe.menu && title !== '目次を読む') title = menuTitle(probe.menuNames);
    // 題を作れないカード（「お知らせ 1」「ボタン 1」のような既定の題になるもの）は作らない。
    // 作るたびに束が大きく変わり、何のカードか分からない題が戻ってきた（2026-11-04 の Windows の確かめ）。
    // 題が日時だけ（「〇年〇月〇日〇時〇分更新」など）のカードは、何のカードか分からないので、中の別の短い文を題にし、無ければ作らない（頼み27 の8）。
    // 「最終更新日：…」のような日付の行と、「リンク」「詳細」のような一語の題も同じに扱う（リンクは「このページのリンク」のカードで全部読める）。
    if (isVagueTitle(title)) {
      const alt = (Array.isArray(probe.alts) ? probe.alts : []).map((t) => cleanTitle(t)).find((t) => t && !isVagueTitle(t) && !isPlaceWord(t) && !titles.has(t));
      if (!alt) return drop(isTimeOnly(title) ? 'time-title' : 'vague-title');
      title = alt;
    }
    if (!title) return drop('no-title');
    // 題が重なり、中身が同じ題のカードの中身に含まれるなら作らない（同じ所を二度読むカードに番号が付いた。頼み18 の確かめ）。
    if (titles.has(title) && body && cards.some((x) => x.title === title && squeezeText(x.body).includes(squeezeText(body)))) return drop('subset');
    // 題が重なったら、番号を付ける前に、場所の中の見出し・直前の見出し・中の短い文字から、まだ使っていない題を探す。
    let unique = title;
    if (titles.has(unique)) {
      const alt = (Array.isArray(probe.alts) ? probe.alts : []).map((t) => cleanTitle(t))
        .find((t) => t.length >= 2 && !titles.has(t) && !isPlaceWord(t) && t !== body);
      if (alt) unique = alt;
    }
    for (let n = 2; titles.has(unique); n++) unique = `${title} ${n}`;
    titles.add(unique);
    const card = { id: `${c.role}-${cards.length + 1}`, title: unique, action: c.action, selector: c.selector };
    if (c.action === 'list' && c.container && probe.containerOk) card.container = c.container;
    Object.defineProperty(card, 'pos', { value: Number(probe.pos) || 0, enumerable: false });
    const meta = c.action === 'read' && isPartsOnly(body);
    Object.defineProperty(card, 'back', { value: meta || c.role === 'search' || BACK_TITLE.test(unique) || Boolean(probe.chrome) || (Boolean(probe.menu) && title !== '目次を読む'), enumerable: false });
    Object.defineProperty(card, 'meta', { value: meta, enumerable: false });
    Object.defineProperty(card, 'body', { value: body, enumerable: false });
    Object.defineProperty(card, 'weak', { value: weak, enumerable: false });
    Object.defineProperty(card, 'pageTitled', { value: pageTitled, enumerable: false });
    cards.push(card);
  });
  return cards;
}

// 比べるための文字: 空白と記号を除く。
function squeezeText(t) {
  return String(t || '').replace(/[\s、。，．・：:（）()「」『』【】［］[\]!！?？]/g, '');
}

// 中身が題とほぼ同じ一行か（空白・記号を除いて比べ、同じか、片方が他方を含み、違いが4字までのとき）。
function nearlySame(body, title) {
  const sq = (t) => String(t || '').replace(/[\s、。，．・：:（）()「」『』【】［］[\]!！?？]/g, '');
  const b = sq(body);
  const t = sq(title);
  if (!b || !t) return false;
  return b === t || ((b.includes(t) || t.includes(b)) && Math.abs(b.length - t.length) <= 4);
}

// 束の後ろにまとめるカードの題: 検索・お問い合わせ・サイトの名前（〇〇市役所・〇〇町役場・公式サイト など）。
// 「サイト内を検索する」が一枚目に来て、本文が遠かった（2026-11-04 の Windows の確かめ）。
const BACK_TITLE = /検索|問い?合わせ|問合せ|(市役所|区役所|町役場|村役場|役場|県庁|都庁|府庁|道庁|公式(ホームページ|ウェブサイト|サイト)?)$/;

// 束のカードを、ページの上からの順に並べ、id を振り直す（Claude の返す順が毎回違っても、同じ束になるように）。
// 検索・お問い合わせ・サイトの名前のカードは、本文のカードの後ろにまとめる（その中でも上からの順）。
// 本文が見出しごとの節のカードに分かれているときに、ページの題（h1）を借りた短い読むカード（更新日とページ番号だけの所など）は、
// 本文を全部読むカードと紛らわしいので、中の最初の短い文を題にする。
// つくば市の自転車のページで、更新日の所が「〇〇のご案内」の題で一枚目に来た（頼み19 の確かめ）。
function renamePageTitled(cards, sectionCount) {
  if (!(sectionCount > 0)) return cards;
  const titles = new Set(cards.map((c) => c.title));
  return cards.map((c) => {
    if (!c.pageTitled || titles.has(c.pageTitled)) return c;
    titles.add(c.pageTitled);
    const card = { ...c, title: c.pageTitled };
    for (const k of ['pos', 'back', 'body', 'meta']) Object.defineProperty(card, k, { value: c[k], enumerable: false });
    return card;
  });
}

// 後ろのカードの中は、お問い合わせ → メニュー・サイトの名前 → 検索 の順（それぞれの中はページの上からの順）。
// ページの上にある見出しのメニューが、お問い合わせより前に来た（つくば市の自転車のページ。頼み19 の確かめ）。
// ページの部品だけの所（更新日・ページ番号・印刷・文字の大きさ・背景の色・共有のボタンなど）は、お問い合わせの前に置く。
// つくば市の自転車のページで、更新日とページ番号だけのカードが一枚目に来た（頼み20 の確かめ）。
function backRank(c) {
  if (!c.back) return 0;
  if (c.meta) return 1;
  if (/^search-/.test(String(c.id)) || /検索/.test(c.title)) return 4;
  if (/問い?合わせ|問合せ/.test(c.title)) return 2;
  return 3;
}

// 読むカードの中身が、ページの部品の言葉と日付・番号だけか（それを除くと6字も残らない、120字までの中身）。
const PARTS_WORDS = /更新日|最終更新|公開日|掲載日|作成日|ページ番号|ページID|印刷(する|用)?|文字(の)?(サイズ|大きさ)|拡大|縮小|標準|背景(色)?|色(を)?(変える|変更)|白|黒|青|音声読み上げ|読み上げ|ふりがな|やさしい日本語|Language|シェア|ツイート|ポスト|いいね|Facebook|X|LINE|Twitter|年|月|日|時|分|[0-9０-９]+|[：:／/・|｜\-－()（）\s]/g;
const PARTS_KEY = /更新日|最終更新|公開日|掲載日|作成日|ページ番号|ページID|印刷|文字(の)?(サイズ|大きさ)|拡大|縮小|背景|読み上げ|シェア|ツイート/;
function isPartsOnly(body) {
  const text = String(body || '');
  return text.length > 0 && text.length <= 120 && PARTS_KEY.test(text) && text.replace(PARTS_WORDS, '').length < 6;
}

// ページの中の、いまの並びの番号（カードの selector の最初の要素。無ければ入れ物）。見つからなければ null。ページの中で動く関数。
// 入れ物を先に見ると、Claude の案の入れ物が区画を丸ごと指していたとき（#warning_summary）、その区画の後ろの表のカードが前の表より先に並んだ。
function pagePositions(pairs) {
  const index = new Map();
  [...document.querySelectorAll('*')].forEach((e, i) => index.set(e, i));
  const one = (s) => {
    try {
      return s ? document.querySelector(s) : null;
    } catch (err) {
      return null;
    }
  };
  return pairs.map(([sel, box]) => {
    const e = one(sel) || one(box);
    return e ? index.get(e) : null;
  });
}

function buildPositionsScript(selectors) {
  return `(${pagePositions.toString()})(${JSON.stringify(selectors)})`;
}

// カードの並びの番号（pos）を、カードを作り終えた時点のページで数え直す。
// pos は、Claude の案を試す台本と、本文の節や必ず作る表を探す台本の二つで、別々の時点に数えていた。その間にページの上の方に要素が増えると
// （気象庁の警報のページは、読み込んだ後も上の方を書き換える）、後で数えた方の番号だけが大きくなり、芯の表の並びが回ごとに入れ替わった
// （「警報・注意報（発表状況）」と「警戒レベル相当情報（発表状況）」が入れ替わった。頼み34）。
// 見つからないカードは、元の並びで一つ前のカードの番号のすぐ後に置く。
function withFreshPositions(cards, fresh) {
  const byOld = cards.map((c, i) => ({ c, i, f: Array.isArray(fresh) ? fresh[i] : null })).sort((a, b) => (a.c.pos ?? 0) - (b.c.pos ?? 0) || a.i - b.i);
  let last = -1;
  let step = 0;
  const pos = new Map();
  for (const x of byOld) {
    if (typeof x.f === 'number') {
      last = x.f;
      step = 0;
      pos.set(x.c, x.f);
    } else {
      step += 0.001;
      pos.set(x.c, last + step);
    }
  }
  return cards.map((c) => {
    const card = { ...c };
    for (const k of Object.getOwnPropertyNames(c)) {
      if (k === 'pos' || Object.prototype.propertyIsEnumerable.call(c, k)) continue;
      Object.defineProperty(card, k, { value: c[k], enumerable: false });
    }
    Object.defineProperty(card, 'pos', { value: pos.get(c), enumerable: false });
    return card;
  });
}

function orderCards(cards) {
  const sorted = cards.map((c, i) => ({ c, i }))
    .sort((a, b) => backRank(a.c) - backRank(b.c) || (a.c.pos ?? 0) - (b.c.pos ?? 0) || a.i - b.i).map((x) => x.c);
  return sorted.map((c, i) => ({ ...c, id: `${c.id.replace(/-\d+$/, '')}-${i + 1}` }));
}

// 束の名前: ページの title。無ければ URL のホスト名、それも無ければ「新しいページ」。
// 「ページの題／サイトの名前」の形で、区切った所の一つがサイトの名前（公式・ホームページ・ウェブサイト など）なら、それを外す。
// サイトの名前と分からないときは外さない（「気象庁｜警報・注意報」を「気象庁」だけにしない。2026-11-04 の Windows の確かめ）。
const SITE_WORD = /公式|ホームページ|ウェブサイト|Webサイト|WEBサイト|webサイト|サイト$/;
function deckName(title, url) {
  const parts = String(title || '').split(/\s*[｜|／]\s*|\s+[-–—]\s+/).map((p) => p.trim()).filter(Boolean);
  const kept = parts.filter((p) => !SITE_WORD.test(p));
  const page = parts.length > 1 && kept.length > 0 && kept.length < parts.length ? kept.join('｜') : title;
  const name = cleanTitle(page, NAME_MAX);
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
// 開発者が、本物の Claude の案と手元の守りの結果を見比べるための書き出し（環境変数 TODOKU_DUMP_DIR があるときだけ）。
// (a) <id>-a-structure.txt: Claude に送った構造（文字なし） (b) <id>-b-proposals.json: Claude の返事そのまま
// (c) <id>-c-deck.json: 手元の守りの後の束（題も含む）と、作らなかったカードと理由。ページの文字（題）は (c) にだけ入る。
// 受け渡しのフォルダに置いてよいのは (a)(b) だけ。
function dumpDir() {
  const dir = process.env.TODOKU_DUMP_DIR;
  return typeof dir === 'string' && dir.trim() !== '' ? dir : null;
}

function dumpFile(id, name, content) {
  const dir = dumpDir();
  if (!dir) return;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}-${name}`), typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
  } catch (e) {
    // 書き出せなくても、束を作るのは続ける
  }
}

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
  const user = buildGenerateRequest(limited.text, { truncated: truncated || limited.cut });
  // 送る文の全体に日本語の文字があれば送らない（構造の確かめに加えて、送る文そのものも確かめる）。
  if (!looksTextFree(user)) return fail('text-in-structure');
  dumpFile(id, 'a-structure.txt', limited.text);
  let answer;
  try {
    answer = await callModel({ system: SYSTEM_PROMPT, user, signal });
  } catch (e) {
    return fail(signal.aborted ? 'timeout' : 'model-error', e.message);
  }
  if (signal.aborted) return fail('timeout');
  dumpFile(id, 'b-proposals.json', answer);
  const candidates = normalizeCandidates(answer);
  // Claude の案が一枚も無くても、手元で必ず作る表と本文の節のカードがあれば束にする（最後に一枚も無ければ作らない）。
  const probes = candidates.length > 0 ? await win.webContents.executeJavaScript(buildInspectScript(candidates)) : [];
  const rejects = [];
  const picked = pickCards(candidates, probes, rejects);
  // 本文の見出しごとの節を読むカードを足す（Claude が選んだ読む・一覧のカードの中にある節は除く）。
  const taken = picked.filter((c) => c.action !== 'click').map((c) => [c.selector, c.action]);
  const clickSelectors = picked.filter((c) => c.action === 'click').map((c) => c.selector);
  const extras = await win.webContents.executeJavaScript(buildSectionsScript(taken, clickSelectors));
  const whole = new Set(extras && Array.isArray(extras.whole) ? extras.whole : []);
  const fragments = new Set(extras && Array.isArray(extras.fragments) ? extras.fragments : []);
  const kept = applySplits(picked.filter((c) => !(c.action !== 'click' && whole.has(c.selector)) && !(c.action === 'list' && fragments.has(c.selector))), extras && extras.splits);
  const withMain = addToggleCards(addMainListCards(retitleCards(kept, extras && extras.retitles), extras && extras.mainLists), extras && extras.toggles);
  const sectionList = extras && Array.isArray(extras.sections) ? extras.sections : [];
  const built = renamePageTitled(addSectionCards(withMain, sectionList), sectionList.length);
  // 並びは、作り終えた時点のページで、全部のカードの位置を一度に数え直してから決める（withFreshPositions）。
  let fresh = null;
  try {
    fresh = await win.webContents.executeJavaScript(buildPositionsScript(built.map((c) => [c.selector, c.container || ''])));
  } catch (e) {
    fresh = null;
  }
  const cards = orderCards(withFreshPositions(built, fresh));
  dumpFile(id, 'c-deck.json', {
    url,
    cards,
    picked: picked.map((c) => c.selector),
    rejects,
    whole: [...whole],
    mainLists: extras && Array.isArray(extras.mainLists) ? extras.mainLists : [],
    sections: extras && Array.isArray(extras.sections) ? extras.sections : [],
  });
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
    dropped: candidates.length - picked.length,
    sections: cards.filter((c) => c.id.startsWith('section-')).length,
    split: picked.filter((c) => c.action !== 'click' && whole.has(c.selector)).length,
    tableSplits: picked.filter((c) => c.action === 'read' && extras && extras.splits && extras.splits[c.selector]).length,
    mainLists: withMain.length - picked.length,
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
  return `ダウンロードのフォルダに「${name}」として書き出しました。支援者が確認してから、設定ファイルとして配ってください。`;
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
  isTimeOnly,
  isVagueTitle,
  withFreshPositions,
  waitForSettle,
  pageSettleProbe,
  normalizeCandidates,
  pageInspect,
  buildInspectScript,
  buildSectionsScript,
  pickCards,
  deckName,
  generateDeck,
  exportDeck,
  exportedMessage,
};
