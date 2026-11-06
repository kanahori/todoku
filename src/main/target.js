'use strict';
// ウェブアプリの窓（操作する相手のページ）を開き、カードの selector を当てる所。
// 当たらなかったときは、設定ファイルのどの行かだけを返す。ページの中身は外へ送らない。

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { watchDownload } = require('./download');
const { pageLinks, tidyLinks, MAX_LINKS } = require('./links');

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
// dateSelector（list のカードだけ・任意）は、項目の中の日付の要素の selector。その要素の datetime か id に書かれた年・月・日から、
// その要素を「11月6日」と読む。つくば市のイベントカレンダーの一覧は、日の欄が「6」だけで、月がどこにも読めなかった
// （「6 金曜」と読んだ。2026-11-04 の Windows の確かめ）。月は日の欄の id（calendar_list_2026_11_6）にだけ書いてある。
// 入れ物に当たって項目が 0件なら「0件」（found: true・items: []）、入れ物にも当たらなければ「当たらない」と返す。
// dateSelector の要素が項目の中に無ければ、項目を囲む要素（3段上まで）の中の、項目より前にあるものを使い、項目の頭に「11月6日 金曜」と付ける
// （一日に催しが幾つもある行で、催しを一件ずつ読むため）。
// tagSelector（list のカードだけ・任意）は、項目の中の分類の言葉の要素の selector。題の前でなく、後ろに括弧で読む（「…を開催します！（催し、健康）」）。
// つくば市のイベントカレンダーで、分類の言葉が題の前に続いて聞き分けにくかった（2026-11-04 の Windows の確かめ）。
// 書いている途中の所（チャットの返事など）: 読む所か、それを囲む要素・中の要素に aria-busy="true" が付いている間は、外れるまで待つ（待つ長さの内）。
// 待っても外れなければ、そこまでを読み、partial: true を返す（画面が「書いている途中です」と知らせる）。
// joinWith（list のカードだけ・任意）は、二つ目の表の行の selector。一覧の n 件目の後ろに、joinWith の n 件目を空白でつないで読む
// （横に長い表を、名前の列の表と値の列の表に分けて描くページのため）。
// skipItems（list のカードだけ・任意）は、読まない項目の決まり（正規表現の文字列）。項目の文がこれに当たれば、その一件を読まず、件数にも入れない。
// 大学のお知らせの一覧に、入試の案内の件が混ざるため（入試の材料はカードにしない決まり・2026-11-05）。
// until（read のカードだけ・任意）は、節の終わりの selector。当たった要素から、後に続く兄弟の要素を、until に当たる要素の手前まで読む
// （見出しから次の同じ段の見出しの手前までの節。作った束の、本文の節を読むカード）。
async function pageAction(selector, action, loginSelector, limit, waitMs, container, dateSelector, until, tagSelector, joinWith, skipItems) {
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
  // 画像の説明（alt）と文字の重なり。項目（一覧の1件・読むカードの1行）の中で、画像の説明と文字が同じか、
  // 片方が他方を含むときは、一度だけ読む（長い方を残す）。「〇〇ロゴ」「〇〇のロゴ」は、ロゴの語を外して比べる。
  // 「〇〇の写真」「〇〇の画像」は外さない（写真があることも中身なので、「役場の写真」と「あおば町役場」は両方読む）。
  // 比べる前に、全角と半角・大文字と小文字をそろえ、空白と記号を外す。それでも1〜2字だけ違う（8字以上の）ときも同じとみて、
  // 文字の方（alt でない方）だけを読む（「探求…steam…」と「探究…STEAM…」。ページの書き損じで二度読まれた）。違う中身は両方残す。
  // つくば市のトップで「つくミルロゴ、つくば市地図データサイト「つくミル」」と重ねて読んだ（2026-11-04 の Windows の確かめ）。
  const ALT_OPEN = '\u0001';
  const ALT_CLOSE = '\u0002';
  const settleAlts = (s) => {
    if (!s.includes(ALT_OPEN)) return s;
    const pieces = s.split(/(\u0001[^\u0002]*\u0002)/).map((t) => (t.startsWith(ALT_OPEN) ? { alt: true, t: t.slice(1, -1) } : { alt: false, t }));
    const core = (t) => t.normalize('NFKC').toLowerCase().replace(/(の)?(ロゴマーク|ロゴ)\s*$/, '').replace(/[\s\p{P}\p{S}\p{Cc}]+/gu, '');
    // 二つの文の違い（足す・消す・置き換えるの字数）が2字までか。
    const near = (a, b) => {
      if (Math.min(a.length, b.length) < 8 || Math.abs(a.length - b.length) > 2) return false;
      let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
      for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (Math.min(...cur) > 2) return false;
        prev = cur;
      }
      return prev[b.length] <= 2;
    };
    const texts = pieces.filter((p) => !p.alt).map((p) => core(p.t));
    const textAll = texts.join('');
    const kept = [];
    for (const p of pieces) {
      if (!p.alt) continue;
      const a = core(p.t);
      if (!a || textAll.includes(a) || texts.some((t) => near(t, a)) || kept.some((k) => k.includes(a) || near(k, a))) p.drop = true;
      else kept.push(a);
    }
    for (const p of pieces) {
      if (p.alt) continue;
      const c = core(p.t);
      if (c.length >= 2 && kept.some((k) => k.includes(c) || near(k, c))) p.drop = true;
    }
    return pieces.map((p) => (p.drop ? p.t.replace(/[^\n]+/g, ' ') : p.alt ? ` ${p.t} ` : p.t)).join('');
  };
  // scope が 'item' なら当たった要素の全体で、'line'（ふだん）なら行ごとに、画像の説明の重なりを外す。
  // 日付の要素の datetime か id から「11月6日」を作る。読めなければ null（そのときは書いてあるまま読む）。
  // その要素に無ければ、中の datetime を持つ要素（time など）を見る。
  // withWeekday のときは「11月6日 金曜」と曜日も付ける（項目の外の日付を、項目の頭に付けるとき）。
  const dateLabel = (el, withWeekday = false) => {
    const inner = el.querySelector('[datetime]');
    const src = `${el.getAttribute('datetime') || ''} ${el.id || ''} ${inner ? inner.getAttribute('datetime') : ''}`;
    const m = /(\d{4})[-_/](\d{1,2})[-_/](\d{1,2})(?!\d)/.exec(src);
    if (!m) return null;
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null;
    if (!withWeekday) return `${month}月${day}日`;
    const w = new Date(Number(m[1]), month - 1, day).getDay();
    return `${month}月${day}日 ${'日月火水木金土'[w]}曜`;
  };
  // 項目の日付の要素。項目の中に無ければ、項目を囲む行（tr か li。3段上まで）の中の、項目より前にあるもの。
  // 行より外は探さない（ほかの行や表の日付を、取り違えないため）。
  const dateOf = (it) => {
    let a = it;
    for (let depth = 0; a && depth <= 3; depth++, a = a.parentElement) {
      let d = null;
      try {
        d = a.querySelector(dateSelector);
      } catch (e) {
        return { invalid: true };
      }
      if (d && (a === it || it.contains(d) || (d.compareDocumentPosition(it) & Node.DOCUMENT_POSITION_FOLLOWING))) {
        return { el: d, inside: it.contains(d) };
      }
      if (a.tagName === 'TR' || a.tagName === 'LI') break;
    }
    return {};
  };
  // ol の中の li の番号。start と reversed と、li の value に従う。
  const olNumber = (li) => {
    const ol = li.parentElement;
    const lis = [...ol.children].filter((c) => c.tagName === 'LI');
    const reversed = ol.hasAttribute('reversed');
    let n = parseInt(ol.getAttribute('start'), 10);
    if (Number.isNaN(n)) n = reversed ? lis.length : 1;
    for (const x of lis) {
      const v = parseInt(x.getAttribute('value'), 10);
      if (!Number.isNaN(v)) n = v;
      if (x === li) return n;
      n += reversed ? -1 : 1;
    }
    return null;
  };
  // replace は Map（要素 → 文字）。その要素を、中の文字の代わりにその文字として読む（日付の要素）。空の文字なら読まない（分類の言葉）。
  const textLines = (root, visibleOnly = false, scope = 'line', replace = null) => {
    let out = '';
    const walk = (node, isRoot, keepNewlines, shown) => {
      if (replace && replace.has(node)) {
        out += ` ${replace.get(node)} `;
        return;
      }
      if (node.nodeType === 3) {
        if (shown) out += keepNewlines ? node.nodeValue : node.nodeValue.replace(/\s+/g, ' ');
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = node.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE') return;
      // 見出し（h1〜h6）の中の改行は、見た目の折り返しなので、行を分けずにつなぐ（印 \u0008。行を整えるときに、日本語どうしなら
      // そのまま、英数字が隣なら空白でつなぐ）。「共生社会を希究する、」「そして未来へ」が二つの段落に割れた（2026-11-05 の Windows の確かめ）。
      if (tag === 'BR') { out += node.closest('h1, h2, h3, h4, h5, h6') ? '\u0008' : '\n'; return; }
      if (!isRoot && node.getAttribute('aria-hidden') === 'true') return;
      const cs = getComputedStyle(node);
      if (visibleOnly && !isRoot && cs.display === 'none') return;
      const visible = !visibleOnly || cs.visibility === 'visible';
      const pre = PRE_SPACE.test(cs.whiteSpace || '');
      const block = cs.display === 'none' ? BLOCK.has(tag) : BLOCK.has(tag) || BLOCK_DISPLAY.test(cs.display);
      // 要素の境目の区切りは、ページの文字の空白と分けて印（\u0007）で入れ、行を整えるときに空白にする。
      const sep = block ? '\n' : INLINE.has(tag) ? '' : '\u0007';
      out += sep;
      // 番号の付いた一覧（ol）の項目は、頭に番号を付けて読む（画面に番号が出ているときだけ。list-style が none の ol は付けない）。
      // 手順が番号無しで読まれた（2026-11-04 の Windows の確かめ）。当たった要素そのもの（一覧のカードの一件）には付けない（「1件目」と重なるため）。
      if (tag === 'LI' && !isRoot && node.parentElement && node.parentElement.tagName === 'OL' && cs.listStyleType !== 'none') {
        const n = olNumber(node);
        if (n !== null) out += `${n} `;
      }
      const label = (node.getAttribute('aria-label') || '').trim();
      if (tag === 'IMG' || node.getAttribute('role') === 'img') {
        const alt = (node.getAttribute('alt') || label).trim();
        if (alt && visible) out += ` ${ALT_OPEN}${alt}${ALT_CLOSE} `;
        out += sep;
        return;
      }
      const before = out.length;
      for (const child of node.childNodes) walk(child, false, pre, visible);
      if (label && visible && out.slice(before).trim() === '') out += ' ' + label + ' ';
      out += sep;
    };
    walk(root, true, false, true);
    if (scope === 'item') out = settleAlts(out);
    const lines = [];
    for (const raw of out.split('\n')) {
      const line = settleAlts(raw)
        // 要素の境目の区切りは、日本語の後ろの開き括弧の前では入れない（別々の要素の「利用料」「（税込）」が、題と違って空白つきで読まれた）。
        // ページの文字にもとからある空白は、そのまま残す。
        .replace(/([^\x00-\x7F])\s*\u0008\s*(?=[^\x00-\x7F])/g, '$1')
        .replace(/\s*\u0008\s*/g, ' ')
        .replace(/([^\x00-\x7F])\u0007+(?=[（「『【])/g, '$1')
        .replace(/\u0007/g, ' ')
        .replace(/[^\S\n]+/g, ' ')
        .trim()
        // 区切りに入れた空白が、句読点と括弧の内側に来たら外す。
        .replace(/ (?=[、。，．！？）」』】])/g, '')
        .replace(/([（「『【]) /g, '$1')
        // 同じ文が続けて二度出たら一度にする（画像の alt とその下の文字が同じときなど）。
        .replace(/(\S.{3,}?) \1(?= |$)/g, '$1');
      if (!line || line === lines[lines.length - 1]) continue;
      // 前の行が「・」「／」で終わるか、この行がそれで始まるときは、一つの名前の続きなので前の行につなぐ（どちらかが記号だけの行ならつながない）。
      // 前は「-」「＋」などもつなぎにしていて、気象庁の早期注意情報の表で「-」の升目で終わる行が次の行とつながった（2026-11-04 の Windows の確かめ）。
      const last = lines[lines.length - 1];
      const joins = last !== undefined && last.length > 1 && line.length > 1 && (/[・／]$/.test(last) || /^[・／]/.test(line));
      if (joins) lines[lines.length - 1] = last + line;
      else lines.push(line);
    }
    return lines;
  };
  // 一覧の1件は、一つの項目として読む。行の区切りは、句読点で終わっていなければ読点にする。
  // 行の間は、ふつうは読点で区切る。前の行が句読点で終わるときは空白にする。
  // 一つの名前が二つの要素に分かれているときは区切らない: 前の行が「・」「／」などのつなぎで終わるか、次の行がそれで始まるときは
  // そのままつなぎ、前の行の終わりと次の行の頭がどちらも英数字なら空白でつなぐ（「在宅医療・、介護連携」「TSUKUBA、OPEN DATA」と読んだ）。
  const joint = (acc, line) => {
    if (acc.length > 1 && line.length > 1 && (/[・／]$/.test(acc) || /^[・／]/.test(line))) return '';
    if (/[A-Za-z0-9]$/.test(acc) && /^[A-Za-z0-9]/.test(line)) return ' ';
    return /[、。，．！？：:,.;；]$/.test(acc) ? ' ' : '、';
  };
  const oneLine = (lines) => lines.reduce((acc, line) => (acc === '' ? line : `${acc}${joint(acc, line)}${line}`), '')
    .replace(/(\S.{3,}?)[、 ]\1(?=[、 ]|$)/g, '$1');
  const query = (s) => {
    try {
      return { el: document.querySelector(s) };
    } catch (e) {
      return { invalid: true };
    }
  };
  // 一覧の一件ごとの手がかり（文字そのものではなく、短いハッシュ）。itemKeysOf と同じ作り方（ページの中の関数なので二か所に書く）。
  const itemKeys = (els) => {
    const seen = new Map();
    return els.map((e) => {
      const t = (e.textContent || '').replace(/\s+/g, ' ').trim();
      let h = 0x811c9dc5;
      for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), (1 << 24) + 0x193) >>> 0;
      const base = h.toString(16).padStart(8, '0');
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      return `${base}-${n}`;
    });
  };
  const deadline = Date.now() + waitMs;
  const busyAt = (el) => Boolean(el && (el.closest('[aria-busy="true"]') || el.querySelector('[aria-busy="true"]')));
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
      // 日付の要素のあるカードは、日付の読める項目が出てくるまで待つ（待つ長さの内）。
      // つくば市のイベントカレンダーは、読み込んだ直後は日の欄の無い仮の行が5件あり、0.6秒ほど後に日付つきの10件に描き直す
      // （2026-11-04 に Mac で測った。仮の行を読んで「（5件）」「6 金曜」になっていた）。
      const dateReady = () => items.some((it) => {
        const d = dateOf(it);
        return Boolean(d.invalid || (d.el && dateLabel(d.el)));
      });
      if (items.length > 0 && dateSelector && !dateReady() && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }
      // 書いている途中の所（項目か入れ物に aria-busy）があれば、書き終わるまで待つ。
      const busy = items.some(busyAt) || (container && busyAt(query(container).el));
      if (busy && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }
      let partners = [];
      if (joinWith) {
        try {
          partners = [...document.querySelectorAll(joinWith)];
        } catch (e) {
          return { found: false, reason: 'invalid', field: 'joinWith' };
        }
      }
      // 一件がほぼ表だけのとき（表が一つで、表の外の文が30字まで。表を含む li など）は、表をまるごと一件にせず、
      // 表の前の文・見出しの行（一度だけ）・行ごとに分ける。表の外の文が長い一件（表の入ったチャットの返事など）は、一件のまま。
      // 気象庁の「警戒レベルとの関係」が、表まるごと一件（400字ほど）になった（2026-11-04 の Windows の確かめ）。二つの表の組（joinWith）のときは分けない。
      const overrides = new Map();
      const blanks = new Map();
      // 表の行のまとまりの見出しの行（td の無い行で、すぐ下に td の行があるもの。二つ目の行から）。二つ以上あれば、まとまりのある表とみる。
      const hasTd = (r) => Boolean(r.querySelector('td'));
      const groupRowsOf = (table) => {
        const rows = [...table.rows].filter((r) => (r.textContent || '').trim() || r.querySelector('td'));
        const g = rows.filter((r, i) => !hasTd(r) && i > 0 && rows[i + 1] && hasTd(rows[i + 1]));
        return g.length >= 2 ? g : [];
      };
      const asTable = (it) => (it.tagName === 'TABLE' ? [it] : it.tagName !== 'TR' && !it.closest('table') ? [...it.querySelectorAll('table')].filter((t) => !t.parentElement.closest('table')) : []);
      if (items.length > 0 && !joinWith && items.some((it) => it.tagName === 'TABLE' || (it.tagName !== 'TR' && !it.closest('table') && it.querySelector('table')))) {
        const units = [];
        for (const it of items) {
          const tables = asTable(it);
          const rest = (it.textContent || '').replace(/\s+/g, '').length - tables.reduce((n, t) => n + (t.textContent || '').replace(/\s+/g, '').length, 0);
          if (tables.length !== 1 || rest > 30) {
            units.push(it);
            continue;
          }
          if (rest > 0) {
            units.push(it);
            blanks.set(it, tables);
          }
          for (const t of tables) {
            const rows = [...t.rows];
            // まとまりのある表は、行を全部並べ、下で題の行・時刻などの行・まとまりの見出しの行を外す（見出しの行をまとめて一件にしない）。
            if (groupRowsOf(t).length > 0) {
              units.push(...rows);
              continue;
            }
            const heads = rows.filter((r) => !r.querySelector('td'));
            if (heads.length > 0) {
              units.push(heads[0]);
              overrides.set(heads[0], heads.map((r) => oneLine(textLines(r, false, 'item'))).filter(Boolean).join(' '));
            }
            for (const r of rows) if (r.querySelector('td')) units.push(r);
          }
        }
        items = units;
      }
      // まとまりのある表の行を並べた一覧（Claude の案が表の行を全部指したときなど）では、td の無い行のうち、
      // 題の行（一行目の升目一つの行）・最初の td の行より前の升目一つの行（更新の時刻など。下で一件目の頭に付ける）・まとまりの見出しの行を、一件にしない。
      // 気象庁の発表状況の表で、題・時刻・「茨城県北部 警報・注意報」が一件ずつになった（2026-11-04 夜の Windows の確かめ・頼み26）。
      if (items.length > 0 && !joinWith) {
        for (const table of new Set(items.filter((it) => it.tagName === 'TR').map((it) => it.closest('table')))) {
          const groups = groupRowsOf(table);
          if (groups.length === 0) continue;
          const rows = [...table.rows];
          const firstData = rows.findIndex(hasTd);
          const drop = (r) => !hasTd(r) && !overrides.has(r)
            && (groups.includes(r) || (r.cells.length === 1 && (rows.indexOf(r) === 0 || rows.indexOf(r) < firstData)));
          items = items.filter((it) => !(it.tagName === 'TR' && it.closest('table') === table && drop(it)));
        }
      }
      // 表の中で、見出しだけの行（地域の名前）が行のまとまりごとに二つ以上あれば、その下の行の頭に、見出しの行の最初の升目を付けて読む。
      // 気象庁の発表状況の表で、地域名の行が抜け、「警報・注意報は発表されていません」の2件だけになった（2026-11-04 の Windows の確かめ）。
      const groupHead = new Map();
      // 行のまとまり（見出しの行）ごとの、一覧に入っている行。行が二つ以上のまとまりは、一件にまとめて読む（下の texts の後）。
      const groupRows = new Map();
      const isData = (r) => Boolean(r.querySelector('td'));
      if (items.length > 0 && !joinWith) {
        const cellText = (c) => oneLine(textLines(c, false, 'item'));
        for (const table of new Set(items.filter((it) => it.tagName === 'TR').map((it) => it.closest('table')))) {
          const rows = [...table.rows].filter((r) => (r.textContent || '').trim() || r.querySelector('td'));
          const groups = rows.filter((r, i) => !isData(r) && i > 0 && rows[i + 1] && isData(rows[i + 1]));
          if (groups.length < 2) continue;
          let label = '';
          for (const r of rows) {
            if (groups.includes(r)) label = r.cells[0] ? cellText(r.cells[0]) : '';
            else if (isData(r) && items.includes(r) && label) {
              groupHead.set(r, label);
              const g = groups.filter((x) => rows.indexOf(x) < rows.indexOf(r)).pop();
              if (!groupRows.has(g)) groupRows.set(g, { label, rows: [] });
              groupRows.get(g).rows.push(r);
            }
          }
        }
      }
      // 表の題の行の後ろにある、升目が一つだけの見出しの行（更新の時刻など）は、一件目の頭に付けて読む。
      // 表の中の、一件目より前の行と、分けて描いた表の頭（td の行の無い、すぐ前の表）の行を見る。題の行（一行目の升目一つの行）と、升目が二つ以上の列の名前の行は付けない。
      // 気象庁の警戒レベル相当情報と発表状況の表で、「…更新」の時刻が抜けた（2026-11-04 の Windows の確かめ）。
      let lead = '';
      const firstRow = items.find((it) => it.tagName === 'TR');
      if (firstRow && firstRow === items[0] && !overrides.has(firstRow)) {
        const notes = (rows) => rows.filter((r, i) => !isData(r) && r.cells.length === 1 && i > 0).map((r) => oneLine(textLines(r, false, 'item'))).filter(Boolean);
        const table = firstRow.closest('table');
        const rows = [...table.rows];
        const parts = notes(rows.slice(0, rows.indexOf(firstRow)));
        // すぐ前の兄弟を4段上までさかのぼる。同じ表の写し（固定の列の表など、td の行のある表を含む兄弟）は飛ばす。それ以外の兄弟に当たったら止める。
        let stop = false;
        for (let n = table, d = 0; n && d < 4 && !stop; n = n.parentElement, d++) {
          for (let p = n.previousElementSibling; p && !stop; p = p.previousElementSibling) {
            if (p.matches('table') && p.rows.length > 0 && ![...p.rows].some(isData)) {
              parts.push(...notes([...p.rows]));
              stop = true;
            } else if (!(p.matches('table') ? [p] : [...p.querySelectorAll('table')]).some((t) => [...t.rows].some(isData))) stop = true;
          }
        }
        lead = parts.join(' ');
      }
      if (items.length > 0) {
        let texts = items.map((it, k) => {
          if (overrides.has(it)) return overrides.get(it);
          const replace = new Map();
          for (const t of blanks.get(it) || []) replace.set(t, '');
          let head = groupHead.get(it) ? `${groupHead.get(it)} ` : '';
          if (dateSelector) {
            const d = dateOf(it);
            const label = d.el ? dateLabel(d.el, !d.inside) : null;
            if (label && d.inside) replace.set(d.el, label);
            else if (label) head += `${label} `;
          }
          const tags = [];
          if (tagSelector) {
            let found = [];
            try {
              found = [...it.querySelectorAll(tagSelector)];
            } catch (e) {
              found = [];
            }
            for (const t of found) {
              const word = (t.textContent || '').replace(/\s+/g, ' ').trim();
              if (word && !tags.includes(word)) tags.push(word);
              replace.set(t, '');
            }
          }
          const body = oneLine(textLines(it, false, 'item', replace));
          // 表の行で、見出しの列（th。無ければ最初の升目）にだけ文字があり、残りの升目が全部空なら、名前の後に「なし」と読む。
          // 名前だけ（「水戸市」）では、何も無いのか読めなかったのか分からなかった（2026-11-04 の Windows の確かめ）。
          let none = '';
          if (it.tagName === 'TR') {
            const cells = [...it.cells];
            let heads = cells.filter((c) => c.tagName === 'TH');
            if (heads.length === 0) heads = cells.slice(0, 1);
            const rest = cells.filter((c) => !heads.includes(c));
            const empty = (c) => !(c.textContent || '').trim() && !c.querySelector('img[alt]:not([alt=""]), [aria-label]');
            if (rest.length > 0 && rest.every(empty) && heads.some((h) => (h.textContent || '').trim())) none = ' なし';
          }
          const partner = partners[k] ? oneLine(textLines(partners[k], false, 'item')) : '';
          return `${head}${body}${partner ? ` ${partner}` : none}${tags.length > 0 ? `（${tags.join('、')}）` : ''}`;
        });
        // 行が二つ以上ある行のまとまりは、「地域名 行1、行2、…」の一件にまとめる。行は升目ごとに空白で区切り、見出しの升目だけに文字があれば「なし」。
        // 気象庁の発表状況の表は、警報が出ていると地域ごとに特別警報・警報・注意報の三行になり、「茨城県北部 警報 なし」のように地域が細かく割れた
        // （2026-11-04 夜の Windows の確かめ・頼み26）。
        const multi = [...groupRows.values()].filter((g) => g.rows.length >= 2);
        if (multi.length > 0) {
          const rowText = (r) => {
            const cells = [...r.cells].map((c) => oneLine(textLines(c, false, 'item'))).filter(Boolean);
            const empty = [...r.cells].slice(1).every((c) => !(c.textContent || '').trim() && !c.querySelector('img[alt]:not([alt=""]), [aria-label]'));
            return cells.length === 0 ? '' : `${cells.join(' ')}${empty && r.cells.length > 1 ? ' なし' : ''}`;
          };
          const outItems = [];
          const outTexts = [];
          items.forEach((it, k) => {
            const g = multi.find((x) => x.rows.includes(it));
            if (!g) {
              outItems.push(it);
              outTexts.push(texts[k]);
            } else if (g.rows[0] === it) {
              outItems.push(it);
              outTexts.push(`${g.label} ${g.rows.map(rowText).filter(Boolean).join('、')}`);
            }
          });
          items = outItems;
          texts = outTexts;
        }
        // 読まない決まり（skipItems）に当たる一件は外す。全部が外れたら「0件です。」。
        if (skipItems) {
          let skip = null;
          try {
            skip = new RegExp(skipItems);
          } catch (e) {
            skip = null;
          }
          if (skip) {
            const keep = texts.map((t, i) => (skip.test(t) ? -1 : i)).filter((i) => i >= 0);
            items = keep.map((i) => items[i]);
            texts = keep.map((i) => texts[i]);
            if (texts.length === 0) return { found: true, text: '0件です。', truncated: false, items: [], keys: [], ...(busy ? { partial: true } : {}) };
          }
        }
        // 文字の無い一件（表の頭の飾りの空の行など）は読まない（「1件目: 」と空のまま読まれた。気象庁の警報の表）。
        // 全部が空なら、今までどおり項目のまま返す（空の項目として知らせる）。
        if (texts.some((t) => t.trim() !== '')) {
          const keep = texts.map((t, i) => (t.trim() !== '' ? i : -1)).filter((i) => i >= 0);
          items = keep.map((i) => items[i]);
          texts = keep.map((i) => texts[i]);
          if (lead && !texts[0].includes(lead)) texts[0] = `${lead} ${texts[0]}`;
        }
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
        return {
          found: true, text: text.slice(0, limit), truncated: text.length > limit, items: parts, keys: itemKeys(items).slice(0, parts.length),
          ...(busy ? { partial: true } : {}),
        };
      }
      if (loginSelector && query(loginSelector).el) return { found: false, reason: 'login' };
      if (container) {
        const box = query(container);
        if (box.invalid) return { found: false, reason: 'invalid', field: 'container' };
        if (box.el) {
          // 入れ物が書いている途中なら、0件と決めずに待つ。
          if (busyAt(box.el) && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 250));
            continue;
          }
          if (containerSeenAt === null) containerSeenAt = Date.now();
          if (Date.now() - containerSeenAt >= EMPTY_SETTLE_MS || Date.now() >= deadline) {
            return { found: true, text: '0件です。', truncated: false, items: [], ...(busyAt(box.el) ? { partial: true } : {}) };
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
  // 書いている途中なら、書き終わるまで待つ（その間に要素が置き換わることがあるので、当たり直す）。
  while (busyAt(el) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    const again = query(selector).el;
    if (again) el = again;
  }
  const partial = busyAt(el);
  // ふだんは見えている文を、行ごとに読む（画面の項目は行ごとに一つ）。見えている文が無いときは、隠れている所も読む。
  const parts = [el];
  if (until) {
    for (let n = el.nextElementSibling; n; n = n.nextElementSibling) {
      let stop;
      try {
        stop = n.matches(until);
      } catch (e) {
        return { found: false, reason: 'invalid', field: 'until' };
      }
      if (stop) break;
      if (getComputedStyle(n).display !== 'none') parts.push(n);
    }
  }
  let lines = parts.flatMap((p) => textLines(p, true));
  if (lines.length === 0) lines = parts.flatMap((p) => textLines(p));
  // 「目次に戻る」「ページの先頭へ」のような、ページの中を戻るだけの一行は読まない（ほかに読む行があるとき）。
  const BACKLINK = /^(目次|ページの(先頭|上|トップ)|このページの(先頭|上|トップ)|先頭|トップ)(へ|に)?(戻る)?$/;
  const kept = lines.filter((l) => !BACKLINK.test(l));
  if (kept.length > 0) lines = kept;
  const text = lines.join('\n');
  return { found: true, text: text.slice(0, limit), truncated: text.length > limit, ...(partial ? { partial: true } : {}) };
}

// ページで動かす文を作る。selector は JSON にして埋め込み、文として解釈されないようにする。
function buildScript(selector, action, loginSelector = null, waitMs = WAIT_MS, container = null, dateSelector = null, until = null, tagSelector = null,
  joinWith = null, skipItems = null) {
  const args = [selector, action, loginSelector, READ_LIMIT, waitMs, container, dateSelector, until, tagSelector, joinWith, skipItems].map((v) => JSON.stringify(v)).join(', ');
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
// 「元のページを表示する」で前に出した窓（id）。その窓で Esc キーを押すと、Todoku の窓へ戻る。
const revealed = new Set();
// カードの画面の窓（Todoku の窓）。ウェブアプリの窓に焦点が来てしまったら、ここへ戻す。
let homeWindow = null;
// Todoku の窓に焦点が戻ったら、ログインのために前に出していた窓を、焦点を取れない窓に戻す（見直しの7）。
// 前は次にカードを動かすまで守りが外れたままで、その間にログインの窓のページが焦点を取ると、NVDA がそちらへ移りえた
// （smoke で、Todoku の窓に戻った後もログインの窓が焦点を取れる窓のままで、焦点が返らないことを確かめた）。
function endLoginFocus() {
  revealed.clear();
  let restored = 0;
  for (const id of [...loginFocus]) {
    const w = windows.get(id);
    loginFocus.delete(id);
    if (!w || w.isDestroyed()) continue;
    restoreUnfocusable(w);
    restored += 1;
  }
  if (restored > 0) guardHomeFront(homeWindow);
}

// 前に出していたウェブアプリの窓を、焦点を取れない窓に戻す（Windows では、タスクバーからも外す）。すぐに戻す。
// 2f8b231 では Windows だけ500ミリ秒おくらせたが、Todoku に戻った後に戻すことになり、Windows が一つ前の窓（ターミナル）へ
// 前面を渡したまま戻らなくなった（P → Esc で7回中7回。2026-11-06 夕方の WinCC の確かめ）。35e46ef と同じく、すぐに戻す。
function restoreUnfocusable(w, { platform = process.platform } = {}) {
  if (w.isDestroyed()) return;
  if (w.isFocusable()) w.setFocusable(false);
  if (platform === 'win32') w.setSkipTaskbar(true);
}

// Windows で、Todoku の窓が前面にいるはずなのに前面でなくなっていたら、もう一度前に出す（150ミリ秒後と600ミリ秒後に見る）。
// ウェブアプリの窓を焦点を取れない窓に戻したとき、Windows が一つ前の窓へ前面を渡すことがあるため。Mac では何もしない。
function guardHomeFront(home, { platform = process.platform, later = setTimeout, bring = bringToFront, headless = testHeadless() } = {}) {
  if (platform !== 'win32' || headless || !home) return 0;
  const check = () => {
    if (home.isDestroyed() || !home.isVisible() || home.isFocused()) return;
    bring(home, { platform });
  };
  later(check, 150);
  later(check, 600);
  return 2;
}

function setHomeWindow(win) {
  if (homeWindow && !homeWindow.isDestroyed()) homeWindow.removeListener('focus', endLoginFocus);
  homeWindow = win;
  if (win) win.on('focus', endLoginFocus);
}

// 試しの台本（test/headless.js）が TODOKU_TEST_HEADLESS=1 を立てたときは、窓を画面に出さず、焦点も動かさない。
// 試しの窓が開いて、人が別のアプリで打っていた文字がその窓に入ったことがあった（2026-11-03）。アプリとして起こしたときは立たない。
function testHeadless() {
  return process.env.TODOKU_TEST_HEADLESS === '1';
}

// ウェブアプリの窓を、Todoku の窓の後ろに置く。焦点は動かさない（moveTop は焦点を移さずに z の順だけを変える）。
// 2026-11-03 の Windows の確かめで、別のページを読み込むカード（つくば市のイベント情報）を読んだ後、
// 前の窓は Todoku のままなのに、ウェブアプリの窓が Todoku の窓の上に重なって出て、NVDA が結果を読まず、矢印と Esc にも黙った。
// Todoku の窓が前にあるとき（使う人がカードの画面にいるとき）だけ、Todoku の窓を z の順の一番上へ戻す。
// 使う人が別のアプリにいるときは何もしない（そのアプリの窓の上に Todoku を出さないため）。
function keepBehindHome(win) {
  if (testHeadless() || !win || win.isDestroyed() || !win.isVisible() || loginFocus.has(idOf(win))) return;
  if (!homeWindow || homeWindow.isDestroyed() || homeWindow === win || !homeWindow.isVisible() || !homeWindow.isFocused()) return;
  homeWindow.moveTop();
}

function idOf(win) {
  for (const [id, w] of windows) if (w === win) return id;
  return null;
}

// 前に出さずに見せ、Todoku の窓の後ろに置く（試しのときは見せない）。
function showQuietly(win) {
  if (testHeadless()) return;
  if (!win.isVisible()) win.showInactive();
  keepBehindHome(win);
}

function keepUnfocusable(id, win) {
  loginFocus.delete(id);
  revealed.delete(id);
  if (win.isFocusable()) win.setFocusable(false);
}

// ページを開く・ページの中で読む文を流す、の時間の上限（見直しの3）。応えない口のページを読むと、60秒たっても終わらなかった
// （手元の作り物の http の口で確かめた）。時間切れなら読み込みを止め、例外にする（runCard は「ページを開けませんでした」と返す）。
const LOAD_TIMEOUT_MS = 30000;
const SCRIPT_EXTRA_MS = 15000; // 読む文の待つ長さ（waitMs）の上に足す余り

function withLimit(promise, ms, onTimeout) {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => {
      // 先に時間切れとして返してから止める（止めると読み込みの側が別の理由で失敗するので、その理由より先に返す）。
      reject(new Error('時間内に終わりませんでした'));
      try {
        if (onTimeout) onTimeout();
      } catch (e) {
        // 止められなくても、時間切れとして返す
      }
    }, ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

async function loadWithLimit(win, url, ms = LOAD_TIMEOUT_MS) {
  return withLimit(win.loadURL(url), ms, () => { if (!win.isDestroyed()) win.webContents.stop(); });
}

function runWithLimit(win, script, waitMs) {
  return withLimit(win.webContents.executeJavaScript(script), (waitMs ?? WAIT_MS) + SCRIPT_EXTRA_MS);
}

async function openTarget(BrowserWindow, config, url, options = {}) {
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
    // 元のページやログインのために前に出していた窓を、使う人が閉じたときは、Todoku の窓へ戻す
    // （戻さないと、Windows ではほかのアプリの窓が前に来て、使う人が取り残される）。
    // 前に出していたかは、閉じ始め（close）で見ておく。Mac では閉じる途中で Todoku の窓に焦点が移り、closed の時には印が外れていた（窓を出す smoke で確かめた）。
    let shownAtClose = false;
    win.on('close', () => { shownAtClose = revealed.has(id) || loginFocus.has(id); });
    win.on('closed', () => {
      const shown = shownAtClose || revealed.has(id) || loginFocus.has(id);
      windows.delete(id);
      loginFocus.delete(id);
      revealed.delete(id);
      if (shown) backToHome(id, 'closed');
    });
    // 「元のページを表示する」で前に出したときだけ、Esc キーで Todoku の窓へ戻る（ページには渡さない）。
    // （node の試しの偽の窓には on が無いので、あるときだけ付ける。）
    if (typeof win.webContents.on === 'function') {
      win.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown' || input.key !== 'Escape' || !revealed.has(id)) return;
        event.preventDefault();
        backToHome(id);
      });
    }
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
  if (!isSamePage(win.webContents.getURL(), url)) await loadWithLimit(win, url, options.loadTimeoutMs);
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
    win = await openTarget(BrowserWindow, config, resolveUrl(config.url, card.path), options);
  } catch (e) {
    return { ok: false, where: card.path ? `cards[${index}].path` : 'url', message: `ページを開けませんでした: ${e.message}` };
  }
  const loginSelector = config.login ? config.login.selector : null;
  const container = card.action === 'list' && card.container ? card.container : null;
  const dateSelector = card.action === 'list' && card.dateSelector ? card.dateSelector : null;
  const until = card.action === 'read' && card.until ? card.until : null;
  const tagSelector = card.action === 'list' && card.tagSelector ? card.tagSelector : null;
  const joinWith = card.action === 'list' && card.joinWith ? card.joinWith : null;
  const skipItems = card.action === 'list' && card.skipItemsMatching ? card.skipItemsMatching : null;
  // 押すカードは、押す前からダウンロードを待ち受ける。
  // 保存の名前の型（saveAs）があれば、始まったダウンロードをその名前で保存する。
  const watch = card.action === 'click' ? watchDownload({ saveAs: card.saveAs || null }) : null;
  let result;
  try {
    result = await runWithLimit(win, buildScript(card.selector, card.action, loginSelector, options.waitMs, container, dateSelector, until, tagSelector, joinWith, skipItems), options.waitMs);
  } catch (e) {
    if (watch) watch.cancel();
    throw e;
  }
  // 読んでいる間にページが自分で動いても（押したカードで別のページへ移ったときなど）、Todoku の窓を上に保つ。
  keepBehindHome(win);
  if (watch && !result.found) watch.cancel();
  if (result.reason === 'login') {
    // ログインは人が手で行う。ログインの画面を開いておく。
    // 窓を前に出すのは、利用者がカードの「ログインの窓を前に出す」を押したとき（showTarget）。
    // ここで勝手に前に出すと、カードの画面の知らせを聞く前に焦点が移ってしまうため。
    if (config.login.path) {
      try {
        const loginUrl = resolveUrl(config.url, config.login.path);
        if (!isSamePage(win.webContents.getURL(), loginUrl)) await loadWithLimit(win, loginUrl, options.loadTimeoutMs);
      } catch (e) {
        return { ok: false, where: 'login.path', message: `ログインの画面を開けませんでした: ${e.message}` };
      }
    }
    showQuietly(win);
    return { ok: false, needLogin: true, message: 'ログインが必要です。ウェブアプリのウィンドウでログインしてから、もう一度カードで Enter キーを押してください' };
  }
  if (!result.found) {
    if (result.field === 'container') return { ok: false, where: `cards[${index}].container`, message: 'container の書き方が正しくありません' };
    if (result.field === 'joinWith') return { ok: false, where: `cards[${index}].joinWith`, message: 'joinWith の書き方が正しくありません' };
    if (result.field === 'until') return { ok: false, where: `cards[${index}].until`, message: 'until の書き方が正しくありません' };
    const message = result.reason === 'invalid' ? 'selector の書き方が正しくありません' : 'ページの中に読む場所が見つかりません';
    return { ok: false, where, message };
  }
  if (card.action === 'click') {
    // 押した結果ダウンロードが始まったら、保存が終わるまで待ち、結果に入れる（画面がそれを知らせる）。
    const download = await watch.wait({ startMs: options.downloadStartMs ?? 1000 });
    return { ok: true, action: card.action, ...(download ? { download } : {}) };
  }
  let { text, items } = result;
  if (card.action === 'list' && Array.isArray(items) && items.length > 0) {
    const next = tidyListItems(items, card.undatedLabel || null);
    if (next.some((t, i) => t !== items[i])) {
      items = next;
      text = `${items.length}件あります。\n${items.map((t, i) => `${i + 1}件目: ${t}`).join('\n')}`;
    }
  }
  return {
    ok: true, action: card.action, text, truncated: result.truncated,
    ...(items ? { items } : {}), ...(result.keys ? { keys: result.keys } : {}), ...(result.partial ? { partial: true } : {}),
  };
}

// 一覧の一件の頭の飾り「＼Hot!／」の「＼」「／」は読まない（「Hot!、…」にする）。本学のトピックスの固定の記事で、記号まで読まれた
// （2026-11-05 の Windows の確かめ）。
const HEAD_DECORATION = /^＼\s*([^＼／、。\n]{1,12}?)\s*／[、\s]*/;
// 日付で始まる一件か（「2026年11月04日、」「2026.10.16 」「2026/11/4」「11月4日」「令和8年」）。
const HEAD_DATE = /^(\d{4}\s*[年./-]\s*\d{1,2}\s*[月./-]\s*\d{1,2}|\d{1,2}月\d{1,2}日|令和\d+年)/;

// 一覧の一件ずつの文を整える。undatedLabel（設定ファイルの list のカードだけ・任意）があれば、ほかに日付で始まる一件があるのに
// 日付で始まらない一件の頭に「固定の記事、」のように付ける（日付の無い件だと分かるように）。
function tidyListItems(items, undatedLabel = null) {
  const tidied = items.map((t) => {
    const m = HEAD_DECORATION.exec(t);
    return m ? `${m[1]}、${t.slice(m[0].length)}` : t;
  });
  if (!undatedLabel || !tidied.some((t) => HEAD_DATE.test(t))) return tidied;
  return tidied.map((t) => (HEAD_DATE.test(t) || t.trim() === '' ? t : `${undatedLabel}、${t}`));
}

// ページの中で動く関数。一覧の index 件目（0 から）の項目から、itemTarget の closest・next・find の順にたどり、着いた要素に印を付ける。
// 印の付いた要素は、ふだんの読むカードと同じ読み方（pageAction）で読む（書いている途中なら待つ、など）。
// key（一覧を読んだときの、その一件の手がかり）があれば、番号でなく、今のページで同じ手がかりの項目を探す。
// 一覧を読んだ後にページで発言が増えて、番号がずれても、選んだ一件を読むため。見つからなければ reason: 'changed'。
function pageMarkItemTarget(selector, target, index, attr, token, key) {
  for (const old of document.querySelectorAll(`[${attr}]`)) old.removeAttribute(attr);
  const itemKeys = (els) => {
    const seen = new Map();
    return els.map((e) => {
      const t = (e.textContent || '').replace(/\s+/g, ' ').trim();
      let h = 0x811c9dc5;
      for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), (1 << 24) + 0x193) >>> 0;
      const base = h.toString(16).padStart(8, '0');
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      return `${base}-${n}`;
    });
  };
  try {
    const items = [...document.querySelectorAll(selector)];
    let at = index;
    if (key) {
      at = itemKeys(items).indexOf(key);
      if (at < 0) return { found: false, reason: 'changed' };
    }
    let el = items[at] || null;
    if (!el) return { found: false, reason: 'no-item', count: items.length };
    if (target.closest) el = el.closest(target.closest);
    if (el && target.next) {
      let n = el.nextElementSibling;
      while (n && !n.matches(target.next)) n = n.nextElementSibling;
      el = n;
    }
    if (el && target.find) el = el.querySelector(target.find);
    if (!el) return { found: false, reason: 'none' };
    el.setAttribute(attr, token);
    return { found: true };
  } catch (e) {
    return { found: false, reason: 'invalid' };
  }
}

const ITEM_TARGET_ATTR = 'data-todoku-item-target';

// 一覧のカードの index 件目（0 から）に結び付いた所（itemTarget）を読む。結果は runCard の読むカードと同じ形。
// チャットの「自分の質問を全部読む」で一つ選ぶと、その返事を読む、のような使い方。
async function readItemTarget(BrowserWindow, config, cardId, index, options = {}, key = null) {
  const k = config.cards.findIndex((c) => c.id === cardId);
  if (k < 0) return { ok: false, where: '(なし)', message: `カード「${cardId}」が設定ファイルにありません` };
  const card = config.cards[k];
  if (card.action !== 'list' || !card.itemTarget) return { ok: false, where: `cards[${k}].itemTarget`, message: 'このカードには、項目を選んで読む場所がありません' };
  let win;
  try {
    win = await openTarget(BrowserWindow, config, resolveUrl(config.url, card.path), options);
  } catch (e) {
    return { ok: false, where: card.path ? `cards[${k}].path` : 'url', message: `ページを開けませんでした: ${e.message}` };
  }
  const token = `t${Date.now().toString(36)}`;
  const args = [card.selector, card.itemTarget, Number(index), ITEM_TARGET_ATTR, token, key || null].map((v) => JSON.stringify(v)).join(', ');
  const mark = await win.webContents.executeJavaScript(`(${pageMarkItemTarget.toString()})(${args})`);
  if (!mark.found) {
    if (mark.reason === 'changed') return { ok: false, where: `cards[${k}].selector`, message: '一覧を読んだ後に、ページが変わりました', changed: true };
    const message = mark.reason === 'invalid' ? 'itemTarget の書き方が正しくありません' : '選んだ項目に結び付いた場所がありません';
    return { ok: false, where: `cards[${k}].itemTarget`, message, notFound: mark.reason !== 'invalid' };
  }
  let result;
  try {
    result = await runWithLimit(win, buildScript(`[${ITEM_TARGET_ATTR}="${token}"]`, 'read', null, options.waitMs), options.waitMs);
  } finally {
    await win.webContents.executeJavaScript(`document.querySelectorAll('[${ITEM_TARGET_ATTR}]').forEach((e) => e.removeAttribute('${ITEM_TARGET_ATTR}'))`);
  }
  keepBehindHome(win);
  if (!result.found) return { ok: false, where: `cards[${k}].itemTarget`, message: '選んだ項目に結び付いた場所がありません', notFound: true };
  return { ok: true, action: 'read', text: result.text, truncated: result.truncated, ...(result.partial ? { partial: true } : {}) };
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
      if (states[k] === 'none') problems.push({ where: `cards[${index}].selector`, message: 'ページの中に読む場所が見つかりません' });
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
  if (!testHeadless()) bringToFront(win);
  return true;
}

// 窓を確かに前に出して、焦点を移す。
// Windows では、BrowserWindow.focus() だけでは前に来ず、タスクバーが点滅するだけのことがある（前の窓が別の処理のものだと、
// OS が前に出すのを止める）。元のページから Esc で戻ったとき、Todoku でなく、npm を起こした cmd の窓が前に来た（2026-11-06 の WinCC の報告）。
// Windows では一瞬だけ最前面にしてから戻し（setAlwaysOnTop と moveTop）、どの OS でも、ページの中にも焦点を渡す。
// 少し後に、まだ焦点が来ていなければ、もう一度だけ出し直す。later は試しのときに差し替える。
function bringToFront(win, { platform = process.platform, later = setTimeout } = {}) {
  if (!win || win.isDestroyed()) return false;
  if (win.isMinimized()) win.restore();
  win.show();
  if (platform === 'win32') {
    win.setAlwaysOnTop(true);
    win.focus();
    win.moveTop();
    later(() => { if (!win.isDestroyed()) win.setAlwaysOnTop(false); }, 300);
  } else {
    win.focus();
  }
  if (win.webContents && typeof win.webContents.focus === 'function') win.webContents.focus();
  later(() => {
    if (win.isDestroyed() || win.isFocused()) return;
    win.show();
    win.focus();
    if (win.webContents && typeof win.webContents.focus === 'function') win.webContents.focus();
  }, 150);
  return true;
}

// 元のページ（ウェブアプリの窓）を、そのままの見た目で前に出す。窓がまだ無ければ、設定ファイルの url を開いてから出す。
// ほかのアプリの窓は隠す（openTarget）。出した窓で Esc キーを押すと、Todoku の窓へ戻る（backToHome）。
async function revealTarget(BrowserWindow, config, options = {}) {
  const existing = windows.get(config.id);
  const now = existing && !existing.isDestroyed() ? existing.webContents.getURL() : '';
  await openTarget(BrowserWindow, config, now || resolveUrl(config.url), options);
  showTarget(config.id);
  revealed.add(config.id);
  return true;
}

// 前に出した元のページから、Todoku の窓へ戻る。Todoku の窓に焦点が戻ると、元のページの窓は焦点を取れない窓に戻る（endLoginFocus）。
// どんなきっかけで Todoku の窓へ戻したかの控え（試しが見るため。'escape' か 'closed'）。
const homeReturns = [];
// Windows では、Todoku の窓を前に出してから、元のページの窓を隠す（hide）。
// 前面の窓を先に隠すと Windows が一つ前の窓へ前面を渡すので、Todoku が前面になってから隠す。隠した窓は、次にカードを読むときに
// 前に出さずに見せ直す（openTarget の showQuietly）。隠しておけば、焦点を取れない窓に戻すときにも前面が動かない。
function backToHome(id, reason = 'escape', { platform = process.platform } = {}) {
  revealed.delete(id);
  if (!homeWindow || homeWindow.isDestroyed()) return false;
  homeReturns.push(reason);
  if (!testHeadless()) {
    bringToFront(homeWindow, { platform });
    const w = windows.get(id);
    if (platform === 'win32' && w && !w.isDestroyed() && w.isVisible()) w.hide();
  }
  return true;
}
function homeReturnLog() { return homeReturns.slice(); }

function isRevealed(id) {
  return revealed.has(id);
}

// いまウェブアプリの窓が開いているページの URL（窓が無ければ空の文字）。
function currentPageUrl(appId) {
  const win = windows.get(appId);
  return win && !win.isDestroyed() ? win.webContents.getURL() : '';
}

// 設定ファイルの url のページを開き、ページの中のリンクを読む。結果は { ok, links: [{ url, text }], truncated } か { ok: false, where, message }。
// リンクの文字は読み上げに渡すだけで、外へは送らない。
async function readLinks(BrowserWindow, config, options = {}) {
  let win;
  try {
    win = await openTarget(BrowserWindow, config, resolveUrl(config.url), options);
  } catch (e) {
    return { ok: false, where: 'url', message: `ページを開けませんでした: ${e.message}` };
  }
  const waitMs = options.linkWaitMs ?? 4000;
  const raw = await runWithLimit(win, `(${pageLinks.toString()})(${JSON.stringify(waitMs)})`, waitMs);
  keepBehindHome(win);
  const all = tidyLinks(raw, win.webContents.getURL(), MAX_LINKS + 1);
  return { ok: true, links: all.slice(0, MAX_LINKS), truncated: all.length > MAX_LINKS };
}

// ウェブアプリの窓を全部閉じる（Todoku の窓を閉じたとき）。閉じた数を返す。
function closeAllTargets() {
  const all = [...windows.values()];
  windows.clear();
  loginFocus.clear();
  revealed.clear();
  let n = 0;
  for (const w of all) {
    if (!w.isDestroyed()) {
      w.destroy();
      n += 1;
    }
  }
  return n;
}

// ウェブアプリの窓を閉じる（カードの束を作れなかったとき・消したとき）。窓が無ければ何もしない。
function closeTarget(appId) {
  const win = windows.get(appId);
  windows.delete(appId);
  if (win && !win.isDestroyed()) win.destroy();
}

module.exports = {
  resolveUrl, buildScript, pageAction, pageProbe, runCard, checkCards, openTarget, showTarget, closeTarget, isSamePage, setHomeWindow, testHeadless,
  readItemTarget, closeAllTargets, tidyListItems, revealTarget, backToHome, isRevealed, currentPageUrl, readLinks,
  bringToFront, homeReturnLog, restoreUnfocusable, guardHomeFront,
};
