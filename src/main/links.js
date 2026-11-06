'use strict';
// ページの中のリンクを、カードの一覧（「このページのリンク」）にする所と、いまのページを既定のブラウザで開くときの URL を決める所。
// リンクの文字は、このパソコンの中で読み上げに渡すだけで、Claude にも外にも送らない。

const { externalUrl } = require('./config');

// 一つのページから読むリンクの数の上限（読み上げで一件ずつ聞ける数に抑える）。
const MAX_LINKS = 300;
// リンクの名前の長さの上限（文字数）。
const NAME_MAX = 200;

// ページの中で動く関数。外の変数は使えないので、引数だけで動くようにする。
// リンク（a[href]）の行き先と名前を集める。後から出てくるリンクに備えて、数が落ち着くまで少し待つ（長くても waitMs）。
// 名前は、リンクの文字・aria-label・中の画像の alt・title の順に探す。
// あわせて、リンクがページのどの場所にあるか（area）を返す。場所は、いちばん内側のランドマーク
// （main・nav・header・footer・aside・role="search"・名前のある section や role="region"。role の付いたものを含む）。
// 本文（main）の中は、さらに見出し（h2・h3）ごとのまとまりに分ける。ランドマークの外のリンクは、すぐ前の見出し（h1〜h3）のまとまり。
// どちらも無ければ kind: 'none'。
// 場所の名前（label）は、ランドマークの aria-label・aria-labelledby の先の文字・中の最初の見出しの順（本文は aria-label だけ。
// 本文の最初の見出しはページの題のことが多く、場所の名前にならないため）。言語の切り替え（hreflang・lang のあるリンク）も印を付ける。
async function pageLinks(waitMs) {
  const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  const nameOf = (a) => clean(a.innerText || a.textContent)
    || clean(a.getAttribute('aria-label'))
    || clean([...a.querySelectorAll('img[alt]')].map((i) => i.getAttribute('alt')).join(' '))
    || clean(a.getAttribute('title'));
  const LANDMARKS = 'main, [role="main"], nav, [role="navigation"], header, [role="banner"], footer, [role="contentinfo"], aside, [role="complementary"], '
    + '[role="search"], section[aria-label], section[aria-labelledby], [role="region"][aria-label], [role="region"][aria-labelledby]';
  const kindOf = (el) => {
    const role = el.getAttribute('role') || '';
    const tag = el.tagName.toLowerCase();
    if (role === 'main' || tag === 'main') return 'main';
    if (role === 'navigation' || tag === 'nav') return 'nav';
    if (role === 'banner' || tag === 'header') return 'header';
    if (role === 'contentinfo' || tag === 'footer') return 'footer';
    if (role === 'complementary' || tag === 'aside') return 'aside';
    if (role === 'search') return 'search';
    return 'region';
  };
  const labelOf = (el, kind) => {
    const own = clean(el.getAttribute('aria-label'));
    if (own) return own;
    const by = (el.getAttribute('aria-labelledby') || '').split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean)
      .map((n) => clean(n.textContent)).join(' ');
    if (by) return by;
    if (kind === 'main') return '';
    const h = el.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]');
    return h ? clean(h.textContent) : '';
  };
  const collect = () => {
    const keys = new Map();
    const headings = [...document.querySelectorAll('h1, h2, h3')];
    let hk = -1;
    return [...document.querySelectorAll('a[href]')].map((a) => {
      let area;
      // すぐ前の見出し（文書の順で、このリンクより前にある最後の h1〜h3）。
      while (hk + 1 < headings.length && (headings[hk + 1].compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING)) hk += 1;
      const near = hk >= 0 ? headings[hk] : null;
      const land = a.parentElement ? a.parentElement.closest(LANDMARKS) : null;
      if (land && kindOf(land) === 'main' && !clean(land.getAttribute('aria-label')) && near && near.tagName !== 'H1' && land.contains(near)) {
        // 本文の中は、見出し（h2・h3）ごとのまとまりに分ける（本文のリンクがいちばん多く、一枚では長いため）。h1 はページの題なので使わない。
        area = { key: `m${hk}`, kind: 'main', label: clean(near.textContent).slice(0, 30) };
      } else if (land) {
        if (!keys.has(land)) {
          const kind = kindOf(land);
          keys.set(land, { key: `l${keys.size}`, kind, label: labelOf(land, kind).slice(0, 30) });
        }
        area = keys.get(land);
      } else {
        area = near ? { key: `h${hk}`, kind: 'heading', label: clean(near.textContent).slice(0, 30) } : { key: 'none', kind: 'none', label: '' };
      }
      return {
        href: a.href, text: nameOf(a), area, lang: Boolean(a.getAttribute('hreflang') || a.getAttribute('lang')),
        // 文字が数字だけ・1〜2字だけのリンクのための、ほかの名前（aria-label か title）。
        alt: clean(a.getAttribute('aria-label')) || clean(a.getAttribute('title')),
      };
    });
  };
  const started = Date.now();
  let last = -1;
  let same = 0;
  for (;;) {
    const n = document.querySelectorAll('a[href]').length;
    same = n === last ? same + 1 : 0;
    last = n;
    if ((n > 0 && same >= 2) || Date.now() - started >= waitMs) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return collect();
}

function withoutHash(url) {
  const k = url.indexOf('#');
  return k < 0 ? url : url.slice(0, k);
}

// 比べるための形: # から後を外し、終わりの / を外す。
function sameKey(url) {
  return withoutHash(String(url || '')).replace(/\/$/, '');
}

// それだけでは何のリンクか分からない文字（数字だけか、1〜2字だけ）。
function isWeakLinkText(text) {
  const t = String(text || '').trim();
  return /^[0-9０-９]+$/.test(t) || [...t].length <= 2;
}

// ページから集めたリンクを、読む一覧にそろえる。結果は [{ url, text }]。
// - 開けるのは http:// と https:// だけ（javascript:・mailto:・tel: などは除く）。
// - ページの中の飛び先（同じページの #…）と、いまのページそのものへのリンクは除く。
// - 同じ行き先（# から後の違いは同じと見る）は、ページの中で最初のものだけを残す。
// - 名前の無いリンクは除く（行き先の URL を一文字ずつ聞かせないため）。
function tidyLinks(raw, pageUrl, max = MAX_LINKS) {
  const here = sameKey(pageUrl);
  const seen = new Set();
  const out = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    if (!r || typeof r !== 'object') continue;
    const url = externalUrl(String(r.href || ''));
    if (!url) continue;
    const key = sameKey(url);
    if (key === here || seen.has(key)) continue;
    let text = String(r.text || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
    if (!text) continue;
    seen.add(key);
    const a = r.area && typeof r.area === 'object' ? r.area : {};
    // 文字が数字だけ・1〜2字だけのリンク（イベントカレンダーの「6」など）は、それだけでは何のリンクか分からない。
    // aria-label か title があればそれを使い、無ければ場所の名前を前に付ける（「イベント情報：6」）。
    if (isWeakLinkText(text)) {
      const alt = String(r.alt || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
      const place = String(a.label || '').replace(/\s+/g, ' ').trim().slice(0, 30) || (AREA_KINDS[a.kind] && AREA_KINDS[a.kind].name) || '';
      if (alt && alt !== text) text = alt;
      else if (place) text = `${place}：${text}`;
    }
    out.push({
      url, text,
      area: { key: String(a.key || 'none'), kind: String(a.kind || 'none'), label: String(a.label || '').replace(/\s+/g, ' ').trim().slice(0, 30) },
      lang: Boolean(r.lang),
    });
    if (out.length >= max) break;
  }
  return out;
}

// 場所の種類ごとの、名前が無いときの呼び名と、並びの順（小さいほど先）。本文を先に、ページの頭とフッターは後に。
const AREA_KINDS = {
  main: { name: '本文', order: 0 },
  heading: { name: '', order: 1 },
  region: { name: 'ページの中のまとまり', order: 1 },
  aside: { name: 'サイドバー', order: 2 },
  nav: { name: 'メニュー', order: 3 },
  search: { name: '検索', order: 3 },
  header: { name: 'ページの上', order: 4 },
  footer: { name: 'フッター', order: 5 },
  none: { name: 'そのほか', order: 6 },
};
const OTHER_LABEL = 'そのほか';
// ページの頭の小さな操作（言語の切り替え・スマートフォン版の切り替え・文字の大きさや背景色など）。場所によらず「そのほか」に入れる。
const SMALL_TOOLS = /^(English|Chinese|Korean|Portugu[eê]s|Espa[nñ]ol|Fran[cç]ais|Deutsch|Tiếng Việt|Filipino|Tagalog|ไทย|Bahasa|日本語|中文|简体中文|簡体中文|繁體中文|繁体中文|한국어|ポルトガル語|スペイン語|やさしい日本語|多言語|Language|Languages|スマートフォン版|スマホ版|PC版|パソコン版|モバイル版|文字(サイズ|の大きさ)|文字を?(大きく|小さく)|標準|拡大|縮小|背景色|配色|ふりがな|ルビ|音声読み上げ|読み上げ)/i;

// リンクの一覧を、ページの場所ごとのまとまりに分ける。全部のリンクは、どれか一つのまとまりにちょうど一度ずつ入る。
// 結果は [{ label, kind, indexes: [links の中の番号] }]。並びは、本文 → 見出しのまとまり・名前のあるまとまり → サイドバー →
// メニュー・検索 → ページの上 → フッター → そのほか（言語の切り替えなど）。同じ順のものは、ページの中の順。
// 同じ名前になったまとまりは一つにまとめる（名前の無い nav が二つあるときなど）。
function groupLinks(links) {
  const groups = new Map();
  (Array.isArray(links) ? links : []).forEach((l, i) => {
    const area = (l && l.area) || {};
    const small = Boolean(l && (l.lang || SMALL_TOOLS.test(String(l.text || ''))));
    const kind = small ? 'none' : (AREA_KINDS[area.kind] ? area.kind : 'none');
    let label = small ? OTHER_LABEL : String(area.label || '') || AREA_KINDS[kind].name || OTHER_LABEL;
    if (kind === 'none') label = OTHER_LABEL;
    if (!groups.has(label)) groups.set(label, { label, kind, order: AREA_KINDS[kind].order, first: i, indexes: [] });
    const g = groups.get(label);
    g.order = Math.min(g.order, AREA_KINDS[kind].order);
    g.indexes.push(i);
  });
  return [...groups.values()]
    .sort((a, b) => (a.label === OTHER_LABEL) - (b.label === OTHER_LABEL) || a.order - b.order || a.first - b.first)
    .map(({ label, kind, indexes }) => ({ label, kind, indexes }));
}

// 設定ファイルの読まない項目の決まり（list のカードの skipItemsMatching）を一つにまとめる。無ければ null。
// 裁定219（入試の材料は開かない）に寄せて、その語を含むリンクの題は「このページのリンク」にも出さない。
function skipPatternOf(config) {
  const parts = [...new Set((config && Array.isArray(config.cards) ? config.cards : [])
    .filter((c) => c && c.action === 'list' && typeof c.skipItemsMatching === 'string' && c.skipItemsMatching.trim() !== '')
    .map((c) => c.skipItemsMatching))];
  if (parts.length === 0) return null;
  try {
    return new RegExp(parts.map((p) => `(?:${p})`).join('|'));
  } catch (e) {
    return null;
  }
}

// 決まりに当たるリンクを外す（外したことは言わない。件数も外した後の数）。
function dropSkippedLinks(links, pattern) {
  if (!pattern) return links;
  return (Array.isArray(links) ? links : []).filter((l) => !pattern.test(String((l && l.text) || '')));
}

// いまのページを既定のブラウザで開くときの URL。ウェブアプリの窓が開いているページ（http か https）を先に、
// 無ければ設定ファイルの url を使う。どちらも開けない形（練習のページなど）なら null。
function browserUrl(currentUrl, configUrl) {
  return externalUrl(String(currentUrl || '')) || externalUrl(String(configUrl || ''));
}

// リンクの行き先に、Todoku の束（設定ファイル・作った束）があるかを探す。
// 束の url と合えばその束（cardId は null）、カードの path のページと合えばその束とカード。無ければ null。
// 比べるときは # から後と、終わりの / を外す。
function findDeckFor(url, configs) {
  const key = sameKey(url);
  if (!key) return null;
  const list = Array.isArray(configs) ? configs.filter((c) => c && externalUrl(String(c.url || ''))) : [];
  for (const config of list) if (sameKey(config.url) === key) return { config, cardId: null };
  for (const config of list) {
    for (const card of config.cards || []) {
      if (!card.path) continue;
      let page;
      try {
        page = new URL(card.path, config.url).href;
      } catch (e) {
        continue;
      }
      if (sameKey(page) === key) return { config, cardId: card.id };
    }
  }
  return null;
}

module.exports = {
  MAX_LINKS, pageLinks, tidyLinks, groupLinks, browserUrl, findDeckFor, sameKey, isWeakLinkText, skipPatternOf, dropSkippedLinks,
};
