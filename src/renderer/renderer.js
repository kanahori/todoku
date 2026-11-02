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
    renderMaintenance(config),
  ]);
}

// 設定ファイルの点検と、直しの案を選ぶ所。
function renderMaintenance(config) {
  const headingId = `maint-${config.id}`;
  const area = el('div', { class: 'maint-area' });
  const checkButton = el('button', { type: 'button', class: 'tool-button', text: '画面が変わっていないか点検する' });
  checkButton.addEventListener('click', () => checkApp(config, area, checkButton));
  return el('section', { class: 'maint', 'aria-labelledby': headingId }, [
    el('h3', { id: headingId, text: `${config.name} の設定の点検` }),
    checkButton,
    area,
  ]);
}

async function checkApp(config, area, button) {
  button.disabled = true;
  announce('点検しています。');
  const result = await window.cardsApi.checkCards(config.id);
  button.disabled = false;
  if (!result.ok) {
    area.replaceChildren(el('p', { text: result.message }));
    announce(result.message);
    return;
  }
  showProblems(config, area, result.problems);
}

function showProblems(config, area, problems) {
  if (problems.length === 0) {
    area.replaceChildren(el('p', { text: '全部のカードが当たりました。直すところはありません。' }));
    announce('全部のカードが当たりました。');
    return;
  }
  const list = el('ul', {}, problems.map((p) => el('li', { text: `${p.title ?? p.where}（${p.where}）: ${p.message}` })));
  const proposeButton = el('button', { type: 'button', class: 'tool-button', text: '直しの案を作る' });
  proposeButton.addEventListener('click', () => propose(config, area, proposeButton));
  area.replaceChildren(el('p', { text: `当たらないカードが ${problems.length}枚あります。` }), list, proposeButton);
  announce(`当たらないカードが ${problems.length}枚あります。直しの案を作るボタンがあります。`);
}

async function propose(config, area, button) {
  button.disabled = true;
  announce('直しの案を作っています。しばらくかかります。');
  const result = await window.cardsApi.proposeRepairs(config.id);
  button.disabled = false;
  if (!result.ok) {
    area.append(el('p', { text: result.message }));
    announce(result.message);
    return;
  }
  const form = el('form', { class: 'proposals' });
  result.proposals.forEach((p, i) => {
    const name = `choice-${config.id}-${i}`;
    const canUse = p.newSelector && p.matches > 0;
    const yes = el('input', { type: 'radio', name, value: 'yes', id: `${name}-yes` });
    const no = el('input', { type: 'radio', name, value: 'no', id: `${name}-no` });
    no.checked = true;
    if (!canUse) yes.disabled = true;
    const matchText = !p.newSelector ? '案はありません' : p.matches < 0 ? '書き方が正しくありません' : `今のページで ${p.matches}か所に当たります`;
    form.append(el('fieldset', { 'data-where': p.where }, [
      el('legend', { text: `${p.title}（${p.where}）` }),
      el('p', { text: `前: ${p.oldSelector}` }),
      el('p', { text: `案: ${p.newSelector || 'なし'}。${matchText}。` }),
      el('p', { text: `理由: ${p.reason}` }),
      el('label', { for: `${name}-yes` }, [yes, ' 採る']),
      el('label', { for: `${name}-no` }, [no, ' 採らない']),
    ]));
  });
  for (const e of result.errors) form.append(el('p', { text: `${e.where}: ${e.message}` }));
  const apply = el('button', { type: 'submit', class: 'tool-button', text: '採った案を設定ファイルに書く' });
  form.append(apply);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const wheres = [...form.querySelectorAll('fieldset')]
      .filter((fs) => fs.querySelector('input[value="yes"]').checked)
      .map((fs) => fs.getAttribute('data-where'));
    const r = await window.cardsApi.applyRepairs(config.id, wheres);
    if (!r.ok) {
      announce(r.message);
      form.append(el('p', { text: r.message }));
      return;
    }
    const rest = r.problems.length === 0 ? '全部のカードが当たるようになりました。' : `まだ当たらないカードが ${r.problems.length}枚あります。`;
    const msg = `${r.written}件の案を設定ファイルに書きました。${rest}`;
    area.replaceChildren(el('p', { text: msg }));
    announce(msg);
  });
  area.append(form);
  announce(`直しの案が ${result.proposals.length}件できました。1件ずつ、採るか採らないかを選んでください。`);
  const firstChoice = form.querySelector('input');
  if (firstChoice) firstChoice.focus();
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
