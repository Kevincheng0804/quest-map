#!/usr/bin/env node
// 打開桌面上的闖關地圖。第一次會下載桌面視窗元件（Electron，約 100 MB）到使用者層級的共用資料夾，
// Claude Code、Cowork 共用同一份。
// 用法：node launch.js [--data <其他要先找的資料夾>] [--auto]
//   --auto：只在已經安裝過時才啟動，不下載、不出聲（給 SessionStart hook 用）
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');
const { PORT, sharedDir, candidateDirs, findElectron, alive, spawnApp, replaceIfOld, myVersion, isRemote } = require('./runtime');

const args = process.argv.slice(2);
const auto = args.includes('--auto');
const dataArg = args.includes('--data') ? args[args.indexOf('--data') + 1] : '';
// 這次是誰要開地圖：hook 自動開（哪個專案）或使用者自己輸入 /quest-map:open
const opener = auto ? { by: 'code', projectDir: process.env.CLAUDE_PROJECT_DIR } : { by: 'manual' };
let upgraded = false;
const say = t => { if (!auto) console.log(t); };

function post(urlPath) {
  return new Promise(resolve => {
    const req = http.request({ host: '127.0.0.1', port: PORT(), path: urlPath, method: 'POST', headers: { 'content-type': 'application/json' }, timeout: 600 },
      res => { res.resume(); res.on('end', () => resolve(res.statusCode < 300)); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end('{}');
  });
}

(async () => {
  if (isRemote()) return say('這個對話跑在雲端，闖關地圖在你的電腦上，從這裡打不開。請在桌面版的 Claude Code 選在你的電腦上執行（不是雲端），再輸入 /quest-map:open。');
  const dirs = candidateDirs(dataArg);
  if (await alive()) {
    // 開著的是別的版本：要它自己結束，換成這個外掛的版本
    const st = await replaceIfOld({ canStart: !!findElectron(dirs) });
    if (st === 'same') {
      if (!auto) await post('/show');
      return say('闖關地圖已經開著，已把它叫到最前面。');
    }
    if (st === 'cannot') {
      return say(`闖關地圖開著的是舊版（這個外掛是 ${myVersion()}），而且舊版不能自動關閉。請先關掉它再重新執行一次：按地圖右上角的 X，或在 PowerShell 執行 Get-Process electron | Stop-Process`);
    }
    if (st === 'cannot-start') {
      return say('闖關地圖已經開著（版本跟這個外掛不同），但找不到新版的桌面元件，所以沒有換。請先不加 --auto 執行一次 /quest-map:open 完成安裝。');
    }
    upgraded = true;
    say('已把舊版地圖換成新版。');
  }
  let electron = findElectron(dirs);
  if (!electron) {
    if (auto) return;
    const dir = sharedDir();
    say(`第一次使用，正在下載桌面視窗元件到 ${dir}（約 100 MB，需要一兩分鐘）…`);
    fs.mkdirSync(dir, { recursive: true });
    const pkg = path.join(dir, 'package.json');
    if (!fs.existsSync(pkg)) fs.writeFileSync(pkg, JSON.stringify({ name: 'quest-map-runtime', private: true }));
    try {
      execSync('npm install electron@33 --no-audit --no-fund --loglevel=error', { cwd: dir, stdio: 'inherit' });
    } catch {
      console.error('下載失敗。請確認已安裝 Node.js 18 以上、網路可以連到 npm，再試一次。');
      process.exit(1);
    }
    electron = findElectron(candidateDirs(dataArg));
    if (!electron) { console.error('找不到下載好的桌面視窗元件。'); process.exit(1); }
  }
  spawnApp(electron, __dirname, upgraded ? { ...opener, upgraded: true } : opener);
  say('闖關地圖已打開。按視窗右上的「縮到旁邊」可以收成螢幕邊緣的水位。');
})();
