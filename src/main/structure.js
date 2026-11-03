'use strict';
// ページの「構造だけ」を集める所。直しの案を作るとき、Claude に渡してよいのはこの結果だけ。
// 残すもの: 要素名・id・class・role・aria-*（値が文字になるものは、あるかどうかだけ）・data-*（短い値だけ）・階層。
// 落とすもの: 文字・href・src・value・title・alt・placeholder などの中身。

// ページの中で動く関数。外の変数は使えないので、引数だけで動くようにする。
function pageSkeleton(maxNodes, maxDepth) {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'PATH', 'IFRAME', 'LINK', 'META']);
  // 値が文字（人が読む中身）になる属性は、あるかどうかだけを残す。
  const TEXT_ATTRS = new Set(['aria-label', 'aria-description', 'aria-valuetext', 'aria-placeholder', 'aria-roledescription']);
  // 英数字の名前でも、人や物を指す値になりうるもの（5桁以上の数字を含む・GUID の形・数字を含む12字以上の英数字）は入れない
  // （学籍番号の形・ログイン名・発行された番号など。見直しの8。smoke で、これらと role の値の文が構造に入ることを確かめた）。
  const personal = (v) => /\d{5,}/.test(v) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v) || (v.length >= 12 && /\d/.test(v) && /[A-Za-z]/.test(v));
  const safeToken = (v) => /^[A-Za-z0-9_:\-]{1,40}$/.test(v) && !personal(v);
  const lines = [];
  let count = 0;
  let truncated = false;

  const describe = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id && safeToken(el.id)) s += `#${el.id}`;
    for (const c of el.classList) if (safeToken(c)) s += `.${c}`;
    const attrs = [];
    for (const a of el.attributes) {
      const n = a.name;
      if (n === 'role') attrs.push(safeToken(a.value) ? `role=${a.value}` : 'role');
      else if (TEXT_ATTRS.has(n)) attrs.push(n);
      else if (n.startsWith('aria-')) attrs.push(safeToken(a.value) ? `${n}=${a.value}` : n);
      else if (n.startsWith('data-')) attrs.push(safeToken(a.value) ? `${n}=${a.value}` : n);
      else if (n === 'type' || n === 'name') attrs.push(safeToken(a.value) ? `${n}=${a.value}` : n);
      else if (n === 'hidden') attrs.push('hidden');
    }
    if (attrs.length) s += `[${attrs.join('][')}]`;
    // 文字があるかどうかだけを印にする（文字そのものは入れない）。
    const ownText = [...el.childNodes].some((nd) => nd.nodeType === 3 && nd.textContent.trim() !== '');
    if (ownText) s += ' (has text)';
    return s;
  };

  const walk = (el, depth) => {
    if (count >= maxNodes) { truncated = true; return; }
    if (SKIP.has(el.tagName.toUpperCase())) return;
    if (depth > maxDepth) { truncated = true; return; }
    count += 1;
    lines.push('  '.repeat(depth) + describe(el));
    for (const child of el.children) walk(child, depth + 1);
  };
  walk(document.body, 0);
  return { skeleton: lines.join('\n'), nodes: count, truncated };
}

function buildSkeletonScript(maxNodes = 2500, maxDepth = 30) {
  return `(${pageSkeleton.toString()})(${maxNodes}, ${maxDepth})`;
}

// 送る文に文字が混ざっていないかを確かめる（試しと、送る前の確かめに使う）。
// 日本語の文字（ひらがな・カタカナ・漢字・全角の文字・和文の句読点）が一つでもあれば、混ざっていると見なす。
// 文字がある印は「 (has text)」（ASCII）にしてある。
function looksTextFree(text) {
  return !/[぀-ヿ㐀-鿿　-〿＀-￯]/.test(String(text));
}

// Claude に送る selector の中の、ASCII でない文字（属性の値に書いたページの文字など）を「…」に伏せる。
// 気象庁の地点のカードは div[title^="地点名：東京\a "] のように、ページの文字を selector に持っている。
function maskSelector(selector) {
  return String(selector || '').replace(/[^\x00-\x7F]+/g, '…');
}

// selector や id に使ってよい、文字でない名前（ページの作り手が付けた英数字の名前）か。
const SAFE_TOKEN = /^[A-Za-z0-9_:\-]{1,40}$/;

module.exports = { pageSkeleton, buildSkeletonScript, looksTextFree, maskSelector, SAFE_TOKEN };
