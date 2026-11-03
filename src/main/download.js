'use strict';
// ウェブアプリの窓で始まったダウンロードを扱う所。
// 保存のダイアログは出さず、ダウンロードのフォルダに元の名前で保存する（同じ名前があれば番号を付ける）。
// 押すカードで始まったダウンロードは、そのカードの結果として返す（runCard が watchDownload で受け取る）。
// それより後に始まったものは、onDone で画面に知らせる。

const fs = require('node:fs');
const path = require('node:path');

// 待っている押すカード（ダウンロードが始まったら呼ぶ関数）。
const waiters = new Set();
// 保存の途中で、まだファイルになっていない名前（同じ名前を二つの保存に渡さないため）。
const reserved = new Set();
let attached = false;

// ファイル名として使えない文字を替える。空なら「ダウンロード」にする。
function safeFileName(name) {
  const base = path.basename(String(name || '')).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^[\s.]+|[\s.]+$/g, '');
  return base || 'ダウンロード';
}

// dir の中で、まだ使われていない名前のパスを返す。同じ名前があれば「名前 (1).拡張子」のように番号を付ける。
function uniquePath(dir, name, exists = fs.existsSync) {
  const ext = path.extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  for (let n = 0; ; n++) {
    const candidate = path.join(dir, n === 0 ? name : `${stem} (${n})${ext}`);
    if (!reserved.has(candidate) && !exists(candidate)) return candidate;
  }
}

// 知らせの文。
function downloadMessage({ name, ok }) {
  return ok ? `「${name}」をダウンロードのフォルダに保存しました。` : `「${name}」を保存できませんでした。`;
}

// session の will-download を受ける。getDir は保存先のフォルダを返す関数（試しでは一時のフォルダ）。
// onDone({ name, ok, message }) は、押すカードが受け取らなかったダウンロードが終わったときに呼ぶ。
function attachDownloads(session, { getDir, onDone = () => {} }) {
  if (attached) return;
  attached = true;
  session.on('will-download', (_event, item) => {
    let file;
    try {
      const dir = getDir();
      fs.mkdirSync(dir, { recursive: true });
      file = uniquePath(dir, safeFileName(item.getFilename()));
    } catch (e) {
      item.cancel();
      const r = { name: safeFileName(item.getFilename()), ok: false };
      onDone({ ...r, message: downloadMessage(r) });
      return;
    }
    reserved.add(file);
    // 保存先を先に決めると、ダイアログは出ない。
    item.setSavePath(file);
    const entry = { claimed: false };
    entry.done = new Promise((resolve) => {
      item.once('done', (_e, state) => {
        reserved.delete(file);
        const r = { name: path.basename(file), ok: state === 'completed' };
        resolve({ ...r, message: downloadMessage(r) });
      });
    });
    for (const w of [...waiters]) w(entry);
    entry.done.then((r) => { if (!entry.claimed) onDone(r); });
  });
}

// 押す前に呼び、押した後に wait で受け取る（押してから待ち受けると、すぐ始まるダウンロードを取り逃がすため）。
// wait({ startMs, doneMs }): 押した後 startMs のあいだにダウンロードが始まったら、終わるまで（最長 doneMs）待って { name, ok, message } を返す。
// 始まらなければ null。終わるのが遅いときは null を返し、終わったときの知らせは onDone に任せる。
// cancel(): 押さなかったときに待ち受けをやめる。
function watchDownload() {
  if (!attached) return { wait: () => Promise.resolve(null), cancel() {} };
  let started = null;
  let onStarted = null;
  const onStart = (entry) => {
    waiters.delete(onStart);
    entry.claimed = true;
    started = entry;
    if (onStarted) onStarted(entry);
  };
  waiters.add(onStart);
  const cancel = () => waiters.delete(onStart);
  const wait = ({ startMs = 1000, doneMs = 60000 } = {}) => new Promise((resolve) => {
    const follow = (entry) => {
      const doneTimer = setTimeout(() => {
        entry.claimed = false;
        resolve(null);
      }, doneMs);
      entry.done.then((r) => {
        clearTimeout(doneTimer);
        if (entry.claimed) resolve(r);
      });
    };
    if (started) {
      follow(started);
      return;
    }
    const startTimer = setTimeout(() => {
      cancel();
      resolve(null);
    }, startMs);
    onStarted = (entry) => {
      clearTimeout(startTimer);
      follow(entry);
    };
  });
  return { wait, cancel };
}

module.exports = { attachDownloads, watchDownload, uniquePath, safeFileName, downloadMessage };
