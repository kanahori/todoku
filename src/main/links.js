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
async function pageLinks(waitMs) {
  const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  const nameOf = (a) => clean(a.innerText || a.textContent)
    || clean(a.getAttribute('aria-label'))
    || clean([...a.querySelectorAll('img[alt]')].map((i) => i.getAttribute('alt')).join(' '))
    || clean(a.getAttribute('title'));
  const collect = () => [...document.querySelectorAll('a[href]')].map((a) => ({ href: a.href, text: nameOf(a) }));
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
    const text = String(r.text || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
    if (!text) continue;
    seen.add(key);
    out.push({ url, text });
    if (out.length >= max) break;
  }
  return out;
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
  const list = Array.isArray(configs) ? configs.filter((c) => c && c.kind !== 'youtube' && externalUrl(String(c.url || ''))) : [];
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

module.exports = { MAX_LINKS, pageLinks, tidyLinks, browserUrl, findDeckFor, sameKey };
