'use strict';
// 最初のページを、ブックマークのように使うための保存（フォルダ・ページのカードの表示名とメモ・どのフォルダに入れたか）。
// 置き場は app.getPath('userData') の下の bookmarks.json。書くのは主の処理だけ（表示設定の settings.json と同じ作り）。
// 形が崩れた所は、その所だけ捨てて読む。ファイルが壊れていても、空のブックマークとして起動する。
//
// 形:
// {
//   "folders": [{ "id": "f-abc", "name": "天気" }],          // 並びは作った順
//   "pages": { "<アプリの id>": { "folder": "f-abc", "name": "表示名", "memo": "メモ" } }  // どれも任意
// }

const fs = require('node:fs');
const path = require('node:path');

const FOLDER_ID = /^f-[a-z0-9]{1,24}$/;
const APP_ID = /^[a-z0-9][a-z0-9-]*$/;
const MAX_FOLDERS = 100;
const FOLDER_NAME_MAX = 40;
const PAGE_NAME_MAX = 60;
const MEMO_MAX = 300;

const EMPTY = Object.freeze({ folders: [], pages: {} });

// 前後の空白を落とし、改行や続く空白を一つの空白にし、長さを切る。
function cleanText(value, max) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function normalizeBookmarks(raw) {
  const x = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const folders = [];
  const ids = new Set();
  const names = new Set();
  for (const f of Array.isArray(x.folders) ? x.folders : []) {
    if (!f || typeof f !== 'object') continue;
    const id = typeof f.id === 'string' && FOLDER_ID.test(f.id) ? f.id : null;
    const name = cleanText(f.name, FOLDER_NAME_MAX);
    if (!id || !name || ids.has(id) || names.has(name)) continue;
    ids.add(id);
    names.add(name);
    folders.push({ id, name });
    if (folders.length >= MAX_FOLDERS) break;
  }
  const pages = {};
  const rawPages = x.pages && typeof x.pages === 'object' && !Array.isArray(x.pages) ? x.pages : {};
  for (const [appId, p] of Object.entries(rawPages)) {
    if (!APP_ID.test(appId) || !p || typeof p !== 'object') continue;
    const entry = {};
    if (typeof p.folder === 'string' && ids.has(p.folder)) entry.folder = p.folder;
    const name = cleanText(p.name, PAGE_NAME_MAX);
    if (name) entry.name = name;
    const memo = cleanText(p.memo, MEMO_MAX);
    if (memo) entry.memo = memo;
    if (Object.keys(entry).length > 0) pages[appId] = entry;
  }
  return { folders, pages };
}

function createBookmarksStore(file) {
  return {
    file,
    load() {
      try {
        return normalizeBookmarks(JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')));
      } catch (e) {
        return { folders: [], pages: {} };
      }
    },
    // 渡された中身を、形をそろえてから丸ごと書く。書けたら ok: true。
    save(raw) {
      const next = normalizeBookmarks(raw);
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
        return { ok: true, bookmarks: next };
      } catch (e) {
        return { ok: false, bookmarks: next };
      }
    },
  };
}

function registerBookmarksHandlers(ipcMain, store) {
  ipcMain.handle('bookmarks:load', () => store.load());
  ipcMain.handle('bookmarks:save', (_event, raw) => store.save(raw));
}

module.exports = {
  EMPTY, FOLDER_NAME_MAX, PAGE_NAME_MAX, MEMO_MAX, MAX_FOLDERS, normalizeBookmarks, createBookmarksStore, registerBookmarksHandlers,
};
