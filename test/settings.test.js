'use strict';
// 表示設定の保存（src/main/settings.js）と、文字の大きさのキー、三つの配色の文字と線の対比を確かめる。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  DEFAULT_SETTINGS, normalizeSettings, createSettingsStore, zoomKey, nextZoom, zoomMessage,
} = require('../src/main/settings');

test('知らない値はその項目だけ標準に戻し、配色の無い古い保存には標準の配色を補う', () => {
  assert.deepEqual(normalizeSettings({ preset: 'yuttari', reflow: true }), { preset: 'yuttari', reflow: true, scheme: 'standard', zoom: 1 });
  assert.deepEqual(normalizeSettings({ preset: 'big', reflow: 'yes', scheme: 'pink', zoom: 7 }), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings({ scheme: 'black', zoom: 1.25 }), { preset: 'standard', reflow: false, scheme: 'black', zoom: 1.25 });
});

test('保存した設定は、作り直した置き場からも同じに読める（次の起動でも残る）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-test-'));
  try {
    const file = path.join(dir, 'sub', 'settings.json');
    const store = createSettingsStore(file);
    assert.deepEqual(store.load(), DEFAULT_SETTINGS);
    assert.equal(store.save({ preset: 'yuttari', reflow: true, scheme: 'black' }).ok, true);
    // 渡した項目だけを書き換え、拡大率は残す。
    store.save({ zoom: 1.5 });
    assert.deepEqual(createSettingsStore(file).load(), { preset: 'yuttari', reflow: true, scheme: 'black', zoom: 1.5 });
    store.save({ scheme: 'white' });
    assert.deepEqual(createSettingsStore(file).load(), { preset: 'yuttari', reflow: true, scheme: 'white', zoom: 1.5 });
    // 壊れた中身は標準として読む。
    fs.writeFileSync(file, '{ 壊れた');
    assert.deepEqual(store.load(), DEFAULT_SETTINGS);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('書けない置き場でも落ちずに ok: false を返す（開いている間は画面の側で効く）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-test-'));
  try {
    const blocker = path.join(dir, 'file');
    fs.writeFileSync(blocker, 'x');
    const r = createSettingsStore(path.join(blocker, 'settings.json')).save({ scheme: 'black' });
    assert.equal(r.ok, false);
    assert.equal(r.settings.scheme, 'black');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('文字の大きさのキー: Windows は Ctrl、macOS は Command と、プラス・マイナス・0', () => {
  const k = (o) => ({ type: 'keyDown', alt: false, control: false, meta: false, shift: false, ...o });
  assert.equal(zoomKey(k({ control: true, key: '=' }), 'win32'), 'in');
  assert.equal(zoomKey(k({ control: true, shift: true, key: '+' }), 'win32'), 'in');
  assert.equal(zoomKey(k({ control: true, key: ';' }), 'win32'), 'in');
  assert.equal(zoomKey(k({ control: true, key: '-' }), 'win32'), 'out');
  assert.equal(zoomKey(k({ control: true, key: '0' }), 'win32'), 'reset');
  assert.equal(zoomKey(k({ meta: true, key: '=' }), 'darwin'), 'in');
  assert.equal(zoomKey(k({ meta: true, key: '-' }), 'darwin'), 'out');
  assert.equal(zoomKey(k({ control: true, code: 'NumpadAdd', key: '+' }), 'win32'), 'in');
  // 横取りしないもの: Ctrl なし・macOS の Ctrl・Alt つき・キーを離したとき・ほかの文字。
  assert.equal(zoomKey(k({ key: '=' }), 'win32'), null);
  assert.equal(zoomKey(k({ control: true, key: '=' }), 'darwin'), null);
  assert.equal(zoomKey(k({ control: true, alt: true, key: '=' }), 'win32'), null);
  assert.equal(zoomKey(k({ type: 'keyUp', control: true, key: '=' }), 'win32'), null);
  assert.equal(zoomKey(k({ control: true, key: 'f' }), 'win32'), null);
});

test('拡大率は段で動き、端では止まり、変えたときの文を一つ返す', () => {
  assert.equal(nextZoom(1, 'in'), 1.1);
  assert.equal(nextZoom(1, 'out'), 0.9);
  assert.equal(nextZoom(3, 'in'), 3);
  assert.equal(nextZoom(0.5, 'out'), 0.5);
  assert.equal(nextZoom(2, 'reset'), 1);
  assert.equal(zoomMessage(1, 1.1, 'in'), '文字の大きさを110%にしました。');
  assert.equal(zoomMessage(1.25, 1, 'reset'), '文字の大きさを100%にしました。');
  assert.equal(zoomMessage(3, 3, 'in'), '文字の大きさは、これ以上大きくできません（300%）。');
  assert.equal(zoomMessage(0.5, 0.5, 'out'), '文字の大きさは、これ以上小さくできません（50%）。');
});

// ---- 対比 ----
// style.css の三つの塊（標準・白地・黒地）から色を読み、使っている組み合わせを全部測る。
const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'style.css'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');

function colors(selector) {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `${selector} の塊がありません`);
  const body = css.slice(start, css.indexOf('}', start));
  const out = {};
  // #000 のような3桁の書き方は、6桁に広げて測る。
  for (const m of body.matchAll(/--([a-z-]+):\s*#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    const h = m[2].toLowerCase();
    out[m[1]] = `#${h.length === 3 ? [...h].map((c) => c + c).join('') : h}`;
  }
  return out;
}

function luminance(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const base = colors(':root');
const schemes = {
  標準: base,
  '高コントラスト（白地）': { ...base, ...colors('html[data-scheme="white"]') },
  '高コントラスト（黒地）': { ...base, ...colors('html[data-scheme="black"]') },
};
// 文字（7:1 以上）: [文字の色, 背景の色, 何か]
const TEXT_PAIRS = [
  ['moji', 'ji', '地の上の文字（ページの題）'],
  ['moji', 'card', 'カードの文字・入力欄の文字・ボタンの文字'],
  ['chushaku', 'card', '注釈'],
  ['focus-moji', 'focus-ji', 'フォーカス中の項目（注釈も同じ色になる）'],
  ['sel-moji', 'sel-ji', '選ばれているボタン'],
];
// 線やアイコン（3:1 以上）
const LINE_PAIRS = [
  ['kyocho', 'ji', 'カードのフォーカスの枠と地'],
  ['kyocho', 'card', '項目のフォーカスの枠とカードの面'],
  ['keisen', 'card', 'ボタンと入力欄の縁'],
  ['keisen', 'ji', '罫線と地'],
  ['rinkaku', 'ji', 'カードの輪郭と地'],
  ['sel-ji', 'card', '選ばれているボタンの縁とカードの面'],
];

function measure(pairs) {
  const all = [];
  for (const [name, s] of Object.entries(schemes)) {
    for (const [fg, bg, what] of pairs) {
      assert.ok(s[fg] && s[bg], `${name} に --${fg} か --${bg} がありません`);
      all.push({ scheme: name, what, fg: s[fg], bg: s[bg], r: ratio(s[fg], s[bg]) });
    }
  }
  return all;
}

test('三つの配色のどの組み合わせでも、文字は 7:1 以上・線は 3:1 以上', () => {
  for (const x of measure(TEXT_PAIRS)) assert.ok(x.r >= 7, `${x.scheme} の${x.what} が ${x.r.toFixed(2)}:1`);
  for (const x of measure(LINE_PAIRS)) assert.ok(x.r >= 3, `${x.scheme} の${x.what} が ${x.r.toFixed(2)}:1`);
});

test('index.html の頭のコメントに、測った最小の値（文字と線）が書いてある', () => {
  const minOf = (xs) => xs.reduce((m, x) => (x.r < m.r ? x : m));
  const text = minOf(measure(TEXT_PAIRS));
  const line = minOf(measure(LINE_PAIRS));
  const head = html.split('\n').slice(0, 3).join('\n');
  // 小数2桁で切り捨てた値を書く（書いた値より実際が下回らないように）。
  const floor2 = (r) => (Math.floor(r * 100) / 100).toFixed(2);
  assert.match(head, new RegExp(`文字 ${floor2(text.r)}:1（[^）]*${text.fg}[^）]*${text.bg}`));
  assert.match(head, new RegExp(`線 ${floor2(line.r)}:1（[^）]*${line.fg}[^）]*${line.bg}`));
});
