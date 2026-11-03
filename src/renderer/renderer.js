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
  // 説明（設定ファイルの description）は、見出しの次の項目にして、矢印で選べるようにする（カードの外に情報を作らない）。
  const items = card.note ? [{ text: card.note, note: true }, ...(card.items || [])] : (card.items || []);
  node.append(renderItems(items));
  // マウスで押したときも、キーと同じ動きにする。
  node.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    current().index = i;
    activateCard(card, node);
  });
  card.node = node;
  return node;
}

// 項目の種類: { label, text }（見出しと内容の組・dl）・{ listItem }（読んだ1件・ul の li。NVDA が「2の4」と位置を読む）・
// { text }（一文・p）・{ button, onPress }（ボタン）。並びの順のまま、続く同じ種類を一つの dl・ul にまとめる。
function renderItems(items) {
  const box = el('div', { class: 'items' });
  let group = null;
  let groupKind = null;
  for (const item of items) {
    const kind = item.button ? 'button' : item.label ? 'dl' : item.listItem !== undefined ? 'ul' : 'p';
    if (kind === 'dl' || kind === 'ul') {
      if (groupKind !== kind) {
        group = el(kind);
        groupKind = kind;
        box.append(group);
      }
    } else {
      group = null;
      groupKind = null;
    }
    if (kind === 'button') {
      const b = el('button', { type: 'button', 'data-item': '', tabindex: '-1', class: 'item-button', text: item.button });
      b.addEventListener('click', () => item.onPress(b));
      if (item.result) b.setAttribute('data-result', '');
      box.append(b);
    } else if (kind === 'dl') {
      group.append(el('dt', { 'data-item': '', tabindex: '-1', text: item.label }));
      // 内容の側は、見出しを繰り返さない。
      group.append(el('dd', { 'data-item': '', tabindex: '-1', text: item.text }));
    } else if (kind === 'ul') {
      group.append(el('li', { 'data-item': '', 'data-result': '', tabindex: '-1', text: item.listItem }));
    } else {
      const p = el('p', { 'data-item': '', tabindex: '-1', class: item.note ? 'item-text card-note' : 'item-text', text: item.text });
      if (item.result) p.setAttribute('data-result', '');
      if (item.loading) p.setAttribute('data-loading', '');
      box.append(p);
    }
  }
  return box;
}

function itemNodes(cardNode) { return [...cardNode.querySelectorAll('[data-item]')]; }

// カード内へ移動する。toResult のときは、説明の項目を飛ばして、読んだ結果（か、読み込み中・読めない知らせ）の最初へ。
function enterCard(cardNode, toResult = false) {
  const items = itemNodes(cardNode);
  if (items.length === 0) {
    announce('このカードの中には、読む項目がありません。');
    return;
  }
  const first = toResult ? cardNode.querySelector('[data-result]') : null;
  (first || items[0]).focus();
}

// カードの上の Enter・スペース・クリック。
async function activateCard(card, node) {
  if (card.kind === 'goto') {
    card.open();
    return;
  }
  if (card.kind === 'read') {
    await readCard(card);
    return;
  }
  if (card.kind === 'click') {
    showClickConfirm(card, node);
    return;
  }
  enterCard(node);
}

// ---- 読む先のカード ----
// カードを描き直す。いまの束にそのカードがあるときだけ、置き換えて選んだままにする。
// 描き直したカードの要素を返す（別の束へ移っていたら null）。
function refreshCard(card) {
  const deck = current();
  const index = deck.cards.indexOf(card);
  if (index < 0 || !card.node || !card.node.isConnected) return null;
  const old = card.node;
  const hadFocus = old.contains(document.activeElement);
  const fresh = renderCard(card, index);
  old.replaceWith(fresh);
  if (hadFocus || deck.index === index) {
    cardNodes().forEach((n, k) => { n.tabIndex = k === deck.index ? 0 : -1; });
  }
  return fresh;
}

const PROGRESS_EVERY_MS = 5000; // 進み具合を知らせる間隔（5秒に一度）

async function readCard(card) {
  busy = true;
  const started = Date.now();
  card.heading = `${card.title}（読んでいます）`;
  card.items = [{ text: '読んでいます。\n終わると、ここに読んだ1件ずつが出ます。', result: true, loading: true }];
  let node = refreshCard(card);
  if (node) {
    node.setAttribute('aria-busy', 'true');
    enterCard(node, true);
  }
  announce(`「${card.title}」を読んでいます。`);
  // 5秒に一度だけ、たった秒を知らせる。見える項目の文も書き換える。
  const timer = setInterval(() => {
    const sec = Math.round((Date.now() - started) / 1000);
    const item = card.node && card.node.isConnected ? card.node.querySelector('[data-loading]') : null;
    if (item) item.textContent = `読んでいます。${sec}秒たちました。\n終わると、ここに読んだ1件ずつが出ます。`;
    announce(`${sec}秒たちました。`);
  }, PROGRESS_EVERY_MS);
  let result;
  try {
    result = await window.cardsApi.runCard(card.appId, card.cardId);
  } catch (e) {
    result = { ok: false, message: e.message };
  } finally {
    clearInterval(timer);
    busy = false;
  }
  let count = 0;
  if (result.ok) {
    const texts = Array.isArray(result.items) ? result.items : String(result.text || '').split('\n').filter((t) => t.trim() !== '');
    count = texts.length;
    if (result.action === 'list') {
      // 読んだ1件ずつを ul の li にする（NVDA が「2の4」と位置を読む）。
      card.items = texts.map((t) => ({ listItem: t }));
      card.heading = `${card.title}（${count}件）`;
    } else {
      card.items = texts.map((t) => ({ text: t, result: true }));
      card.heading = card.title;
    }
    if (result.truncated) card.items.push({ text: '長いので、ここまでで切りました。' });
  } else if (result.needLogin) {
    card.heading = `${card.title}（ログインが要ります）`;
    card.items = [
      {
        button: 'ログインの窓を前に出す',
        result: true,
        onPress: async () => {
          const r = await window.cardsApi.showTarget(card.appId);
          if (!r.ok) announce(r.message, true);
        },
      },
      { text: 'ログインが済んだら、Enterキーでもう一度読みます。' },
    ];
  } else {
    card.heading = `${card.title}（読めません）`;
    card.items = [{ text: unreadableText(card, result), result: true }];
  }
  // 読み込み中に Esc で別の所へ移っていたら、結果はカードに入れておくだけにする。
  const wasInside = card.node && card.node.isConnected && card.node.contains(document.activeElement);
  node = refreshCard(card);
  if (!node) return;
  if (result.ok) announce(result.action === 'list' ? `「${card.title}」から${count}件読みました。` : `「${card.title}」を読みました。`);
  if (wasInside) enterCard(node, true);
}

// 読めなかったときの文。理由ごとに分け、黙らない。
function unreadableText(card, result) {
  const message = String(result.message || '');
  if (message.startsWith('ページを開けませんでした')) return 'ページを開けませんでした。\nネットワークを確かめてください。';
  if (message.includes('書き方')) return '設定ファイルの書き方に誤りがあります。\n支援者に知らせてください。';
  if (card.action === 'list') return '画面が変わったため、読む所が見つかりませんでした。\n本当に0件のこともあります。';
  return '画面が変わったため、読む所が見つかりませんでした。';
}

// ---- 押すカード（押す前に確かめる二段）----
function showClickConfirm(card, node) {
  card.items = [
    { text: `「${card.title}」を押します。`, result: true },
    {
      button: `「${card.title}」を押す`,
      onPress: async () => {
        if (busy) return;
        busy = true;
        announce(`「${card.title}」を押しています。`);
        let r;
        try {
          r = await window.cardsApi.runCard(card.appId, card.cardId);
        } catch (e) {
          r = { ok: false, message: e.message };
        } finally {
          busy = false;
        }
        announce(r.ok ? `「${card.title}」を押しました。` : `「${card.title}」を押せませんでした。${r.message}`, !r.ok);
      },
    },
  ];
  const fresh = refreshCard(card);
  if (fresh) enterCard(fresh, true);
}

// ---- 束を作る ----
// はじめのカードのキーの説明。基の書き方（キーには「キー」を付け、カードは「選ぶ」、中は「カード内へ移動する」・一文ごとに改行）。
// Enter の意味は束ごとに違うので、それぞれの束のはじめのカードで言う。
const APP_NAME = 'Todoku';
const NVDA_TEXT = 'NVDA キーとスペースキーでフォーカスモードに替えると、上下矢印キーでカードを選べます。\n替えなくても、H キーで見出しを順に読めます。';

function appDeck(config) {
  const cards = [{
    kind: 'info',
    heading: config.name,
    items: [
      { text: `「${config.name}」を、カードで読めます（読む先 ${config.cards.length}件）。` },
      { label: '上下矢印キー', text: 'カードを選びます。' },
      { label: 'スペースキーまたはEnterキー', text: 'そのカードの所を読みに行き、カード内へ移動します。\nもう一度押すと、読み直します。' },
      { label: 'カードの中の上下矢印キー', text: '読んだものを1件ずつ読みます。' },
      { label: 'Escキー', text: 'カードの中からカードへ戻ります。\nカードの上で押すと、「' + APP_NAME + '」に戻ります。' },
    ],
  }];
  for (const c of config.cards) {
    cards.push({
      kind: c.action === 'click' ? 'click' : 'read',
      action: c.action,
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
    heading: APP_NAME,
    items: [
      { text: `ウェブアプリの画面を、カードで読めます（アプリ ${configs.length}件）。` },
      { label: '上下矢印キー', text: 'アプリのカードを選びます。' },
      { label: 'スペースキーまたはEnterキー', text: 'そのアプリを開きます。\nはじめのカードでは、カード内へ移動します。' },
      { label: 'Escキー', text: 'カードの中からカードへ戻ります。' },
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
  return { name: APP_NAME, cards };
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
