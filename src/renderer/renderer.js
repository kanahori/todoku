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
// 支援者の確認（設定ファイルの確認）の最中か。その間は、キーやクリックで「読み込み中です。」を出さない
// （1〜2秒おきに出て、「確認しています。」と重なって聞こえた。Windows の NVDA の確かめ）。進み具合は5秒ごとの知らせで伝える。
let reviewing = false;
let idSeq = 0;

function current() { return stack[stack.length - 1]; }

// ---- 自動で直した所（手元にだけ効く上書き）----
// アプリごとに、カードの id → 直し（{ cardId, title, action, before, after, reason, at }）。
const repairsByApp = new Map();
// いま自動で直しているカード（"アプリの id/カードの id"）。主の処理の知らせ（card:repairing）で入る。
const repairingNow = new Set();

function repairsOf(appId) {
  if (!repairsByApp.has(appId)) repairsByApp.set(appId, new Map());
  return repairsByApp.get(appId);
}

// 読む所か押す所か（知らせの言い回しで使う）。
function placeWord(action) { return action === 'click' ? '押す場所' : '読む場所'; }

// 直したカードの中に足す項目: 直したことの一文と「直す前に戻す」ボタン。
function repairItems(card) {
  const r = repairsOf(card.appId).get(card.cardId);
  if (!r) return [];
  return [
    { text: `このカードの${placeWord(card.action)}は、ページが変わったときに自動で直したものです。`, repairItem: true },
    { button: '直す前に戻す', repairItem: true, onPress: () => undoRepair(card) },
  ];
}

async function undoRepair(card) {
  let r;
  try {
    r = await window.cardsApi.undoRepair(card.appId, card.cardId);
  } catch (e) {
    r = { ok: false, message: '直す前に戻せませんでした。' };
  }
  if (!r.ok) {
    announce(r.message, true);
    return;
  }
  repairsOf(card.appId).delete(card.cardId);
  card.items = (card.items || []).filter((it) => !it.repairItem);
  // 押したボタンは消えるので、焦点はカードの中の最初の項目に置く（カードの上に戻すと、続けて Esc を押したとき束から出てしまう）。
  refreshCard(card, { focusFirst: true });
  announce(`「${card.title}」の${placeWord(card.action)}を、直す前に戻しました。`);
}

// announcePosition が false のときは、位置（「3件中1件目」）を知らせない（すぐ後に別の知らせを出すとき）。
function pushDeck(deck, { announcePosition = true } = {}) {
  stack.push({ index: 0, ...deck });
  renderDeck({ announcePosition });
}

function popDeck() {
  if (stack.length <= 1) {
    announce('ここが一番上です。');
    return;
  }
  stack.pop();
  // 一覧の一件から先へ進んでいたときは、戻った先で、その一件に焦点を戻す（openItemTarget）。
  const back = current().returnItem;
  delete current().returnItem;
  renderDeck({ announcePosition: back === undefined });
  if (back !== undefined) {
    const node = cardNodes()[current().index];
    const lis = node ? [...node.querySelectorAll('li[data-item]')] : [];
    if (lis[back]) lis[back].focus();
  }
}

// 新しい束のカードを先に入れて焦点を移し、それから古いカードを外す（焦点のある要素を先に DOM から外さない）。
// 外してから焦点を移すと、カードの中の項目では NVDA が焦点を見失った（refreshCard の註）。束を移るときも同じ並びだった（見直しの5。
// smoke で、Enter で先へ・Esc で戻るの二回とも、焦点のあるカードを先に外していたことを確かめた）。
function renderDeck({ announcePosition = true } = {}) {
  const deck = current();
  // 束に入ったら、窓の題を「Todoku - 束の題」にする（h1 は変えない）。一番上の束に戻ったら「Todoku」に戻す。
  // Mac のアクセシビリティの木で、束に入っても窓の題が「Todoku」のままで、いまどの束にいるかが焦点のカードの名前でしか分からなかった。
  document.title = stack.length > 1 && deck.name ? `${APP_NAME} - ${deck.name}` : APP_NAME;
  const nodes = deck.cards.map((card) => renderCard(card));
  const old = [...deckEl.children];
  for (const n of old) n.setAttribute('data-leaving', '');
  deckEl.append(...nodes);
  selectCard(deck.index, { announcePosition });
  for (const n of old) n.remove();
}

function cardNodes() { return [...deckEl.querySelectorAll(':scope > article.card:not([data-leaving])')]; }

function selectCard(i, { announcePosition = true } = {}) {
  const deck = current();
  const nodes = cardNodes();
  if (nodes.length === 0) return;
  const next = Math.max(0, Math.min(nodes.length - 1, i));
  nodes.forEach((n, k) => { n.tabIndex = k === next ? 0 : -1; });
  deck.index = next;
  nodes[next].focus();
  if (announcePosition) announce(`${nodes.length}枚中${next + 1}枚目`);
}

function renderCard(card) {
  // 表示設定のカードは、描くたびに今の設定から項目を作る。
  if (card.kind === 'settings') card.items = settingsItems(card);
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
    // 探した結果のカードが足し引きされるので、添字はその時の並びから取る。
    current().index = Math.max(0, current().cards.indexOf(card));
    activateCard(card, node);
  });
  card.node = node;
  return node;
}

// 項目の種類: { label, text }（見出しと内容の組・dl）・{ listItem }（読んだ1件・ul の li。NVDA が「2の4」と位置を読む）・
// { text }（一文・p）・{ button, onPress }（ボタン）・{ input, onInput, onEnter, value, type }（ラベル付きの入力欄。Enter で onEnter）。並びの順のまま、続く同じ種類を一つの dl・ul にまとめる。
// ボタンの pressed（aria-pressed）・expanded（aria-expanded）・setting（表示設定のどれか）、p の searchCount（探した数の一文）。
// fold は表示設定の中の畳む項目で、hidden のときは隠し、上下矢印キーの対象からも外す。
function renderItems(items) {
  const box = el('div', { class: 'items' });
  let group = null;
  let groupKind = null;
  for (const item of items) {
    const kind = item.embed ? 'embed' : item.button ? 'button' : item.input ? 'input' : item.label ? 'dl' : item.listItem !== undefined ? 'ul' : 'p';
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
    if (kind === 'embed') {
      // YouTube の埋め込みプレーヤー。カードの項目の上に置き、ほかの要素を重ねない。焦点の行き先（data-item）にはしない
      // （iframe の中に焦点が落ちると、読み上げで迷子になるため。tabindex=-1 で Tab でも入らない）。
      const wrap = el('div', { class: 'yt-frame' });
      const f = el('iframe', { src: item.embed, title: item.embedTitle || 'YouTube の動画プレーヤー', width: '640', height: '360', tabindex: '-1',
        allow: 'autoplay; encrypted-media; picture-in-picture', referrerpolicy: 'strict-origin-when-cross-origin' });
      if (item.onLoad) f.addEventListener('load', () => item.onLoad(f));
      wrap.append(f);
      box.append(wrap);
      group = null;
      groupKind = null;
      continue;
    }
    if (kind === 'button') {
      const b = el('button', { type: 'button', 'data-item': '', tabindex: '-1', class: 'item-button', text: item.button });
      if (item.yt) b.setAttribute('data-yt', item.yt);
      b.addEventListener('click', () => item.onPress(b));
      if (item.result) b.setAttribute('data-result', '');
      if (item.pressed !== undefined) b.setAttribute('aria-pressed', String(Boolean(item.pressed)));
      if (item.expanded !== undefined) b.setAttribute('aria-expanded', String(Boolean(item.expanded)));
      if (item.setting) b.setAttribute('data-setting', item.setting);
      if (item.fold) b.setAttribute('data-fold', '');
      if (item.hidden) b.hidden = true;
      box.append(b);
    } else if (kind === 'input') {
      // 見えるラベルを label 要素で入力欄に結び付ける（読み上げは「ページのURL…、編集」のように読む）。
      const inputId = `card-input-${++idSeq}`;
      const wrap = el('div', { class: 'item-input' });
      wrap.append(el('label', { for: inputId, text: item.input }));
      const input = el('input', { id: inputId, type: item.type || 'url', 'data-item': '', 'data-input': '', tabindex: '-1', autocomplete: 'off', spellcheck: 'false' });
      if (item.value) input.value = item.value;
      // 日本語の変換の途中は渡さず、確定したときに渡す。
      if (item.onInput) {
        input.addEventListener('input', (e) => { if (!e.isComposing) item.onInput(input.value); });
        input.addEventListener('compositionend', () => item.onInput(input.value));
      }
      if (item.onEnter) {
        // 変換を確定する Enter は渡さない（isComposing が立たず keyCode 229 だけが来る場合もある）。
        input.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' || e.altKey || e.ctrlKey || e.metaKey || e.isComposing || e.keyCode === 229) return;
          e.preventDefault();
          // 文書全体のキーの処理には渡さない（焦点を移した先で、同じ Enter がもう一度働かないように）。
          e.stopPropagation();
          fieldEnterAt = Date.now();
          item.onEnter(input.value);
        });
        // 同じ Enter の keypress・keyup も、欄の中で止める。
        for (const type of ['keypress', 'keyup']) {
          input.addEventListener(type, (e) => { if (e.key === 'Enter') e.stopPropagation(); });
        }
      }
      wrap.append(input);
      box.append(wrap);
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
      if (item.searchCount) p.setAttribute('data-search-count', '');
      if (item.fold) p.setAttribute('data-fold', '');
      if (item.hidden) p.hidden = true;
      box.append(p);
    }
  }
  return box;
}

// 隠した項目（畳んだ表示設定）は、上下矢印キーの対象から外す。
function itemNodes(cardNode) { return [...cardNode.querySelectorAll('[data-item]')].filter((n) => !n.closest('[hidden]')); }

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
// 一覧の i 件目（0 から）に結び付いた所を読み、一枚のカードの束にして開く。Esc で一覧のその一件に戻る。
async function openItemTarget(card, i) {
  if (busy || i < 0) return;
  busy = true;
  let r;
  try {
    r = await window.cardsApi.readItemTarget(card.appId, card.cardId, i, card.itemKeys ? card.itemKeys[i] : null);
  } catch (e) {
    r = { ok: false, message: 'うまく動きませんでした。' };
  } finally {
    busy = false;
  }
  const name = `${i + 1}件目の${card.itemTarget.label}`;
  if (!r.ok) {
    if (r.changed) announce(`「${card.title}」を読んだ後に、ページが変わりました。もう一度「${card.title}」を読んでください。`, true);
    else announce(r.notFound ? `「${card.title}」の${name}が見つかりませんでした。` : `「${card.title}」の${name}を読めませんでした。${r.message}`, true);
    return;
  }
  const texts = String(r.text || '').split('\n').filter((t) => t.trim() !== '');
  const items = texts.length > 0 ? texts.map((t) => ({ text: t, result: true })) : [{ text: 'このカードの中には、読む項目がありません。', result: true }];
  if (r.truncated) items.push({ text: '長いので、ここまでで切りました。' });
  if (r.partial) items.push({ text: 'まだ書いている途中でした。ここまでを読みました。もう一度読むと、続きが読めます。' });
  current().returnItem = i;
  pushDeck({ name: `${card.title}（${name}）`, appId: card.appId, cards: [{ kind: 'info', heading: name, items }] }, { announcePosition: false });
  const first = itemNodes(cardNodes()[0])[0];
  if (first) first.focus();
  announce(`「${card.title}」の${name}を読みました。${r.partial ? 'まだ書いている途中です。' : ''}`);
}

async function activateCard(card, node) {
  // 読んでいる最中は、ほかのカードを動かさない。キーの守り（keydown）はあったが、クリックと、読み上げソフトが click として
  // 送る操作（NVDA の閲覧モードの Enter・VoiceOver の VO+Space）には無く、二枚を同時に読めた（見直しの4。smoke で確かめた）。
  if (busy) {
    if (!reviewing) announce('読み込み中です。少しお待ちください。');
    return;
  }
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
  if (card.kind === 'maint') {
    await openMaint(card);
    return;
  }
  if (card.kind === 'review') {
    await openReview(card);
    return;
  }
  if (card.kind === 'yt-search') {
    const input = node.querySelector('[data-input]');
    if (input) input.focus();
    else enterCard(node);
    return;
  }
  if (card.kind === 'yt-channel') {
    await ytLoad(card);
    return;
  }
  if (card.kind === 'create') {
    // 入力欄へ移る（入れる所がすぐ分かるように）。
    const input = node.querySelector('[data-input]');
    if (input) input.focus();
    else enterCard(node);
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
// focusFirst のときは、焦点がこのカードにあれば、新しい項目の最初へ焦点を移す（押したボタンが消えるときにカードの中に留める）。
function refreshCard(card, { focusResult = false, focusFirst = false } = {}) {
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
  } else if (focusFirst && node.contains(document.activeElement)) {
    // 焦点がこのカード（か、その中）にあるときだけ、中の最初の項目へ移す。待つ間に別の所へ移っていたら動かさない。
    (newBox.querySelector('[data-item]') || node).focus();
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
    card.items = [{ text: '読んでいます。\n読み終わると、ここに1件ずつ出ます。', result: true, loading: true }];
    const shown = card.node && card.node.isConnected && card.node.contains(document.activeElement);
    const n = refreshCard(card, { focusResult: shown });
    if (n) n.setAttribute('aria-busy', 'true');
  };
  const loadingTimer = setTimeout(showLoading, LOADING_DELAY_MS);
  // 「〇〇を読んでいます。」の知らせは出さない。焦点が移る「読んでいます。…」の項目と、見出しの「（読んでいます）」・aria-busy で
  // 同じことを言っているため（2026-11-03 の NVDA の確かめで、3回続けて聞こえた）。5秒ごとの知らせと、終わりの知らせは残す。
  // 5秒に一度だけ、たった秒を知らせる。見える項目の文も書き換える。
  // 画面が変わって自動で直している間は、同じ形で「読む所を直しています」と言う。
  const key = `${card.appId}/${card.cardId}`;
  repairingNow.delete(key);
  const timer = setInterval(() => {
    const sec = Math.round((Date.now() - started) / 1000);
    const repairing = repairingNow.has(key);
    const item = card.node && card.node.isConnected ? card.node.querySelector('[data-loading]') : null;
    if (item) {
      item.textContent = repairing
        ? `ページが変わったので、読む場所を直しています。${sec}秒たちました。\n読み終わると、ここに1件ずつ出ます。`
        : `読んでいます。${sec}秒たちました。\n読み終わると、ここに1件ずつ出ます。`;
    }
    announce(repairing ? `「${card.title}」の読む場所を直しています。${sec}秒たちました。` : `「${card.title}」を読み始めて、${sec}秒たちました。`);
  }, PROGRESS_EVERY_MS);
  let result;
  try {
    result = await window.cardsApi.runCard(card.appId, card.cardId);
  } catch (e) {
    result = { ok: false, message: e.message };
  } finally {
    clearTimeout(loadingTimer);
    clearInterval(timer);
    repairingNow.delete(key);
    busy = false;
  }
  if (result.repaired) repairsOf(card.appId).set(card.cardId, result.repaired);
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
      // 一件ごとの手がかり（文字ではなく短いハッシュ）。一件を選んだとき、ページの今の同じ項目を探すのに使う。
      card.itemKeys = Array.isArray(result.keys) ? result.keys.slice() : null;
      card.heading = `${card.title}（${count}件）`;
      // 一件に結び付いた所（itemTarget）のあるカードは、一覧の後に、Enter で何が起きるかの一文を置く。
      if (card.itemTarget) card.items.push({ text: `一件を選んで Enter キーを押すと、その${card.itemTarget.label}を読みます。` });
    } else {
      card.items = texts.map((t) => ({ text: t, result: true }));
      card.heading = card.title;
    }
    if (result.truncated) card.items.push({ text: '長いので、ここまでで切りました。' });
    // ページがまだ書いている途中だった（チャットの返事など）。待っても書き終わらなかったので、ここまでを読んだ。
    if (result.partial) card.items.push({ text: 'まだ書いている途中でした。ここまでを読みました。もう一度読むと、続きが読めます。' });
  } else if (result.needLogin) {
    card.heading = `${card.title}（ログインが必要です）`;
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
  // 自動で直したカードは、最後に直したことの一文と「直す前に戻す」ボタンを置く。
  card.items.push(...repairItems(card));
  // 読み込み中に Esc で別の所へ移っていたら、結果はカードに入れておくだけにする。
  const wasInside = card.node && card.node.isConnected && card.node.contains(document.activeElement);
  if (card.node) card.node.removeAttribute('aria-busy');
  // 焦点を移す先（結果の最初の項目）を先に作って焦点を移し、それから読み込み中の項目を外す（refreshCard の中）。
  const node = refreshCard(card, { focusResult: wasInside });
  if (result.repaired) {
    ensureMaintCard(card.appId);
    // 直したことは、読んだ知らせの前に一度だけ言う。
    const fixed = 'ページが変わったので、読む場所を直しました。';
    if (result.action === 'list') announce(fixed + (count === 0 ? `「${card.title}」は0件でした。` : `「${card.title}」から${count}件読みました。`));
    else announce(`${fixed}「${card.title}」を読みました。`);
    return;
  }
  if (!node) return;
  const midway = result.ok && result.partial ? 'まだ書いている途中です。' : '';
  if (result.ok && result.action === 'list') announce((count === 0 ? `「${card.title}」は0件でした。` : `「${card.title}」から${count}件読みました。`) + midway);
  else if (result.ok) announce(`「${card.title}」を読みました。${midway}`);
  else if (result.needLogin) announce(`「${card.title}」は、ログインが必要です。`);
  else announce(`「${card.title}」を読めませんでした。`);
}

// 読めなかったときの文。理由ごとに分け、黙らない。
function unreadableText(card, result) {
  const message = String(result.message || '');
  if (message.startsWith('ページを開けませんでした')) return 'ページを開けませんでした。\nネットワークを確認してください。\nネットワークの場所が変わったときは、Todoku を起動し直してください。';
  if (message.includes('書き方')) return '設定ファイルの書き方に誤りがあります。\n支援者に知らせてください。';
  if (message.startsWith('ログインの画面を開けませんでした')) return 'ログインの画面を開けませんでした。\nネットワークを確認してから、もう一度押してください。';
  // 主の処理で例外が起きたとき（窓が閉じられていた・ページの中の処理が落ちた など）。画面が変わったのではないので、そう言わない（見直しの6）。
  if (result.where === '(なし)' || message.startsWith('動かせませんでした')) return 'うまく動きませんでした。\nもう一度押してください。';
  // 自動で直そうとして直せなかったときは、最後に理由つきの一文を足す（見つからない → 0件のことも → 直すこともできなかった、の順）。
  const notFixed = result.autoRepairFailed ? `\n${notFixedSentence(result)}` : '';
  // 入れ物（container）のあるカードは、0件なら「（0件）」と出るので、ここに来るのは本当に見つからないときだけ。
  if (card.action === 'list' && !card.hasContainer) return `ページが変わったため、読む場所が見つかりませんでした。\n本当に0件の場合もあります。${notFixed}`;
  return `ページが変わったため、読む場所が見つかりませんでした。${notFixed}`;
}

// 自動で直せなかったときの一文。理由（鍵が無い・時間切れ・確かな案が無い・Claude が失敗した）があれば括弧で添える。
function notFixedSentence(result) {
  const why = result.autoRepairReasonText ? `（${result.autoRepairReasonText}）` : '';
  return `自動で直すこともできませんでした${why}。`;
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
        // 「押しています。」は、読み込み中の知らせと同じく、0.5秒たっても終わらないときだけ出す（すぐ終われば「押しました。」だけ）。
        // 押す9枚の束で、一枚ごとに「押します。」「押す ボタン」「押しています。」「押しました。」の4つが読まれ、長かった（Windows の通し稽古・押して約1.0秒）。
        const pressingTimer = setTimeout(() => {
          button.textContent = `「${card.title}」を押す（押しています）`;
          announce(`「${card.title}」を押しています。`);
        }, LOADING_DELAY_MS);
        const key = `${card.appId}/${card.cardId}`;
        repairingNow.delete(key);
        let r;
        try {
          r = await window.cardsApi.runCard(card.appId, card.cardId);
        } catch (e) {
          r = { ok: false, message: e.message };
        } finally {
          clearTimeout(pressingTimer);
          repairingNow.delete(key);
          busy = false;
          button.textContent = `「${card.title}」を押す`;
        }
        if (r.repaired) {
          // 押す所を直したときは、押し直さない。直したことを知らせ、もう一度押すかは使う人に任せる。
          repairsOf(card.appId).set(card.cardId, r.repaired);
          card.items = (card.items || []).filter((it) => !it.repairItem).concat(repairItems(card));
          // 押すボタンは作り直されるので、焦点は「「〇〇」を押します。」の項目へ移す（下矢印キーで押すボタンへ）。
          refreshCard(card, { focusResult: true });
          ensureMaintCard(card.appId);
          announce(`ページが変わったので、押す場所を直しました。もう一度押すときは、「${card.title}」を押すボタンを押してください。`);
          return;
        }
        // 押した結果ダウンロードが始まったときは、保存したか（できなかったか）を知らせる。
        if (r.ok && r.download) announce(r.download.message, !r.download.ok);
        else announce(r.ok ? `「${card.title}」を押しました。` : `「${card.title}」を押せませんでした。${r.message}${r.autoRepairFailed ? `。${notFixedSentence(r)}` : ''}`, !r.ok);
      },
    },
    ...repairItems(card),
  ];
  const fresh = refreshCard(card);
  if (fresh) enterCard(fresh, true);
}

// ---- YouTube のカード（設定ファイルの "kind": "youtube"）----
// 公式の API で探し・読み、公式の埋め込みプレーヤーで再生する（画面を読む作りは当てない）。プレーヤーはカードの中に見える形で置き、
// ほかの要素を重ねない。操作のボタンはプレーヤーの下に置き、焦点はボタンに置く（iframe の中に焦点を落とさない）。
const YT_PRIVACY = '検索の言葉は YouTube（Google）に送られます。Todoku は保存しません。';
let ytState = { card: null, iframe: null, ready: false, current: 0, volume: null, pendingPlay: false };

function ytDeck(config, hasParent) {
  const texts = [
    `「${config.name}」で、YouTube の動画を探して、再生できます。`,
    '上下矢印キーでカードを選びます。',
    'スペースキーまたはEnterキーで、カードの中に入ります。',
    '一覧の一件を選んで Enter キーを押すと、再生のカードで再生します。',
    '再生のカードでは、プレーヤーの下のボタンで、再生、一時停止、10秒戻る、10秒進む、音量の上げ下げができます。',
    YT_PRIVACY,
  ];
  if (hasParent) texts.push(`カードの上でEscキーを押すと、「${APP_NAME}」に戻ります。`);
  if (typeof config.description === 'string' && config.description.trim() !== '') texts.push(endSentence(config.description));
  const items = sentences(texts);
  const policy = (name, label) => ({
    button: label,
    onPress: async () => {
      let r;
      try {
        r = await window.cardsApi.openPolicy(name);
      } catch (e) {
        r = { ok: false, message: 'ページを開けませんでした。' };
      }
      announce(r.message, !r.ok);
    },
  });
  items.push(policy('youtube-terms', 'YouTube の利用規約を開く'), policy('google-privacy', 'Google のプライバシーポリシーを開く'));
  const cards = [{ kind: 'info', heading: config.name, items }];
  for (const c of config.cards) {
    const base = { appId: config.id, cardId: c.id, title: c.title, heading: c.title, note: c.description ? endSentence(c.description) : undefined, items: [] };
    if (c.action === 'youtube-search') {
      const card = { ...base, kind: 'yt-search', query: '' };
      card.items = ytSearchItems(card);
      cards.push(card);
    } else if (c.action === 'youtube-channel') {
      cards.push({ ...base, kind: 'yt-channel', items: [{ text: 'スペースキーまたはEnterキーで、新しい動画を読みます。', describe: true }] });
    } else if (c.action === 'youtube-player') {
      const card = { ...base, kind: 'yt-player' };
      card.items = ytPlayerItems(card);
      cards.push(card);
    }
  }
  return { name: config.name, appId: config.id, cards };
}

function ytSearchItems(card) {
  return [
    {
      input: '探す言葉',
      type: 'search',
      get value() { return card.query || ''; },
      onInput: (v) => { card.query = v; },
      onEnter: (v) => { card.query = v; ytLoad(card); },
    },
    { button: '探す', onPress: () => ytLoad(card) },
  ];
}

async function ytLoad(card) {
  if (busy) return;
  const searching = card.kind === 'yt-search';
  if (searching && !String(card.query || '').trim()) {
    announce('探す言葉を入れてください。');
    return;
  }
  busy = true;
  announce(searching ? '探しています。' : '読んでいます。');
  let r;
  try {
    r = await window.cardsApi.youtubeList(card.appId, card.cardId, searching ? card.query : '');
  } catch (e) {
    r = { ok: false, message: 'YouTube から読めませんでした。' };
  } finally {
    busy = false;
  }
  const head = searching ? ytSearchItems(card) : [];
  if (!r.ok) {
    card.items = [...head, { text: endSentence(r.message), result: true }];
    card.heading = card.title;
    refreshCard(card, { focusResult: true });
    announce(endSentence(r.message), true);
    return;
  }
  card.ytItems = r.items;
  card.onItemEnter = (i) => ytPlay(card.ytItems[i]);
  card.heading = `${card.title}（${r.items.length}件）`;
  card.items = [...head, ...(r.items.length === 0 ? [{ text: '動画は見つかりませんでした。', result: true }] : r.items.map((v) => ({ listItem: v.text }))),
    ...(r.items.length > 0 ? [{ text: '一件を選んで Enter キーを押すと、再生のカードで再生します。' }] : [])];
  refreshCard(card, { focusResult: true });
  announce(searching ? (r.items.length === 0 ? '見つかりませんでした。' : `${r.items.length}件見つかりました。`) : `「${card.title}」から${r.items.length}件読みました。`);
}

function ytPlayerItems(card) {
  if (!card.video) return [{ text: 'まだ動画を選んでいません。「動画を探す」か、新しい動画の一覧で一件を選んで Enter キーを押すと、ここで再生します。', result: true }];
  const b = (label, yt, fn) => ({ button: label, yt, onPress: fn });
  return [
    { embed: card.video.embedUrl, embedTitle: `YouTube の動画プレーヤー（${card.video.title}）`, onLoad: (f) => ytAttach(card, f) },
    { text: `再生する動画: ${card.video.text}` },
    b('再生', 'play', () => ytCommand('playVideo', [], '再生します。')),
    b('一時停止', 'pause', () => ytCommand('pauseVideo', [], '一時停止しました。')),
    b('10秒戻る', 'back', () => ytSeek(-10)),
    b('10秒進む', 'forward', () => ytSeek(10)),
    b('音量を上げる', 'up', () => ytVolume(10)),
    b('音量を下げる', 'down', () => ytVolume(-10)),
  ];
}

// 一覧の一件から、再生のカードへ移って再生する。プレーヤーが画面に半分以上見えてから再生を始める（YouTube の決まり）。
function ytPlay(video) {
  if (!video) return;
  const deck = current();
  const index = deck.cards.findIndex((c) => c.kind === 'yt-player');
  if (index < 0) {
    announce('再生のカードがありません。', true);
    return;
  }
  const card = deck.cards[index];
  card.video = video;
  card.heading = `${card.title}（${video.title}）`;
  card.items = ytPlayerItems(card);
  ytState = { card, iframe: null, ready: false, current: 0, volume: null, pendingPlay: true };
  selectCard(index, { announcePosition: false });
  const node = refreshCard(card);
  if (node) {
    node.scrollIntoView({ block: 'start' });
    const play = node.querySelector('button[data-yt="play"]');
    if (play) play.focus();
  }
  announce(`「${video.title}」を再生のカードに出しました。読み込めたら再生します。`);
}

function ytPost(func, args = []) {
  if (!ytState.iframe || !ytState.iframe.contentWindow) return false;
  ytState.iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
  return true;
}

function ytVisibleEnough(f) {
  const r = f.getBoundingClientRect();
  const h = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0));
  const w = Math.max(0, Math.min(r.right, window.innerWidth) - Math.max(r.left, 0));
  return r.width > 0 && r.height > 0 && (h * w) / (r.width * r.height) > 0.5;
}

function ytAttach(card, f) {
  if (ytState.card !== card) return;
  ytState.iframe = f;
  // 埋め込みプレーヤーに、状態（再生の位置・音量）を知らせてもらうよう頼む。
  f.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 'todoku', channel: 'widget' }), '*');
}

window.addEventListener('message', (e) => {
  if (!ytState.iframe || e.source !== ytState.iframe.contentWindow) return;
  let data;
  try {
    data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
  } catch (err) {
    return;
  }
  if (!data || typeof data !== 'object') return;
  if (data.event === 'onReady' || data.event === 'initialDelivery') ytState.ready = true;
  // 再生できない動画（埋め込みを許していない・消された など）は、黙らずに知らせる。
  if (data.event === 'onError') {
    ytState.pendingPlay = false;
    const why = { 2: '動画の指定が正しくありません', 5: 'このプレーヤーでは再生できない形式です', 100: '動画が見つかりません（消されたか、非公開です）', 101: '動画の持ち主が、埋め込みでの再生を許していません', 150: '動画の持ち主が、埋め込みでの再生を許していません' }[data.info];
    announce(`この動画は、ここでは再生できません。${why ? `${why}。` : `誤りの番号は${data.info}です。`}`, true);
    return;
  }
  const info = data.info && typeof data.info === 'object' ? data.info : null;
  if (info) {
    if (typeof info.currentTime === 'number') ytState.current = info.currentTime;
    if (typeof info.volume === 'number') ytState.volume = info.volume;
  }
  if (ytState.ready && ytState.pendingPlay && ytVisibleEnough(ytState.iframe)) {
    ytState.pendingPlay = false;
    ytPost('playVideo');
  }
});

function ytCommand(func, args, said) {
  if (!ytPost(func, args)) {
    announce('まだ動画を選んでいません。', true);
    return;
  }
  ytState.pendingPlay = false;
  announce(said);
}

function ytSeek(delta) {
  const to = Math.max(0, (ytState.current || 0) + delta);
  ytCommand('seekTo', [to, true], delta < 0 ? '10秒戻しました。' : '10秒進めました。');
  ytState.current = to;
}

function ytVolume(delta) {
  const now = typeof ytState.volume === 'number' ? ytState.volume : 100;
  const v = Math.max(0, Math.min(100, Math.round(now + delta)));
  ytCommand('setVolume', [v], `音量を${v}%にしました。`);
  ytState.volume = v;
}

// ---- 設定ファイルの点検と直しの案（支援者向けのカード）----
// 全部のカードを点検し、当たらない行ごとに Claude の案（鍵があるとき）を一件ずつ見て、「受ける」（設定ファイルに書き、前の版を控えに残す）か
// 「断る」を選ぶ。鍵が無いときは、当たらない行の一覧だけを読む。Claude に送るものは、主の処理の今の決まり（文字を落とした構造だけ）のまま。
const REVIEW_HEADING = '設定ファイルを確認して直す（支援者向け）';

const REVIEW_BUTTON = '設定ファイルを確認する（支援者向け）';

function reviewCard(appId) {
  return { kind: 'review', appId, heading: REVIEW_HEADING, items: [] };
}

// はじめのカードのボタンから、点検の束（カード一枚）へ進み、すぐ点検を始める。Esc でアプリの束へ戻る。
async function openReviewDeck(config) {
  if (busy) {
    announce('読み込み中です。少しお待ちください。');
    return;
  }
  const card = reviewCard(config.id);
  pushDeck({ name: `「${config.name}」の設定ファイルの確認（支援者向け）`, appId: config.id, cards: [card] }, { announcePosition: false });
  await openReview(card);
}

function placeOf(where) {
  const m = /^cards\[(\d+)\]\.(\w+)$/.exec(String(where || ''));
  if (!m) return String(where || '');
  return { selector: '読む場所・押す場所', container: '項目を囲む部分', path: 'ページ' }[m[2]] || m[2];
}

// 断っても、使う人の画面では、鍵があればその場で直して読む（autofix）。支援者が迷わないように、案の一覧の頭で言う。
const REVIEW_REJECT_NOTE = 'この直しを使わなくても、使う人の画面では、その場で直して読みます。Claude の API キーがあるときです。';

// 案の一覧（card.review）から、カードの項目を作る。焦点の行き先（result）は、決めたばかりの案の行（結果の文を含む）か、
// まだ決めていなければ最初の案の見出し。決めた結果を先に読み、次の案の見出しは下矢印で読む（知らせと焦点の移動が重なって、
// 次の見出しが先に読まれた。Windows の NVDA の確かめ）。
// 見出しと値は「いまのセレクタ: …」の一つの段落にする（dl にすると NVDA が項目ごとに役割の名前を付けて読み、一件で6回になった）。
function reviewItems(card, justDecided = null) {
  const r = card.review;
  const items = [{ text: r.summary, result: r.proposals.length === 0 }];
  if (r.proposals.length > 0) items.push({ text: REVIEW_REJECT_NOTE });
  for (const e of r.errors) items.push({ text: `「${e.title || e.where}」（${placeOf(e.where)}）: ${e.message}` });
  const pending = r.proposals.findIndex((p) => !p.decided);
  r.proposals.forEach((p, k) => {
    const head = `直しの候補${k + 1}（全部で${r.proposals.length}つ）: 「${p.title}」の${placeWord(p.action)}`;
    if (p.decided) {
      const done = p.decided === 'accepted' ? 'この直しを使いました。設定ファイルに書き、前の版はバックアップとして残しました。' : 'この直しは使いませんでした。設定ファイルは変えていません。';
      items.push({ text: `${head}: ${done}`, result: p === justDecided });
      return;
    }
    items.push(
      { text: head, result: !justDecided && k === pending },
      { text: `いまのセレクタ: ${p.oldSelector}` },
      { text: `直しの候補のセレクタ: ${p.newSelector}（ページの中で${p.matches}か所が見つかります）` },
      { text: `理由: ${p.reason || '（理由はありません）'}` },
      { button: `「${p.title}」の直しを使う（設定ファイルに書く）`, onPress: () => decideProposal(card, p, true) },
      { button: `「${p.title}」の直しを使わない`, onPress: () => decideProposal(card, p, false) },
    );
  });
  if (r.proposals.length > 0 && pending < 0) {
    const accepted = r.proposals.filter((p) => p.decided === 'accepted').length;
    items.push({ text: `すべての直しの候補を確認しました。使った直しは${accepted}つ、使わなかった直しは${r.proposals.length - accepted}つです。`, result: !justDecided });
  }
  return items;
}

async function openReview(card) {
  busy = true;
  reviewing = true;
  card.heading = `${REVIEW_HEADING}（確認しています）`;
  card.items = [{ text: '確認しています。\n終わると、ここに読めなくなった場所と直しの候補が出ます。', result: true, loading: true }];
  refreshCard(card, { focusResult: true });
  announce('確認しています。');
  // 5秒ごとに、どれだけたったかを知らせる（読むカードの「読み始めて、〇秒たちました。」と同じ形）。
  const started = Date.now();
  const timer = setInterval(() => {
    const sec = Math.round((Date.now() - started) / 1000);
    const item = card.node ? card.node.querySelector('[data-loading]') : null;
    if (item) item.textContent = `確認しています。${sec}秒たちました。\n終わると、ここに読めなくなった場所と直しの候補が出ます。`;
    announce(`確認を始めて、${sec}秒たちました。`);
  }, PROGRESS_EVERY_MS);
  let summary;
  try {
    let checked;
    try {
      checked = await window.cardsApi.checkCards(card.appId);
    } catch (e) {
      checked = { ok: false, message: `確認できませんでした: ${e.message}` };
    }
    if (!checked.ok) {
      card.review = null;
      card.items = [{ text: endSentence(checked.message), result: true }];
      summary = endSentence(checked.message);
    } else if (checked.problems.length === 0) {
      card.review = null;
      card.items = [{ text: '読めなくなった場所はありません。', result: true }];
      summary = '読めなくなった場所はありません。';
    } else {
      const n = checked.problems.length;
      let proposed;
      try {
        proposed = await window.cardsApi.proposeRepairs(card.appId);
      } catch (e) {
        proposed = { ok: false, message: `直しの候補を作れませんでした: ${e.message}` };
      }
      if (!proposed.ok) {
        // 鍵が無いとき（案を作れないとき）は、当たらない行の一覧だけを読む。
        card.review = null;
        summary = `読めなくなった場所が${n}か所あります。${endSentence(proposed.message)}`;
        card.items = [{ text: summary, result: true }, ...checked.problems.map((p) => ({ text: `「${p.title || p.where}」（${placeOf(p.where)}）: ${endSentence(p.message)}` }))];
      } else {
        const proposals = (proposed.proposals || []).filter((p) => p.newSelector).map((p) => ({ ...p, decided: null }));
        const noIdea = (proposed.proposals || []).filter((p) => !p.newSelector).map((p) => ({ where: p.where, title: p.title, message: '直しの候補がありませんでした' }));
        const errors = [...noIdea, ...(proposed.errors || []).map((e) => ({ ...e, title: (checked.problems.find((p) => p.where === e.where) || {}).title }))];
        summary = `読めなくなった場所が${n}か所あり、直しの候補が${proposals.length}つあります。`;
        card.review = { summary, proposals, errors };
        card.items = reviewItems(card);
      }
    }
  } finally {
    clearInterval(timer);
    reviewing = false;
    busy = false;
  }
  card.heading = card.review ? `${REVIEW_HEADING}（直しの候補${card.review.proposals.length}つ）` : REVIEW_HEADING;
  refreshCard(card, { focusResult: true });
  announce(summary);
}

async function decideProposal(card, p, accept) {
  if (busy || p.decided) return;
  if (accept) {
    busy = true;
    // 書くのに時間がかかる（Windows で3秒ほど無音だった）ので、0.5秒を越えたら「書いています。」と一言知らせる（押すカードの「押しています。」と同じ形）。
    const writingTimer = setTimeout(() => announce('書いています。'), LOADING_DELAY_MS);
    let r;
    try {
      r = await window.cardsApi.applyRepairs(card.appId, [p.where]);
    } catch (e) {
      r = { ok: false, message: `設定ファイルに書けませんでした: ${e.message}` };
    } finally {
      clearTimeout(writingTimer);
      busy = false;
    }
    if (!r.ok) {
      announce(`「${p.title}」の直しを設定ファイルに書けませんでした。${endSentence(r.message)}`, true);
      return;
    }
    p.decided = 'accepted';
  } else {
    p.decided = 'rejected';
  }
  // 焦点は、決めた案の行（結果の文を含む）に置き、知らせは出さない（焦点の先の文で結果を読むため。二度読ませない）。
  card.items = reviewItems(card, p);
  refreshCard(card, { focusResult: true });
}

// ---- 自動で直した所（支援者向けのカード）----
// どのカード・前と後のセレクタ・理由・日時を読み、設定ファイルに書く（配る）か、直す前に戻すかを選ぶ。
const MAINT_HEADING = '自動で直した場所（支援者向け）';

function formatAt(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso || '');
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}時${String(d.getMinutes()).padStart(2, '0')}分`;
}

// 支援者向けのカードで配った・戻したカードから、直したことの一文と「直す前に戻す」ボタンを外す（焦点は動かさない）。
function dropRepairItems(appId, cardId) {
  const card = current().cards.find((c) => c.appId === appId && c.cardId === cardId);
  if (!card || !(card.items || []).some((it) => it.repairItem)) return;
  card.items = card.items.filter((it) => !it.repairItem);
  refreshCard(card);
}

function maintCard(appId) {
  return { kind: 'maint', appId, heading: MAINT_HEADING, items: [] };
}

// いまの束がそのアプリの束で、支援者向けのカードがまだ無ければ、最後に足す（焦点は動かさない）。
function ensureMaintCard(appId) {
  const deck = current();
  if (!deck || deck.appId !== appId || deck.cards.some((c) => c.kind === 'maint')) return;
  const card = maintCard(appId);
  deck.cards.push(card);
  deckEl.append(renderCard(card));
}

async function openMaint(card) {
  let r;
  try {
    r = await window.cardsApi.listRepairs(card.appId);
  } catch (e) {
    r = { ok: false, message: '自動で直した場所の一覧を読めませんでした。' };
  }
  const repairs = r.ok ? r.repairs : [];
  repairsOf(card.appId).clear();
  for (const x of repairs) repairsOf(card.appId).set(x.cardId, x);
  if (!r.ok) {
    card.items = [{ text: r.message, result: true }];
  } else if (repairs.length === 0) {
    card.items = [{ text: '自動で直した場所は、いまはありません。', result: true }];
  } else {
    card.items = [{ text: `自動で直した場所が${repairs.length}か所あります。この直しは、このパソコンの中だけで使っています。`, result: true }];
    for (const x of repairs) {
      card.items.push(
        { label: 'カード', text: x.title },
        { label: '直す前のセレクタ', text: x.before },
        { label: '直した後のセレクタ', text: x.after },
        { label: '理由', text: x.reason || '（理由はありません）' },
        { label: '日時', text: formatAt(x.at) },
        {
          button: `「${x.title}」の直しを設定ファイルに書く（ほかの人にも配れるようにする）`,
          onPress: async () => {
            let p;
            try {
              p = await window.cardsApi.publishRepair(card.appId, x.cardId);
            } catch (e) {
              p = { ok: false, message: '設定ファイルに書けませんでした。' };
            }
            announce(p.message, !p.ok);
            if (!p.ok) return;
            dropRepairItems(card.appId, x.cardId);
            await openMaint(card);
          },
        },
        {
          button: `「${x.title}」を直す前に戻す`,
          onPress: async () => {
            let u;
            try {
              u = await window.cardsApi.undoRepair(card.appId, x.cardId);
            } catch (e) {
              u = { ok: false, message: '直す前に戻せませんでした。' };
            }
            if (!u.ok) {
              announce(u.message, true);
              return;
            }
            announce(`「${x.title}」の${placeWord(x.action)}を、直す前に戻しました。`);
            dropRepairItems(card.appId, x.cardId);
            await openMaint(card);
          },
        },
      );
    }
  }
  card.heading = `${MAINT_HEADING}（${repairs.length}か所）`;
  const node = refreshCard(card, { focusResult: true });
  return node;
}

// ---- 新しいページからカードを作る（設定ファイルの無いページ）----
// URL を入れて、作り始めるボタンか Enter キーで作り始める。作っている間は、読み込み中の知らせと同じ形で秒数を知らせる。
// 作れたら、はじめの束にその束の行き先のカードを足し、その束を開いて「「名前」のカードをN枚作りました。」と一度だけ知らせる。
// 作れなかったら、理由の一文を知らせ、入力欄をもう一度出す（入れた URL は残す）。
const CREATE_HEADING = '新しいページからカードを作る';
// 作った束の id（はじめの束で、作った束だと分かるように）。
const generatedApps = new Set();
// 読めた設定ファイルの一覧（はじめの束を作り直すときに使う）。
let appConfigs = [];

function createItems(card) {
  return [
    { text: 'ページのURLを入れて、Enterキーを押すと、Claude がそのページのカードを作ります。', describe: true },
    { text: 'Claude に送るのはページの構造だけで、ページの文字は送りません。作り終わるまで、長いときは90秒ほどかかります。' },
    {
      input: 'ページのURL（http か https で始まるもの）',
      // 描き直したときも、入れた途中の URL を残す。
      get value() { return card.urlValue || ''; },
      onInput: (v) => { card.urlValue = v; },
      onEnter: (v) => { card.urlValue = v; startGenerate(card); },
    },
    { button: '作り始める', onPress: () => startGenerate(card) },
  ];
}

function createCard() {
  const card = { kind: 'create', heading: CREATE_HEADING, urlValue: '' };
  card.items = createItems(card);
  return card;
}

// 作った束（と、読めた束）の行き先のカード。
function gotoCard(config) {
  const items = [{ text: `スペースキーまたはEnterキーで、「${config.name}」のカードへ進みます。`, describe: true }];
  if (generatedApps.has(config.id)) items.push({ text: 'Claude がページの構造から作ったカードです。' });
  return { kind: 'goto', heading: config.name, appId: config.id, items, open: () => pushDeck(appDeck(config, true)) };
}

async function startGenerate(card) {
  if (busy) return;
  const url = String(card.urlValue || '').trim();
  if (!/^https?:\/\/\S+$/i.test(url)) {
    announce('http:// か https:// で始まるページのURLを入れてください。', true);
    return;
  }
  busy = true;
  const started = Date.now();
  card.heading = `${CREATE_HEADING}（作っています）`;
  card.items = [{ text: 'カードを作っています。長いときは90秒ほどかかります。\n作り終わると、作ったカードを開きます。', result: true, loading: true }];
  // 焦点を入力欄から「カードを作っています。」の項目へ移してから、入力欄を外す（refreshCard の中）。
  const node = refreshCard(card, { focusResult: true });
  if (node) node.setAttribute('aria-busy', 'true');
  const timer = setInterval(() => {
    const sec = Math.round((Date.now() - started) / 1000);
    const item = card.node && card.node.isConnected ? card.node.querySelector('[data-loading]') : null;
    if (item) item.textContent = `カードを作っています。${sec}秒たちました。\n作り終わると、作ったカードを開きます。`;
    announce(`カードを作り始めて、${sec}秒たちました。`);
  }, PROGRESS_EVERY_MS);
  let r;
  try {
    r = await window.cardsApi.generateDeck(url);
  } catch (e) {
    r = { ok: false, message: 'うまく動かなかったので、カードを作れませんでした。' };
  } finally {
    clearInterval(timer);
    busy = false;
  }
  if (card.node) card.node.removeAttribute('aria-busy');
  card.heading = CREATE_HEADING;
  const wasInside = Boolean(card.node && card.node.isConnected && card.node.contains(document.activeElement));
  if (!r.ok) {
    card.items = [{ text: r.message, result: true }, ...createItems(card)];
    refreshCard(card, { focusResult: wasInside });
    announce(r.message, true);
    return;
  }
  card.urlValue = '';
  card.items = createItems(card);
  refreshCard(card);
  generatedApps.add(r.config.id);
  appConfigs.push(r.config);
  // はじめの束の「新しいページからカードを作る」の前に、作った束の行き先のカードを足す。戻ったときは、そのカードに焦点を戻す。
  const top = stack[0];
  const at = top.cards.indexOf(card);
  const k = at < 0 ? top.cards.length : at;
  top.cards.splice(k, 0, gotoCard(r.config));
  top.index = k;
  refreshTopIntro();
  refreshSearchResults();
  pushDeck(appDeck(r.config, true), { announcePosition: false });
  announce(r.message);
}

// はじめのカードの件数の一文を、いまのアプリの数に合わせる。
function refreshTopIntro() {
  const intro = stack[0] && stack[0].cards[0];
  if (!intro || !intro.items || !intro.items[0]) return;
  intro.items[0] = { text: topIntroText(appConfigs.length) };
}

// 数は「〇個」で言う（「〇つ」は10を越えると「14つ」になる。2026-11-05 の Windows の確かめ）。
function topIntroText(n) {
  return `ウェブアプリの画面を、カードで読めます。アプリは${n}個あります。`;
}

// 作った束を消す。消したら、はじめの束へ戻り、その束の行き先のカードを外す。
async function deleteGenerated(config) {
  let r;
  try {
    r = await window.cardsApi.deleteGenerated(config.id);
  } catch (e) {
    r = { ok: false, message: 'カードを消せませんでした。' };
  }
  if (!r.ok) {
    announce(r.message, true);
    return;
  }
  generatedApps.delete(config.id);
  repairsByApp.delete(config.id);
  appConfigs = appConfigs.filter((c) => c.id !== config.id);
  stack.length = 1;
  const top = stack[0];
  const at = top.cards.findIndex((c) => c.kind === 'goto' && c.appId === config.id);
  if (at >= 0) top.cards.splice(at, 1);
  // 焦点は「新しいページからカードを作る」のカードへ戻す。
  const createAt = top.cards.findIndex((c) => c.kind === 'create');
  top.index = createAt >= 0 ? createAt : Math.min(top.index, top.cards.length - 1);
  refreshTopIntro();
  refreshSearchResults();
  renderDeck({ announcePosition: false });
  announce(r.message);
}

async function exportGenerated(config) {
  let r;
  try {
    r = await window.cardsApi.exportGenerated(config.id);
  } catch (e) {
    r = { ok: false, message: '設定ファイルを書き出せませんでした。' };
  }
  announce(r.message, !r.ok);
}

// ---- 表示設定 ----
// 基のカード型ページの三つ（読みやすさ・1列リフロー表示・配色）。ふだんは「表示設定を開く」の1行だけを出す。
// 変えたら、何をしたかを一文で一度だけ知らせる。設定は主の処理が userData に残し、次の起動で、カードを作る前に当てる。
// 保存できなくても、開いている間は効く。文字の大きさは、Ctrl（macOS は Command）とプラス・マイナスで主の処理が変える。
const SETTINGS_HEADING = '表示設定';
const PRESET_LABELS = { standard: '標準', yuttari: 'ゆったり' };
const SCHEME_LABELS = { standard: '標準（配色変更なし）', white: '高コントラスト（白地）', black: '高コントラスト（黒地）' };
const DEFAULT_VIEW = { preset: 'standard', reflow: false, scheme: 'standard' };
let view = { ...DEFAULT_VIEW };

// 知らない値は標準に戻して、html の data-* に当てる（見た目は style.css が決める）。
function applySettings(s) {
  const x = s && typeof s === 'object' ? s : {};
  view = {
    preset: Object.hasOwn(PRESET_LABELS, x.preset) ? x.preset : DEFAULT_VIEW.preset,
    reflow: typeof x.reflow === 'boolean' ? x.reflow : DEFAULT_VIEW.reflow,
    scheme: Object.hasOwn(SCHEME_LABELS, x.scheme) ? x.scheme : DEFAULT_VIEW.scheme,
  };
  const root = document.documentElement;
  root.dataset.preset = view.preset;
  root.dataset.reflow = view.reflow ? 'on' : 'off';
  root.dataset.scheme = view.scheme;
}

// ボタンの文字にも、いまの状態を入れる（色や配置だけで示さない）。
function settingButton(key) {
  const [name, value] = key.split(':');
  if (name === 'reflow') return { text: `1列リフロー表示: ${view.reflow ? '有効' : '無効'}`, pressed: view.reflow };
  if (name === 'preset') {
    const on = view.preset === value;
    return { text: `${PRESET_LABELS[value]}${on ? '、選択中' : ''}`, pressed: on };
  }
  const on = view.scheme === value;
  return { text: `${SCHEME_LABELS[value]}${on ? '、選択中' : ''}`, pressed: on };
}

function settingsItems(card) {
  const hidden = !card.open;
  const fold = (item) => ({ ...item, fold: true, hidden });
  const choice = (key, onPress) => {
    const b = settingButton(key);
    return fold({ button: b.text, pressed: b.pressed, setting: key, onPress });
  };
  return [
    { button: '表示設定を開く', expanded: Boolean(card.open), onPress: (b) => toggleSettings(card, b) },
    fold({ text: '読みやすさ' }),
    choice('preset:standard', () => choosePreset('standard')),
    choice('preset:yuttari', () => choosePreset('yuttari')),
    fold({ text: '「ゆったり」は、文字の間隔、単語の間隔、行の間隔を広げ、1列リフロー表示にします。' }),
    fold({ text: '「1列リフロー表示」を有効にすると、項目の見出しと内容を1列に並べます。\n画面の幅が狭いときは、自動で1列になります。' }),
    choice('reflow', toggleReflow),
    fold({ text: '配色' }),
    choice('scheme:standard', () => chooseScheme('standard')),
    choice('scheme:white', () => chooseScheme('white')),
    choice('scheme:black', () => chooseScheme('black')),
    fold({ text: 'OSで強制配色やハイコントラストモードを使っているときは、そちらを優先します。' }),
    fold({ text: '文字の大きさは、WindowsではCtrlキーとプラスまたはマイナス、macOSではCommandキーとプラスまたはマイナスで変えます。\nCtrlキーまたはCommandキーと0キーで、元の大きさに戻ります。' }),
    fold({ button: '表示設定を標準に戻す', onPress: resetSettings }),
  ];
}

// 開く・閉じる。焦点は「表示設定を開く」のボタンに置いたまま、畳む項目だけを出し入れする（状態は aria-expanded で伝わる）。
function toggleSettings(card, button) {
  card.open = !card.open;
  button.setAttribute('aria-expanded', String(card.open));
  if (!card.node) return;
  for (const n of card.node.querySelectorAll('[data-fold]')) n.hidden = !card.open;
}

// ボタンを作り直さずに、文字と押された状態だけを書き換える（焦点のあるボタンを外さない）。
function refreshSettingButtons() {
  for (const b of document.querySelectorAll('[data-setting]')) {
    const s = settingButton(b.dataset.setting);
    b.textContent = s.text;
    b.setAttribute('aria-pressed', String(s.pressed));
  }
}

async function changeView(next, message) {
  applySettings(next);
  refreshSettingButtons();
  announce(message);
  try {
    await window.cardsApi.saveSettings(view);
  } catch (e) {
    // 保存できなくても、開いている間は効いている。
  }
}

// 「ゆったり」は1列リフロー表示も有効にし、「標準」は無効にする（プリセットで一度に変える）。変わったときは、そのことも同じ文で言う。
function choosePreset(preset) {
  const reflow = preset === 'yuttari';
  const more = reflow === view.reflow ? '' : `1列リフロー表示を${reflow ? '有効' : '無効'}にしました。`;
  changeView({ ...view, preset, reflow }, `読みやすさを「${PRESET_LABELS[preset]}」にしました。${more}`);
}

function toggleReflow() {
  const reflow = !view.reflow;
  changeView({ ...view, reflow }, `1列リフロー表示を${reflow ? '有効' : '無効'}にしました。`);
}

function chooseScheme(scheme) {
  changeView({ ...view, scheme }, `配色を「${SCHEME_LABELS[scheme]}」にしました。`);
}

// 文字の大きさ（拡大率）は戻さないので、そのことを添える。
function resetSettings() {
  changeView({ ...DEFAULT_VIEW }, '表示設定を標準に戻しました。続けて文字の大きさも、必要に応じて調整してください。');
}

function settingsCard() {
  return { kind: 'settings', heading: SETTINGS_HEADING, open: false, items: [] };
}

// ---- 探す（文字だけの関数）----
// 全角と半角、大文字と小文字、ひらがなとカタカナを区別しない。空白で区切ると、全部の言葉を含むものだけにする。
function normalizeForSearch(text) {
  return String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/\s+/g, ' ')
    .trim();
}

// アプリごとに、題と説明に全部の言葉を含むカードを集める。当たらないアプリは入れない。
function searchCards(configs, query) {
  const words = normalizeForSearch(query).split(' ').filter(Boolean);
  if (words.length === 0) return [];
  const groups = [];
  for (const config of configs) {
    const matches = (config.cards || []).filter((c) => {
      const hay = normalizeForSearch(`${c.title || ''} ${c.description || ''}`);
      return words.every((w) => hay.includes(w));
    });
    if (matches.length > 0) groups.push({ config, matches });
  }
  return groups;
}

function searchCountText(query, total) {
  if (normalizeForSearch(query) === '') return '探す言葉を入れると、ここに見つかった数が出ます。';
  return total === 0 ? '見つかりませんでした。別の言い方でお試しください。' : `${total}件見つかりました。`;
}

// ---- 探す欄 ----
// 基の探す欄の形: 打つたびに絞り込み、アプリごとのカード（見出しにアプリの名前と件数）を探す欄のカードのすぐ後に並べる。
// 0件のアプリのカードは出さない（上下矢印キーの対象からも外れる）。見つかった数は、打ち終えて少し待ってから一度だけ知らせる。
// 入力した後、Escキーで探す欄のカードへ戻り、下矢印キーで最初の見つかったカードへ移る。欄の中の Enterキーでも、最初の見つかったカードへ移る。
const SEARCH_HEADING = 'カードを探す';
const SEARCH_ANNOUNCE_MS = 400;
const search = { query: '', total: 0, timer: null };

function searchCard() {
  return {
    kind: 'search',
    heading: SEARCH_HEADING,
    items: [
      {
        input: '探す言葉',
        type: 'text',
        get value() { return search.query; },
        onInput: (v) => onSearchInput(v),
        onEnter: (v) => { onSearchInput(v); toFirstResult(); },
      },
      { text: '題と説明から、全部のアプリのカードを探します。', describe: true },
      { text: '入力した後、Escキーでこのカードへ戻り、下矢印キーで、アプリごとの見つかったカードへ移ります。' },
      { text: '欄の中でEnterキーを押すと、最初に見つかったカードへ移ります。' },
      { text: searchCountText(search.query, search.total), searchCount: true },
    ],
  };
}

function resultCard({ config, matches }) {
  const items = [];
  for (const c of matches) {
    // 同じ題でもアプリごとに働きが違うので、一件ずつアプリの名前を付ける。
    items.push({ button: `「${config.name}」の「${c.title}」へ移る`, onPress: () => goToFound(config.id, c.id) });
    if (c.description) items.push({ text: endSentence(c.description) });
  }
  return { kind: 'results', appId: config.id, heading: `「${config.name}」で見つかったカード（${matches.length}件）`, items };
}

// はじめの束の、見つかったカードを作り直す。はじめの束が画面に出ているときは、そのカードの要素だけを入れ替える（焦点は動かさない）。
function refreshSearchResults() {
  const top = stack[0];
  if (!top) return;
  const groups = searchCards(appConfigs, search.query);
  search.total = groups.reduce((n, g) => n + g.matches.length, 0);
  const selected = top.cards[top.index];
  const old = top.cards.filter((c) => c.kind === 'results');
  top.cards = top.cards.filter((c) => c.kind !== 'results');
  const at = top.cards.findIndex((c) => c.kind === 'search');
  if (at < 0) return;
  const fresh = groups.map(resultCard);
  top.cards.splice(at + 1, 0, ...fresh);
  const sc = top.cards[at];
  top.index = Math.max(0, top.cards.indexOf(old.includes(selected) ? sc : selected));
  sc.items[sc.items.length - 1] = { text: searchCountText(search.query, search.total), searchCount: true };
  if (!(sc.node && sc.node.isConnected)) return;
  for (const c of old) if (c.node) c.node.remove();
  let anchor = sc.node;
  for (const c of fresh) {
    const n = renderCard(c);
    anchor.after(n);
    anchor = n;
  }
  const countEl = sc.node.querySelector('[data-search-count]');
  if (countEl) countEl.textContent = searchCountText(search.query, search.total);
}

function onSearchInput(value) {
  if (value === search.query) return;
  search.query = value;
  refreshSearchResults();
  clearTimeout(search.timer);
  if (normalizeForSearch(value) === '') return;
  search.timer = setTimeout(() => announce(searchCountText(search.query, search.total)), SEARCH_ANNOUNCE_MS);
}

// 欄の中の Enterキー: 見つかったカードがあれば最初のカードへ移る。無ければ、見つかった数をもう一度言う。
function toFirstResult() {
  clearTimeout(search.timer);
  const top = current();
  const at = top.cards.findIndex((c) => c.kind === 'results');
  if (normalizeForSearch(search.query) === '') {
    announce('探す言葉を入れてください。');
    return;
  }
  if (at < 0) {
    announce(searchCountText(search.query, search.total));
    return;
  }
  // 見つかった数と位置を、一つの文で言う（続けて二つ入れると、前の文が読まれないことがある）。
  selectCard(at, { announcePosition: false });
  announce(`${searchCountText(search.query, search.total)}${cardNodes().length}枚中${at + 1}枚目`);
}

// 見つかったカードへ移る: そのアプリの束を開き、そのカードを選ぶ。Escキーで、はじめの束の見つかったカードに戻る。
function goToFound(appId, cardId) {
  const config = appConfigs.find((c) => c.id === appId);
  if (!config) {
    announce('そのカードは、もうありません。', true);
    return;
  }
  const deck = appDeck(config, true);
  const index = deck.cards.findIndex((c) => c.cardId === cardId);
  pushDeck({ ...deck, index: Math.max(0, index) });
}

// ---- 束を作る ----
// はじめのカードは、見出しを名前にし、中の最初の項目で何ができるかを一文で言う（件数も同じ文に）。
// キーの説明は基の書き方（キーには「キー」を付け、カードは「選ぶ」、中は「カード内へ移動する」）で、一文を一つの項目にする。
// Enter の二つの意味（先へ進む／カード内へ移動する）は、はじめのカードで分けて言い、行き先のカードでは中の一文でも言う。
const APP_NAME = 'Todoku';
// 読み上げソフトごとの使い方。VoiceOver のキーの名前は Apple の言い方（クイックナビ・左矢印キーと右矢印キーを同時に押す）に合わせる。
const READER_TEXTS = [
  'NVDAでは、NVDAキーとスペースキーでフォーカスモードに替えると、上下矢印キーでカードを選べます。',
  '替えなくても、Hキーで見出しを順に読めます。',
  'MacのVoiceOverでは、左矢印キーと右矢印キーを同時に押してクイックナビをオフにすると、上下矢印キーでカードを選べます。',
];

function sentences(texts) { return texts.map((text) => ({ text })); }

// 説明の文の終わりに「。」が無ければ足す（一文として読まれるように）。
function endSentence(text) {
  const t = String(text).trim();
  return /[。．.！？!?]$/.test(t) ? t : `${t}。`;
}

// hasParent: 上に「Todoku」の束があるか（アプリが一つだけのときは無い）。
function appDeck(config, hasParent = true) {
  if (config.kind === 'youtube') return ytDeck(config, hasParent);
  const reads = config.cards.filter((c) => c.action !== 'click').length;
  const clicks = config.cards.length - reads;
  const counts = [reads > 0 ? `読むカード${reads}枚` : '', clicks > 0 ? `押すカード${clicks}枚` : ''].filter(Boolean).join('、');
  const texts = [
    `「${config.name}」の画面を、カードで読めます（${counts || 'カードはありません'}）。`,
    '上下矢印キーでカードを選びます。',
    'Homeキーで最初のカード、Endキーで最後のカードへ移動します。',
    'スペースキーまたはEnterキーで、カードの中に入ります。',
    '読むカードでは、カードの中に入るときに、ウェブアプリのその場所を読みます。',
    '読むカードの上で、もう一度スペースキーまたはEnterキーを押すと、読み直します。',
    '押すカードでは、カードの中のボタンで押します。',
    'カードの中では、上下矢印キーで項目を一つずつ選びます。',
    'Homeキーで最初、Endキーで最後の項目へ移動します。',
    'Escキーで、カードの中からカードへ戻ります。',
  ];
  if (hasParent) {
    texts.push(`カードの上でEscキーを押すと、「${APP_NAME}」に戻ります。`);
    // 基を使い慣れた方は、二枚目に表示設定があると思って探すので、在処と戻り方を言う。
    texts.push(`表示設定は、はじめの画面の「${SETTINGS_HEADING}」のカードにあります。`);
  }
  if (clicks === 0) texts.splice(texts.indexOf('押すカードでは、カードの中のボタンで押します。'), 1);
  // 設定ファイルの頭の description（アプリの説明・出典など）は、はじめのカードの最後の項目にする。
  if (typeof config.description === 'string' && config.description.trim() !== '') texts.push(endSentence(config.description));
  const items = sentences(texts);
  // 支援者向け: 設定ファイルを点検し、当たらない行の直しの案を一件ずつ受ける・断る束へ進む（使う人の束にカードを増やさないため、ボタンにする）。
  items.push({ button: REVIEW_BUTTON, onPress: () => openReviewDeck(config) });
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
  // Claude が作った束は、はじめのカードの最後に、設定ファイルとして書き出す（支援者向け）ボタンと、束を消すボタンを置く。
  if (generatedApps.has(config.id)) {
    items.push(
      { button: '設定ファイルとして書き出す（支援者向け）', onPress: () => exportGenerated(config) },
      { button: 'このアプリのカードを消す', onPress: () => deleteGenerated(config) },
    );
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
      itemTarget: c.action === 'list' && c.itemTarget && c.itemTarget.label ? { label: String(c.itemTarget.label) } : null,
      note: c.description ? endSentence(c.description) : undefined,
      items: [],
    });
  }
  // 自動で直した所があれば、支援者向けのカードを最後に置く。
  if (repairsOf(config.id).size > 0) cards.push(maintCard(config.id));
  return { name: config.name, appId: config.id, cards };
}

function topDeck(configs, problems) {
  const cards = [{
    kind: 'info',
    heading: APP_NAME,
    items: sentences([
      topIntroText(configs.length),
      '上下矢印キーでカードを選びます。',
      'Homeキーで最初のカード、Endキーで最後のカードへ移動します。',
      'スペースキーまたはEnterキーで、カードの中に入ります。',
      'ただし、アプリの名前のカードでは、スペースキーまたはEnterキーで、そのアプリのカードへ進みます。',
      `「${CREATE_HEADING}」のカードでは、スペースキーまたはEnterキーで、ページのURLを入れる欄へ移ります。`,
      'カードの中では、上下矢印キーで項目を一つずつ選びます。',
      'Homeキーで最初、Endキーで最後の項目へ移動します。',
      'Escキーで、カードの中からカードへ戻ります。',
      `「${SETTINGS_HEADING}」のカードで、読みやすさ、1列リフロー表示、配色を変えられます。`,
      `「${SEARCH_HEADING}」のカードで、全部のアプリのカードを、題と説明から探せます。`,
      ...READER_TEXTS,
    ]),
  }];
  // 基のカード型ページと同じく、二枚目を表示設定にする。三枚目が探す欄で、見つかったカードはそのすぐ後に並ぶ。
  cards.push(settingsCard(), searchCard());
  for (const config of configs) cards.push(gotoCard(config));
  cards.push(createCard());
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
// 入力欄の Enter で働きを始めた時刻。入力欄の Enter は欄の中で止めるが、その直後に、焦点を移した先へ
// Enter がもう一度届くことがある（押したままの繰り返しや、読み上げソフトが続けて渡すもの）。
// 「新しいページからカードを作る」の欄で Enter を押した直後に「読み込み中です。少しお待ちください。」が一度出た（2026-11-03 の Windows の確かめ）。
// 欄の Enter から短い間に、ほかのキーを挟まずに届いた Enter と、押したままの繰り返しの Enter は、黙って捨てる。
const FIELD_ENTER_GUARD_MS = 500;
let fieldEnterAt = 0;

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') fieldEnterAt = 0;
  if (e.altKey || e.ctrlKey || e.metaKey || e.isComposing || e.keyCode === 229) return;
  const active = document.activeElement;
  const cardNode = active && active.closest ? active.closest('article.card') : null;
  if (!cardNode) return;
  const onCard = active === cardNode;
  const key = e.key;
  const handled = ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape'].includes(key);
  if (!handled) return;
  // 入力欄の中の Enter（入力欄が作り始める）・スペース・Home・End（文字の入力と移動）は、入力欄に任せる。
  if (active.tagName === 'INPUT' && ['Enter', ' ', 'Home', 'End'].includes(key)) return;
  if (key === 'Enter' && (e.repeat || Date.now() - fieldEnterAt < FIELD_ENTER_GUARD_MS)) {
    e.preventDefault();
    return;
  }
  if (busy && key !== 'Escape') {
    e.preventDefault();
    if (!reviewing) announce('読み込み中です。少しお待ちください。');
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
  // 一件に結び付いた所のある一覧では、一件の上の Enter とスペースで、その所を読む。
  if ((key === 'Enter' || key === ' ') && active.tagName === 'LI') {
    const card = current().cards[current().index];
    if (card && card.itemTarget) {
      e.preventDefault();
      openItemTarget(card, [...cardNode.querySelectorAll('li[data-item]')].indexOf(active));
      return;
    }
    if (card && card.onItemEnter) {
      e.preventDefault();
      card.onItemEnter([...cardNode.querySelectorAll('li[data-item]')].indexOf(active));
      return;
    }
  }
  // 項目の端で、さらに下・上へ進もうとしたときは、黙らずに端だと知らせる（はじめの束の「ここが一番上です。」とそろえる）。
  // 読んだ結果の最後で下矢印を押しても何も読まれず、黙ったのか終わりなのか分からなかった（2026-11-04 の Windows の確かめ）。
  if (key === 'ArrowDown') {
    if (k === items.length - 1) announce('ここが最後です。');
    else items[k + 1].focus();
  } else if (key === 'ArrowUp') {
    if (k === 0) announce('ここが一番上です。');
    else items[k - 1].focus();
  }
  else if (key === 'Home') items[0].focus();
  else if (key === 'End') items[items.length - 1].focus();
  else if (key === 'Escape') cardNode.focus();
  else return;
  e.preventDefault();
});

// ---- ダウンロードの知らせ ----
// 押すカードの結果にならなかったダウンロード（押してから遅れて始まったもの）が終わったときに知らせる。
if (window.cardsApi.onDownloadDone) window.cardsApi.onDownloadDone((r) => announce(r.message, !r.ok));

// ---- 自動で直し始めた知らせ ----
// 読むカードは、5秒ごとの知らせと読み込み中の項目の文で「読む所を直しています」と言う。押すカードは、ここで一度だけ言う。
if (window.cardsApi.onRepairing) {
  window.cardsApi.onRepairing(({ appId, cardId }) => {
    repairingNow.add(`${appId}/${cardId}`);
    const card = stack.flatMap((d) => d.cards).find((c) => c.appId === appId && c.cardId === cardId);
    if (card && card.kind === 'click') announce('ページが変わったので、押す場所を直しています。少しお待ちください。');
  });
}

// ---- 文字の大きさの知らせ ----
if (window.cardsApi.onZoom) window.cardsApi.onZoom((r) => { if (r.message) announce(r.message); });

// ---- はじめ ----
(async () => {
  // カードの操作の準備より先に、保存された表示設定を当てる（読めなければ標準のまま）。
  try {
    if (window.cardsApi.loadSettings) applySettings(await window.cardsApi.loadSettings());
    else applySettings(DEFAULT_VIEW);
  } catch (e) {
    applySettings(DEFAULT_VIEW);
  }
  let results;
  try {
    results = await window.cardsApi.loadConfigs();
  } catch (e) {
    deckEl.replaceChildren(el('p', { text: `設定ファイルを読めませんでした。${e.message}` }));
    announce(`設定ファイルを読めませんでした。${e.message}`, true);
    return;
  }
  const configs = results.filter((r) => r.config).map((r) => r.config);
  for (const r of results) {
    if (!r.config) continue;
    if (r.generated) generatedApps.add(r.config.id);
    for (const x of r.repairs || []) repairsOf(r.config.id).set(x.cardId, x);
  }
  appConfigs = configs.slice();
  const problems = [];
  for (const r of results) {
    for (const e of r.errors || []) problems.push(`${r.file} の ${e.where}: ${e.message}`);
  }
  // はじめの束は、アプリが一つだけのときも出す（「新しいページからカードを作る」の入口があるため）。
  pushDeck(topDeck(configs, problems));
})();
