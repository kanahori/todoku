'use strict';
// Electron の上で動かす試し（smoke・ui:repair・real:tsukuba）の頭で読み込む。
// 試しのあいだ、窓を画面に出さず、いま前にあるアプリから焦点を奪わないようにする。
// 2026-11-03: 人が別のアプリで文字を打っている最中に試しの窓が開き、打った文字がその窓に入った。
// - TODOKU_TEST_HEADLESS=1 を立てる。src/main/target.js と main.js は、これが立っているときだけ窓を見せず、前にも出さない。
// - Mac では、アプリを Dock とメニューの前に出ない種類（accessory）にする。
// 窓を見せて焦点の動きを確かめたいときは、台本に --show-windows を付ける（npm run smoke:windows）。
// そのときは窓が前に出るので、Mac を使っている人がいないときだけ動かす。

if (!process.versions.electron) {
  require('node:test')('試しの窓を出さない仕掛け（Electron の上でだけ動く）', { skip: 'Electron の試しの台本が読み込む' }, () => {});
  return;
}

const { app } = require('electron');

const showWindows = process.argv.includes('--show-windows');

if (showWindows) {
  delete process.env.TODOKU_TEST_HEADLESS;
} else {
  process.env.TODOKU_TEST_HEADLESS = '1';
  if (process.platform === 'darwin') {
    const hide = () => {
      app.setActivationPolicy('accessory');
      if (app.dock) app.dock.hide();
    };
    try {
      hide();
    } catch (e) {
      app.once('will-finish-launching', hide);
    }
  }
}

module.exports = { headless: !showWindows };
