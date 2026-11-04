'use strict';
// VoiceOver の確かめ（test/voiceover-check.js）から起こす Todoku。作品のコードはそのまま読み、userData だけを一時のフォルダにする
// （本物の Todoku の置き場の設定・作った束・直しに触らない）。窓は出す（VoiceOver が読むため）。
// 一時のフォルダは、確かめの台本が引数で渡す。

if (!process.versions.electron) {
  require('node:test')('VoiceOver の確かめから起こす Todoku（Electron の上でだけ動く）', { skip: 'npm run voiceover:check から使う' }, () => {});
  return;
}

const { app } = require('electron');

const userData = process.argv[process.argv.length - 1];
app.setPath('userData', userData);
require('../src/main/main');
