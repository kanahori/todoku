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
  // 行き先のカードは Enter で先へ進むので、中の一文（Enter で何が起きるか）を、カードを選んだときに見出しの後で読ませる。
  const described = node.querySelector('[data-describe]');
  if (described) {
    described.id = `card-d-${idSeq}`;
    node.setAttribute('aria-describedby', described.id);
  }
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
      if (item.describe) p.setAttribute('data-describe', '');
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
// カードの要素（article）はそのまま残し、見出しの文字と中の項目だけを入れ替える。
// 焦点のある要素を丸ごと作り直すと、NVDA がその要素を見失って黙ることがあった（2026-11-03 の確かめ）。
// 焦点のある要素は、DOM から外す前に焦点を移す（外してから移すと、NVDA が見失って「Todoku ドキュメント」から読み直した。
// 2026-11-03 の Windows の確かめで 11回中9回）。新しい項目を先に入れ、焦点を移してから、古い項目を外す。
// focusResult のときは、新しい項目の結果の最初（無ければ最初の項目）へ焦点を移す。
function refreshCard(card, { focusResult = false } = {}) {
  const deck = current();
  const index = deck.cards.indexOf(card);
  if (index < 0 || !card.node || !card.node.isConnected) return null;
  const node = card.node;
  node.querySelector('h2').textContent = card.heading;
  const items = card.note ? [{ text: card.note, note: true }, ...(card.items || [])] : (card.items || []);
  const focusWasInside = node.contains(document.activeElement) && document.activeElement !== node;
  const oldBox = node.querySelector('.items');
  const newBox = renderItems(items);
  oldBox.after(newBox);
  if (focusResult) {
    const target = newBox.querySelector('[data-result]') || newBox.querySelector('[data-item]');
    (target || node).focus();
  } else if (focusWasInside) {
    // 中の項目に焦点があったなら、カードへ戻しておく（消える要素に焦点を残さない）。
    node.focus();
  }
  oldBox.remove();
  return node;
}

const PROGRESS_EVERY_MS = 5000; // 進み具合を知らせる間隔（5秒に一度）
const LOADING_DELAY_MS = 500; // 読み込み中の項目を出すまで待つ時間（その前に結果が来たら出さない）

async function readCard(card) {
  busy = true;
  const started = Date.now();
  // 「（読んでいます）」の見出しと「読んでいます。」の項目は、すぐには出さず、少し待ってから出して焦点を移す。
  // 同じアプリの二枚目からはページを読み込み直さないので、結果がすぐ返る。そのとき読み込み中の項目に焦点を移すと、
  // 直後にその項目が結果に替わり、NVDA が焦点を見失った（2026-11-03 の Windows の確かめ）。待つ間に結果が来たら、
  // 読み込み中は出さずに結果へ焦点を移す。待つ間、焦点はカードの上のまま。
  const showLoading = () => {
    card.heading = `${card.title}（読んでいます）`;
    card.items = [{ text: '読んでいます。\n終わると、ここに読んだ1件ずつが出ます。', result: true, loading: true }];
    const shown = card.node && card.node.isConnected && card.node.contains(document.activeElement);
    const n = refreshCard(card, { focusResult: shown });
    if (n) n.setAttribute('aria-busy', 'true');
  };
  const loadingTimer = setTimeout(showLoading, LOADING_DELAY_MS);
  // 「〇〇を読んでいます。」の知らせは出さない。焦点が移る「読んでいます。…」の項目と、見出しの「（読んでいます）」・aria-busy で
  // 同じことを言っているため（2026-11-03 の NVDA の確かめで、3回続けて聞こえた）。5秒ごとの知らせと、終わりの知らせは残す。
  // 5秒に一度だけ、たった秒を知らせる。見える項目の文も書き換える。
  const timer = setInterval(() => {
    const sec = Math.round((Date.now() - started) / 1000);
    const item = card.node && card.node.isConnected ? card.node.querySelector('[data-loading]') : null;
    if (item) item.textContent = `読んでいます。${sec}秒たちました。\n終わると、ここに読んだ1件ずつが出ます。`;
    announce(`「${card.title}」を読み始めて、${sec}秒たちました。`);
  }, PROGRESS_EVERY_MS);
  let result;
  try {
    result = await window.cardsApi.runCard(card.appId, card.cardId);
  } catch (e) {
    result = { ok: false, message: e.message };
  } finally {
    clearTimeout(loadingTimer);
    clearInterval(timer);
    busy = false;
  }
  let count = 0;
  if (result.ok) {
    const texts = Array.isArray(result.items) ? result.items : String(result.text || '').split('\n').filter((t) => t.trim() !== '');
    count = texts.length;
    if (count === 0) {
      // 中に読む項目が無いカード。上下矢印キーの対象から外すと、いま選んでいるカードが消えるので外さず、見出しの件数と中の一文の両方で言う。
      card.items = [{ text: 'このカードの中には、読む項目がありません。', result: true }];
      card.heading = `${card.title}（0件）`;
    } else if (result.action === 'list') {
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
  if (card.node) card.node.removeAttribute('aria-busy');
  // 焦点を移す先（結果の最初の項目）を先に作って焦点を移し、それから読み込み中の項目を外す（refreshCard の中）。
  const node = refreshCard(card, { focusResult: wasInside });
  if (!node) return;
  if (result.ok && result.action === 'list') announce(count === 0 ? `「${card.title}」は0件でした。` : `「${card.title}」から${count}件読みました。`);
  else if (result.ok) announce(`「${card.title}」を読みました。`);
  else if (result.needLogin) announce(`「${card.title}」は、ログインが要ります。`);
  else announce(`「${card.title}」を読めませんでした。`);
}

// 読めなかったときの文。理由ごとに分け、黙らない。
function unreadableText(card, result) {
  const message = String(result.message || '');
  if (message.startsWith('ページを開けませんでした')) return 'ページを開けませんでした。\nネットワークを確かめてください。';
  if (message.includes('書き方')) return '設定ファイルの書き方に誤りがあります。\n支援者に知らせてください。';
  // 入れ物（container）のあるカードは、0件なら「（0件）」と出るので、ここに来るのは本当に見つからないときだけ。
  if (card.action === 'list' && !card.hasContainer) return '画面が変わったため、読む所が見つかりませんでした。\n本当に0件のこともあります。';
  return '画面が変わったため、読む所が見つかりませんでした。';
}

// ---- 押すカード（押す前に確かめる二段）----
function showClickConfirm(card, node) {
  card.items = [
    { text: `「${card.title}」を押します。`, result: true },
    {
      button: `「${card.title}」を押す`,
      onPress: async (button) => {
        if (busy) return;
        busy = true;
        button.textContent = `「${card.title}」を押す（押しています）`;
        announce(`「${card.title}」を押しています。`);
        let r;
        try {
          r = await window.cardsApi.runCard(card.appId, card.cardId);
        } catch (e) {
          r = { ok: false, message: e.message };
        } finally {
          busy = false;
          button.textContent = `「${card.title}」を押す`;
        }
        // 押した結果ダウンロードが始まったときは、保存したか（できなかったか）を知らせる。
        if (r.ok && r.download) announce(r.download.message, !r.download.ok);
        else announce(r.ok ? `「${card.title}」を押しました。` : `「${card.title}」を押せませんでした。${r.message}`, !r.ok);
      },
    },
  ];
  const fresh = refreshCard(card);
  if (fresh) enterCard(fresh, true);
}

// ---- 束を作る ----
// はじめのカードは、見出しを名前にし、中の最初の項目で何ができるかを一文で言う（件数も同じ文に）。
// キーの説明は基の書き方（キーには「キー」を付け、カードは「選ぶ」、中は「カード内へ移動する」）で、一文を一つの項目にする。
// Enter の二つの意味（先へ進む／カード内へ移動する）は、はじめのカードで分けて言い、行き先のカードでは中の一文でも言う。
const APP_NAME = 'Todoku';
const NVDA_TEXTS = [
  'NVDAでは、NVDAキーとスペースキーでフォーカスモードに替えると、上下矢印キーでカードを選べます。',
  '替えなくても、Hキーで見出しを順に読めます。',
];

function sentences(texts) { return texts.map((text) => ({ text })); }

// 説明の文の終わりに「。」が無ければ足す（一文として読まれるように）。
function endSentence(text) {
  const t = String(text).trim();
  return /[。．.！？!?]$/.test(t) ? t : `${t}。`;
}

// hasParent: 上に「Todoku」の束があるか（アプリが一つだけのときは無い）。
function appDeck(config, hasParent = true) {
  const reads = config.cards.filter((c) => c.action !== 'click').length;
  const clicks = config.cards.length - reads;
  const counts = [reads > 0 ? `読む所${reads}件` : '', clicks > 0 ? `押す所${clicks}件` : ''].filter(Boolean).join('・');
  const texts = [
    `「${config.name}」の画面を、カードで読めます（${counts || 'カード0件'}）。`,
    '上下矢印キーでカードを選びます。',
    'スペースキーまたはEnterキーで、カード内へ移動します。',
    '読む所のカードでは、カード内へ移動するときに、ウェブアプリのその所を読みます。',
    '読む所のカードの上で、もう一度スペースキーまたはEnterキーを押すと、読み直します。',
    '押す所のカードでは、カード内のボタンで押します。',
    'カード内では、上下矢印キーで項目を一つずつ選びます。',
    'Escキーで、カードの中からカードへ戻ります。',
  ];
  if (hasParent) texts.push(`カードの上でEscキーを押すと、「${APP_NAME}」に戻ります。`);
  if (clicks === 0) texts.splice(texts.indexOf('押す所のカードでは、カード内のボタンで押します。'), 1);
  // 設定ファイルの頭の description（アプリの説明・出典など）は、はじめのカードの最後の項目にする。
  if (typeof config.description === 'string' && config.description.trim() !== '') texts.push(endSentence(config.description));
  const items = sentences(texts);
  // 出典のページ（sourceUrl）があれば、URL は読ませずに、開くボタンを最後の項目にする（既定のブラウザで開く）。
  if (typeof config.sourceUrl === 'string' && config.sourceUrl !== '') {
    items.push({
      button: '出典のページを開く',
      onPress: async () => {
        let r;
        try {
          r = await window.cardsApi.openSource(config.id);
        } catch (e) {
          r = { ok: false, message: '出典のページを開けませんでした。' };
        }
        announce(r.message, !r.ok);
      },
    });
  }
  const cards = [{ kind: 'info', heading: config.name, items }];
  for (const c of config.cards) {
    cards.push({
      kind: c.action === 'click' ? 'click' : 'read',
      action: c.action,
      appId: config.id,
      cardId: c.id,
      title: c.title,
      heading: c.title,
      hasContainer: Boolean(c.container),
      note: c.description ? endSentence(c.description) : undefined,
      items: [],
    });
  }
  return { name: config.name, cards };
}

function topDeck(configs, problems) {
  const cards = [{
    kind: 'info',
    heading: APP_NAME,
    items: sentences([
      `ウェブアプリの画面を、カードで読めます（アプリ${configs.length}件）。`,
      '上下矢印キーでカードを選びます。',
      'スペースキーまたはEnterキーで、カード内へ移動します。',
      'ただし、アプリの名前のカードでは、スペースキーまたはEnterキーで、そのアプリのカードへ進みます。',
      'カード内では、上下矢印キーで項目を一つずつ選びます。',
      'Escキーで、カードの中からカードへ戻ります。',
      ...NVDA_TEXTS,
    ]),
  }];
  for (const config of configs) {
    cards.push({
      kind: 'goto',
      heading: config.name,
      items: [{ text: `スペースキーまたはEnterキーで、「${config.name}」のカードへ進みます。`, describe: true }],
      open: () => pushDeck(appDeck(config, true)),
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

// ---- ダウンロードの知らせ ----
// 押すカードの結果にならなかったダウンロード（押してから遅れて始まったもの）が終わったときに知らせる。
if (window.cardsApi.onDownloadDone) window.cardsApi.onDownloadDone((r) => announce(r.message, !r.ok));

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
  // アプリが一つだけなら、「Todoku」の束を飛ばす。
  if (configs.length === 1 && problems.length === 0) pushDeck(appDeck(configs[0], false));
  else pushDeck(topDeck(configs, problems));
})();
