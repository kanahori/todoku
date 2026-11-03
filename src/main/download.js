'use strict';
// ウェブアプリの窓で始まったダウンロードを扱う所。
// 保存のダイアログは出さず、ダウンロードのフォルダに元の名前で保存する（同じ名前があれば番号を付ける）。
// 押すカードに保存の名前の型（saveAs）があれば、その名前で保存する。
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
// 先に「:」などを「_」に替えてから、フォルダの部分（/ と \ より前）を外す。
// 先に basename をかけると、Windows では「a:」をドライブの名前として扱い、その前が消える（2026-11-03 の Windows の試し）。
// path.win32 と path.posix の両方で外すので、どの OS で動かしても同じ結果になる。
function safeFileName(name) {
  const replaced = String(name || '').replace(/[:*?"<>|\u0000-\u001f]/g, '_');
  const base = path.posix.basename(path.win32.basename(replaced)).replace(/[\\/]/g, '_').replace(/^[\s.]+|[\s.]+$/g, '');
  return base || 'ダウンロード';
}

// 日付を yyyy-mm-dd にする（その機械の時刻で）。
function formatDate(d) {
  const pad = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 保存の名前の型（設定ファイルの押すカードの saveAs）から、保存の名前を作る。
// {date} は保存した日（yyyy-mm-dd）に替える。{n} は残し、uniquePath が番号に替える。
// 型に拡張子が無ければ、ウェブアプリが付けた元の名前の拡張子を足す。
function nameFromPattern(pattern, original, now = new Date()) {
  let name = String(pattern).replace(/\{date\}/g, formatDate(now));
  if (!path.extname(name.replace(/\{n\}/g, '1'))) name += path.extname(safeFileName(original));
  return safeFileName(name);
}

// dir の中で、まだ使われていない名前のパスを返す。
// 名前に {n} があれば、1 から順に番号を入れて、使われていない最初のものにする。
// 無ければ、同じ名前があるときだけ「名前 (1).拡張子」のように番号を付ける。
function uniquePath(dir, name, exists = fs.existsSync) {
  if (name.includes('{n}')) {
    for (let n = 1; ; n++) {
      const candidate = path.join(dir, name.replace(/\{n\}/g, String(n)));
      if (!reserved.has(candidate) && !exists(candidate)) return candidate;
    }
  }
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
    // 待っている押すカードに保存の名前の型があれば、それで名前を作る。
    const pattern = [...waiters].map((w) => w.saveAs).find(Boolean);
    const name = pattern ? nameFromPattern(pattern, item.getFilename()) : safeFileName(item.getFilename());
    try {
      const dir = getDir();
      fs.mkdirSync(dir, { recursive: true });
      file = uniquePath(dir, name);
    } catch (e) {
      item.cancel();
      const r = { name: name.replace(/\{n\}/g, '1'), ok: false };
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
// saveAs（任意）: 保存の名前の型。始まったダウンロードを、この型の名前で保存する。
function watchDownload({ saveAs = null } = {}) {
  if (!attached) return { wait: () => Promise.resolve(null), cancel() {} };
  let started = null;
  let onStarted = null;
  const onStart = (entry) => {
    waiters.delete(onStart);
    entry.claimed = true;
    started = entry;
    if (onStarted) onStarted(entry);
  };
  onStart.saveAs = saveAs;
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

module.exports = { attachDownloads, watchDownload, uniquePath, safeFileName, nameFromPattern, formatDate, downloadMessage };
