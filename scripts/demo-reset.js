'use strict';
// 収録の前に、Todoku をはじめの状態に戻す台本（npm run demo:reset）。消さずに、userData の中の控えのフォルダへ移す。
// 移すもの: 作ったカードの束（generated/）・その場の直し（repairs/）・表示設定と文字の大きさ（settings.json）・最初のページのフォルダ・表示名・メモ（bookmarks.json）。
// 移す先: userData/reset-backup/<日時>/ 。戻すときは npm run demo:reset -- --restore（いちばん新しい控え）か --restore <日時>。
// userData は、いまの「Todoku」（npm start も包んだアプリも。package.json の productName から決まる）と、前の版が使っていた「hackathon2026」の両方を見る（--dir で一つを指せる）。
// Todoku を閉じてから動かす（動いている間は、表示設定が閉じるときに書き戻されることがある）。

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TARGETS = ['generated', 'repairs', 'settings.json', 'bookmarks.json'];
const BACKUP_DIR = 'reset-backup';
const APP_NAMES = ['hackathon2026', 'Todoku'];

// その機械の userData の置き場の候補（Electron の app.getPath('appData') と同じ所）。
function userDataCandidates({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  let appData;
  if (platform === 'win32') appData = env.APPDATA || path.join(home, 'AppData', 'Roaming');
  else if (platform === 'darwin') appData = path.join(home, 'Library', 'Application Support');
  else appData = env.XDG_CONFIG_HOME || path.join(home, '.config');
  return APP_NAMES.map((name) => path.join(appData, name));
}

function stampOf(now) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

// 一つの userData の、作った束・直し・表示設定・フォルダと表示名とメモを控えへ移す。結果は { moved: [{ from, to }], backup }。移すものが無ければ backup は null。
function resetUserData(dir, { now = new Date() } = {}) {
  const present = TARGETS.filter((t) => fs.existsSync(path.join(dir, t)));
  if (present.length === 0) return { moved: [], backup: null };
  let backup = path.join(dir, BACKUP_DIR, stampOf(now));
  for (let n = 2; fs.existsSync(backup); n++) backup = path.join(dir, BACKUP_DIR, `${stampOf(now)}-${n}`);
  fs.mkdirSync(backup, { recursive: true });
  const moved = [];
  for (const t of present) {
    const from = path.join(dir, t);
    const to = path.join(backup, t);
    fs.renameSync(from, to);
    moved.push({ from, to });
  }
  return { moved, backup };
}

// 控えの一つ（無ければいちばん新しいもの）を、元の所へ戻す。元の所にもうあるものは上書きしない。
// 結果は { restored: [{ from, to }], kept: [{ from, to }], backup }。控えが無ければ backup は null。
function restoreUserData(dir, stamp = null) {
  const root = path.join(dir, BACKUP_DIR);
  if (!fs.existsSync(root)) return { restored: [], kept: [], backup: null };
  const names = fs.readdirSync(root).filter((n) => fs.statSync(path.join(root, n)).isDirectory()).sort();
  const name = stamp || names[names.length - 1];
  if (!name || !names.includes(name)) return { restored: [], kept: [], backup: null };
  const backup = path.join(root, name);
  const restored = [];
  const kept = [];
  for (const t of TARGETS) {
    const from = path.join(backup, t);
    if (!fs.existsSync(from)) continue;
    const to = path.join(dir, t);
    if (fs.existsSync(to)) {
      kept.push({ from, to });
      continue;
    }
    fs.renameSync(from, to);
    restored.push({ from, to });
  }
  return { restored, kept, backup };
}

function main(argv) {
  const at = (flag) => argv.indexOf(flag);
  const dirs = at('--dir') >= 0 && argv[at('--dir') + 1] ? [path.resolve(argv[at('--dir') + 1])] : userDataCandidates();
  const restore = at('--restore') >= 0;
  const stamp = restore && argv[at('--restore') + 1] && !argv[at('--restore') + 1].startsWith('--') ? argv[at('--restore') + 1] : null;
  console.log('Todoku を閉じてから動かしてください。');
  let seen = 0;
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    seen += 1;
    console.log(`userData: ${dir}`);
    if (restore) {
      const r = restoreUserData(dir, stamp);
      if (!r.backup) {
        console.log(stamp ? `  控え「${stamp}」がありません。` : '  戻す控えがありません。');
        continue;
      }
      for (const m of r.restored) console.log(`  戻した: ${path.basename(m.to)}（${m.from} から）`);
      for (const m of r.kept) console.log(`  戻さなかった（今のものがあるため。控えはそのまま）: ${path.basename(m.to)}`);
      if (r.restored.length === 0 && r.kept.length === 0) console.log('  控えの中に戻すものがありませんでした。');
    } else {
      const r = resetUserData(dir);
      if (!r.backup) {
        console.log('  移すもの（作った束・直し・表示設定・フォルダと表示名とメモ）はありませんでした。はじめの状態です。');
        continue;
      }
      for (const m of r.moved) console.log(`  移した: ${path.basename(m.from)} → ${m.to}`);
      console.log(`  戻すときは: npm run demo:reset -- --restore ${path.basename(r.backup)}${dirs.length > 1 || at('--dir') >= 0 ? ` --dir "${dir}"` : ''}`);
    }
  }
  if (seen === 0) console.log(`userData が見つかりませんでした（見た所: ${dirs.join('、')}）。はじめの状態です。`);
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { TARGETS, BACKUP_DIR, userDataCandidates, resetUserData, restoreUserData, stampOf };
