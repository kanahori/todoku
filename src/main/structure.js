'use strict';
// ページの「構造だけ」を集める所。直しの案を作るとき、Claude に渡してよいのはこの結果だけ。
// 残すもの: 要素名・id・class・role・aria-*（値が文字になるものは、あるかどうかだけ）・data-*（短い値だけ）・階層。
// 落とすもの: 文字・href・src・value・title・alt・placeholder などの中身。

// ページの中で動く関数。外の変数は使えないので、引数だけで動くようにする。
function pageSkeleton(maxNodes, maxDepth) {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'PATH', 'IFRAME', 'LINK', 'META']);
  // 値が文字（人が読む中身）になる属性は、あるかどうかだけを残す。
  const TEXT_ATTRS = new Set(['aria-label', 'aria-description', 'aria-valuetext', 'aria-placeholder', 'aria-roledescription']);
  const safeToken = (v) => /^[A-Za-z0-9_:\-]{1,40}$/.test(v);
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
      if (n === 'role') attrs.push(`role=${a.value}`);
      else if (TEXT_ATTRS.has(n)) attrs.push(n);
      else if (n.startsWith('aria-')) attrs.push(safeToken(a.value) ? `${n}=${a.value}` : n);
      else if (n.startsWith('data-')) attrs.push(safeToken(a.value) ? `${n}=${a.value}` : n);
      else if (n === 'type' || n === 'name') attrs.push(safeToken(a.value) ? `${n}=${a.value}` : n);
      else if (n === 'hidden') attrs.push('hidden');
    }
    if (attrs.length) s += `[${attrs.join('][')}]`;
    // 文字があるかどうかだけを印にする（文字そのものは入れない）。
    const ownText = [...el.childNodes].some((nd) => nd.nodeType === 3 && nd.textContent.trim() !== '');
    if (ownText) s += ' (文字あり)';
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

// 骨組みに文字が混ざっていないかを確かめる（試しと、送る前の確かめに使う）。
// 日本語の文字（ひらがな・カタカナ・漢字）が「(文字あり)」の印のほかに出てきたら、混ざっていると見なす。
function looksTextFree(skeleton) {
  const withoutMarks = skeleton.replace(/ \(文字あり\)/g, '');
  return !/[぀-ヿ㐀-鿿]/.test(withoutMarks);
}

module.exports = { pageSkeleton, buildSkeletonScript, looksTextFree };
