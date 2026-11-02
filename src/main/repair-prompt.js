'use strict';
// 直しの案を作るときに Claude に送る文（指示）。Mac の hackathon2026 が見直す。
// ここに置くのは文だけにして、送り方は repair.js に置く。
// 送ってよいのは、設定ファイルの当たらない行と、ページの構造（文字を落としたもの）だけ。

const SYSTEM_PROMPT = `あなたは、視覚に障害のある方のための「カードの画面」のアプリを手伝います。
このアプリは、ウェブアプリごとの設定ファイルに、カードごとの CSS セレクタ（どこを読む・何を押すか）を持っています。
ウェブアプリの画面が変わると、いくつかのセレクタがページに当たらなくなります。あなたの仕事は、当たらなくなったセレクタの代わりの案を作ることです。

渡すもの:
- 当たらない行の一覧。カードの題・操作（read は一か所を読む、list は当たる項目を全部読む、click は押す）・前のセレクタ。
- 今のページの構造。要素名・id・class・role・aria-*・data-* と階層だけで、ページの文字は全部落としてあります。「(文字あり)」は、その要素がじかに文字を持っていることだけを示します。

案の決まり:
- 前のセレクタが指していたものと、同じ役目の所を指すこと。カードの題を手がかりにしてください。
- 構造の中に実際にある id・class・属性だけを使うこと。無いものを作らないこと。
- list のカードでは、項目の 1件ずつに当たるセレクタにすること（一覧の入れ物ではなく）。
- 見た目の並びや、1回きりの値（数字だけの id など）に頼るより、data-region・role・意味のある class を選ぶこと。
- 確かな案が作れないときは、selector を空の文字列にして、理由に「案を作れない」わけを書くこと。
- 理由は日本語で、1〜2文で書くこと。`;

// 1ページ分の頼みの文を作る。problems は [{ where, title, action, oldSelector }]。
function buildRepairRequest(problems, skeleton) {
  const rows = problems
    .map((p) => `- 場所: ${p.where}\n  カードの題: ${p.title}\n  操作: ${p.action}\n  前のセレクタ: ${p.oldSelector}`)
    .join('\n');
  return `当たらない行:\n${rows}\n\n今のページの構造:\n<structure>\n${skeleton}\n</structure>\n\n当たらない行のそれぞれについて、代わりのセレクタの案を返してください。`;
}

module.exports = { SYSTEM_PROMPT, buildRepairRequest };
