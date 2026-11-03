'use strict';
// ウェブアプリの窓（操作する相手のページ）を開き、カードの selector を当てる所。
// 当たらなかったときは、設定ファイルのどの行かだけを返す。ページの中身は外へ送らない。

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { watchDownload } = require('./download');

const FIXTURES_DIR = path.join(__dirname, '..', '..', 'test', 'fixtures');
const FIXTURE_NAME = /^[a-z0-9][a-z0-9-]*\.html$/;
const READ_LIMIT = 4000; // 読み上げに渡す文字数の上限
const WAIT_MS = 8000; // 後から出てくる所を待つ長さ

// 設定ファイルの url とカードの path から、窓で開く URL を作る。
// 練習のページ（fixture:）では、path は test/fixtures/ の別のファイルの名前（/名前.html）として扱う。
function resolveUrl(url, cardPath) {
  if (url.startsWith('fixture:')) {
    const name = cardPath ? cardPath.slice(1) : url.slice('fixture:'.length);
    if (!FIXTURE_NAME.test(name)) throw new Error(`練習のページの名前が正しくありません: ${name}`);
    return pathToFileURL(path.join(FIXTURES_DIR, name)).href;
  }
  if (!cardPath) return url;
  const resolved = new URL(cardPath, url);
  if (resolved.origin !== new URL(url).origin) throw new Error('path が別のサイトを指しています');
  return resolved.href;
}

// ページの中で動く関数。外の変数は使えないので、引数だけで動くようにする。
// 後から出てくる所に備えて、当たるまで少しずつ待つ。
// container（list のカードだけ・任意）は、項目を入れる入れ物の selector。
// 入れ物に当たって項目が 0件なら「0件」（found: true・items: []）、入れ物にも当たらなければ「当たらない」と返す。
async function pageAction(selector, action, loginSelector, limit, waitMs, container) {
  // 読む文を、行の並びとして取り出す。画面読み上げが読む文に近づける。
  // - 中の文字に加えて、画像の説明（alt）と aria-label も読む。aria-hidden="true" の中と script・style は読まない。
  //   当たった要素そのものに付いた aria-hidden は見ない（カルーセルの部品は、見えないスライドに aria-hidden="true" を付けるため）。
  //   本物の自治体のカルーセルは、文字が画像の alt だけのことが多い（2026-11-02 Mac の確かめ）。
  // - 別々の要素の文字の間に空白を入れる。日付の数字の直後に英字の題が続けて読まれた（2026-11-03 の Windows の確かめ）。
  //   字の飾りの要素（strong・em など）は、文の途中にあるので区切らない。
  // - 段落・行（p・div・li・tr や、表示が block の要素）と改行（br・white-space が pre の文の改行）で行を分ける。
  //   住所・電話・窓口の時間が、一つの段落として続けて読まれた（同じ確かめ）。
  // visibleOnly のときは、見えていない要素（display: none・visibility: hidden）を読まない（読むカード。今までの innerText と同じ見方）。
  // 一覧のカードは、隠れているスライドも読む（自動で切り替わるスライドの見えない分）。
  const INLINE = new Set(['B', 'STRONG', 'EM', 'I', 'U', 'S', 'MARK', 'SMALL', 'SUB', 'SUP', 'ABBR', 'CODE', 'KBD', 'Q', 'CITE', 'DFN',
    'VAR', 'SAMP', 'FONT', 'WBR', 'BDI', 'BDO', 'RUBY', 'RB', 'RT', 'RP', 'INS', 'DEL']);
  const BLOCK = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'DL', 'DT', 'DD', 'TR', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'CAPTION', 'SECTION',
    'ARTICLE', 'HEADER', 'FOOTER', 'NAV', 'ASIDE', 'MAIN', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'ADDRESS', 'BLOCKQUOTE', 'PRE',
    'FIGURE', 'FIGCAPTION', 'FORM', 'FIELDSET', 'LEGEND', 'HR', 'DETAILS', 'SUMMARY', 'BODY']);
  const BLOCK_DISPLAY = /^(block|flex|grid|list-item|table|table-row|table-caption|flow-root)$/;
  const PRE_SPACE = /^(pre|pre-wrap|pre-line|break-spaces)/;
  const textLines = (root, visibleOnly = false) => {
    let out = '';
    const walk = (node, isRoot, keepNewlines, shown) => {
      if (node.nodeType === 3) {
        if (shown) out += keepNewlines ? node.nodeValue : node.nodeValue.replace(/\s+/g, ' ');
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = node.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE') return;
      if (tag === 'BR') { out += '\n'; return; }
      if (!isRoot && node.getAttribute('aria-hidden') === 'true') return;
      const cs = getComputedStyle(node);
      if (visibleOnly && !isRoot && cs.display === 'none') return;
      const visible = !visibleOnly || cs.visibility === 'visible';
      const pre = PRE_SPACE.test(cs.whiteSpace || '');
      const block = cs.display === 'none' ? BLOCK.has(tag) : BLOCK.has(tag) || BLOCK_DISPLAY.test(cs.display);
      const sep = block ? '\n' : INLINE.has(tag) ? '' : ' ';
      out += sep;
      const label = (node.getAttribute('aria-label') || '').trim();
      if (tag === 'IMG' || node.getAttribute('role') === 'img') {
        const alt = (node.getAttribute('alt') || label).trim();
        if (alt && visible) out += ' ' + alt + ' ';
        out += sep;
        return;
      }
      const before = out.length;
      for (const child of node.childNodes) walk(child, false, pre, visible);
      if (label && visible && out.slice(before).trim() === '') out += ' ' + label + ' ';
      out += sep;
    };
    walk(root, true, false, true);
    const lines = [];
    for (const raw of out.split('\n')) {
      const line = raw
        .replace(/[^\S\n]+/g, ' ')
        .trim()
        // 区切りに入れた空白が、句読点と括弧の内側に来たら外す。
        .replace(/ (?=[、。，．！？）」』】])/g, '')
        .replace(/([（「『【]) /g, '$1')
        // 同じ文が続けて二度出たら一度にする（画像の alt とその下の文字が同じときなど）。
        .replace(/(\S.{3,}?) \1(?= |$)/g, '$1');
      if (line && line !== lines[lines.length - 1]) lines.push(line);
    }
    return lines;
  };
  // 一覧の1件は、一つの項目として読む。行の区切りは、句読点で終わっていなければ読点にする。
  const oneLine = (lines) => lines.reduce((acc, line) => (acc === '' ? line : `${acc}${/[、。，．！？：:,.;；]$/.test(acc) ? ' ' : '、'}${line}`), '')
    .replace(/(\S.{3,}?)[、 ]\1(?=[、 ]|$)/g, '$1');
  const query = (s) => {
    try {
      return { el: document.querySelector(s) };
    } catch (e) {
      return { invalid: true };
    }
  };
  const deadline = Date.now() + waitMs;
  if (action === 'list') {
    // 当たる項目を全部、番号を付けて読む。隠れているスライドも、画像の説明（alt）も読む。
    // 入れ物が見えてから項目が出てくるページもあるので、入れ物に当たってからも少し（最長2秒）待ってから 0件とする。
    const EMPTY_SETTLE_MS = Math.min(waitMs, 2000);
    let containerSeenAt = null;
    for (;;) {
      let items;
      try {
        items = [...document.querySelectorAll(selector)];
      } catch (e) {
        return { found: false, reason: 'invalid' };
      }
      if (items.length > 0) {
        const texts = items.map((it) => oneLine(textLines(it)));
        const lines = texts.map((t, i) => `${i + 1}件目: ${t}`);
        const text = `${items.length}件あります。\n` + lines.join('\n');
        // 画面で1件ずつのカードにするため、1件ずつの文も返す（全体の上限は text と同じ）。
        let left = limit;
        const parts = [];
        for (const t of texts) {
          if (left <= 0) break;
          parts.push(t.slice(0, left));
          left -= t.length;
        }
        return { found: true, text: text.slice(0, limit), truncated: text.length > limit, items: parts };
      }
      if (loginSelector && query(loginSelector).el) return { found: false, reason: 'login' };
      if (container) {
        const box = query(container);
        if (box.invalid) return { found: false, reason: 'invalid', field: 'container' };
        if (box.el) {
          if (containerSeenAt === null) containerSeenAt = Date.now();
          if (Date.now() - containerSeenAt >= EMPTY_SETTLE_MS || Date.now() >= deadline) {
            return { found: true, text: '0件です。', truncated: false, items: [] };
          }
        } else {
          containerSeenAt = null;
        }
      }
      if (Date.now() >= deadline) return { found: false, reason: 'none' };
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  let el = null;
  for (;;) {
    const q = query(selector);
    if (q.invalid) return { found: false, reason: 'invalid' };
    el = q.el;
    if (el && (action === 'click' || textLines(el).length > 0)) break;
    if (!el && loginSelector) {
      const login = query(loginSelector);
      if (login.el) return { found: false, reason: 'login' };
    }
    if (Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!el) return { found: false, reason: 'none' };
  if (action === 'click') {
    el.click();
    return { found: true };
  }
  // ふだんは見えている文を、行ごとに読む（画面の項目は行ごとに一つ）。見えている文が無いときは、隠れている所も読む。
  let lines = textLines(el, true);
  if (lines.length === 0) lines = textLines(el);
  const text = lines.join('\n');
  return { found: true, text: text.slice(0, limit), truncated: text.length > limit };
}

// ページで動かす文を作る。selector は JSON にして埋め込み、文として解釈されないようにする。
function buildScript(selector, action, loginSelector = null, waitMs = WAIT_MS, container = null) {
  const args = [selector, action, loginSelector, READ_LIMIT, waitMs, container].map((v) => JSON.stringify(v)).join(', ');
  return `(${pageAction.toString()})(${args})`;
}

// 窓のいまの URL（current）と、開きたい URL（wanted）が同じページか。
// # から後（フラグメント）だけの違いは同じページとする。
// ただし開きたい URL が # から後を持つとき（# で表を切り替えるページ）は、そこまで同じときだけ同じページとする。
function isSamePage(current, wanted) {
  if (current === wanted) return true;
  const strip = (u) => {
    const k = u.indexOf('#');
    return k < 0 ? u : u.slice(0, k);
  };
  if (wanted.includes('#')) return false;
  return current !== '' && strip(current) === wanted;
}

// アプリごとに窓を一つ持つ。見せておくのは、いま読むアプリの窓だけにする（ほかは隠す。閉じはしない）。
// ウェブアプリの窓が二つ見えていると、二つ目を見せたときに NVDA がカードの画面を見失い、黙ることがあった（2026-11-03 の確かめ）。
const windows = new Map();

// ウェブアプリの窓は、ふだんは焦点を取れない窓にする（focusable: false）。
// 本物のつくば市のトップは、読み込むとページの中の欄に自分で焦点を当てる。Windows ではそれで窓ごと前に出て、
// NVDA がつくば市の窓へ移り、使う人がカードの画面から取り残された（2026-11-03 の Windows の確かめ）。
// 焦点を取れるようにするのは、使う人が「ログインの窓を前に出す」を押したとき（showTarget）だけ。次にカードを動かすときに戻す。
const loginFocus = new Set();
// カードの画面の窓（Todoku の窓）。ウェブアプリの窓に焦点が来てしまったら、ここへ戻す。
let homeWindow = null;
function setHomeWindow(win) { homeWindow = win; }

// 試しの台本（test/headless.js）が TODOKU_TEST_HEADLESS=1 を立てたときは、窓を画面に出さず、焦点も動かさない。
// 試しの窓が開いて、人が別のアプリで打っていた文字がその窓に入ったことがあった（2026-11-03）。アプリとして起こしたときは立たない。
function testHeadless() {
  return process.env.TODOKU_TEST_HEADLESS === '1';
}

// 前に出さずに見せる（試しのときは見せない）。
function showQuietly(win) {
  if (testHeadless() || win.isVisible()) return;
  win.showInactive();
}

function keepUnfocusable(id, win) {
  loginFocus.delete(id);
  if (win.isFocusable()) win.setFocusable(false);
}

async function openTarget(BrowserWindow, config, url) {
  for (const [id, other] of windows) {
    if (id !== config.id && !other.isDestroyed() && other.isVisible()) other.hide();
  }
  let win = windows.get(config.id);
  if (!win || win.isDestroyed()) {
    win = new BrowserWindow({
      width: 1000,
      height: 760,
      show: false,
      focusable: false,
      title: config.name,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    // 新しい窓を勝手に開かせない。
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    windows.set(config.id, win);
    const id = config.id;
    win.on('closed', () => { windows.delete(id); loginFocus.delete(id); });
    // 守りの二つ目: 焦点を取れない窓でも、OS やページの動きで焦点が来たら、ログインのとき以外は Todoku の窓へ返す。
    win.on('focus', () => {
      if (loginFocus.has(id)) return;
      if (homeWindow && !homeWindow.isDestroyed() && homeWindow !== win) homeWindow.focus();
    });
  } else {
    // ログインのために前に出した窓も、使う人がカードの画面からカードを動かしたら、焦点を取れない窓に戻す。
    keepUnfocusable(config.id, win);
  }
  // 同じページにいるなら読み込み直さない（共用のデモサイトに負荷をかけないため）。
  // ページの中の動きで # から後だけが変わったとき（気象庁の「データを表示」の後など）も、同じページとして扱う。
  // 読み込み直すと、ページの中で出した表が消えるため。
  if (!isSamePage(win.webContents.getURL(), url)) await win.loadURL(url);
  // カードの画面からフォーカスを奪わないように、前に出さずに見せる。
  showQuietly(win);
  return win;
}

// カードを一枚動かす。結果は { ok, action?, text?, truncated?, needLogin?, where?, message? }。
async function runCard(BrowserWindow, config, cardId, options = {}) {
  const index = config.cards.findIndex((c) => c.id === cardId);
  if (index < 0) return { ok: false, where: '(なし)', message: `カード「${cardId}」が設定ファイルにありません` };
  const card = config.cards[index];
  const where = `cards[${index}].selector`;

  let win;
  try {
    win = await openTarget(BrowserWindow, config, resolveUrl(config.url, card.path));
  } catch (e) {
    return { ok: false, where: card.path ? `cards[${index}].path` : 'url', message: `ページを開けませんでした: ${e.message}` };
  }
  const loginSelector = config.login ? config.login.selector : null;
  const container = card.action === 'list' && card.container ? card.container : null;
  // 押すカードは、押す前からダウンロードを待ち受ける。
  // 保存の名前の型（saveAs）があれば、始まったダウンロードをその名前で保存する。
  const watch = card.action === 'click' ? watchDownload({ saveAs: card.saveAs || null }) : null;
  let result;
  try {
    result = await win.webContents.executeJavaScript(buildScript(card.selector, card.action, loginSelector, options.waitMs, container));
  } catch (e) {
    if (watch) watch.cancel();
    throw e;
  }
  if (watch && !result.found) watch.cancel();
  if (result.reason === 'login') {
    // ログインは人が手で行う。ログインの画面を開いておく。
    // 窓を前に出すのは、利用者がカードの「ログインの窓を前に出す」を押したとき（showTarget）。
    // ここで勝手に前に出すと、カードの画面の知らせを聞く前に焦点が移ってしまうため。
    if (config.login.path) {
      try {
        const loginUrl = resolveUrl(config.url, config.login.path);
        if (!isSamePage(win.webContents.getURL(), loginUrl)) await win.loadURL(loginUrl);
      } catch (e) {
        return { ok: false, where: 'login.path', message: `ログインの画面を開けませんでした: ${e.message}` };
      }
    }
    showQuietly(win);
    return { ok: false, needLogin: true, message: 'ログインが要ります。ウェブアプリの窓でログインしてから、もう一度カードを押してください' };
  }
  if (!result.found) {
    if (result.field === 'container') return { ok: false, where: `cards[${index}].container`, message: 'container の書き方が正しくありません' };
    const message = result.reason === 'invalid' ? 'selector の書き方が正しくありません' : 'ページの中に当たる所がありません';
    return { ok: false, where, message };
  }
  if (card.action === 'click') {
    // 押した結果ダウンロードが始まったら、保存が終わるまで待ち、結果に入れる（画面がそれを知らせる）。
    const download = await watch.wait({ startMs: options.downloadStartMs ?? 1000 });
    return { ok: true, action: card.action, ...(download ? { download } : {}) };
  }
  return { ok: true, action: card.action, text: result.text, truncated: result.truncated, ...(result.items ? { items: result.items } : {}) };
}

// ページの中で動く関数（点検用）。selector が当たるかだけを返し、中身は読まない。
// 入れ物（container）のあるカードは、項目が 0件でも入れ物に当たれば 'ok'（0件は画面の変わりではない）。
function pageProbe(selectors, containers = []) {
  const probe = (s) => {
    try {
      return document.querySelector(s) ? 'ok' : 'none';
    } catch (e) {
      return 'invalid';
    }
  };
  return selectors.map((s, k) => {
    const state = probe(s);
    if (state !== 'none' || !containers[k]) return state;
    const box = probe(containers[k]);
    return box === 'invalid' ? 'invalid-container' : box;
  });
}

// 全部のカードを点検し、当たらない行の一覧を返す。押さない・読まない。
// 結果は [{ where, message }]。ページの中身は入れない（Claude に送ってよいのはこの一覧だけ）。
async function checkCards(BrowserWindow, config, options = {}) {
  const problems = [];
  // 開くページごとにまとめて、読み込みを少なくする。
  const byUrl = new Map();
  config.cards.forEach((card, index) => {
    let url;
    try {
      url = resolveUrl(config.url, card.path);
    } catch (e) {
      problems.push({ where: card.path ? `cards[${index}].path` : 'url', message: e.message });
      return;
    }
    if (!byUrl.has(url)) byUrl.set(url, []);
    byUrl.get(url).push({ card, index });
  });
  for (const [url, items] of byUrl) {
    const win = await openTarget(BrowserWindow, config, url);
    // 後から出てくる所に備えて、少し待ってから見る。
    await new Promise((r) => setTimeout(r, options.settleMs ?? 1500));
    const selectors = items.map((i) => i.card.selector);
    const containers = items.map((i) => (i.card.action === 'list' && i.card.container ? i.card.container : null));
    const states = await win.webContents.executeJavaScript(`(${pageProbe.toString()})(${JSON.stringify(selectors)}, ${JSON.stringify(containers)})`);
    items.forEach(({ index }, k) => {
      if (states[k] === 'invalid-container') problems.push({ where: `cards[${index}].container`, message: 'container の書き方が正しくありません' });
      if (states[k] === 'none') problems.push({ where: `cards[${index}].selector`, message: 'ページの中に当たる所がありません' });
      if (states[k] === 'invalid') problems.push({ where: `cards[${index}].selector`, message: 'selector の書き方が正しくありません' });
    });
  }
  return problems;
}

// ウェブアプリの窓を前に出して、焦点を移す（ログインのため）。窓がまだ無ければ false。
// ログインの間だけ焦点を取れる窓にする（キーで打てるように）。次にカードを動かすと、焦点を取れない窓に戻る（openTarget）。
function showTarget(appId) {
  const win = windows.get(appId);
  if (!win || win.isDestroyed()) return false;
  loginFocus.add(appId);
  if (!win.isFocusable()) win.setFocusable(true);
  // Windows では焦点を取れない窓はタスクバーに出ないので、ログインの間は出す。
  if (process.platform === 'win32') win.setSkipTaskbar(false);
  if (!testHeadless()) {
    win.show();
    win.focus();
  }
  return true;
}

// ウェブアプリの窓を閉じる（カードの束を作れなかったとき・消したとき）。窓が無ければ何もしない。
function closeTarget(appId) {
  const win = windows.get(appId);
  windows.delete(appId);
  if (win && !win.isDestroyed()) win.destroy();
}

module.exports = {
  resolveUrl, buildScript, pageAction, pageProbe, runCard, checkCards, openTarget, showTarget, closeTarget, isSamePage, setHomeWindow, testHeadless,
};
