'use strict';
// カードの画面。基のカード型ページ（授業の教材のページ）と同じ形と操作にする。
// - 束は、カードを縦に一列に並べたもの。上下の矢印でカードを移り、Home と End で最初と最後へ。端では止まる。
// - Enter かスペースで、カードの先へ進むか、カードの中へ入る。中では上下の矢印で項目を一つずつ読み、Esc でカードへ戻る。
// - カードの上の Esc で、一つ上の束へ戻る。戻った先では、さっき進んだカードに焦点を戻す。
// - 束の中で Tab が止まるのは、いまのカード一枚だけ。Alt・Ctrl・Command と一緒のキーは横取りしない。
// - 位置は、見えない控えめな知らせの欄に「3件中2件目」とだけ入れる（見出しはカードの名前として読まれるため）。

const deckEl = document.getElementById('deck');
const statusEl = document.getElementById('status');
const alertEl = document.getElementById('alert');

// 同じ文を続けて入れても読まれるように、いったん空にしてから入れる。
function announce(message, strong = false) {
  const target = strong ? alertEl : statusEl;
  target.textContent = '';
  setTimeout(() => { target.textContent = message; }, 50);
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

// ---- 束（いまいる所）----
// 束は { name, cards, index } 。cards の一枚は { heading, items, kind, open } 。
// kind: 'goto'（先へ進む）・'read'（Enter でウェブアプリを読み、中に1件ずつの項目）・'info'（中を読むだけ）・'click'（押すカード）。
// items の一つは { label?, text } か { button, onPress } 。
const stack = [];
let busy = false;
let idSeq = 0;

function current() { return stack[stack.length - 1]; }

function pushDeck(deck) {
  stack.push({ index: 0, ...deck });
  renderDeck();
}

function popDeck() {
  if (stack.length <= 1) {
    announce('ここが一番上です。');
    return;
  }
  stack.pop();
  renderDeck();
}

function renderDeck() {
  const deck = current();
  const nodes = deck.cards.map((card, i) => renderCard(card, i));
  deckEl.replaceChildren(...nodes);
  selectCard(deck.index, { announcePosition: true });
}

function cardNodes() { return [...deckEl.querySelectorAll(':scope > article.card')]; }

function selectCard(i, { announcePosition = true } = {}) {
  const deck = current();
  const nodes = cardNodes();
  if (nodes.length === 0) return;
  const next = Math.max(0, Math.min(nodes.length - 1, i));
  nodes.forEach((n, k) => { n.tabIndex = k === next ? 0 : -1; });
  deck.index = next;
  nodes[next].focus();
  if (announcePosition) announce(`${nodes.length}件中${next + 1}件目`);
}

function renderCard(card, i) {
  const headingId = `card-h-${++idSeq}`;
  const node = el('article', {
    class: `card card-${card.kind}`,
    role: 'group',
    'aria-roledescription': 'カード',
    'aria-labelledby': headingId,
    tabindex: '-1',
  });
  node.append(el('h2', { id: headingId, text: card.heading }));
  if (card.note) node.append(el('p', { class: 'card-note', text: card.note }));
  node.append(renderItems(card.items || []));
  // マウスで押したときも、キーと同じ動きにする。
  node.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    current().index = i;
    activateCard(card, node);
  });
  card.node = node;
  return node;
}

function renderItems(items) {
  const box = el('div', { class: 'items' });
  const dl = el('dl');
  let useDl = false;
  for (const item of items) {
    if (item.button) {
      const b = el('button', { type: 'button', 'data-item': '', tabindex: '-1', class: 'item-button', text: item.button });
      b.addEventListener('click', () => item.onPress(b));
      box.append(b);
    } else if (item.label) {
      useDl = true;
      dl.append(el('dt', { 'data-item': '', tabindex: '-1', text: item.label }));
      // 内容の側は、見出しを繰り返さない。
      dl.append(el('dd', { 'data-item': '', tabindex: '-1', text: item.text }));
    } else {
      box.append(el('p', { 'data-item': '', tabindex: '-1', class: 'item-text', text: item.text }));
    }
  }
  if (useDl) box.prepend(dl);
  return box;
}

function itemNodes(cardNode) { return [...cardNode.querySelectorAll('[data-item]')]; }

function enterCard(cardNode) {
  const items = itemNodes(cardNode);
  if (items.length === 0) {
    announce('このカードの中には、読む項目がありません。');
    return;
  }
  items[0].focus();
}

// カードの上の Enter・スペース・クリック。
async function activateCard(card, node) {
  if (card.kind === 'goto') {
    card.open();
    return;
  }
  if (card.kind === 'read') {
    await readCard(card, node);
    return;
  }
  if (card.kind === 'click') {
    showClickConfirm(card, node);
    return;
  }
  enterCard(node);
}

// ---- 読む先のカード ----
async function readCard(card, node) {
  busy = true;
  node.setAttribute('aria-busy', 'true');
  announce(`${card.title}を読んでいます。`);
  let result;
  try {
    result = await window.cardsApi.runCard(card.appId, card.cardId);
  } catch (e) {
    result = { ok: false, message: e.message };
  } finally {
    busy = false;
    node.removeAttribute('aria-busy');
  }
  if (result.ok) {
    const texts = Array.isArray(result.items) ? result.items : String(result.text || '').split('\n').filter((t) => t.trim() !== '');
    card.items = texts.map((t) => ({ text: t }));
    card.heading = result.action === 'list' ? `${card.title}（${texts.length}件）` : card.title;
    if (result.truncated) card.items.push({ text: '長いので、ここまでで切りました。' });
  } else if (result.needLogin) {
    card.heading = `${card.title}（ログインが要ります）`;
    card.items = [{ text: result.message }];
  } else {
    card.heading = `${card.title}（読めません）`;
    card.items = [{ text: `画面が変わったため読めません。${result.message}` }];
  }
  const fresh = renderCard(card, current().index);
  node.replaceWith(fresh);
  selectCard(current().index, { announcePosition: false });
  if (result.ok) announce(result.action === 'list' ? `${card.items.length}件読みました。` : '読みました。');
  enterCard(fresh);
}

// ---- 押すカード（押す前に確かめる二段）----
function showClickConfirm(card, node) {
  card.items = [
    { text: `「${card.title}」を押します。` },
    {
      button: '押す',
      onPress: async () => {
        if (busy) return;
        busy = true;
        announce(`${card.title}を押しています。`);
        let r;
        try {
          r = await window.cardsApi.runCard(card.appId, card.cardId);
        } catch (e) {
          r = { ok: false, message: e.message };
        } finally {
          busy = false;
        }
        announce(r.ok ? `${card.title}を押しました。` : `押せませんでした。${r.message}`, !r.ok);
      },
    },
  ];
  const fresh = renderCard(card, current().index);
  node.replaceWith(fresh);
  selectCard(current().index, { announcePosition: false });
  enterCard(fresh);
}

// ---- 束を作る ----
const KEYS_TEXT = '上下の矢印でカードを移ります。\nEnter で、カードの先へ進むか、カードの中を読みます。\nカードの中では、上下の矢印で一つずつ読みます。\nEsc で一つ戻ります。';
const NVDA_TEXT = 'NVDA では、NVDA キーとスペースでフォーカスモードに替えると、矢印でカードを移れます。\n替えなくても、H で見出しを順に読めます。';

function appDeck(config) {
  const cards = [{
    kind: 'info',
    heading: config.name,
    items: [
      { label: '読む先', text: `${config.cards.length}件あります。` },
      { label: '動かし方', text: KEYS_TEXT },
      { label: '戻る', text: 'カードの上で Esc を押すと、どこを読みますかに戻ります。' },
    ],
  }];
  for (const c of config.cards) {
    cards.push({
      kind: c.action === 'click' ? 'click' : 'read',
      appId: config.id,
      cardId: c.id,
      title: c.title,
      heading: c.title,
      note: c.description,
      items: [],
    });
  }
  return { name: config.name, cards };
}

function topDeck(configs, problems) {
  const cards = [{
    kind: 'info',
    heading: 'どこを読みますか',
    items: [
      { label: 'アプリ', text: `${configs.length}件あります。` },
      { label: '動かし方', text: KEYS_TEXT },
      { label: 'NVDA', text: NVDA_TEXT },
    ],
  }];
  for (const config of configs) {
    cards.push({
      kind: 'goto',
      heading: config.name,
      open: () => pushDeck(appDeck(config)),
    });
  }
  if (problems.length > 0) {
    cards.push({
      kind: 'info',
      heading: `読めなかった設定ファイル（${problems.length}件）`,
      items: problems.map((p) => ({ text: p })),
    });
  }
  return { name: 'どこを読みますか', cards };
}

// ---- キー ----
document.addEventListener('keydown', (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const active = document.activeElement;
  const cardNode = active && active.closest ? active.closest('article.card') : null;
  if (!cardNode) return;
  const onCard = active === cardNode;
  const key = e.key;
  const handled = ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape'].includes(key);
  if (!handled) return;
  if (busy && key !== 'Escape') {
    e.preventDefault();
    announce('読み込み中です。少しお待ちください。');
    return;
  }
  if (onCard) {
    const deck = current();
    if (key === 'ArrowDown') selectCard(deck.index + 1);
    else if (key === 'ArrowUp') selectCard(deck.index - 1);
    else if (key === 'Home') selectCard(0);
    else if (key === 'End') selectCard(cardNodes().length - 1);
    else if (key === 'Enter' || key === ' ') activateCard(deck.cards[deck.index], cardNode);
    else if (key === 'Escape') popDeck();
    e.preventDefault();
    return;
  }
  // カードの中の項目。ボタンの上の Enter とスペースは、ボタンの働きに任せる。
  const items = itemNodes(cardNode);
  const k = items.indexOf(active);
  if (k < 0) return;
  if ((key === 'Enter' || key === ' ') && active.tagName === 'BUTTON') return;
  if (key === 'ArrowDown') items[Math.min(items.length - 1, k + 1)].focus();
  else if (key === 'ArrowUp') items[Math.max(0, k - 1)].focus();
  else if (key === 'Home') items[0].focus();
  else if (key === 'End') items[items.length - 1].focus();
  else if (key === 'Escape') cardNode.focus();
  else return;
  e.preventDefault();
});

// ---- はじめ ----
(async () => {
  let results;
  try {
    results = await window.cardsApi.loadConfigs();
  } catch (e) {
    deckEl.replaceChildren(el('p', { text: `設定ファイルを読めませんでした。${e.message}` }));
    announce(`設定ファイルを読めませんでした。${e.message}`, true);
    return;
  }
  const configs = results.filter((r) => r.config).map((r) => r.config);
  const problems = [];
  for (const r of results) {
    for (const e of r.errors || []) problems.push(`${r.file} の ${e.where}: ${e.message}`);
  }
  // アプリが一つだけなら、どこを読みますかの束を飛ばす。
  if (configs.length === 1 && problems.length === 0) pushDeck(appDeck(configs[0]));
  else pushDeck(topDeck(configs, problems));
})();
