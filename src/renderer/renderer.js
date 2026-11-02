'use strict';
// カードの画面の土台。設定ファイルからカードを作る。
// カードはふつうの button にして、Tab と Enter・Space だけで全部の操作ができるようにする。
// ウェブアプリの操作（読む・押す）はまだつないでいない。

const statusEl = document.getElementById('status');

function announce(message) {
  // 同じ文を続けて入れても読まれるように、いったん空にしてから入れる。
  statusEl.textContent = '';
  setTimeout(() => { statusEl.textContent = message; }, 50);
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

// カードを押したときの処理。結果は「結果」の欄に書き、読み上げにも知らせる。
async function runCard(config, card, button) {
  if (button.getAttribute('aria-busy') === 'true') return;
  button.setAttribute('aria-busy', 'true');
  announce(`${card.title}。動かしています。`);
  let result;
  try {
    result = await window.cardsApi.runCard(config.id, card.id);
  } catch (e) {
    result = { ok: false, where: '(なし)', message: e.message };
  }
  button.removeAttribute('aria-busy');

  const heading = document.getElementById('result-heading');
  const body = document.getElementById('result-body');
  document.getElementById('result').hidden = false;
  heading.textContent = `結果: ${card.title}`;

  let message;
  if (result.needLogin) {
    message = `${result.message}。`;
  } else if (!result.ok) {
    message = `うまくいきませんでした。設定ファイルの ${result.where} が当たりません。${result.message}。`;
  } else if (result.action === 'click') {
    message = '押しました。';
  } else if (!result.text) {
    message = '読む所は見つかりましたが、文字がありません。';
  } else {
    message = result.text + (result.truncated ? '（長いので、ここで切りました）' : '');
  }
  body.textContent = message;
  announce(`${card.title}。${message}`);
}

function renderApp(config) {
  const headingId = `app-${config.id}`;
  const list = el('ul', { class: 'cards' });
  for (const card of config.cards) {
    const children = [el('span', { class: 'card-title', text: card.title })];
    if (card.description) {
      children.push(el('span', { class: 'card-description', text: card.description }));
    }
    const button = el('button', { type: 'button', class: 'card', 'data-card': card.id }, children);
    button.addEventListener('click', () => runCard(config, card, button));
    list.append(el('li', {}, [button]));
  }
  return el('section', { 'aria-labelledby': headingId }, [
    el('h2', { id: headingId, text: config.name }),
    list,
  ]);
}

function renderProblems(results) {
  const section = document.getElementById('problems');
  const list = document.getElementById('problems-list');
  list.replaceChildren();
  for (const r of results) {
    for (const e of r.errors) {
      list.append(el('li', { text: `${r.file} の ${e.where}: ${e.message}` }));
    }
  }
  section.hidden = list.children.length === 0;
}

async function start() {
  const results = await window.cardsApi.loadConfigs();
  const apps = document.getElementById('apps');
  const ok = results.filter((r) => r.config);
  apps.replaceChildren(...ok.map((r) => renderApp(r.config)));
  renderProblems(results);
  document.getElementById('loading').remove();

  const cardCount = ok.reduce((n, r) => n + r.config.cards.length, 0);
  const badCount = results.length - ok.length;
  let message = `${ok.length}件のアプリ、${cardCount}枚のカードを読みました。`;
  if (badCount > 0) message += `読めなかった設定ファイルが${badCount}件あります。`;
  announce(message);

  const first = apps.querySelector('.card');
  if (first) first.focus();
}

start().catch((e) => {
  announce(`設定ファイルを読めませんでした。${e.message}`);
});
