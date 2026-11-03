'use strict';
// 表示設定（基のカード型ページの三つ: 読みやすさ・1列リフロー表示・配色）と、文字の大きさ（拡大率）を、次の起動でも残す。
// 置き場は app.getPath('userData') の下の settings.json。書くのは主の処理だけ。
// 知らない値が入っていたら、その項目だけ標準に戻す。保存できなくても、開いている間は画面の側で効く。

const fs = require('node:fs');
const path = require('node:path');

const PRESETS = ['standard', 'yuttari'];
const SCHEMES = ['standard', 'white', 'black'];
// 拡大率の段（ブラウザの拡大縮小と同じような刻み）。
const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

const DEFAULT_SETTINGS = Object.freeze({ preset: 'standard', reflow: false, scheme: 'standard', zoom: 1 });

function normalizeSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    preset: PRESETS.includes(s.preset) ? s.preset : DEFAULT_SETTINGS.preset,
    reflow: typeof s.reflow === 'boolean' ? s.reflow : DEFAULT_SETTINGS.reflow,
    // 配色の設定が無い古い保存には、標準の配色を補う。
    scheme: SCHEMES.includes(s.scheme) ? s.scheme : DEFAULT_SETTINGS.scheme,
    zoom: ZOOM_STEPS.includes(s.zoom) ? s.zoom : DEFAULT_SETTINGS.zoom,
  };
}

function createSettingsStore(file) {
  return {
    file,
    load() {
      try {
        return normalizeSettings(JSON.parse(fs.readFileSync(file, 'utf8')));
      } catch (e) {
        return { ...DEFAULT_SETTINGS };
      }
    },
    // 渡された項目だけを書き換え、残りは保存してある値のままにする。書けたら true。
    save(partial) {
      const next = normalizeSettings({ ...this.load(), ...(partial && typeof partial === 'object' ? partial : {}) });
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
        return { ok: true, settings: next };
      } catch (e) {
        return { ok: false, settings: next };
      }
    },
  };
}

// 画面からの読み書き。画面から受け取るのは三つの表示設定だけ（拡大率は主の処理がキーで変える）。
function registerSettingsHandlers(ipcMain, store) {
  ipcMain.handle('settings:load', () => store.load());
  ipcMain.handle('settings:save', (_event, s) => {
    const x = s && typeof s === 'object' ? s : {};
    return store.save({ preset: x.preset, reflow: x.reflow, scheme: x.scheme });
  });
}

// ---- 文字の大きさ（拡大率）----
// 窓のメニューを外しているので、Windows ではブラウザの Ctrl＋プラス・マイナスが効かない。主の処理でキーを受け、拡大率を変える。
// Windows は Ctrl、macOS は Command。Alt・Shift 以外の組み合わせ（Ctrl と Command の両方など）は受けない。
function zoomKey(input, platform = process.platform) {
  if (!input || input.type !== 'keyDown' || input.alt) return null;
  const mod = platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta;
  if (!mod) return null;
  const key = String(input.key || '');
  const code = String(input.code || '');
  // 日本語の配列では、プラスは「;」のキーにある（Shift なしでも拡大にする）。
  // Ctrl と Shift と「;」で拡大できなかった（2026-11-03 の Windows の確かめ）。キーの配列の設定が日本語でないと、
  // 同じキーが「:」と読まれる。押したキーの場所（code が Semicolon）でも拡大にする（Chrome や Edge と同じ押し方で効くように）。
  if (['+', '=', ';'].includes(key) || code === 'NumpadAdd' || code === 'Semicolon') return 'in';
  if (['-', '_'].includes(key) || code === 'NumpadSubtract') return 'out';
  if (key === '0' || code === 'Numpad0') return 'reset';
  return null;
}

function nextZoom(current, direction) {
  const at = ZOOM_STEPS.indexOf(ZOOM_STEPS.includes(current) ? current : 1);
  if (direction === 'reset') return 1;
  if (direction === 'in') return ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, at + 1)];
  if (direction === 'out') return ZOOM_STEPS[Math.max(0, at - 1)];
  return ZOOM_STEPS[at];
}

function zoomPercent(factor) { return Math.round(factor * 100); }

// 変えたときに一度だけ読ませる文。端でそれ以上変わらないときも黙らない。
function zoomMessage(before, after, direction) {
  if (before === after && direction === 'in') return `文字の大きさは、これ以上大きくできません（${zoomPercent(after)}%）。`;
  if (before === after && direction === 'out') return `文字の大きさは、これ以上小さくできません（${zoomPercent(after)}%）。`;
  return `文字の大きさを${zoomPercent(after)}%にしました。`;
}

// 窓に、拡大率のキーを付ける。保存してある拡大率を、読み込むたびに当てる。変えたら onChange(文) を呼ぶ。
function attachZoomKeys(webContents, store, onChange, platform = process.platform) {
  webContents.on('did-finish-load', () => webContents.setZoomFactor(store.load().zoom));
  webContents.on('before-input-event', (event, input) => {
    const direction = zoomKey(input, platform);
    if (!direction) return;
    event.preventDefault();
    const before = store.load().zoom;
    const after = nextZoom(before, direction);
    webContents.setZoomFactor(after);
    store.save({ zoom: after });
    onChange(zoomMessage(before, after, direction));
  });
}

module.exports = {
  PRESETS, SCHEMES, ZOOM_STEPS, DEFAULT_SETTINGS,
  normalizeSettings, createSettingsStore, registerSettingsHandlers,
  zoomKey, nextZoom, zoomMessage, attachZoomKeys,
};
